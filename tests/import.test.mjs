import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { loadCatalog, readmeRow } from "../scripts/lib/catalog.mjs";
import { dealYaml as toYaml, parseReadme, parseRow, planImport, roundTrip, slugify } from "../scripts/lib/import.mjs";
import { commitAll, dealYaml, git, makeRoot, run } from "./helpers.mjs";

const row = (terms, { emoji = "💰", discount = "30% off all plans", name = "[App](https://app.example.dev/)" } = {}) =>
  parseRow([emoji, name, "Does a thing.", discount, terms]);
const cells = (line) => line.split("|").slice(1, -1).map((cell) => cell.trim());

test("code, terms and dates are split out of the canonical cell", () => {
  assert.deepEqual(row("**BF2026**; applies to early-bird prices; 2026-11-16 to 2026-12-03").deal, {
    name: "App", url: "https://app.example.dev/", description: "Does a thing.", discount: "30% off all plans", percent: 30,
    code: "BF2026", terms: "applies to early-bird prices", starts: "2026-11-16", ends: "2026-12-03",
  });
  const codeAndDates = row("**BF2026**; 2026-11-16 to 2026-12-03").deal;
  assert.deepEqual([codeAndDates.code, codeAndDates.terms, codeAndDates.starts, codeAndDates.ends], ["BF2026", undefined, "2026-11-16", "2026-12-03"]);
  const codeOnly = row("**BF2026**").deal;
  assert.deepEqual([codeOnly.code, codeOnly.terms, codeOnly.starts], ["BF2026", undefined, undefined]);
  const datesOnly = row("2026-11-27 to 2026-11-30").deal;
  assert.deepEqual([datesOnly.code, datesOnly.terms, datesOnly.starts, datesOnly.ends], [undefined, undefined, "2026-11-27", "2026-11-30"]);
  const termsAndDates = row("Automatically applied; no code needed; 2026-11-01 to 2026-12-31").deal;
  assert.deepEqual([termsAndDates.code, termsAndDates.terms, termsAndDates.ends], [undefined, "Automatically applied; no code needed", "2026-12-31"]);
  assert.equal(row("").deal.terms, undefined);
});

test("an entity in the code is decoded, and the row still round-trips", () => {
  const parsed = row("**CYBER&#95;2026**; 2026-11-05 to 2026-12-04");
  assert.equal(parsed.deal.code, "CYBER_2026");
  assert.equal(roundTrip({ raw: "| 💰 | [App](https://app.example.dev/) | Does a thing. | 30% off all plans | **CYBER&#95;2026**; 2026-11-05 to 2026-12-04 |", deal: parsed.deal }), "normalized");
});

test("anything that is not the canonical shape stays in terms untouched", () => {
  const untouched = [
    "**YEARLY26** for yearly plans; **LIFE26** for lifetime",          // several codes
    "**MONTHLY**; then **YEARLY** from January",                       // a second code later on
    "Code **BF26**; one-time or 1st year",                             // text before the code
    "with code **BLACKFRIDAY** at example.dev. Nov 9 - Dec 1, 2026",   // code inside a sentence
    "**BLACK FRIDAY**; all plans",                                     // not a single token
    "Use code `BLACKFRIDAY26`",                                        // inline code, not bold
    "Automatically applied; until 2026-12-02",                         // "until", not a range
    "Automatically applied; 2026-11-27 to 2026-12-1",                  // not a full date
    "yearly plans; 2026-11-17 to 2026-12-01 23:59 UTC",                // time after the range
    "2026-11-27 to 2026-11-30 (UTC); one-time purchase",               // range not at the end
  ];
  for (const terms of untouched) {
    const { deal } = row(terms);
    assert.deepEqual([deal.code, deal.terms, deal.starts, deal.ends], [undefined, terms, undefined, undefined], terms);
  }
  // a code with a note in brackets keeps the code out, a range at the end still splits
  const mixed = row("**BLACKFRIDAY** (the link applies it); one-time purchase; 2026-11-27 to 2026-11-28 PST").deal;
  assert.equal(mixed.code, undefined);
  assert.equal(mixed.terms, "**BLACKFRIDAY** (the link applies it); one-time purchase; 2026-11-27 to 2026-11-28 PST");
});

