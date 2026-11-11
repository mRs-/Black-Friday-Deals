// Builds the website into _site/ at the repository root:  node site/build.mjs
// Static files only; GitHub Pages serves the folder as it is.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { latestYear, loadCatalog, savingsEmoji } from "../scripts/lib/catalog.mjs";
import { renderSite } from "./lib/site.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "_site");

const year = latestYear(root);
const categories = loadCatalog(root, year);
const { files, warnings } = renderSite({ categories, year, builtAt: new Date(), highEmoji: savingsEmoji(50) });

rmSync(out, { recursive: true, force: true });
for (const [path, content] of files) {
  const target = join(out, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
const deals = categories.reduce((sum, category) => sum + category.deals.length, 0);
const kb = (path) => `${Math.round(Buffer.byteLength(files.get(path)) / 1024)} kB`;
console.log(`${year}: ${deals} deals in ${categories.length} categories -> _site/ (${files.size} files, index.html ${kb("index.html")})`);
