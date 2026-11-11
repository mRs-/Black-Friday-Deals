import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loadCatalog, loadCategories } from "../scripts/lib/catalog.mjs";
import { parseReadme, planImport } from "../scripts/lib/import.mjs";
import {
  START_MARKER, buildReadme, checksum, compareGenerated, endMarker, findHandEdits, firstDifference, renderDeals, splitReadme,
} from "../scripts/lib/readme.mjs";
import { REPO_ROOT, commitAll, dealYaml, git, makeRoot, run, write } from "./helpers.mjs";

// The generated part for the three test categories: two deals, one deal, none.
const GENERATED = `## Table of Contents

- [🛠 Dev Tools](#dev-tools)
- [🎓 Reference & Education](#reference--education)
- [📖 Books](#books)

<a id="dev-tools"></a>

## 🛠 Dev Tools

| Savings | Name | Description | Discount | Code & Terms |
| --- | --- | --- | --- | --- |
| 💰 | [Proxy Tool](https://proxy.example.dev/) | Capture and inspect HTTP/HTTPS traffic. | 30% off all plans | **BF2026**; applies to early-bird prices; 2026-11-16 to 2026-12-03 |
| 💸 | [Text Editor](https://apps.example.dev/us/app/editor/id1548193893) | Plain text editor for iPhone &#124; iPad. | 50% off Premium (~~$9.99~~ $4.99 USD) | Automatically applied. No code needed. November 24–30, 2026. |

[⬆️ Back to contents](#table-of-contents)

<a id="reference--education"></a>

## 🎓 Reference & Education

| Savings | Name | Description | Discount | Code & Terms |
| --- | --- | --- | --- | --- |
| — | [Flash Cards](https://cards.example.dev/?ref=list) | Spaced repetition for language learners. | Lifetime licence for $19 | **YEARLY&#95;26** for yearly; **LIFE&#95;26** for lifetime; until 2026-12-02 |

[⬆️ Back to contents](#table-of-contents)

<a id="books"></a>

## 📖 Books

| Savings | Name | Description | Discount | Code & Terms |
| --- | --- | --- | --- | --- |

[⬆️ Back to contents](#table-of-contents)`;

const INTRO = "# Deals\n\nHand-written intro.\n\n| Savings | Meaning |\n| --- | --- |\n| 💰 | Less than 50% off |\n\n";
const BARE_END = "<!-- DEALS:END -->"; // a README that was never built has no checksum yet
const END_MARKER = endMarker(GENERATED);
const README = `${INTRO}${START_MARKER}\n\n${GENERATED}\n\n${END_MARKER}\n`;

// 1-based line number of the first line that contains `needle`.
const lineOf = (text, needle) => text.split("\n").findIndex((line) => line.includes(needle)) + 1;

const DEALS = {
  "deals/2026/dev-tools/proxy-tool.yml": dealYaml({
    name: "Proxy Tool", url: "https://proxy.example.dev/", description: "Capture and inspect HTTP/HTTPS traffic.",
    discount: "30% off all plans", percent: 30, code: "BF2026", terms: "applies to early-bird prices",
    starts: "2026-11-16", ends: "2026-12-03", added: "2026-11-01T10:00:00Z",
  }),
  "deals/2026/dev-tools/text-editor.yml": dealYaml({
    name: "Text Editor", url: "https://apps.example.dev/us/app/editor/id1548193893", description: "Plain text editor for iPhone | iPad.",
    discount: "50% off Premium (~~$9.99~~ $4.99 USD)", percent: 50,
    terms: "Automatically applied. No code needed. November 24–30, 2026.", added: "2026-11-02T10:00:00Z",
  }),
  "deals/2026/reference-education/flash-cards.yml": dealYaml({
    name: "Flash Cards", url: "https://cards.example.dev/?ref=list", description: "Spaced repetition for language learners.",
    discount: "Lifetime licence for $19", terms: "**YEARLY&#95;26** for yearly; **LIFE&#95;26** for lifetime; until 2026-12-02",
    added: "2026-11-03T10:00:00Z",
  }),
};

