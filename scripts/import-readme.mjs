// Turns deal rows from a README table into deal files (deals/<year>/<category>/<slug>.yml).
//
// Convert a pull request that still edits the README tables:
//   git fetch origin pull/1234/head && git show FETCH_HEAD:README.md > /tmp/pr.md
//   node scripts/import-readme.mjs --from /tmp/pr.md            report only
//   node scripts/import-readme.mjs --from /tmp/pr.md --write    add the deals that are not in deals/ yet
// Existing deal files are never changed or removed with --from. Rows that differ from
// their file are listed so they can be edited by hand.
//
// The one-time migration of this repository's own README.md (order taken from git blame):
//   node scripts/import-readme.mjs                      report only
//   node scripts/import-readme.mjs --write --replace    rebuild deals/<year> and categories.yml
//
// Options: --year 2026, --root <folder>, --missing (with --from: list deals that are in deals/ but not in that README)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { Document } from "yaml";
import { REPO_ROOT, dealKey, latestYear, loadCatalog, savingsEmoji } from "./lib/catalog.mjs";
import { dealYaml, parseReadme, planImport, roundTrip, slugify } from "./lib/import.mjs";
import { formatErrors, validateDeal } from "./lib/validate.mjs";

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const root = option("--root") ? resolve(option("--root")) : REPO_ROOT;
const year = option("--year") ?? String(latestYear(root));
const from = option("--from");
const write = args.includes("--write");

if (args.includes("--from") && !from) {
  console.error("--from needs the path of a README file, for example: --from /tmp/pr.md");
  process.exit(1);
}

const source = from ? resolve(from) : join(root, "README.md");
const parsed = parseReadme(readFileSync(source, "utf8"));
const rows = parsed.categories.flatMap((category) => category.rows);

// Round trip: does every row come back byte for byte when it is rebuilt from its fields?
const counts = { identical: 0, normalized: 0, different: 0 };
const mismatches = [];
const emojiIssues = [];
for (const row of rows) {
  const result = roundTrip(row);
  counts[result]++;
  if (result === "different") mismatches.push(`line ${row.line}\n  was: ${row.raw}`);
  if (savingsEmoji(row.deal.percent) !== row.emoji) {
    emojiIssues.push(`line ${row.line} [${row.emoji}] ${row.deal.name}: ${row.deal.discount}`);
  }
}

console.log(`${source}: ${rows.length} deals in ${parsed.categories.length} categories`);
console.log(`round trip: ${counts.identical} identical, ${counts.normalized} identical after entity decoding, ${counts.different} different`);
if (parsed.problems.length) console.log("PROBLEMS (rows that could not be read):\n" + parsed.problems.join("\n"));
if (emojiIssues.length) console.log("EMOJI vs PERCENT (no percentage found that matches the emoji; the file gets no percent):\n" + emojiIssues.join("\n"));
if (mismatches.length) console.log("MISMATCHES:\n" + mismatches.join("\n"));

if (from) importNewDeals();
else migrateOwnReadme();

