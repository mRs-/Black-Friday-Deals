// README.md has a hand-written top part and a generated part between two marker lines:
// the table of contents and one table per category, built from the deal files.
import { createHash } from "node:crypto";
import { dealKey, readmeRow } from "./catalog.mjs";
import { decodeEntities, parseReadme } from "./import.mjs";

export const START_MARKER =
  "<!-- DEALS:START - Everything from here to DEALS:END is generated from the files in deals/. Do not edit it by hand: see CONTRIBUTING.md to add or change a deal. -->";
const START_PATTERN = /<!-- DEALS:START\b[^\n]*?-->/g;
const END_PATTERN = /<!-- DEALS:END(?: checksum:([0-9a-f]+))? -->/g;

const TABLE_HEADER = "| Savings | Name | Description | Discount | Code & Terms |\n| --- | --- | --- | --- | --- |";
const BACK_TO_CONTENTS = "[⬆️ Back to contents](#table-of-contents)";

// The end marker carries a checksum of the generated part. When the two no longer match,
// somebody edited the tables by hand (for example by merging a pull request that added a
// row), and the next build must not silently throw that edit away.
export const checksum = (generated) => createHash("sha256").update(generated).digest("hex").slice(0, 12);
export const endMarker = (generated) => `<!-- DEALS:END checksum:${checksum(generated)} -->`;

// The generated part, without the markers.
export function renderDeals(catalog) {
  const blocks = [
    "## Table of Contents",
    catalog.map((category) => `- [${category.emoji} ${category.title}](#${category.anchor})`).join("\n"),
  ];
  for (const category of catalog) {
    blocks.push(
      `<a id="${category.anchor}"></a>`,
      `## ${category.emoji} ${category.title}`,
      [TABLE_HEADER, ...category.deals.map(readmeRow)].join("\n"),
      BACK_TO_CONTENTS,
    );
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
export function buildReadme(text, catalog) {
  const parts = splitReadme(text);
  if (!parts) throw new Error(MARKER_HELP);
  const generated = renderDeals(catalog);
  return `${parts.before}${START_MARKER}\n\n${generated}\n\n${endMarker(generated)}${parts.after}`;
}

// What a rebuild would throw away from a README whose tables were edited by hand:
//   orphans      rows for deals that have no deal file
//   changed      rows that say something else than their deal file
//   unreadable   table rows that cannot be read at all
export function findHandEdits(text, catalog) {
  const parsed = parseReadme(text);
  const deals = new Map(catalog.flatMap((category) => category.deals).map((deal) => [dealKey(deal), deal]));
  const cells = (row) => decodeEntities(row).split("|").map((cell) => cell.trim()).join("|");
  const orphans = [];
  const changed = [];
  for (const category of parsed.categories) {
    for (const row of category.rows) {
      const deal = deals.get(dealKey(row.deal));
      if (!deal) orphans.push({ line: row.line, readme: row.raw });
      else if (cells(readmeRow(deal)) !== cells(row.raw)) changed.push({ line: row.line, path: deal.path, readme: row.raw, file: readmeRow(deal) });
    }
  }
  return { orphans, changed, unreadable: parsed.problems };
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