test("percent is taken from the discount text only when it agrees with the emoji", () => {
  const percent = (emoji, discount) => row("", { emoji, discount }).deal.percent;
  assert.equal(percent("💰", "30% off all plans"), 30);
  assert.equal(percent("💸", "50% off"), 50);
  assert.equal(percent("💸", "Up to 80 % off yearly plans"), 80);
  // several percentages: the first one that fits the emoji the submitter chose
  assert.equal(percent("💸", "30% off monthly, 60% off yearly"), 60);
  assert.equal(percent("💰", "30% off monthly, 60% off yearly"), 30);
  // no percentage in the text: worked out from a price pair
  assert.equal(percent("💰", "Lifetime $57 → $35"), 39);
  assert.equal(percent("💸", "~~$20~~ $8 once"), 60);
  assert.equal(percent("💸", "$1,990 → $995"), 50);
  // a dash means no percentage, even if the text has one
  assert.equal(percent("—", "Launch price $14.50, 50% off later"), undefined);
  // the emoji contradicts the text, or nothing can be worked out: left without percent
  assert.equal(percent("💸", "30% off"), undefined);
  assert.equal(percent("💰", "Two months free"), undefined);
  assert.equal(percent("💰", "$57 → $20"), undefined);
});

test("rows that are not five cells or whose name is not one link are reported", () => {
  assert.match(parseRow(["💰", "[App](https://app.example.dev)", "Thing", "30% off"]).problem, /4 cells instead of 5/);
  assert.match(parseRow(["💰", "App", "Thing", "30% off", ""]).problem, /name is not a single link: App/);
  assert.match(parseRow(["💰", "[App](https://app.example.dev) and more", "Thing", "30% off", ""]).problem, /not a single link/);
});

const README = `# Deals

**Legend**

| Savings | Meaning |
| --- | --- |
| 💰 | Less than 50% off |

## Table of Contents

- [🛠 Dev Tools](#dev-tools)

<a id="dev-tools"></a>

## 🛠 Dev Tools

| Savings | Name | Description | Discount | Code & Terms |
| --- | --- | --- | --- | --- |
| 💰 | [Alpha](https://alpha.example.dev/) | First tool. | 30% off | **A30**; 2026-11-16 to 2026-12-03 |
| 💸 | [Beta](https://beta.example.dev) | Second tool. | 60% off | Automatically applied |

[⬆️ Back to contents](#table-of-contents)

<a id="reference--education"></a>

## 🎓 Reference & Education

| Savings | Name | Description | Discount | Code & Terms |
| --- | --- | --- | --- | --- |
| — | [Gamma](https://gamma.example.dev) | A course. | $19 once | until 2026-12-02 |
| broken row |

<a id="books"></a>

## 📖 Books

| Savings | Name | Description | Discount | Code & Terms |
| --- | --- | --- | --- | --- |
`;

test("parseReadme reads the category tables and skips everything else", () => {
  const { categories, problems } = parseReadme(README);
  assert.deepEqual(categories.map((c) => [c.slug, c.anchor, c.emoji, c.title, c.rows.length]), [
    ["dev-tools", "dev-tools", "🛠", "Dev Tools", 2],
    ["reference-education", "reference--education", "🎓", "Reference & Education", 1],
    ["books", "books", "📖", "Books", 0],
  ]);
  assert.deepEqual(categories[0].rows.map((r) => [r.line, r.emoji, r.deal.name]), [[19, "💰", "Alpha"], [20, "💸", "Beta"]]);
  assert.deepEqual(problems, ["line 31: 1 cells instead of 5"]);
  for (const category of categories) for (const r of category.rows) assert.equal(roundTrip(r), "identical");
  // Windows line endings give the same result
  assert.deepEqual(parseReadme(README.replace(/\n/g, "\r\n")).categories, categories);
});

test("dealYaml writes the fields in the usual order with quoted text", () => {
  const text = toYaml({ added: "2026-11-11T10:00:00Z", percent: 30, discount: "30% off: all plans", name: "App #1", url: "https://app.example.dev", description: 'Say "hi"', code: undefined });
  assert.equal(text, 'name: "App #1"\nurl: "https://app.example.dev"\ndescription: "Say \\"hi\\""\ndiscount: "30% off: all plans"\npercent: 30\nadded: "2026-11-11T10:00:00Z"\n');
  assert.deepEqual(parse(text), { name: "App #1", url: "https://app.example.dev", description: 'Say "hi"', discount: "30% off: all plans", percent: 30, added: "2026-11-11T10:00:00Z" });
});

