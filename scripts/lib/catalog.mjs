// Loads the deal catalog: deals/categories.yml plus one YAML file per deal in
// deals/<year>/<category>/<slug>.yml. Everything else (README, website) is built from this.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { parse } from "yaml";

export const DEAL_FIELDS = [
  "name", "url", "description", "discount", "percent", "code", "terms", "starts", "ends", "added",
];

export function loadCategories(root) {
  return parse(readFileSync(join(root, "deals", "categories.yml"), "utf8"));
}

// Savings tier shown as an emoji in the README: under 50%, 50% or more, or no percentage.
export function savingsEmoji(percent) {
  if (typeof percent !== "number") return "—";
  return percent >= 50 ? "💸" : "💰";
}

// Time each deal file was first committed, used for first-come-first-served order
// when a deal has no explicit `added` value. Needs full git history.
export function gitAddedTimes(root, dir) {
  const times = new Map();
  try {
    const out = execFileSync(
      "git",
      ["log", "--diff-filter=A", "--name-only", "--format=@%aI", "--", dir],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
    let current = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("@")) current = line.slice(1);
      else if (line.trim()) times.set(line.trim(), current); // oldest commit wins: log is newest first
    }
  } catch {
    // Not a git checkout: fall back to file-name order.
  }
  return times;
}

export function loadCatalog(root, year) {
  const categories = loadCategories(root);
  const yearDir = join(root, "deals", String(year));
  const gitTimes = gitAddedTimes(root, join("deals", String(year)));

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
      return ta - tb || a.slug.localeCompare(b.slug);
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