test("renderDeals writes the table of contents, anchors, tables and empty categories", (t) => {
  const root = makeRoot(t, DEALS);
  assert.equal(renderDeals(loadCatalog(root, 2026)), GENERATED);
});

test("buildReadme replaces only the generated part and is stable", (t) => {
  const root = makeRoot(t, DEALS);
  const catalog = loadCatalog(root, 2026);
  const stale = `${INTRO}${START_MARKER}\nold tables\n${BARE_END}\n\nFooter stays.\n`;
  const built = buildReadme(stale, catalog);
  assert.equal(built, `${INTRO}${START_MARKER}\n\n${GENERATED}\n\n${END_MARKER}\n\nFooter stays.\n`);
  assert.equal(buildReadme(built, catalog), built);
  assert.equal(buildReadme(README, catalog), README);
});

test("splitReadme needs both markers, once each, in order", () => {
  assert.equal(splitReadme(README).generated, GENERATED);
  assert.equal(splitReadme(README).before, INTRO);
  assert.equal(splitReadme("no markers"), null);
  assert.equal(splitReadme(`${START_MARKER}\nonly start`), null);
  assert.equal(splitReadme(`${END_MARKER}\n${START_MARKER}`), null);
  assert.equal(splitReadme(`${README}${START_MARKER}`), null);
  assert.equal(splitReadme(`${README}${BARE_END}`), null);
  assert.throws(() => buildReadme("no markers", []), /DEALS:START/);
  // the wording of the start marker may change without breaking anything
  assert.equal(splitReadme(README.replace(START_MARKER, "<!-- DEALS:START generated, hands off -->")).generated, GENERATED);
});

test("the end marker carries a checksum that shows when the tables were edited by hand", () => {
  assert.equal(END_MARKER, `<!-- DEALS:END checksum:${checksum(GENERATED)} -->`);
  assert.match(END_MARKER, /^<!-- DEALS:END checksum:[0-9a-f]{12} -->$/);
  assert.equal(splitReadme(README).edited, false);
  assert.equal(splitReadme(README.replace("Hand-written intro.", "A better intro.")).edited, false);
  assert.equal(splitReadme(README.replace("30% off all plans", "35% off all plans")).edited, true);
  assert.equal(splitReadme(README.replace(END_MARKER, BARE_END)).edited, false, "no checksum yet: nothing to compare");
});

test("findHandEdits lists rows without a deal file and rows that differ from their file", (t) => {
  const root = makeRoot(t, DEALS);
  const catalog = loadCatalog(root, 2026);
  assert.deepEqual(findHandEdits(README, catalog), { orphans: [], changed: [], unreadable: [] });

  const added = "| 💰 | [By Hand](https://byhand.example.dev) | Added to the table. | 10% off |  |";
  const edited = README
    .replace("| 💸 | [Text Editor]", `${added}\n| 💸 | [Text Editor]`)
    .replace("Lifetime licence for $19", "Lifetime licence for $15")
    .replace("| — | [Flash Cards]", "| not a row |\n| — | [Flash Cards]");
  const edits = findHandEdits(edited, catalog);
  assert.deepEqual(edits.orphans, [{ line: lineOf(edited, "[By Hand]"), readme: added }]);
  assert.equal(edits.changed.length, 1);
  assert.equal(edits.changed[0].path, "deals/2026/reference-education/flash-cards.yml");
  assert.match(edits.changed[0].readme, /\$15/);
  assert.match(edits.changed[0].file, /\$19/);
  assert.deepEqual(edits.unreadable, [`line ${lineOf(edited, "| not a row |")}: 1 cells instead of 5`]);

  // padding the cells (a table formatter) is not a change
  const padded = README.replace("| 30% off all plans |", "|   30% off all plans   |");
  assert.deepEqual(findHandEdits(padded, catalog), { orphans: [], changed: [], unreadable: [] });
});

