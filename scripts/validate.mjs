// Checks deals/categories.yml and every deal file, and prints every problem with a fix.
// Usage: node scripts/validate.mjs [--root <folder>]
import { resolve } from "node:path";
import { REPO_ROOT } from "./lib/catalog.mjs";
import { formatErrors, githubAnnotations, validateTree } from "./lib/validate.mjs";

const args = process.argv.slice(2);
const root = args.includes("--root") ? resolve(args[args.indexOf("--root") + 1]) : REPO_ROOT;

const { errors, deals, categories } = validateTree(root);

if (!errors.length) {
  console.log(`All good: ${deals} deals in ${categories} categories passed every check.`);
  process.exit(0);
}

const files = new Set(errors.map((error) => error.file)).size;
console.error(formatErrors(errors));
console.error(
  `\n${errors.length} ${errors.length === 1 ? "problem" : "problems"} in ${files} ${files === 1 ? "file" : "files"}. ` +
  "Nothing is published until these are fixed.\n" +
  "Edit the file in your pull request (pencil icon on GitHub) and commit; the check runs again by itself.\n" +
  "Field reference and a full example: CONTRIBUTING.md",
);
if (process.env.GITHUB_ACTIONS === "true") console.log(githubAnnotations(errors));
process.exit(1);
