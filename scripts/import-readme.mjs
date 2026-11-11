// One-time migration: turns the deal tables in README.md into one YAML file per deal.
// Usage: node scripts/import-readme.mjs [--year 2026] [--write]
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Document } from "yaml";
import { readmeRow, savingsEmoji } from "./lib/catalog.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const year = args.includes("--year") ? args[args.indexOf("--year") + 1] : "2026";
const write = args.includes("--write");

const lines = readFileSync(join(root, "README.md"), "utf8").split(/\r?\n/);

// author time of every README line, to keep first-come-first-served order
const blame = new Map();
{
  const out = execFileSync("git", ["blame", "--line-porcelain", "README.md"], {
    cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  let lineNo = null, time = null;
  for (const l of out.split("\n")) {
    const head = l.match(/^[0-9a-f^]{40} \d+ (\d+)/);
    if (head) lineNo = Number(head[1]);
    else if (l.startsWith("author-time ")) time = Number(l.slice(12));
    else if (l.startsWith("\t")) blame.set(lineNo, time);
  }
}

const slugify = (text) =>
  text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const decode = (text) => text.replace(/&#95;/g, "_");

const categories = [];
const problems = [];
let anchor = null, current = null, inTable = false;

lines.forEach((raw, index) => {
  const line = raw.trim();
  const a = line.match(/^<a id="([^"]+)"><\/a>$/);
  if (a) { anchor = a[1]; return; }
  if (line.startsWith("## ")) {
    inTable = false;
    current = null;
    if (anchor) {
      const [emoji, ...rest] = line.slice(3).split(" ");
      current = { slug: anchor.replace(/-+/g, "-"), anchor, emoji, title: rest.join(" "), deals: [] };
      categories.push(current);
      anchor = null;
    }
    return;
  }
  if (!current || !line.startsWith("|")) { inTable = false; return; }
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  if (cells[0] === "Savings") { inTable = true; return; }
  if (!inTable || cells.every((c) => /^:?-{3,}:?$/.test(c))) return;
  if (cells.length !== 5) { problems.push(`line ${index + 1}: ${cells.length} cells`); return; }

  const [emoji, nameCell, description, discount, termsRaw] = cells;
  const link = nameCell.match(/^\[(.+)\]\((\S+)\)$/);
  if (!link) { problems.push(`line ${index + 1}: name is not a single link: ${nameCell}`); return; }

  const deal = { name: link[1], url: link[2], description, discount };

  // percentage: taken from the discount text, kept only when it agrees with the row's emoji
  // (an offer with several percentages uses the first one that matches the emoji the submitter chose)
  const pcts = [...discount.matchAll(/(\d{1,3})\s?%/g)].map((m) => Number(m[1]));
  const pct = pcts.find((value) => savingsEmoji(value) === emoji);
  if (pct !== undefined) deal.percent = pct;
  else if (emoji !== "—") {
    // no usable percentage in the text: work it out from a "was -> now" price pair, else flag it
    const prices = discount.match(/~~\D*([\d.,]+)~~\s*\D?([\d.,]+)/) ?? discount.match(/([\d.,]+)\s*→\s*\D?([\d.,]+)/);
    const was = prices && Number(prices[1].replace(/,/g, ""));
    const now = prices && Number(prices[2].replace(/,/g, ""));
    const computed = was > now && now > 0 ? Math.round(((was - now) / was) * 100) : null;
    deal.percent = computed !== null && savingsEmoji(computed) === emoji ? computed : null;
  }

  // code and dates: only the canonical "**CODE**; terms; YYYY-MM-DD to YYYY-MM-DD" shape is split
  let terms = termsRaw;
  const range = terms.match(/(?:^|; )(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/);
  if (range) {
    deal._starts = range[1];
    deal._ends = range[2];
    terms = terms.slice(0, range.index);
  }
  const code = terms.match(/^\*\*([^*\s]+)\*\*(?:; |$)/);
  if (code && !terms.slice(code[0].length).includes("**")) {
    deal.code = decode(code[1]);
    terms = terms.slice(code[0].length);
  }
  if (terms) deal.terms = terms;
  if (deal._starts) { deal.starts = deal._starts; deal.ends = deal._ends; }
  delete deal._starts; delete deal._ends;

  deal._line = index + 1;
  deal._emoji = emoji;
  deal._raw = raw;
  deal._time = blame.get(index + 1) ?? 0;
  current.deals.push(deal);
});

let exact = 0, normalized = 0;
const mismatches = [];
const emojiIssues = [];
const out = [];

for (const category of categories) {
  // order key: git time of the row, clamped so the current README order is kept exactly
  for (let i = category.deals.length - 2; i >= 0; i--) {
    category.deals[i]._time = Math.min(category.deals[i]._time, category.deals[i + 1]._time - 1);
  }
  const used = new Set();
  for (const deal of category.deals) {
    if (deal.percent === null || (deal.percent !== undefined && savingsEmoji(deal.percent) !== deal._emoji)) {
      emojiIssues.push(`line ${deal._line} [${deal._emoji}] ${deal.name}: ${deal.discount}`);
    }
    if (deal.percent === null) delete deal.percent;
    let slug = slugify(deal.name) || slugify(new URL(deal.url).hostname);
    for (let n = 2; used.has(slug); n++) slug = `${slugify(deal.name)}-${n}`;
    used.add(slug);
    deal.added = new Date(deal._time * 1000).toISOString().replace(".000Z", "Z");

    const row = readmeRow(deal);
    if (row === deal._raw.trim()) exact++;
    else if (decode(row) === decode(deal._raw.trim())) normalized++;
    else mismatches.push(`line ${deal._line}\n  was: ${deal._raw.trim()}\n  now: ${row}`);

    const data = {};
    for (const key of ["name", "url", "description", "discount", "percent", "code", "terms", "starts", "ends", "added"]) {
      if (deal[key] !== undefined) data[key] = deal[key];
    }
    const doc = new Document(data);
    out.push({ path: join("deals", year, category.slug, `${slug}.yml`), text: doc.toString({ defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", lineWidth: 0 }) });
  }
}

const total = categories.reduce((n, c) => n + c.deals.length, 0);
console.log(`${total} deals in ${categories.length} categories`);
console.log(`round trip: ${exact} identical, ${normalized} identical after entity decoding, ${mismatches.length} different`);
if (problems.length) console.log("PROBLEMS:\n" + problems.join("\n"));
if (emojiIssues.length) console.log("EMOJI vs PERCENT:\n" + emojiIssues.join("\n"));
if (mismatches.length) console.log("MISMATCHES:\n" + mismatches.join("\n"));

if (write) {
  rmSync(join(root, "deals", year), { recursive: true, force: true });
  mkdirSync(join(root, "deals"), { recursive: true });
  const catDoc = new Document(categories.map(({ slug, title, emoji, anchor }) => ({ slug, title, emoji, anchor })));
  writeFileSync(join(root, "deals", "categories.yml"), catDoc.toString({ lineWidth: 0 }));
  for (const category of categories) mkdirSync(join(root, "deals", year, category.slug), { recursive: true });
  for (const file of out) writeFileSync(join(root, file.path), file.text);
  console.log(`wrote ${out.length} files`);
}
