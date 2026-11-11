import assert from "node:assert/strict";
import test from "node:test";
import {
  dealKey, escapeCell, gitAddedTimes, latestYear, loadCatalog, loadCategories, readmeRow, savingsEmoji, termsCell,
} from "../scripts/lib/catalog.mjs";
import { CATEGORIES, commitAll, dealYaml, git, makeRoot, write } from "./helpers.mjs";

const names = (category) => category.deals.map((deal) => deal.name);

test("loadCategories returns the categories in file order", (t) => {
  const root = makeRoot(t);
  assert.deepEqual(loadCategories(root), CATEGORIES);
});

test("loadCatalog groups deals by category, keeps empty categories and adds slug, category and path", (t) => {
  const root = makeRoot(t, {
    "deals/2026/dev-tools/alpha.yml": dealYaml({ name: "Alpha", added: "2026-11-01T10:00:00Z" }),
    "deals/2026/reference-education/beta.yml": dealYaml({ name: "Beta", percent: 60, added: "2026-11-01T10:00:00Z" }),
    "deals/2026/dev-tools/notes.txt": "not a deal",
  });
  const catalog = loadCatalog(root, 2026);
  assert.deepEqual(catalog.map((category) => category.slug), ["dev-tools", "reference-education", "books"]);
  assert.deepEqual(catalog.map((category) => category.deals.length), [1, 1, 0]);
  assert.equal(catalog[1].anchor, "reference--education");
  assert.deepEqual(catalog[0].deals[0], {
    name: "Alpha",
    url: "https://example-app.dev/sale",
    description: "Does one thing well.",
    discount: "40% off",
    added: "2026-11-01T10:00:00Z",
    slug: "alpha",
    category: "dev-tools",
    path: "deals/2026/dev-tools/alpha.yml",
  });
  assert.equal(catalog[1].deals[0].percent, 60);
});

test("deals are ordered by `added`, oldest first, whatever the file names are", (t) => {
  const root = makeRoot(t, {
    "deals/2026/dev-tools/a-third.yml": dealYaml({ name: "Third", added: "2026-11-03T00:00:00Z" }),
    "deals/2026/dev-tools/m-first.yml": dealYaml({ name: "First", added: "2026-11-01T00:00:00Z" }),
    "deals/2026/dev-tools/z-second.yml": dealYaml({ name: "Second", added: "2026-11-02T08:00:00+09:00" }),
  });
  assert.deepEqual(names(loadCatalog(root, 2026)[0]), ["First", "Second", "Third"]);
});

test("without `added` and without git history, deals go last in file-name order", (t) => {
  const root = makeRoot(t, {
    "deals/2026/dev-tools/b.yml": dealYaml({ name: "B" }),
    "deals/2026/dev-tools/a.yml": dealYaml({ name: "A" }),
    "deals/2026/dev-tools/z.yml": dealYaml({ name: "Dated", added: "2026-11-09T00:00:00Z" }),
  });
  const [category] = loadCatalog(root, 2026);
  assert.deepEqual(names(category), ["Dated", "A", "B"]);
  assert.equal(category.deals[1].added, null);
});

test("options.gitTimes supplies the time for deals without `added`; an explicit `added` wins", (t) => {
  const root = makeRoot(t, {
    "deals/2026/dev-tools/a.yml": dealYaml({ name: "A" }),
    "deals/2026/dev-tools/b.yml": dealYaml({ name: "B", added: "2026-11-01T00:00:00Z" }),
    "deals/2026/dev-tools/c.yml": dealYaml({ name: "C" }),
  });
  const gitTimes = new Map([
    ["deals/2026/dev-tools/a.yml", "2026-11-05T00:00:00Z"],
    ["deals/2026/dev-tools/b.yml", "2026-11-09T00:00:00Z"], // ignored: the file says 11-01
    ["deals/2026/dev-tools/c.yml", "2026-11-03T00:00:00Z"],
  ]);
  const [category] = loadCatalog(root, 2026, { gitTimes });
  assert.deepEqual(names(category), ["B", "C", "A"]);
  assert.equal(category.deals[2].added, "2026-11-05T00:00:00Z");
});