// --from: add only what the catalog does not have yet.
function importNewDeals() {
  const catalog = loadCatalog(root, year);
  const plan = planImport(parsed, catalog, { year });
  const inCatalog = catalog.reduce((sum, category) => sum + category.deals.length, 0);
  const inReadme = new Set(rows.map((row) => dealKey(row.deal)));
  const notInReadme = catalog.flatMap((category) => category.deals).filter((deal) => !inReadme.has(dealKey(deal)));

  console.log(`\ncompared with deals/${year} (${inCatalog} deals): ${plan.unchanged} already there, ${plan.fresh.length} new, ${plan.changed.length} different`);
  if (plan.problems.length) console.log("PROBLEMS:\n" + plan.problems.join("\n"));
  if (notInReadme.length) {
    // Normal for a pull request branch that is behind master. When the README is the newer
    // side (the cutover from the old README), these are deals that were removed from it.
    const list = notInReadme.length <= 10 || args.includes("--missing");
    console.log(`IN deals/${year} BUT NOT IN THIS README: ${notInReadme.length} (expected when this README is older than master)${list ? ":" : "; add --missing to list them"}`);
    if (list) for (const deal of notInReadme) console.log(`  ${deal.path}`);
  }
  if (plan.changed.length) {
    console.log("DIFFERENT FROM THE DEAL FILE (not written; if this README is the newer one, edit the file by hand):");
    for (const item of plan.changed) console.log(`  ${item.path} (README line ${item.line})\n    file:   ${item.was}\n    README: ${item.now}`);
  }
  if (plan.fresh.length) {
    console.log("NEW:");
    for (const item of plan.fresh) {
      console.log(`  ${item.path}  (README line ${item.line})\n${item.text.trimEnd().replace(/^/gm, "      ")}`);
    }
  }

  // The same checks CI runs, so problems show up before the files are committed.
  const errors = plan.fresh.flatMap((item) => validateDeal(item.text, { file: item.path, year }).errors);
  if (errors.length) console.log("\nNEW FILES THAT NEED A FIX BEFORE THEY PASS `npm run validate`:\n" + formatErrors(errors));

  if (!plan.fresh.length) { console.log("\nNothing to add."); return; }
  if (!write) { console.log(`\nDry run: nothing written. Add --write to create the ${plan.fresh.length} new ${plan.fresh.length === 1 ? "file" : "files"}.`); return; }
  for (const item of plan.fresh) {
    mkdirSync(dirname(join(root, item.path)), { recursive: true });
    writeFileSync(join(root, item.path), item.text);
  }
  console.log(`\nWrote ${plan.fresh.length} ${plan.fresh.length === 1 ? "file" : "files"}. Next: npm run validate, review, commit. The README is regenerated after the push.`);
}

// No --from: rebuild every deal file from this repository's README.md.
function migrateOwnReadme() {
  // author time of every README line, to keep first-come-first-served order
  const blame = new Map();
  let out;
  try {
    out = execFileSync("git", ["blame", "--line-porcelain", "README.md"], {
      cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    console.error("\nWithout --from, the order of the deals is read from `git blame README.md`, and that failed here.\nTo add deals from a README file, use: --from <path>");
    process.exit(1);
  }
  let lineNo = null, time = null;
  for (const l of out.split("\n")) {
    const head = l.match(/^[0-9a-f^]{40} \d+ (\d+)/);
    if (head) lineNo = Number(head[1]);
    else if (l.startsWith("author-time ")) time = Number(l.slice(12));
    else if (l.startsWith("\t")) blame.set(lineNo, time);
  }

  const files = [];
  for (const category of parsed.categories) {
    // order key: git time of the row, clamped so the current README order is kept exactly
    const times = category.rows.map((row) => blame.get(row.line) ?? 0);
    for (let i = times.length - 2; i >= 0; i--) times[i] = Math.min(times[i], times[i + 1] - 1);
    const used = new Set();
    category.rows.forEach((row, index) => {
      const base = slugify(row.deal.name) || slugify(new URL(row.deal.url).hostname);
      let slug = base;
      for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
      used.add(slug);
      const added = new Date(times[index] * 1000).toISOString().replace(".000Z", "Z");
      files.push({ path: join("deals", year, category.slug, `${slug}.yml`), text: dealYaml({ ...row.deal, added }) });
    });
  }

  if (!write) { console.log("\nDry run: nothing written. To add deals from another README use --from <path>."); return; }

  const yearDir = join(root, "deals", year);
  const existing = existsSync(yearDir) ? readdirSync(yearDir, { recursive: true }).filter((name) => String(name).endsWith(".yml")).length : 0;
  if (existing && !args.includes("--replace")) {
    console.error(
      `\ndeals/${year} already holds ${existing} deal files. This mode deletes them and rebuilds everything from README.md.\n` +
      "To add deals from another README, use: --from <path> --write\n" +
      "To really rebuild from scratch, add: --replace",
    );
    process.exit(1);
  }
  rmSync(yearDir, { recursive: true, force: true });
  mkdirSync(join(root, "deals"), { recursive: true });
  const catDoc = new Document(parsed.categories.map(({ slug, title, emoji, anchor }) => ({ slug, title, emoji, anchor })));
  writeFileSync(join(root, "deals", "categories.yml"), catDoc.toString({ lineWidth: 0 }));
  for (const category of parsed.categories) mkdirSync(join(root, "deals", year, category.slug), { recursive: true });
  for (const file of files) writeFileSync(join(root, file.path), file.text);
  console.log(`wrote ${files.length} files`);
}