test("slugify makes file names from product names", () => {
  assert.equal(slugify("Crisp, Docket & Outlier Bundle"), "crisp-docket-and-outlier-bundle");
  assert.equal(slugify("learningtodj.com"), "learningtodj-com");
  assert.equal(slugify("Café Déjà Vu 2"), "cafe-deja-vu-2");
});

const NOW = Date.parse("2026-11-11T12:00:00Z");
const existingAlpha = dealYaml({
  name: "Alpha", url: "https://alpha.example.dev/", description: "First tool.", discount: "30% off", percent: 30,
  code: "A30", starts: "2026-11-16", ends: "2026-12-03", added: "2026-11-01T00:00:00Z",
});

test("planImport adds only the deals the catalog does not have, in README order", (t) => {
  const root = makeRoot(t, { "deals/2026/dev-tools/alpha.yml": existingAlpha });
  const plan = planImport(parseReadme(README), loadCatalog(root, 2026), { year: "2026", now: NOW });
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.changed, []);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.fresh.map((file) => [file.path, file.deal.added]), [
    ["deals/2026/dev-tools/beta.yml", "2026-11-11T12:00:00Z"],
    ["deals/2026/reference-education/gamma.yml", "2026-11-11T12:00:01Z"],
  ]);
  assert.equal(plan.fresh[0].text, 'name: "Beta"\nurl: "https://beta.example.dev"\ndescription: "Second tool."\ndiscount: "60% off"\npercent: 60\nterms: "Automatically applied"\nadded: "2026-11-11T12:00:00Z"\n');
  assert.equal(readmeRow(parse(plan.fresh[1].text)), "| — | [Gamma](https://gamma.example.dev) | A course. | $19 once | until 2026-12-02 |");
});

test("planImport reports a row that differs from its deal file instead of overwriting it", (t) => {
  const root = makeRoot(t, { "deals/2026/dev-tools/alpha.yml": existingAlpha.replace("30% off", "25% off").replace("percent: 30", "percent: 25") });
  const plan = planImport(parseReadme(README), loadCatalog(root, 2026), { year: "2026", now: NOW });
  assert.equal(plan.unchanged, 0);
  assert.deepEqual(plan.changed, [{
    path: "deals/2026/dev-tools/alpha.yml",
    line: 19,
    was: "| 💰 | [Alpha](https://alpha.example.dev/) | First tool. | 25% off | **A30**; 2026-11-16 to 2026-12-03 |",
    now: "| 💰 | [Alpha](https://alpha.example.dev/) | First tool. | 30% off | **A30**; 2026-11-16 to 2026-12-03 |",
  }]);
  assert.deepEqual(plan.fresh.map((file) => file.path), ["deals/2026/dev-tools/beta.yml", "deals/2026/reference-education/gamma.yml"]);
});