test("git fallback: a deal is ordered by the time it landed on the branch, not by its commit date", (t) => {
  const root = makeRoot(t);
  const file = (name) => `deals/2026/dev-tools/${name}.yml`;
  git(root, ["init", "-q", "-b", "main"]);

  write(root, { [file("apple")]: dealYaml({ name: "Apple" }) });
  commitAll(root, "Add Apple", "2026-11-01T10:00:00Z");

  // A pull request branch whose commit is old but which is merged late.
  git(root, ["checkout", "-q", "-b", "pull-request"]);
  write(root, { [file("banana")]: dealYaml({ name: "Banana" }) });
  commitAll(root, "Add Banana", "2026-11-02T10:00:00Z");
  git(root, ["checkout", "-q", "main"]);

  write(root, { [file("cherry")]: dealYaml({ name: "Cherry" }) });
  commitAll(root, "Add Cherry", "2026-11-05T10:00:00Z");
  git(root, ["merge", "-q", "--no-ff", "-m", "Merge pull request", "pull-request"], "2026-11-08T10:00:00Z");

  assert.deepEqual(names(loadCatalog(root, 2026)[0]), ["Apple", "Cherry", "Banana"]);
  assert.equal(new Date(gitAddedTimes(root, "deals/2026").get(file("banana"))).toISOString(), "2026-11-08T10:00:00.000Z");

  // A renamed file keeps its place.
  git(root, ["mv", file("apple"), file("apple-pro")]);
  commitAll(root, "Rename Apple", "2026-11-09T10:00:00Z");
  assert.deepEqual(loadCatalog(root, 2026)[0].deals.map((deal) => deal.slug), ["apple-pro", "cherry", "banana"]);

  // An explicit `added` beats the git time, and an uncommitted file goes last.
  write(root, { [file("zebra")]: dealYaml({ name: "Zebra", added: "2026-10-01T00:00:00Z" }) });
  commitAll(root, "Add Zebra", "2026-11-10T10:00:00Z");
  write(root, { [file("aardvark")]: dealYaml({ name: "Aardvark" }) });
  assert.deepEqual(names(loadCatalog(root, 2026)[0]), ["Zebra", "Apple", "Cherry", "Banana", "Aardvark"]);

  // A deal that was removed and added again counts from the second time.
  git(root, ["rm", "-q", file("cherry")]);
  commitAll(root, "Remove Cherry", "2026-11-11T10:00:00Z");
  write(root, { [file("cherry")]: dealYaml({ name: "Cherry" }) });
  commitAll(root, "Add Cherry again", "2026-11-12T10:00:00Z");
  assert.deepEqual(names(loadCatalog(root, 2026)[0]), ["Zebra", "Apple", "Banana", "Aardvark", "Cherry"]);
});

test("gitAddedTimes returns nothing outside a git repository", (t) => {
  const root = makeRoot(t, { "deals/2026/dev-tools/a.yml": dealYaml() });
  assert.equal(gitAddedTimes(root, "deals/2026").size, 0);
});

test("latestYear is the newest deals/<year> folder", (t) => {
  const root = makeRoot(t, {
    "deals/2025/dev-tools/a.yml": dealYaml(),
    "deals/2026/dev-tools/a.yml": dealYaml(),
    "deals/notes/readme.txt": "x",
  });
  assert.equal(latestYear(root), 2026);
});

test("savingsEmoji: under 50, 50 or more, no percentage", () => {
  assert.equal(savingsEmoji(1), "💰");
  assert.equal(savingsEmoji(49), "💰");
  assert.equal(savingsEmoji(50), "💸");
  assert.equal(savingsEmoji(100), "💸");
  assert.equal(savingsEmoji(undefined), "—");
  assert.equal(savingsEmoji(null), "—");
});

test("termsCell puts the code first, then the terms, then the dates", () => {
  assert.equal(termsCell({ code: "BF2026", terms: "annual plans", starts: "2026-11-27", ends: "2026-11-30" }),
    "**BF2026**; annual plans; 2026-11-27 to 2026-11-30");
  assert.equal(termsCell({ code: "BF2026" }), "**BF2026**");
  assert.equal(termsCell({ terms: "Automatically applied" }), "Automatically applied");
  assert.equal(termsCell({ ends: "2026-12-01" }), "until 2026-12-01");
  assert.equal(termsCell({ starts: "2026-11-20" }), "from 2026-11-20");
  assert.equal(termsCell({}), "");
});

test("readmeRow builds the five-cell table row and escapes pipes", () => {
  assert.equal(
    readmeRow({ name: "Example", url: "https://example.org/", description: "CLI | editor", discount: "~~$20~~ $10", percent: 50, code: "X" }),
    "| 💸 | [Example](https://example.org/) | CLI &#124; editor | ~~$20~~ $10 | **X** |",
  );
  assert.equal(
    readmeRow({ name: "Fixed", url: "https://fixed.example", description: "Thing.", discount: "$5 once" }),
    "| — | [Fixed](https://fixed.example) | Thing. | $5 once |  |",
  );
  assert.equal(escapeCell("a|b|c"), "a&#124;b&#124;c");
});

test("dealKey ignores case, protocol, www, trailing slash, query and fragment", () => {
  const key = dealKey({ name: "My App", url: "https://myapp.dev/sale" });
  assert.equal(dealKey({ name: "my  app", url: "http://www.MyApp.dev/sale/?utm_source=x#buy" }), key);
  assert.notEqual(dealKey({ name: "My App", url: "https://myapp.dev/other" }), key);
  assert.notEqual(dealKey({ name: "My App 2", url: "https://myapp.dev/sale" }), key);
});
