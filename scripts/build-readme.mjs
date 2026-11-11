// Rebuilds the generated part of README.md (category index and deal tables) from deals/.
// Usage: node scripts/build-readme.mjs [--check] [--force] [--year 2026] [--root <folder>]
//   --check   change nothing; exit 1 when README.md is not up to date
//   --force   rebuild even when the tables were edited by hand and the edits would be lost
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT, isShallowClone, latestYear, loadCatalog } from "./lib/catalog.mjs";
import { MARKER_HELP, buildReadme, findHandEdits, firstDifference, splitReadme } from "./lib/readme.mjs";
import { formatErrors, validateTree } from "./lib/validate.mjs";

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const root = option("--root") ? resolve(option("--root")) : REPO_ROOT;
const year = option("--year") ?? String(latestYear(root));
const check = args.includes("--check");
const force = args.includes("--force");
const inCi = process.env.GITHUB_ACTIONS === "true";
const short = (text) => (text === null ? "(nothing)" : text.length > 110 ? `${text.slice(0, 109)}…` : text);

const { errors } = validateTree(root);
if (errors.length) {
  console.error(formatErrors(errors));
  console.error(`\nREADME.md was not ${check ? "checked" : "changed"}: fix the ${errors.length === 1 ? "problem" : `${errors.length} problems`} above first (npm run validate).`);
  process.exit(1);
}

const file = join(root, "README.md");
const current = readFileSync(file, "utf8");
const parts = splitReadme(current);
if (!parts) {
  console.error(MARKER_HELP);
  process.exit(1);
}

const catalog = loadCatalog(root, year);
const count = catalog.reduce((sum, category) => sum + category.deals.length, 0);
const summary = `${count} deals in ${catalog.length} categories`;

// Tables edited by hand since the last build: stop before anything is lost.
if (parts.edited && !force) {
  const edits = findHandEdits(current, catalog, year);
  const lost = edits.orphans.length + edits.changed.length + edits.unreadable.length + edits.foreign.length;
  if (lost) {
    const lines = ["README.md: the deal tables were edited by hand since they were last generated", "(was a pull request merged that adds or changes a table row?). Rebuilding now would lose this:"];
    if (edits.orphans.length) {
      lines.push("", `Rows without a deal file (${edits.orphans.length}):`);
      for (const row of edits.orphans) lines.push(`  line ${row.line}: ${row.readme}`);
    }
    if (edits.changed.length) {
      lines.push("", `Rows that differ from their deal file (${edits.changed.length}):`);
      for (const row of edits.changed) lines.push(`  line ${row.line}, ${row.path}`, `    README: ${row.readme}`, `    file:   ${row.file}`);
    }
    if (edits.unreadable.length) {
      lines.push("", `Table rows that cannot be read (${edits.unreadable.length}):`, ...edits.unreadable.map((problem) => `  ${problem}`));
    }
    if (edits.foreign.length) {
      lines.push("", `Lines that were not generated from a deal file (${edits.foreign.length}):`);
      for (const row of edits.foreign) lines.push(`  line ${row.line}: ${row.readme}`);
    }
    lines.push(
      "",
      "README.md was not changed. To fix this on your computer, on an up-to-date master:",
      "  1. node scripts/import-readme.mjs --from README.md --write   (turns rows without a file into deal files)",
      "  2. For rows that differ and for lines that were not generated, put the right version into the deal file.",
      "  3. npm run validate, then commit deals/ and push. The next build accepts README.md again.",
      "To drop the rows listed above instead: npm run build:readme -- --force, then commit README.md and push.",
    );
    console.error(lines.join("\n"));
    if (inCi) {
      console.log(`::error file=README.md,title=README tables were edited by hand::${lost} table ${lost === 1 ? "row is" : "rows are"} only in README.md and would be lost. Nothing was published. The log of this step lists the rows and the commands that fix it.`);
    }
    process.exit(1);
  }
  console.log("Note: the tables in README.md were edited by hand, but every row matches a deal file, so nothing is lost by rebuilding.");
}

const next = buildReadme(current, catalog, year);

if (next === current) {
  console.log(`README.md is up to date (${summary}).`);
  process.exit(0);
}

if (check) {
  const diff = firstDifference(next, current);
  console.error(`README.md is out of date with deals/${year} (${summary}).`);
  console.error(`First difference, line ${diff.line}:\n  README.md has: ${short(diff.actual)}\n  should be:     ${short(diff.expected)}`);
  console.error("Run: npm run build:readme");
  if (isShallowClone(root)) {
    console.error("Note: this is a shallow clone. The order of deals comes from git history, so fetch it first: git fetch --unshallow");
  }
  process.exit(1);
}

writeFileSync(file, next);
console.log(`README.md updated (${summary}).`);
