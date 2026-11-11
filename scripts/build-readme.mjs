// Rebuilds the generated part of README.md (table of contents and deal tables) from deals/.
// Usage: node scripts/build-readme.mjs [--check] [--year 2026] [--root <folder>]
//   --check   change nothing; exit 1 when README.md is not up to date
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT, isShallowClone, latestYear, loadCatalog } from "./lib/catalog.mjs";
import { MARKER_HELP, buildReadme, firstDifference, splitReadme } from "./lib/readme.mjs";
import { formatErrors, validateTree } from "./lib/validate.mjs";

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const root = option("--root") ? resolve(option("--root")) : REPO_ROOT;
const year = option("--year") ?? String(latestYear(root));
const check = args.includes("--check");
const short = (text) => (text === null ? "(nothing)" : text.length > 110 ? `${text.slice(0, 109)}…` : text);

const { errors } = validateTree(root);
if (errors.length) {
  console.error(formatErrors(errors));
  console.error(`\nREADME.md was not ${check ? "checked" : "changed"}: fix the ${errors.length === 1 ? "problem" : `${errors.length} problems`} above first (npm run validate).`);
  process.exit(1);
}

const file = join(root, "README.md");
const current = readFileSync(file, "utf8");
if (!splitReadme(current)) {
  console.error(MARKER_HELP);
  process.exit(1);
}

const catalog = loadCatalog(root, year);
const next = buildReadme(current, catalog);
const count = catalog.reduce((sum, category) => sum + category.deals.length, 0);
const summary = `${count} deals in ${catalog.length} categories`;

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
