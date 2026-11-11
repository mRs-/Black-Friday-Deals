import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import {
  FILE_NAME, MAX_LENGTH, formatErrors, githubAnnotations, suggestFileName, validateCategories, validateDeal, validateTree,
} from "../scripts/lib/validate.mjs";
import { categoriesYaml, dealYaml, makeRoot, run } from "./helpers.mjs";

const FILE = "deals/2026/dev-tools/example-app.yml";
const check = (text, options = {}) => validateDeal(text, { file: FILE, year: "2026", ...options }).errors;

// Exactly one error, on the expected field, with matching problem and fix text.
function expectOne(text, field, problem, fix) {
  const errors = check(text);
  assert.equal(errors.length, 1, `expected one error, got:\n${formatErrors(errors)}`);
  const [error] = errors;
  assert.equal(error.file, FILE);
  assert.equal(error.field, field);
  assert.match(error.problem, problem);
  assert.match(error.fix, fix);
  return error;
}

test("a minimal deal and a deal with every field pass", () => {
  assert.deepEqual(check(dealYaml()), []);
  const full = dealYaml({
    percent: 50, code: "BF_2026", terms: "annual plan; see [terms](https://example-app.dev/terms), ~~$20~~ **$10**, use `X` &#95;",
    starts: "2026-11-27", ends: "2026-11-30", added: "2026-11-11T04:18:27Z",
  });
  const result = validateDeal(full, { file: FILE, year: "2026" });
  assert.deepEqual(result.errors, []);
  assert.equal(result.deal.percent, 50);
});

test("comments on their own lines and unquoted simple values are fine", () => {
  const text = "# my deal\nname: Example App\nurl: https://example-app.dev\n# what it does\ndescription: Does one thing well.\ndiscount: 40% off\nends: 2026-12-01\n";
  assert.deepEqual(check(text), []);
});

test("required fields must be present", () => {
  for (const field of ["name", "url", "description", "discount"]) {
    const error = expectOne(dealYaml({ [field]: null }), field, /is missing/, new RegExp(`Add this line: ${field}: "`));
    assert.equal(error.line, undefined);
  }
});

