// README.md has a hand-written top part and a generated part between two markers:
// the table of contents and one table per category, built from the deal files.
import { readmeRow } from "./catalog.mjs";

export const START_MARKER =
  "<!-- DEALS:START - Everything from here to DEALS:END is generated from the files in deals/. Do not edit it by hand: see CONTRIBUTING.md to add or change a deal. -->";
export const END_MARKER = "<!-- DEALS:END -->";

const TABLE_HEADER = "| Savings | Name | Description | Discount | Code & Terms |\n| --- | --- | --- | --- | --- |";
const BACK_TO_CONTENTS = "[⬆️ Back to contents](#table-of-contents)";

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
// text after it. Returns null when the two markers are not both there, in that order.
export function splitReadme(text) {
  const start = text.indexOf(START_MARKER);
  const end = text.indexOf(END_MARKER);
  if (start < 0 || end < 0 || end < start) return null;
  if (text.indexOf(START_MARKER, start + 1) >= 0 || text.indexOf(END_MARKER, end + 1) >= 0) return null;
  return {
    before: text.slice(0, start),
    generated: text.slice(start + START_MARKER.length, end).trim(),
    after: text.slice(end + END_MARKER.length),
  };
}

export const MARKER_HELP =
  `README.md must contain these two lines, each exactly once, with the generated part between them:\n  ${START_MARKER}\n  ${END_MARKER}`;

// The README text with its generated part replaced by the current catalog.
export function buildReadme(text, catalog) {
  const parts = splitReadme(text);
  if (!parts) throw new Error(MARKER_HELP);
  return `${parts.before}${START_MARKER}\n\n${renderDeals(catalog)}\n\n${END_MARKER}${parts.after}`;
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