test("planImport avoids file-name clashes, repeated rows and unknown categories", (t) => {
  const root = makeRoot(t, {
    // another product that already uses the file name beta.yml
    "deals/2026/dev-tools/beta.yml": dealYaml({ name: "Beta", url: "https://other-beta.example.dev", added: "2026-11-01T00:00:00Z" }),
  });
  const readme = README
    .replace("| 💸 | [Beta](https://beta.example.dev) | Second tool. | 60% off | Automatically applied |",
      "| 💸 | [Beta](https://beta.example.dev) | Second tool. | 60% off | Automatically applied |\n| 💸 | [Beta](https://beta.example.dev) | Second tool. | 60% off | Automatically applied |")
    + '\n<a id="gadgets"></a>\n\n## 📟 Gadgets\n\n| Savings | Name | Description | Discount | Code & Terms |\n| --- | --- | --- | --- | --- |\n| — | [Thing](https://thing.example.dev) | A thing. | $5 |  |\n';
  const plan = planImport(parseReadme(readme), loadCatalog(root, 2026), { year: "2026", now: NOW });
  assert.deepEqual(plan.fresh.map((file) => file.path), [
    "deals/2026/dev-tools/alpha.yml",
    "deals/2026/dev-tools/beta-2.yml",
    "deals/2026/reference-education/gamma.yml",
  ]);
  assert.equal(plan.problems.length, 2);
  assert.match(plan.problems[0], /line 21: "Beta" is in this README twice/);
  assert.match(plan.problems[1], /category "Gadgets" \(#gadgets\) is not in deals\/categories\.yml: 1 rows skipped/);
});

test("import-readme.mjs --from is a dry run by default and --write adds only new files", (t) => {
  const root = makeRoot(t, { "deals/2026/dev-tools/alpha.yml": existingAlpha, "pr-readme.md": README });
  const from = join(root, "pr-readme.md");

  let result = run("import-readme.mjs", ["--root", root, "--from", from]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /3 deals in 3 categories/);
  assert.match(result.stdout, /round trip: 3 identical, 0 identical after entity decoding, 0 different/);
  assert.match(result.stdout, /line 31: 1 cells instead of 5/);
  assert.match(result.stdout, /compared with deals\/2026 \(1 deals\): 1 already there, 2 new, 0 different/);
  assert.match(result.stdout, /deals\/2026\/dev-tools\/beta\.yml {2}\(README line 20\)\n {6}name: "Beta"/);
  assert.match(result.stdout, /Dry run: nothing written\. Add --write to create the 2 new files\./);
  assert.ok(!existsSync(join(root, "deals/2026/dev-tools/beta.yml")));

  result = run("import-readme.mjs", ["--root", root, "--from", from, "--write"]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /Wrote 2 files/);
  assert.equal(readFileSync(join(root, "deals/2026/dev-tools/alpha.yml"), "utf8"), existingAlpha, "existing files are not rewritten");
  assert.equal(parse(readFileSync(join(root, "deals/2026/dev-tools/beta.yml"), "utf8")).percent, 60);
  assert.equal(run("validate.mjs", ["--root", root]).status, 0);

  // order: the existing deal first, then the imported ones
  assert.deepEqual(loadCatalog(root, 2026)[0].deals.map((deal) => deal.name), ["Alpha", "Beta"]);

  // a second run finds nothing left to do
  result = run("import-readme.mjs", ["--root", root, "--from", from, "--write"]);
  assert.match(result.stdout, /3 already there, 0 new, 0 different/);
  assert.match(result.stdout, /Nothing to add\./);
});

test("import-readme.mjs --from shows rows that would fail validation and rows that differ", (t) => {
  const root = makeRoot(t, {
    "deals/2026/dev-tools/alpha.yml": existingAlpha.replace("First tool.", "The first tool."),
    "pr-readme.md": README.replace("Second tool.", "x".repeat(300)),
  });
  const result = run("import-readme.mjs", ["--root", root, "--from", join(root, "pr-readme.md")]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /0 already there, 2 new, 1 different/);
  assert.match(result.stdout, /DIFFERENT FROM THE DEAL FILE/);
  assert.match(result.stdout, /deals\/2026\/dev-tools\/alpha\.yml \(README line 19\)\n {4}file: {3}\| 💰 \| \[Alpha\].*The first tool\./);
  assert.match(result.stdout, /NEW FILES THAT NEED A FIX[\s\S]*deals\/2026\/dev-tools\/beta\.yml\n {2}✗ line 3, description: is 300 characters long; the limit is 250/);
});

test("import-readme.mjs without --from refuses to rebuild an existing catalog unless --replace is given", (t) => {
  const root = makeRoot(t, { "deals/2026/dev-tools/alpha.yml": existingAlpha, "README.md": README });
  // blame needs a repository
  git(root, ["init", "-q"]);
  commitAll(root, "Start", "2026-11-05T10:00:00Z");
  const result = run("import-readme.mjs", ["--root", root, "--write"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already holds 1 deal files/);
  assert.match(result.stderr, /--from <path> --write/);
  assert.equal(readFileSync(join(root, "deals/2026/dev-tools/alpha.yml"), "utf8"), existingAlpha);
});

test("import-readme.mjs without --from explains itself outside a git checkout", (t) => {
  const root = makeRoot(t, { "README.md": README });
  const result = run("import-readme.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /use: --from <path>/);
});
