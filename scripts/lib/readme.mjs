// README.md has a hand-written top part and a generated part between two marker lines:
// the table of contents and one table per category, built from the deal files.
import { createHash } from "node:crypto";
import { dealKey, escapeCell, readmeRow, savingsEmoji } from "./catalog.mjs";
import { decodeEntities, parseReadme } from "./import.mjs";

export const START_MARKER =
  "<!-- DEALS:START - Everything from here to DEALS:END is generated from the files in deals/. Do not edit it by hand: see CONTRIBUTING.md to add or change a deal. -->";
const START_PATTERN = /<!-- DEALS:START\b[^\n]*?-->/g;
const END_PATTERN = /<!-- DEALS:END(?: checksum:([0-9a-f]+))? -->/g;

const SITE = "https://blackfriday.mariuslandwehr.com";
const TABLE_HEADER = "|  | Name | Offer |\n| :-: | --- | --- |";
const BACK_TO_CATEGORIES = '<p align="right"><a href="#categories">↑ Categories</a></p>';
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The end marker carries a checksum of the generated part. When the two no longer match,
// somebody edited the tables by hand (for example by merging a pull request that added a
// row), and the next build must not silently throw that edit away.
export const checksum = (generated) => createHash("sha256").update(generated).digest("hex").slice(0, 12);
export const endMarker = (generated) => `<!-- DEALS:END checksum:${checksum(generated)} -->`;

// "2026-11-16" -> "Nov 16"; the year is added only when it is not the year of the list.
function shortDate(date, year) {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${String(y) === String(year) ? "" : `, ${y}`}`;
}

export function dateRange(deal, year) {
  if (deal.starts && deal.ends) return `${shortDate(deal.starts, year)} – ${shortDate(deal.ends, year)}`;
  if (deal.ends) return `until ${shortDate(deal.ends, year)}`;
  if (deal.starts) return `from ${shortDate(deal.starts, year)}`;
  return "";
}

// One deal as a three-cell table row: savings mark, name over description, offer over
// code, terms and dates.
export function displayRow(deal, year) {
  const mark = typeof deal.percent === "number" ? savingsEmoji(deal.percent) : "";
  const code = deal.code ? (deal.code.includes("`") ? `**${escapeCell(deal.code)}**` : `\`${deal.code}\``) : "";
  const dates = dateRange(deal, year).replace(/ /g, "&nbsp;"); // a date range stays on one line
  const details = [code, deal.terms ? escapeCell(deal.terms) : "", dates].filter(Boolean).join(" · ");
  const name = `**[${escapeCell(deal.name)}](${deal.url})**<br>${escapeCell(deal.description)}`;
  const offer = `<b>${escapeCell(deal.discount)}</b>${details ? `<br>${details}` : ""}`;
  return `| ${mark} | ${name} | ${offer} |`;
}

const sentenceList = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

// The generated part, without the markers: a category index with counts, then one table
// per category that has deals.
export function renderDeals(catalog, year) {
  const filled = catalog.filter((category) => category.deals.length);
  const empty = catalog.filter((category) => !category.deals.length);
  const total = filled.reduce((sum, category) => sum + category.deals.length, 0);

  const blocks = [
    "## Categories",
    `**${total} ${total === 1 ? "deal" : "deals"}** in ${filled.length} ${filled.length === 1 ? "category" : "categories"}. 💸 marks 50% off or more, 💰 less than 50%.`,
    // &nbsp; keeps an emoji and a count on the same line as their category name
    filled.map((category) => `${category.emoji}&nbsp;[${category.title}](#${category.anchor})&nbsp;\`${category.deals.length}\``).join(" · "),
  ];
  for (const category of filled) {
    blocks.push(
      `<a id="${category.anchor}"></a>`,
      `## ${category.emoji} ${category.title}`,
      [TABLE_HEADER, ...category.deals.map((deal) => displayRow(deal, year))].join("\n"),
      BACK_TO_CATEGORIES,
    );
  }
  if (empty.length) {
    blocks.push(`No deals yet in ${sentenceList(empty.map((category) => category.title))}. [Add the first one](${SITE}/submit/).`);
  }
  return blocks.join("\n\n");
}