test("round trip: an old README turns into deal files that rebuild the same tables byte for byte", (t) => {
  const root = makeRoot(t);
  const parsed = parseReadme(README);
  assert.deepEqual(parsed.problems, []);
  const plan = planImport(parsed, loadCatalog(root, 2026), { year: "2026", now: Date.parse("2026-11-05T00:00:00Z") });
  assert.equal(plan.fresh.length, 3);
  write(root, Object.fromEntries(plan.fresh.map((file) => [file.path, file.text])));
  write(root, { "README.md": `${INTRO}${START_MARKER}\n${BARE_END}\n` });

  assert.equal(run("validate.mjs", ["--root", root]).status, 0);
  const built = run("build-readme.mjs", ["--root", root]);
  assert.equal(built.status, 0, built.output);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), README);
});

test("build-readme.mjs writes README.md, and --check reports without writing", (t) => {
  const root = makeRoot(t, { ...DEALS, "README.md": README });

  let result = run("build-readme.mjs", ["--root", root, "--check"]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /up to date \(3 deals in 3 categories\)/);

  // a new deal makes the README stale
  write(root, { "deals/2026/books/new-book.yml": dealYaml({ name: "New Book", url: "https://book.example.dev", percent: 40, added: "2026-11-04T10:00:00Z" }) });
  result = run("build-readme.mjs", ["--root", root, "--check"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md is out of date/);
  assert.match(result.stderr, /should be: {5}\| 💰 \| \[New Book\]/);
  assert.match(result.stderr, /npm run build:readme/);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), README, "--check must not write");

  result = run("build-readme.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /README\.md updated \(4 deals in 3 categories\)/);
  const updated = readFileSync(join(root, "README.md"), "utf8");
  assert.ok(updated.startsWith(INTRO), "the hand-written part is untouched");
  assert.match(updated, /\| 💰 \| \[New Book\]\(https:\/\/book\.example\.dev\) \| Does one thing well\. \| 40% off \|  \|\n\n\[⬆️ Back to contents\]/);
  assert.equal(run("build-readme.mjs", ["--root", root, "--check"]).status, 0);
});

test("build-readme.mjs refuses to write when a deal file is invalid or the markers are missing", (t) => {
  const broken = makeRoot(t, { ...DEALS, "README.md": README, "deals/2026/books/bad.yml": dealYaml({ percent: 500 }) });
  let result = run("build-readme.mjs", ["--root", broken]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deals\/2026\/books\/bad\.yml\n {2}✗ line 5, percent/);
  assert.match(result.stderr, /README\.md was not changed/);
  assert.equal(readFileSync(join(broken, "README.md"), "utf8"), README);

  const unmarked = makeRoot(t, { ...DEALS, "README.md": "# Deals\n\nNo markers here.\n" });
  result = run("build-readme.mjs", ["--root", unmarked]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must contain a DEALS:START line and a DEALS:END line/);
  assert.equal(readFileSync(join(unmarked, "README.md"), "utf8"), "# Deals\n\nNo markers here.\n");
});

