// Loads the deal catalog: deals/categories.yml plus one YAML file per deal in
// deals/<year>/<category>/<slug>.yml. Everything else (README, website) is built from this.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");

export const REQUIRED_FIELDS = ["name", "url", "description", "discount"];
export const DEAL_FIELDS = [
  "name", "url", "description", "discount", "percent", "code", "terms", "starts", "ends", "added",
];

export function loadCategories(root) {
  return parse(readFileSync(join(root, "deals", "categories.yml"), "utf8"));
}

// The year the README and the website show: the newest deals/<year> folder.
export function latestYear(root) {
  const dir = join(root, "deals");
  const years = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
        .map((entry) => Number(entry.name))
    : [];
  return years.length ? Math.max(...years) : new Date().getFullYear();
}

// Savings tier shown as an emoji in the README: under 50%, 50% or more, or no percentage.
export function savingsEmoji(percent) {
  if (typeof percent !== "number") return "—";
  return percent >= 50 ? "💸" : "💰";
}

// Two deals are the same offer when the product name and the page they link to match.
// Protocol, "www.", a trailing slash, the query string and the fragment are ignored,
// so a second submission with a different tracking parameter is still a duplicate.
export function dealKey(deal) {
  const name = String(deal.name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  let url = String(deal.url ?? "").trim();
  try {
    const parsed = new URL(url);
    url = parsed.hostname.toLowerCase().replace(/^www\./, "") + parsed.pathname.replace(/\/+$/, "");
  } catch {
    url = url.toLowerCase();
  }
  return `${name}\n${url}`;
}

// Time each deal file landed on the current branch, used for first-come-first-served
// order when a deal has no explicit `added` value. Needs full git history.
//
// "Landed" is the commit time on the first-parent line: for a merged pull request that
// is the moment it was merged (merge commit, squash and rebase alike), so a new deal
// always goes below the ones merged before it, whatever date its own commits carry.
// A renamed or moved file keeps the time of the file it came from.
export function gitAddedTimes(root, dir) {
  const times = new Map();
  let out;
  try {
    out = execFileSync(
      "git",
      [
        "-c", "core.quotepath=off",
        "log", "--first-parent", "-m", "--reverse", "--relative",
        "-M90%", "--diff-filter=ADR", "--name-status", "--format=@%cI",
        "--", dir.split("\\").join("/"),
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return times; // not a git checkout: the caller falls back to file-name order
  }
  let current = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("@")) { current = line.slice(1); continue; }
    const [status, path, renamedTo] = line.split("\t");
    if (!path) continue;
    if (status === "A") times.set(path, current);
    else if (status === "D") times.delete(path);
    else if (status.startsWith("R") && renamedTo) {
      const landed = times.get(path) ?? current;
      times.delete(path);
      times.set(renamedTo, landed);
    }
  }
  return times;
}

// A shallow clone has no history, so every file looks as if it landed at the same moment.
export function isShallowClone(root) {
  try {
    return execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim() === "true";
  } catch {
    return false;
  }
}

// options.gitTimes: a Map of "deals/<year>/<category>/<file>.yml" to ISO time, to use
// instead of asking git (tests, or callers that already have it).
export function loadCatalog(root, year, options = {}) {
  const categories = loadCategories(root);
  const yearDir = join(root, "deals", String(year));
  const gitTimes = options.gitTimes ?? gitAddedTimes(root, join("deals", String(year)));

  return categories.map((category) => {
    const dir = join(yearDir, category.slug);
    const files = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(".yml")).sort() : [];
    const deals = files.map((file) => {
      const path = relative(root, join(dir, file)).split("\\").join("/");
      const data = parse(readFileSync(join(dir, file), "utf8")) ?? {};
      const added = data.added ?? gitTimes.get(path) ?? null;
      return { ...data, added, slug: file.replace(/\.yml$/, ""), category: category.slug, path };
    });
    // First come, first served. Deals without a known time sort last, by file name.
    deals.sort((a, b) => {
      const ta = a.added ? Date.parse(a.added) : Infinity;
      const tb = b.added ? Date.parse(b.added) : Infinity;
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    return { ...category, deals };
  });
}

export function escapeCell(text) {
  return String(text).replace(/\|/g, "&#124;");
}

// The "Code & Terms" cell: code first, then free-text terms, then the date range.
export function termsCell(deal) {
  const parts = [];
  if (deal.code) parts.push(`**${deal.code}**`);
  if (deal.terms) parts.push(deal.terms);
  if (deal.starts && deal.ends) parts.push(`${deal.starts} to ${deal.ends}`);
  else if (deal.ends) parts.push(`until ${deal.ends}`);
  else if (deal.starts) parts.push(`from ${deal.starts}`);
  return parts.join("; ");
}

export function readmeRow(deal) {
  const cells = [
    savingsEmoji(deal.percent),
    `[${deal.name}](${deal.url})`,
    deal.description,
    deal.discount,
    termsCell(deal),
  ];
  return `| ${cells.map(escapeCell).join(" | ")} |`;
}