// Splits a README into the text before the generated part, the generated part and the
// text after it. `edited` is true when the generated part does not match the checksum
// written by the last build. Returns null unless both markers are there, once each, in order.
export function splitReadme(text) {
  const starts = [...text.matchAll(START_PATTERN)];
  const ends = [...text.matchAll(END_PATTERN)];
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index < starts[0].index) return null;
  const generated = text.slice(starts[0].index + starts[0][0].length, ends[0].index).trim();
  const recorded = ends[0][1] ?? null;
  return {
    before: text.slice(0, starts[0].index),
    generated,
    after: text.slice(ends[0].index + ends[0][0].length),
    edited: recorded !== null && recorded !== checksum(generated),
  };
}

export const MARKER_HELP =
  `README.md must contain a DEALS:START line and a DEALS:END line, each exactly once, with the generated part between them:\n  ${START_MARKER}\n  <!-- DEALS:END -->`;

// The README text with its generated part replaced by the current catalog.
export function buildReadme(text, catalog, year) {
  const parts = splitReadme(text);
  if (!parts) throw new Error(MARKER_HELP);
  const generated = renderDeals(catalog, year);
  return `${parts.before}${START_MARKER}\n\n${generated}\n\n${endMarker(generated)}${parts.after}`;
}

// What a rebuild would throw away from a README whose generated part was edited by hand:
//   orphans      rows in the old five-column format for deals that have no deal file
//                (a pull request that still added a table row); the importer can convert them
//   changed      old-format rows that say something else than their deal file
//   unreadable   old-format rows that cannot be read at all
//   foreign      any other table row the generator would not have written (an edited or added row)
// Padding cells with spaces, as a table formatter does, is not an edit.
export function findHandEdits(text, catalog, year) {
  const parsed = parseReadme(text);
  const deals = new Map(catalog.flatMap((category) => category.deals).map((deal) => [dealKey(deal), deal]));
  const cells = (row) => decodeEntities(row).split("|").map((cell) => cell.trim()).join("|");
  const orphans = [];
  const changed = [];
  const oldFormatLines = new Set(parsed.problemLines ?? []);
  for (const category of parsed.categories) {
    for (const row of category.rows) {
      oldFormatLines.add(row.line);
      const deal = deals.get(dealKey(row.deal));
      if (!deal) orphans.push({ line: row.line, readme: row.raw });
      else if (cells(readmeRow(deal)) !== cells(row.raw)) changed.push({ line: row.line, path: deal.path, readme: row.raw, file: readmeRow(deal) });
    }
  }

  const foreign = [];
  const parts = splitReadme(text);
  if (parts) {
    const expected = new Set(renderDeals(catalog, year).split("\n").map(cells));
    const firstLine = parts.before.split("\n").length; // line number of the start marker
    text.slice(parts.before.length).split("\n").some((raw, index) => {
      if (index === 0) return false; // the start marker itself
      if (/^<!-- DEALS:END\b/.test(raw.trim())) return true;
      const line = firstLine + index;
      // only table rows count: the index and the totals are derived and simply go stale
      if (raw.trim().startsWith("|") && !oldFormatLines.has(line) && !expected.has(cells(raw.trim()))) foreign.push({ line, readme: raw.trim() });
      return false;
    });
  }
  return { orphans, changed, unreadable: parsed.problems, foreign };
}

// Did a change (base -> head) touch the generated part of the README?
//   "unchanged"  the generated parts are the same
//   "changed"    the generated part was edited
//   "markers"    the markers were removed or damaged
//   "no-base"    the base README has no generated part yet (the change that introduces it)
export function compareGenerated(baseText, headText) {
  const base = baseText === null ? null : splitReadme(baseText);
  if (!base) return "no-base";
  const head = headText === null ? null : splitReadme(headText);
  if (!head) return "markers";
  return base.generated === head.generated ? "unchanged" : "changed";
}

// First line where two texts differ, for a short "what is stale" hint.
export function firstDifference(expected, actual) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return { line: i + 1, expected: a[i] ?? null, actual: b[i] ?? null };
  }
  return null;
}
