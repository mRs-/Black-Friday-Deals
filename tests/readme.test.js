import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseReadme, filterSections } from "../docs/readme.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const header = "| Savings | Name | Description | Discount | Code & Terms | Valid Dates |";
const separator = "| --- | --- | --- | --- | --- | --- |";
const exampleRow = "| 💸 | [Example](https://example.com) | A command--line tool &#124; editor | 50% off | **EXAMPLE2026**; first year only | 2026-11-27 to 2026-11-30 |";
const fixture = [
  "## Contributing",
  "```markdown",
  header,
  separator,
  exampleRow,
  "```",
  "## Development",
  header,
  separator,
  exampleRow,
  "",
  "[Back to contents](#table-of-contents)",
  "## Games",
  header,
  separator,
].join("\n");

test("the README preserves all 22 categories with unique navigation anchors", () => {
  const sections = parseReadme(readme);
  assert.equal(sections.length, 22);
  assert.equal(new Set(sections.map((section) => section.title)).size, 22);
  assert.equal(sections[0].title, "🛠 Development Software");
  assert.equal(sections.at(-1).title, "🕹 Games");
  const anchors = [...readme.matchAll(/<a id="([^"]+)"><\/a>/g)].map((match) => match[1]);
  const tocLinks = [...readme.matchAll(/^- \[.+\]\(#(.+)\)$/gm)].map((match) => match[1]);
  assert.equal(anchors.length, 22);
  assert.equal(new Set(anchors).size, 22);
  assert.deepEqual(tocLinks, anchors);
});

test("headers, separators, prose sections, and fenced examples are not deals", () => {
  const sections = parseReadme(fixture);
  assert.deepEqual(sections.map((section) => [section.title, section.deals.length]), [
    ["Development", 1],
    ["Games", 0],
  ]);
});

test("six columns preserve discount, terms, dates, literal pipes, and double hyphens", () => {
  const [deal] = parseReadme(fixture)[0].deals;
  assert.match(deal.name, /href="https:\/\/example.com"/);
  assert.equal(deal.description, "A command--line tool &#124; editor");
  assert.equal(deal.discount, "50% off");
  assert.equal(deal.terms, "<strong>EXAMPLE2026</strong>; first year only");
  assert.equal(deal.dates, "2026-11-27 to 2026-11-30");
});

test("blank rows are not counted and Windows line endings are supported", () => {
  const text = fixture.replace(exampleRow, "| | | | | | |").replaceAll("\n", "\r\n");
  assert.equal(parseReadme(text)[0].deals.length, 1);
  assert.equal(parseReadme(`## Empty\n${header}\n${separator}\n| | | | | | |`)[0].deals.length, 0);
});

test("filtering keeps empty categories when no search query is active", () => {
  const sections = parseReadme(fixture);
  assert.equal(filterSections(sections, "", "all").length, 2);
  assert.deepEqual(filterSections(sections, "", "Games"), [{ title: "Games", deals: [] }]);
  assert.equal(filterSections(sections, "", "Development").length, 1);
});

test("five-column deals need no dates and optional dates in terms remain searchable", () => {
  const text = "## Tools\n| Savings | Name | Description | Discount | Code & Terms |\n| --- | --- | --- | --- | --- |\n| 💰 | [App](https://example.com) | A tool | 30% off | **CODE** |\n| 💸 | [Other](https://example.org) | Another tool | 50% off | Automatically applied; ends 2026-12-01 |";
  const sections = parseReadme(text);
  assert.equal(sections[0].deals.length, 2);
  assert.ok(sections[0].deals.every((deal) => deal.dates === ""));
  assert.equal(filterSections(sections, "2026-12-01", "all")[0].deals.length, 1);
});

test("search includes codes and dates, respects category selection, and can reset", () => {
  const sections = parseReadme(fixture);
  for (const query of [" EXAMPLE2026 ", "2026-11-30", "FIRST YEAR", "50% off"]) {
    const matches = filterSections(sections, query, "all");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].deals.length, 1);
  }
  assert.deepEqual(filterSections(sections, "example", "Games"), []);
  assert.deepEqual(filterSections(sections, "missing", "all"), []);
  assert.equal(filterSections(sections, "", "all").length, 2);
  assert.equal(sections[0].deals.length, 1);
});
