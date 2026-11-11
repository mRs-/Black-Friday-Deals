// Assembles the whole site in memory: a Map of output path -> file content.
// build.mjs writes that Map to _site/; the tests read it directly.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { site } from "../config.mjs";
import { dealId, safeUrl } from "../src/render.mjs";
import { listPage, notFoundPage, submitPage } from "./pages.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));

// Browser modules live in src/ as .mjs (so Node can test them) and ship as .js.
const MODULES = ["copy", "dates", "deal", "filter", "list", "render", "submit"];

function listFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

// Things that would break the page or its links. Bad deal data is reported and
// skipped over (a row without a link, a date left out), never fatal: one odd
// file must not stop the list from publishing.
export function checkCatalog(categories) {
  const warnings = [];
  const ids = new Set();
  for (const category of categories) {
    if (ids.has(category.slug)) throw new Error(`Category "${category.slug}" is listed twice`);
    ids.add(category.slug);
  }
  for (const category of categories) {
    for (const deal of category.deals) {
      const id = dealId(category.slug, deal.slug);
      if (ids.has(id)) throw new Error(`Two things share the anchor "${id}"`);
      ids.add(id);
      if (!safeUrl(deal.url)) warnings.push(`${deal.path}: url is not an http(s) link, the name is shown without one`);
      for (const key of ["name", "description", "discount"]) {
        if (typeof deal[key] !== "string" || !deal[key].trim()) warnings.push(`${deal.path}: ${key} is missing`);
      }
    }
  }
  return warnings;
}

export function renderSite({ categories, year, builtAt = new Date(), highEmoji = "\u{1F4B8}" }) {
  if (!Number.isInteger(year)) throw new Error("renderSite needs the year of the deals it shows");
  const warnings = checkCatalog(categories);
  const files = new Map();

  const sources = new Map(MODULES.map((name) => [name, readFileSync(join(here, "src", `${name}.mjs`), "utf8")]));
  const css = readFileSync(join(here, "src", "site.css"), "utf8");
  const version = createHash("sha256")
    .update(css)
    .update([...sources.values()].join("\0"))
    .digest("hex")
    .slice(0, 10);

  files.set("assets/site.css", css);
  for (const [name, source] of sources) {
    // "./dates.mjs" -> "./dates.js?v=..." so every import of a module uses one address.
    files.set(`assets/${name}.js`, source.replace(/(["'])\.\/([a-z]+)\.mjs\1/g, `$1./$2.js?v=${version}$1`));
  }
  for (const file of listFiles(join(here, "static"))) {
    files.set(file.startsWith("fonts/") ? `assets/${file}` : file, readFileSync(join(here, "static", file)));
  }

  const stamp = builtAt.toISOString().replace(/\.\d+Z$/, "Z");
  files.set("index.html", listPage({ categories, year, builtAt: stamp, version, highEmoji }));
  files.set("submit/index.html", submitPage({ categories, year, version }));
  files.set("404.html", notFoundPage({ year, version }));

  files.set("CNAME", `${site.domain}\n`);
  files.set(".nojekyll", "");
  files.set("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);
  const day = stamp.slice(0, 10);
  files.set(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      ["", "submit/"].map((path) => `<url><loc>${site.origin}/${path}</loc><lastmod>${day}</lastmod></url>\n`).join("") +
      `</urlset>\n`,
  );

  return { files, warnings, version };
}