test("build-readme.mjs stops when the tables were edited by hand and a row would be lost", (t) => {
  const added = "| 💰 | [By Hand](https://byhand.example.dev) | Added to the table. | 10% off | **HAND10**; 2026-11-27 to 2026-11-30 |";
  const merged = README.replace("\n\n[⬆️ Back to contents](#table-of-contents)\n\n<a id=\"reference--education\">", `\n${added}\n\n[⬆️ Back to contents](#table-of-contents)\n\n<a id="reference--education">`);
  assert.notEqual(merged, README);
  const root = makeRoot(t, { ...DEALS, "README.md": merged });

  for (const args of [[], ["--check"]]) {
    const result = run("build-readme.mjs", ["--root", root, ...args]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.stderr, /deal tables were edited by hand/);
    assert.ok(result.stderr.includes(`Rows without a deal file (1):\n  line ${lineOf(merged, "[By Hand]")}: ${added}\n`), result.stderr);
    assert.match(result.stderr, /import-readme\.mjs --from README\.md --write/);
    assert.match(result.stderr, /README\.md was not changed/);
    assert.equal(readFileSync(join(root, "README.md"), "utf8"), merged);
  }
  const inCi = run("build-readme.mjs", ["--root", root], { GITHUB_ACTIONS: "true" });
  assert.match(inCi.stdout, /^::error file=README\.md,title=README tables were edited by hand::1 table row is only in README\.md/m);

  // the fix: turn the row into a deal file, then the build goes through and keeps the row
  const imported = run("import-readme.mjs", ["--root", root, "--from", join(root, "README.md"), "--write"]);
  assert.match(imported.stdout, /3 already there, 1 new, 0 different/);
  const rebuilt = run("build-readme.mjs", ["--root", root]);
  assert.equal(rebuilt.status, 0, rebuilt.output);
  const text = readFileSync(join(root, "README.md"), "utf8");
  assert.ok(text.includes(added));
  assert.equal(splitReadme(text).edited, false);
  assert.equal(run("build-readme.mjs", ["--root", root, "--check"]).status, 0);
});

test("build-readme.mjs stops on a hand-edited row; --force rebuilds from the deal files", (t) => {
  const edited = README.replace("30% off all plans", "35% off all plans");
  const root = makeRoot(t, { ...DEALS, "README.md": edited });
  const result = run("build-readme.mjs", ["--root", root]);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`Rows that differ from their deal file (1):\n  line ${lineOf(edited, "[Proxy Tool]")}, deals/2026/dev-tools/proxy-tool.yml\n    README: | 💰 | [Proxy Tool]`), result.stderr);
  assert.match(result.stderr, /\n {4}README: .*35% off all plans.*\n {4}file: {3}.*30% off all plans/);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), edited);

  const forced = run("build-readme.mjs", ["--root", root, "--force"]);
  assert.equal(forced.status, 0, forced.output);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), README);
});

test("build-readme.mjs still rebuilds after a deleted deal file or a harmless hand edit", (t) => {
  // a deal file was deleted: its row goes away without any fuss
  const root = makeRoot(t, { ...DEALS, "README.md": README });
  rmSync(join(root, "deals/2026/dev-tools/text-editor.yml"));
  let result = run("build-readme.mjs", ["--root", root]);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(readFileSync(join(root, "README.md"), "utf8"), /Text Editor/);

  // a row removed by hand comes back, because its deal file is still there
  const removed = README.replace(/\| 💸 \| \[Text Editor\].*\n/, "");
  const second = makeRoot(t, { ...DEALS, "README.md": removed });
  result = run("build-readme.mjs", ["--root", second]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /edited by hand, but every row matches a deal file/);
  assert.equal(readFileSync(join(second, "README.md"), "utf8"), README);
});

test("compareGenerated tells an edit of the tables from an edit of the intro", () => {
  assert.equal(compareGenerated(README, README), "unchanged");
  assert.equal(compareGenerated(README, README.replace("Hand-written intro.", "A better intro.")), "unchanged");
  assert.equal(compareGenerated(README, README.replace("30% off all plans", "35% off all plans")), "changed");
  assert.equal(compareGenerated(README, README.replace(END_MARKER, "")), "markers");
  assert.equal(compareGenerated(README, null), "markers");
  assert.equal(compareGenerated("# Old README without markers\n", README), "no-base");
  assert.equal(compareGenerated(null, README), "no-base");
  assert.deepEqual(firstDifference("a\nb\nc", "a\nx\nc"), { line: 2, expected: "b", actual: "x" });
  assert.equal(firstDifference("a\nb", "a\nb"), null);
});