test("required and optional text fields must not be empty", () => {
  expectOne(dealYaml({ description: "" }), "description", /is empty/, /Fill it in, for example: description: "/);
  expectOne(dealYaml({ name: "   " }), "name", /is empty/, /Fill it in/);
  expectOne(dealYaml({ terms: "" }), "terms", /is empty/, /delete the "terms:" line/);
  expectOne(dealYaml() + "code:\n", "code", /must be text, but null is read as empty/, /code: "BF2026"/);
});

test("unknown fields are rejected, with the likely field name", () => {
  expectOne(dealYaml({ discount: null, discout: "40% off" }), "discout", /not a field name/, /Rename it to "discount"/);
  expectOne(dealYaml({ name: null, Name: "Example App" }), "Name", /not a field name/, /Rename it to "name"/);
  expectOne(dealYaml({ coupon: "BF2026" }), "coupon", /not a field name/, /Rename it to "code"/);
  expectOne(dealYaml({ url: null, link: "https://example-app.dev" }), "link", /not a field name/, /Rename it to "url"/);
  expectOne(dealYaml({ colour: "red" }), "colour", /not a field name/, /Delete the line\. The fields are: name, url, description, discount, percent, code, terms, starts, ends\./);
  // a typo of a field that is already there cannot be renamed
  expectOne(dealYaml({ nmae: "Other" }), "nmae", /not a field name/, /Delete the line \(there is already a "name" line\)/);
});

test("errors carry the line of the field", () => {
  const error = expectOne(dealYaml({ percent: 150 }), "percent", /whole number from 1 to 100, but it is 150/, /delete this line/);
  assert.equal(error.line, 5);
});

test("url must be an http(s) address", () => {
  expectOne(dealYaml({ url: "example-app.dev/sale" }), "url", /is not a web address/, /url: "https:\/\/example-app\.dev\/sale"/);
  expectOne(dealYaml({ url: "ftp://example-app.dev" }), "url", /is not a web address/, /full address/);
  expectOne(dealYaml({ url: "mailto:me@example-app.dev" }), "url", /is not a web address/, /full address/);
  expectOne(dealYaml({ url: "https://localhost" }), "url", /is not a web address/, /full address/);
  expectOne(dealYaml({ url: "https://example-app.dev/my sale" }), "url", /contains a space/, /%20/);
  expectOne(dealYaml({ url: "https://example-app.dev/a)b" }), "url", /break the link/, /%29/);
  expectOne(dealYaml({ url: "https://example.com/black-friday" }), "url", /still the example address/, /Replace it/);
  expectOne(dealYaml({ url: 42 }), "url", /must be text/, /double quotes/);
  assert.deepEqual(check(dealYaml({ url: "http://example-app.dev/wiki/App_(software)?a=1&b=2#buy" })), []);
});

test("percent must be a whole number from 1 to 100", () => {
  for (const value of [0, 101, -5, 49.5]) {
    expectOne(dealYaml({ percent: value }), "percent", /whole number from 1 to 100/, /percent: /);
  }
  expectOne(dealYaml({ percent: "50%" }), "percent", /but it is "50%"/, /without quotes and without a % sign: percent: 50$/);
  expectOne(dealYaml({ percent: "30" }), "percent", /but it is "30"/, /percent: 30$/);
  expectOne(dealYaml() + "percent: 50% off\n", "percent", /but it is "50% off"/, /Write the number alone/);
  expectOne(dealYaml() + "percent: true\n", "percent", /whole number/, /Write the number alone/);
  for (const value of [1, 49, 50, 100]) assert.deepEqual(check(dealYaml({ percent: value })), []);
});

test("starts and ends must be real YYYY-MM-DD dates, in order", () => {
  expectOne(dealYaml({ ends: "27.11.2026" }), "ends", /must be a date written as YYYY-MM-DD/, /ends: "2026-11-30"/);
  expectOne(dealYaml({ starts: "2026-11-1" }), "starts", /must be a date written as YYYY-MM-DD/, /two digits/);
  expectOne(dealYaml({ ends: "Nov 30" }), "ends", /must be a date/, /describe the timing in "terms"/);
  expectOne(dealYaml({ ends: "2026-11-31" }), "ends", /not a day that exists/, /YYYY|year-month-day/);
  expectOne(dealYaml({ ends: "2026-12-01 23:59 UTC" }), "ends", /must be a date/, /terms/);
  expectOne(dealYaml({ ends: 20261130 }), "ends", /must be a date/, /ends: "2026-11-30"/);
  expectOne(dealYaml({ starts: "2026-12-01", ends: "2026-11-27" }), "ends", /ends \(2026-11-27\) before it starts \(2026-12-01\)/, /Swap/);
  expectOne(dealYaml({ ends: "2025-11-30" }), "ends", /is before 2026/, /this year's end date/);
  assert.deepEqual(check(dealYaml({ starts: "2026-11-27", ends: "2026-11-27" })), []);
  assert.deepEqual(check(dealYaml({ starts: "2026-11-27" })), []);
  assert.deepEqual(check(dealYaml({ starts: "2026-11-20", ends: "2027-01-05" })), []);
});

test("added must be an ISO timestamp with a time zone and not in the future", () => {
  expectOne(dealYaml({ added: "yesterday" }), "added", /must be a full timestamp/, /Delete this line/);
  expectOne(dealYaml({ added: "2026-11-11" }), "added", /must be a full timestamp/, /Delete this line/);
  expectOne(dealYaml({ added: "2026-11-11T10:00:00" }), "added", /must be a full timestamp/, /2026-11-27T09:30:00Z/);
  expectOne(dealYaml({ added: "2026-13-41T10:00:00Z" }), "added", /must be a full timestamp/, /Delete this line/);
  const now = Date.parse("2026-11-11T12:00:00Z");
  assert.equal(check(dealYaml({ added: "2026-11-20T00:00:00Z" }), { now }).length, 1);
  assert.match(check(dealYaml({ added: "2026-11-20T00:00:00Z" }), { now })[0].problem, /is in the future/);
  assert.deepEqual(check(dealYaml({ added: "2026-11-11T13:00:00+01:00" }), { now }), []);
  assert.deepEqual(check(dealYaml({ added: "2026-11-11T04:18:27.123Z" }), { now }), []);
});

test("text fields must be text, on one line, without raw HTML", () => {
  expectOne(dealYaml() + "code: 2026\n", "code", /must be text, but 2026 is read as a number/, /code: "2026"/);
  expectOne(dealYaml({ discount: null }) + "discount: 40\n", "discount", /read as a number/, /discount: "40"/);
  expectOne(dealYaml() + "terms: true\n", "terms", /read as a boolean/, /terms: "true"/);
  expectOne(dealYaml() + "terms:\n  - one\n  - two\n", "terms", /read as a list/, /one line of text/);
  expectOne(dealYaml({ description: null }) + "description: |\n  line one\n  line two\n", "description", /line break/, /one line/);
  expectOne(dealYaml({ terms: "first\nsecond" }), "terms", /line break/, /one line/);
  expectOne(dealYaml({ description: "A <b>bold</b> claim" }), "description", /contains HTML \(<b>\)/, /Markdown/);
  expectOne(dealYaml({ terms: "see <a href=\"https://x.dev\">here</a>" }), "terms", /contains HTML/, /Markdown/);
  expectOne(dealYaml({ discount: "50% off<br>today" }), "discount", /contains HTML \(<br>\)/, /Remove the HTML/);
  expectOne(dealYaml({ terms: "<!-- hidden -->" }), "terms", /contains HTML/, /Remove the HTML/);
  expectOne(dealYaml({ name: "Example <App>" }), "name", /contains HTML/, /Remove the HTML/);
  expectOne(dealYaml({ description: " Padded." }), "description", /space at the start or the end/, /Remove the extra space/);
  // comparisons, arrows and autolinks are not HTML
  assert.deepEqual(check(dealYaml({ terms: "for teams < 5 and > 2; $57 -> $35; <https://example-app.dev>; a<b" })), []);
});

test("name is plain text and code is a single code", () => {
  expectOne(dealYaml({ name: "[Example](https://example-app.dev)" }), "name", /Markdown characters/, /plain product name/);
  expectOne(dealYaml({ name: "**Example**" }), "name", /Markdown characters/, /plain product name/);
  expectOne(dealYaml({ code: "BF 2026" }), "code", /code alone, without spaces/, /code: "BF2026"/);
  expectOne(dealYaml({ code: "**BF2026**" }), "code", /code alone/, /describe them in "terms"/);
});

test("length limits: at the limit passes, one over fails and says by how much", () => {
  const base = { name: "", description: "", discount: "", code: "", terms: "" };
  for (const field of Object.keys(base)) {
    const limit = MAX_LENGTH[field];
    assert.deepEqual(check(dealYaml({ [field]: "x".repeat(limit) })), [], field);
    expectOne(dealYaml({ [field]: "x".repeat(limit + 3) }), field, new RegExp(`is ${limit + 3} characters long; the limit is ${limit}`), /at least 3 characters/);
  }
  const longUrl = `https://example-app.dev/${"a".repeat(MAX_LENGTH.url)}`;
  expectOne(dealYaml({ url: longUrl }), "url", /the limit is 300/, /Shorten/);
});

test("YAML syntax errors show the line and how to quote the value", () => {
  // a ": " inside an unquoted value
  let error = expectOne(dealYaml({ discount: null }) + "discount: 50% off: annual plans\n", "discount",
    /YAML cannot read this line/, /Wrap the value in double quotes: discount: "50% off: annual plans"/);
  assert.equal(error.line, 4);

  // a value that starts with ** (Markdown bold)
  error = expectOne(dealYaml() + "terms: **BF2026** on annual plans\n", "terms",
    /YAML cannot read this line/, /Wrap the value in double quotes: terms: "\*\*BF2026\*\* on annual plans"/);
  assert.equal(error.line, 5);
  expectOne(dealYaml() + "terms: **BF2026**\n", "terms", /starts with \*/, /terms: "\*\*BF2026\*\*"/);

  // text after a quoted part
  expectOne(dealYaml({ description: null }) + 'description: "Great" app\n', "description",
    /YAML cannot read this line/, /description: "\\"Great\\" app"/);

  // reserved first characters
  expectOne(dealYaml() + "code: @SAVE\n", "code", /YAML cannot read this line/, /code: "@SAVE"/);
  expectOne(dealYaml() + "terms: `CODE` at checkout\n", "terms", /YAML cannot read this line/, /terms: "`CODE` at checkout"/);

  // unclosed quote: reported where it was opened, not at the end of the file
  error = expectOne('name: "Example App\nurl: https://example-app.dev\ndescription: x\ndiscount: y\n', "name",
    /starts with a quote but does not end with one/, /same quote at the end/);
  assert.equal(error.line, 1);

  error = expectOne("name: Example App\nurl: https://example-app.dev\n  description: Indented.\ndiscount: 40% off\n", "description",
    /starts with spaces/, /Remove the spaces at the start of the line: description: Indented\./);
  assert.equal(error.line, 3);

  error = expectOne("name: Example App\nurl: https://example-app.dev\ndescription:No space.\ndiscount: 40% off\n", "description",
    /no space after the colon/, /description: "No space\."/);
  assert.equal(error.line, 3);

  error = expectOne("name: Example App\nurl: https://example-app.dev\n\tdescription: Tab.\ndiscount: 40% off\n", undefined,
    /starts with a tab/, /Delete the tab/);
  assert.equal(error.line, 3);

  error = expectOne(dealYaml() + "name: Second Name\n", "name", /"name" appears twice/, /Keep one/);
  assert.equal(error.line, 5);

  error = expectOne(dealYaml() + "---\n" + dealYaml({ name: "Second" }), undefined, /"---" line/, /One file holds exactly one deal/);
  assert.equal(error.line, 5);
});

test("values that YAML would silently cut or change are reported", () => {
  const cut = expectOne(dealYaml({ terms: null }) + "terms: plan #1 only\n", "terms", /cut off after "plan"/, /wrap the whole value in double quotes/);
  assert.equal(cut.line, 5);
  expectOne(dealYaml() + "terms: &save now\n", "terms", /starts with &/, /terms: "&save now"/);
  expectOne(dealYaml() + "terms: !important note\n", "terms", /starts with !/, /terms: "!important note"/);
  // a # without a space before it (URL fragment) and a quoted # are fine
  assert.deepEqual(check(dealYaml({ url: "https://example-app.dev/#pricing", terms: "plan #1 only" })), []);
  assert.deepEqual(check("name: Example App\nurl: https://example-app.dev/#pricing\ndescription: Good.\ndiscount: 40% off\n"), []);
});

test("a file that is not a list of fields is explained", () => {
  expectOne("", undefined, /file is empty/, /name: "Your App"/);
  expectOne("# only a comment\n", undefined, /file is empty/, /name: "Your App"/);
  expectOne("- name: Example App\n  url: https://example-app.dev\n", undefined, /makes this a list/, /Remove the "- "/);
  expectOne("Example App, 40% off\n", undefined, /does not contain "field: value" lines/, /one field per line/);
});

test("several problems in one file are all reported, in line order", () => {
  const errors = check('name: "Example App"\nurl: "example-app.dev"\ndescription: ""\ndiscount: "40% off"\npercent: "40%"\nends: "30.11.2026"\n');
  assert.deepEqual(errors.map((error) => [error.line, error.field]), [[2, "url"], [3, "description"], [5, "percent"], [6, "ends"]]);
});

test("file names: lowercase letters, numbers and single dashes, ending in .yml", () => {
  for (const good of ["a.yml", "my-app.yml", "1bench.yml", "app-2.yml"]) assert.ok(FILE_NAME.test(good), good);
  for (const bad of ["My-App.yml", "my_app.yml", "my app.yml", "my-app.yaml", "-app.yml", "app-.yml", "my--app.yml", ".yml", "app.YML"]) {
    assert.ok(!FILE_NAME.test(bad), bad);
  }
  assert.equal(suggestFileName("My App_Pro 2.YAML"), "my-app-pro-2.yml");
  assert.equal(suggestFileName("Café & Bar.yml"), "cafe-and-bar.yml");
});

test("validateTree accepts a valid catalog and counts it", (t) => {
  const root = makeRoot(t, {
    "deals/2026/dev-tools/alpha.yml": dealYaml({ name: "Alpha", url: "https://alpha.dev" }),
    "deals/2026/reference-education/beta.yml": dealYaml({ name: "Beta", url: "https://beta.dev" }),
    "deals/2025/dev-tools/alpha.yml": dealYaml({ name: "Alpha", url: "https://alpha.dev" }), // same deal in another year is fine
  });
  const result = validateTree(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.deals, 3);
  assert.equal(result.categories, 3);
  assert.deepEqual(result.years, ["2025", "2026"]);
});

test("validateTree checks file names, folders and stray files", (t) => {
  const root = makeRoot(t, {
    "deals/2026/dev-tools/My App.yml": dealYaml({ name: "A", url: "https://a.dev" }),
    "deals/2026/dev-tools/other.yaml": dealYaml({ name: "B", url: "https://b.dev" }),
    "deals/2026/dev-toolz/typo.yml": dealYaml({ name: "C", url: "https://c.dev" }),
    "deals/2026/loose.yml": dealYaml({ name: "D", url: "https://d.dev" }),
    "deals/2026/dev-tools/nested/deep.yml": dealYaml({ name: "E", url: "https://e.dev" }),
    "deals/2026/dev-tools/notes.txt": "hello",
    "deals/top-level.yml": dealYaml({ name: "F", url: "https://f.dev" }),
    "deals/2026/books/.gitkeep": "",
  });
  const byFile = Object.fromEntries(validateTree(root).errors.map((error) => [error.file, error]));
  assert.deepEqual(Object.keys(byFile).sort(), [
    "deals/2026/dev-tools/My App.yml",
    "deals/2026/dev-tools/nested",
    "deals/2026/dev-tools/notes.txt",
    "deals/2026/dev-tools/other.yaml",
    "deals/2026/dev-toolz",
    "deals/2026/loose.yml",
    "deals/top-level.yml",
  ]);
  assert.match(byFile["deals/2026/dev-tools/My App.yml"].fix, /Rename the file to my-app\.yml/);
  assert.match(byFile["deals/2026/dev-tools/other.yaml"].fix, /Rename the file to other\.yml/);
  assert.match(byFile["deals/2026/dev-toolz"].problem, /"dev-toolz" is not one of the categories/);
  assert.match(byFile["deals/2026/dev-toolz"].fix, /Did you mean "dev-tools"\?.*dev-tools, reference-education, books/);
  assert.match(byFile["deals/2026/loose.yml"].problem, /not inside a category folder/);
  assert.match(byFile["deals/2026/loose.yml"].fix, /deals\/2026\/<category>\/loose\.yml/);
  assert.match(byFile["deals/2026/dev-tools/nested"].problem, /folders inside a category/);
  assert.match(byFile["deals/2026/dev-tools/notes.txt"].problem, /not a deal file/);
  assert.match(byFile["deals/top-level.yml"].fix, /deals\/<year>\/<category>\/top-level\.yml/);
});

test("validateTree still checks the content of a badly named file", (t) => {
  const root = makeRoot(t, { "deals/2026/dev-tools/Bad Name.yml": dealYaml({ percent: 500 }) });
  const fields = validateTree(root).errors.map((error) => error.field);
  assert.deepEqual(fields, ["file name", "percent"]);
});

test("validateTree rejects two deals with the same name and URL", (t) => {
  const root = makeRoot(t, {
    "deals/2026/dev-tools/alpha.yml": dealYaml({ name: "Alpha", url: "https://alpha.dev/sale" }),
    "deals/2026/reference-education/alpha-again.yml": dealYaml({ name: "alpha", url: "https://www.alpha.dev/sale/?utm_source=list" }),
    "deals/2026/dev-tools/alpha-pro.yml": dealYaml({ name: "Alpha Pro", url: "https://alpha.dev/sale" }), // other product, same page
    "deals/2026/dev-tools/other-alpha.yml": dealYaml({ name: "Alpha", url: "https://other.dev" }), // same name, other maker
  });
  const { errors } = validateTree(root);
  assert.equal(errors.length, 1, formatErrors(errors));
  assert.equal(errors[0].file, "deals/2026/reference-education/alpha-again.yml");
  assert.match(errors[0].problem, /same deal as deals\/2026\/dev-tools\/alpha\.yml/);
  assert.match(errors[0].fix, /Delete one of the two files/);
});

test("validateCategories checks the category list", () => {
  const ok = validateCategories(categoriesYaml());
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.categories.length, 3);

  const problems = (text) => validateCategories(text).errors.map((error) => `${error.field}: ${error.problem}`);
  assert.match(problems("slug: a\n")[0], /must be a list of categories/);
  assert.match(problems("- slug: Dev Tools\n  title: Dev\n  emoji: 🛠\n  anchor: dev\n")[0], /category 1, slug: "Dev Tools" may only use lowercase/);
  assert.match(problems("- slug: dev\n  title: Dev\n  emoji: 🛠\n")[0], /category 1, anchor: is missing or empty/);
  assert.match(problems("- slug: dev\n  title: Dev\n  emoji: 🛠\n  anchor: Dev Tools\n")[0], /category 1, anchor: "Dev Tools" may only use/);
  assert.match(problems("- slug: dev\n  title: Dev\n  emoji: 🛠\n  anchor: dev\n  color: red\n")[0], /category 1, color: is not a known field/);
  const twice = problems("- slug: dev\n  title: Dev\n  emoji: 🛠\n  anchor: dev\n- slug: dev\n  title: Dev\n  emoji: 🛠\n  anchor: dev\n");
  assert.deepEqual(twice.map((line) => line.split(":")[0]), ["category 2, slug", "category 2, title", "category 2, anchor"]);
  assert.match(problems("- slug: dev\n  title: Dev: tools\n")[0], /YAML cannot read this line/);
});

test("validateTree reports a missing or broken categories.yml", (t) => {
  const broken = makeRoot(t, { "deals/categories.yml": "- slug: Dev Tools\n  title: Dev\n  emoji: 🛠\n  anchor: dev\n" });
  assert.equal(validateTree(broken).errors[0].file, "deals/categories.yml");
  const missing = makeRoot(t);
  rmSync(`${missing}/deals/categories.yml`);
  assert.match(validateTree(missing).errors[0].problem, /file is missing/);
});

test("formatErrors groups by file and shows line, field, problem and fix", () => {
  const text = formatErrors([
    { file: "deals/2026/a/x.yml", line: 5, field: "percent", problem: "is wrong", fix: "Do this." },
    { file: "deals/2026/a/y.yml", field: "name", problem: "is missing", fix: "Add it." },
    { file: "deals/2026/a/x.yml", problem: "is odd", fix: "Do that." },
  ]);
  assert.equal(text, [
    "deals/2026/a/x.yml",
    "  ✗ line 5, percent: is wrong",
    "    Fix: Do this.",
    "  ✗ is odd",
    "    Fix: Do that.",
    "",
    "deals/2026/a/y.yml",
    "  ✗ name: is missing",
    "    Fix: Add it.",
  ].join("\n"));
});

test("githubAnnotations escapes the message for the Actions log", () => {
  const [line] = githubAnnotations([{ file: "deals/2026/a/x.yml", line: 5, field: "percent", problem: "100% wrong", fix: "Use\npercent: 40" }]).split("\n");
  assert.equal(line, "::error file=deals/2026/a/x.yml,line=5,title=Deal check%3A percent::percent: 100%25 wrong. Fix: Use%0Apercent: 40");
});

test("validate.mjs exits 0 on a valid catalog", (t) => {
  const root = makeRoot(t, { "deals/2026/dev-tools/alpha.yml": dealYaml() });
  const result = run("validate.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /All good: 1 deals? in 3 categories/);
});

test("validate.mjs prints every error of every file and exits 1", (t) => {
  const root = makeRoot(t, {
    "deals/2026/dev-tools/alpha.yml": dealYaml({ percent: "40%", ends: "tomorrow" }),
    "deals/2026/dev-tools/beta.yml": "name: Beta\nurl: https://beta.dev\ndescription: Good: really\ndiscount: 10% off\n",
    "deals/2026/books/Gamma.yml": dealYaml({ name: "Gamma", url: "https://gamma.dev" }),
  });
  const result = run("validate.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deals\/2026\/dev-tools\/alpha\.yml\n {2}✗ line 5, percent: /);
  assert.match(result.stderr, /✗ line 6, ends: /);
  assert.match(result.stderr, /deals\/2026\/dev-tools\/beta\.yml\n {2}✗ line 3, description: YAML cannot read this line/);
  assert.match(result.stderr, /Fix: Wrap the value in double quotes: description: "Good: really"/);
  assert.match(result.stderr, /deals\/2026\/books\/Gamma\.yml\n {2}✗ file name: /);
  assert.match(result.stderr, /4 problems in 3 files/);
  assert.equal(result.stdout, "", "no annotations outside GitHub Actions");

  const inCi = run("validate.mjs", ["--root", root], { GITHUB_ACTIONS: "true" });
  assert.equal(inCi.status, 1);
  assert.equal(inCi.stdout.trim().split("\n").length, 4);
  assert.match(inCi.stdout, /^::error file=deals\/2026\/books\/Gamma\.yml,title=Deal check%3A file name::/m);
  assert.match(inCi.stdout, /^::error file=deals\/2026\/dev-tools\/alpha\.yml,line=5,title=Deal check%3A percent::/m);
});
