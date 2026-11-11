// Run by CI on pull requests. Fails when the pull request edits the generated part of
// README.md (the table of contents and the deal tables), and says what to do instead.
// Usage: node scripts/check-pr.mjs --base <git ref the pull request is compared with>
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { REPO_ROOT, latestYear } from "./lib/catalog.mjs";
import { MARKER_HELP, compareGenerated } from "./lib/readme.mjs";

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const root = option("--root") ? resolve(option("--root")) : REPO_ROOT;
const base = option("--base");
if (!base) {
  console.error("Usage: node scripts/check-pr.mjs --base <git ref>");
  process.exit(2);
}

const git = (...gitArgs) => {
  try {
    return execFileSync("git", gitArgs, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};
const inCi = process.env.GITHUB_ACTIONS === "true";
const year = latestYear(root);

// A new deal that sets `added` itself decides its own place in the list. Not an error
// (maintainers do it when they import a deal), but worth a look before merging.
for (const file of (git("diff", "--name-only", "--diff-filter=A", base, "--", "deals") ?? "").split("\n").filter(Boolean)) {
  const path = join(root, file);
  if (/\.ya?ml$/.test(file) && existsSync(path) && /^added\s*:/m.test(readFileSync(path, "utf8"))) {
    const note = `${file} sets "added", which decides its place in the list. Contributors should leave that line out.`;
    console.log(inCi ? `::warning file=${file},title=Deal order::${note}` : `Note: ${note}`);
  }
}

const readmePath = join(root, "README.md");
const result = compareGenerated(git("show", `${base}:README.md`), existsSync(readmePath) ? readFileSync(readmePath, "utf8") : null);

if (result === "unchanged" || result === "no-base") {
  console.log(result === "unchanged"
    ? "README.md: the generated tables were not edited. Good."
    : "README.md: the base branch has no generated part yet, nothing to compare.");
  process.exit(0);
}

const message = result === "markers"
  ? [
      "This pull request removes or changes the DEALS:START / DEALS:END lines in README.md.",
      "",
      MARKER_HELP,
      "",
      "Restore README.md from the master branch and apply your change to the hand-written part only.",
    ]
  : [
      "This pull request edits the deal tables in README.md. Those tables are generated now:",
      "every deal is a small file in deals/, and README.md is rebuilt from those files after each merge,",
      "so a row added by hand would be overwritten.",
      "",
      "To add or change a deal, do one of these instead:",
      "  1. Fill in the form at https://blackfriday.mariuslandwehr.com/submit/",
      "     It opens GitHub with your deal file ready to commit. Then close this pull request.",
      `  2. Or add one file to this pull request: deals/${year}/<category>/<your-app>.yml`,
      "     (example and field list: CONTRIBUTING.md), and undo your change to README.md.",
      "",
      "Maintainers can convert the rows of this pull request with:",
      "  node scripts/import-readme.mjs --from <this pull request's README.md> --write",
    ];

console.error(message.join("\n"));
if (inCi) {
  const title = result === "markers" ? "README markers changed" : "Add a deal file instead of editing README.md";
  const text = result === "markers"
    ? "The DEALS:START / DEALS:END lines in README.md were removed or changed. Restore README.md from master."
    : `The deal tables in README.md are generated. Use the form at https://blackfriday.mariuslandwehr.com/submit/ or add deals/${year}/<category>/<your-app>.yml (see CONTRIBUTING.md), and leave README.md as it is.`;
  console.log(`::error file=README.md,title=${title}::${text}`);
}
process.exit(1);