test("check-pr.mjs fails a pull request that edits the generated tables", (t) => {
  const root = makeRoot(t, { ...DEALS, "README.md": README });
  git(root, ["init", "-q", "-b", "master"]);
  commitAll(root, "Base", "2026-11-05T10:00:00Z");

  // adding a deal file and editing the intro is fine
  write(root, {
    "deals/2026/books/new-book.yml": dealYaml({ name: "New Book", url: "https://book.example.dev" }),
    "README.md": README.replace("Hand-written intro.", "A better intro."),
  });
  commitAll(root, "Add a deal the new way", "2026-11-06T10:00:00Z");
  let result = run("check-pr.mjs", ["--root", root, "--base", "HEAD^1"]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /were not edited/);
  assert.doesNotMatch(result.stdout, /sets "added"/);

  // adding a row to a table the old way is not
  const row = "| 💰 | [Old Way](https://old.example.dev) | Added by hand. | 10% off |  |";
  write(root, { "README.md": README.replace("| 💸 | [Text Editor]", `${row}\n| 💸 | [Text Editor]`) });
  commitAll(root, "Add a row by hand", "2026-11-07T10:00:00Z");
  result = run("check-pr.mjs", ["--root", root, "--base", "HEAD^1"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /edits the deal tables in README\.md/);
  assert.match(result.stderr, /https:\/\/blackfriday\.mariuslandwehr\.com\/submit\//);
  assert.match(result.stderr, /deals\/2026\/<category>\/<your-app>\.yml/);
  assert.match(result.stderr, /import-readme\.mjs --from/);
  const inCi = run("check-pr.mjs", ["--root", root, "--base", "HEAD^1"], { GITHUB_ACTIONS: "true" });
  assert.match(inCi.stdout, /^::error file=README\.md,title=Add a deal file instead of editing README\.md::/m);

  // removing a marker is reported as such
  write(root, { "README.md": README.replace(END_MARKER, "") });
  result = run("check-pr.mjs", ["--root", root, "--base", "HEAD~2"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /removes or changes the DEALS:START \/ DEALS:END lines/);
});

test("check-pr.mjs passes when the base has no generated part, and notes a new deal that sets `added`", (t) => {
  const root = makeRoot(t, { "README.md": "# Old README\n\n| Savings | Name |\n" });
  git(root, ["init", "-q", "-b", "master"]);
  commitAll(root, "Old README", "2026-11-05T10:00:00Z");
  write(root, {
    "README.md": README,
    "deals/2026/books/first.yml": dealYaml({ name: "First", url: "https://first.example.dev", added: "2026-01-01T00:00:00Z" }),
  });
  commitAll(root, "Move to generated tables", "2026-11-06T10:00:00Z");
  const result = run("check-pr.mjs", ["--root", root, "--base", "HEAD^1"], { GITHUB_ACTIONS: "true" });
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /no generated part yet/);
  assert.match(result.stdout, /^::warning file=deals\/2026\/books\/first\.yml,title=Deal order::/m);
});

test("the repository README has the markers and its anchors match deals/categories.yml", () => {
  const parts = splitReadme(readFileSync(join(REPO_ROOT, "README.md"), "utf8"));
  assert.ok(parts, "README.md must contain the DEALS:START and DEALS:END lines");
  const categories = loadCategories(REPO_ROOT);
  const anchors = [...parts.generated.matchAll(/^<a id="([^"]+)"><\/a>$/gm)].map((match) => match[1]);
  const links = [...parts.generated.matchAll(/^- \[.+\]\(#(.+)\)$/gm)].map((match) => match[1]);
  assert.deepEqual(anchors, categories.map((category) => category.anchor));
  assert.deepEqual(links, anchors);
  assert.equal(new Set(anchors).size, anchors.length);
  assert.match(parts.before, /https:\/\/blackfriday\.mariuslandwehr\.com\/submit\//);
  assert.match(parts.before, /\| 💸 \| 50% off or more \|/);
});
