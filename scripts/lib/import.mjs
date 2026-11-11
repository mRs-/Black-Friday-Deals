// Reads the deal tables of a README (the format this list used before deals moved to
// YAML files) and turns rows into deal data. Used by scripts/import-readme.mjs.
import { Document } from "yaml";
import { DEAL_FIELDS, dealKey, readmeRow, savingsEmoji } from "./catalog.mjs";

export const slugify = (text) =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const decodeEntities = (text) => text.replace(/&#95;/g, "_");

// One table row (five trimmed cells) to deal fields. Returns { deal, emoji } or { problem }.
export function parseRow(cells) {
  if (cells.length !== 5) return { problem: `${cells.length} cells instead of 5` };
  const [emoji, nameCell, description, discount, termsRaw] = cells;
  const link = nameCell.match(/^\[(.+)\]\((\S+)\)$/);
  if (!link) return { problem: `name is not a single link: ${nameCell}` };

  const deal = { name: link[1], url: link[2], description, discount };

  // percentage: taken from the discount text, kept only when it agrees with the row's emoji
  // (an offer with several percentages uses the first one that matches the emoji the submitter chose)
  const percentages = [...discount.matchAll(/(\d{1,3})\s?%/g)].map((match) => Number(match[1]));
  const percent = percentages.find((value) => savingsEmoji(value) === emoji);
  if (percent !== undefined) {
    deal.percent = percent;
  } else if (emoji !== "—") {
    // no usable percentage in the text: work it out from a "was -> now" price pair
    const prices = discount.match(/~~\D*([\d.,]+)~~\s*\D?([\d.,]+)/) ?? discount.match(/([\d.,]+)\s*→\s*\D?([\d.,]+)/);
    const was = prices && Number(prices[1].replace(/,/g, ""));
    const now = prices && Number(prices[2].replace(/,/g, ""));
    const computed = was > now && now > 0 ? Math.round(((was - now) / was) * 100) : null;
    if (computed !== null && savingsEmoji(computed) === emoji) deal.percent = computed;
  }

  // code and dates: only the canonical "**CODE**; terms; YYYY-MM-DD to YYYY-MM-DD" shape is split,
  // anything else (several codes, "until ...", free-text dates) stays in terms untouched
  let terms = termsRaw;
  let range = terms.match(/(?:^|; )(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/);
  if (range) terms = terms.slice(0, range.index);
  const code = terms.match(/^\*\*([^*\s]+)\*\*(?:; |$)/);
  if (code && !terms.slice(code[0].length).includes("**")) {
    deal.code = decodeEntities(code[1]);
    terms = terms.slice(code[0].length);
  }
  if (terms) deal.terms = terms;
  if (range) { deal.starts = range[1]; deal.ends = range[2]; }

  return { deal, emoji };
}

// All deal rows of a README, per category. A category is a "## " heading that follows an
// <a id="..."></a> line; other tables (the legend) are ignored.
// Returns { categories: [{ slug, anchor, emoji, title, rows: [{ line, raw, emoji, deal }] }], problems, problemLines }.
export function parseReadme(text) {
  const categories = [];
  const problems = [];
  const problemLines = [];
  let anchor = null, current = null, inTable = false;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const id = line.match(/^<a id="([^"]+)"><\/a>$/);
    if (id) { anchor = id[1]; return; }
    if (line.startsWith("## ")) {
      inTable = false;
      current = null;
      if (anchor) {
        const [emoji, ...rest] = line.slice(3).split(" ");
        current = { slug: anchor.replace(/-+/g, "-"), anchor, emoji, title: rest.join(" "), rows: [] };
        categories.push(current);
        anchor = null;
      }
      return;
    }
    if (!current || !line.startsWith("|")) { inTable = false; return; }
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === "Savings") { inTable = true; return; }
    // Outside an old-format table (the generated tables have three columns), a row still
    // counts when it has the old shape: five cells that start with a savings mark.
    const oldShape = cells.length === 5 && ["💰", "💸", "—"].includes(cells[0]);
    if ((!inTable && !oldShape) || cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return;

    const parsed = parseRow(cells);
    if (parsed.problem) { problems.push(`line ${index + 1}: ${parsed.problem}`); problemLines.push(index + 1); return; }
    current.rows.push({ line: index + 1, raw: line, emoji: parsed.emoji, deal: parsed.deal });
  });

  return { categories, problems, problemLines };
}

// How well a parsed row turns back into the README row it came from.
export function roundTrip(row) {
  const rebuilt = readmeRow(row.deal);
  if (rebuilt === row.raw) return "identical";
  if (decodeEntities(rebuilt) === decodeEntities(row.raw)) return "normalized";
  return "different";
}

// The text of a deal file, fields in the usual order, every text value in double quotes.
export function dealYaml(deal) {
  const data = {};
  for (const key of DEAL_FIELDS) {
    if (deal[key] !== undefined && deal[key] !== null) data[key] = deal[key];
  }
  return new Document(data).toString({ defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", lineWidth: 0 });
}

const isoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

// Compares the rows of a README with the catalog and works out which deal files to add.
//   parsed    result of parseReadme()
//   catalog   result of loadCatalog()
//   year      folder under deals/
//   now       time used for `added`; rows get now, now + 1s, ... in README order so that
//             they keep their order and land below everything already in the catalog
// Returns { fresh: [{ path, text, deal, line }], unchanged, changed: [{ path, line, was, now }], problems }.
export function planImport(parsed, catalog, { year, now = Date.now() } = {}) {
  const fresh = [];
  const changed = [];
  const problems = [];
  let unchanged = 0;

  const existing = new Map();
  const taken = new Map(); // category slug -> file slugs in use
  for (const category of catalog) {
    taken.set(category.slug, new Set(category.deals.map((deal) => deal.slug)));
    for (const deal of category.deals) existing.set(dealKey(deal), deal);
  }

  let tick = 0;
  for (const category of parsed.categories) {
    const target = catalog.find((entry) => entry.anchor === category.anchor || entry.slug === category.slug);
    if (!target) {
      if (category.rows.length) {
        problems.push(`category "${category.title}" (#${category.anchor}) is not in deals/categories.yml: ${category.rows.length} rows skipped`);
      }
      continue;
    }
    const used = taken.get(target.slug);
    for (const row of category.rows) {
      const key = dealKey(row.deal);
      const known = existing.get(key);
      if (known) {
        if (known.path === undefined) {
          problems.push(`line ${row.line}: "${row.deal.name}" is in this README twice; the second row was skipped`);
        } else if (readmeRow(known) === row.raw) {
          unchanged++;
        } else {
          changed.push({ path: known.path, line: row.line, was: readmeRow(known), now: row.raw });
        }
        continue;
      }
      const base = slugify(row.deal.name) || slugify(new URL(row.deal.url).hostname);
      let slug = base;
      for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
      used.add(slug);
      const deal = { ...row.deal, added: isoSeconds(now + 1000 * tick++) };
      fresh.push({ path: `deals/${year}/${target.slug}/${slug}.yml`, text: dealYaml(deal), deal, line: row.line });
      existing.set(key, { ...deal }); // no path: marks a row seen earlier in this same README
    }
  }
  return { fresh, unchanged, changed, problems };
}
