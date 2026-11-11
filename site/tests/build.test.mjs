// The built site, checked in memory: every deal is in the page once, hostile
// deal text stays text, and the pages ask no other host for anything.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { latestYear, loadCatalog } from "../../scripts/lib/catalog.mjs";
import { site } from "../config.mjs";
import { checkCatalog, renderSite } from "../lib/site.mjs";
import { dealId } from "../src/render.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const year = latestYear(root);
const categories = loadCatalog(root, year);
const deals = categories.flatMap((category) => category.deals);
const builtAt = new Date("2026-11-11T10:58:00Z");
const { files } = renderSite({ categories, year, builtAt });
const index = files.get("index.html");
const submit = files.get("submit/index.html");
const notFound = files.get("404.html");

const count = (text, part) => text.split(part).length - 1;

test("the catalog is there to build from", () => {
  assert.ok(deals.length > 0, "no deals found");
  assert.ok(categories.length > 0);
});

test("every deal is in the list page exactly once", () => {
  const rows = [...index.matchAll(/<li class="deal" id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(rows.length, deals.length);
  assert.equal(new Set(rows).size, rows.length, "a deal id is used twice");
  assert.deepEqual(rows, deals.map((deal) => dealId(deal.category, deal.slug)), "rows are in catalog order");
  for (const deal of deals) {
    assert.equal(count(index, `id="${dealId(deal.category, deal.slug)}"`), 1, deal.path);
  }
  assert.equal(count(index, 'class="deal__name"'), deals.length);
  assert.match(index, new RegExp(`data-total="${deals.length}"`));
});

test("every category has a heading, its deals under it, and a place in the rail", () => {
  for (const category of categories) {
    assert.equal(count(index, `<section class="cat" id="${category.slug}"`), 1, category.slug);
    assert.equal(count(index, `<a href="#${category.slug}" data-category="${category.slug}">`), 1);
    const start = index.indexOf(`<section class="cat" id="${category.slug}"`);
    const section = index.slice(start, index.indexOf("</section>", start));
    assert.equal(count(section, '<li class="deal"'), category.deals.length, category.slug);
    if (!category.deals.length) assert.match(section, new RegExp(`submit/\\?category=${category.slug}"`));
  }
  const ids = [...index.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "duplicate id in the page");
});

test("names link to the deal with the agreed rel", () => {
  const links = [...index.matchAll(/<h3 class="deal__name"><a href="([^"]+)" rel="([^"]+)">/g)];
  assert.equal(links.length, deals.filter((deal) => /^https?:/.test(deal.url)).length);
  for (const [, href, rel] of links) {
    assert.match(href, /^https?:\/\//);
    assert.equal(rel, "noopener nofollow ugc");
  }
});

test("the pages load nothing from another host", () => {
  for (const [name, html] of [["index.html", index], ["submit/index.html", submit], ["404.html", notFound]]) {
    const head = html.slice(0, html.indexOf("</head>"));
    for (const [tag] of head.matchAll(/<(?:link|script)\b[^>]*>/g)) {
      const address = tag.match(/\b(?:href|src)="([^"]+)"/)?.[1];
      if (!address) continue;
      const own = /rel="canonical"/.test(tag);
      assert.ok(own || !/^(?:[a-z]+:)?\/\//i.test(address), `${name} loads ${address}`);
    }
    assert.doesNotMatch(html, /<(?:img|iframe|script|link|source|video|audio|embed|object)\b[^>]*\b(?:src|href|data)="(?:https?:)?\/\/(?!blackfriday\.mariuslandwehr\.com)/i, name);
    assert.doesNotMatch(html, /fonts\.googleapis|gstatic|googletagmanager|google-analytics|cdn\.|unpkg|jsdelivr/i, name);
  }
  const css = files.get("assets/site.css");
  for (const [, address] of css.matchAll(/url\(([^)]+)\)/g)) assert.match(address, /^fonts\/[a-z0-9-]+\.woff2$/);
  assert.doesNotMatch(css, /@import/);
});

test("assets and internal links are relative, so the site also works in a subfolder", () => {
  for (const [name, html, prefix] of [["index.html", index, ""], ["submit/index.html", submit, "../"]]) {
    const local = [...html.matchAll(/\b(?:href|src)="([^"#]+)"/g)].map((match) => match[1]).filter((address) => !/^https?:/.test(address));
    assert.ok(local.length > 5);
    for (const address of local) {
      assert.doesNotMatch(address, /^\//, `${name}: ${address} is root-relative`);
      const path = address.split("?")[0];
      if (path.startsWith(`${prefix}assets/`) || /\.(png|svg)$/.test(path)) {
        assert.ok(files.has(path.slice(prefix.length)), `${name}: ${address} is not in the build`);
      }
    }
  }
  // The 404 page is served at any depth and sets a base instead.
  assert.match(notFound, /<base href="\/">/);
});

test("the head names the page for search engines and link previews", () => {
  for (const [html, path] of [[index, ""], [submit, "submit/"]]) {
    assert.match(html, new RegExp(`<link rel="canonical" href="${site.origin}/${path}">`));
    assert.match(html, /<title>[^<]{20,70}<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{60,200}">/);
    assert.match(html, new RegExp(`<meta property="og:image" content="${site.origin}/share\\.png">`));
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(html, /<html lang="en"/);
  }
  assert.match(notFound, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(notFound, /rel="canonical"/);
  assert.notEqual(index.match(/<title>([^<]+)/)[1], submit.match(/<title>([^<]+)/)[1]);
});

test("housekeeping files are written", () => {
  assert.equal(files.get("CNAME"), "blackfriday.mariuslandwehr.com\n");
  assert.match(files.get("robots.txt"), /Sitemap: https:\/\/blackfriday\.mariuslandwehr\.com\/sitemap\.xml/);
  const sitemap = files.get("sitemap.xml");
  assert.match(sitemap, /<loc>https:\/\/blackfriday\.mariuslandwehr\.com\/<\/loc><lastmod>2026-11-11<\/lastmod>/);
  assert.match(sitemap, /<loc>https:\/\/blackfriday\.mariuslandwehr\.com\/submit\/<\/loc>/);
  for (const file of ["404.html", "favicon.svg", "favicon.png", "apple-touch-icon.png", "share.png", "assets/fonts/OFL.txt", "assets/fonts/archivo-latin-wdth-normal.woff2"]) {
    assert.ok(files.has(file), `${file} is missing`);
  }
  assert.match(index, /<time id="built" datetime="2026-11-11T10:58:00Z">Nov 11, 10:58 UTC<\/time>/);
});

test("browser modules import each other by their published names", () => {
  for (const name of ["list", "submit", "render", "deal", "filter", "dates", "copy"]) {
    const source = files.get(`assets/${name}.js`);
    assert.doesNotMatch(source, /from "[^"]*\.mjs/);
    for (const [, target] of source.matchAll(/from "\.\/([a-z]+)\.js\?v=[0-9a-f]+"/g)) assert.ok(files.has(`assets/${target}.js`));
    assert.doesNotMatch(source, /from "(?!\.\/)/, `${name}.js imports something that is not shipped`);
  }
});

test("the submit page knows the deals that are already listed", () => {
  const json = submit.match(/<script type="application\/json" id="listed">(.*?)<\/script>/s)[1];
  const listed = JSON.parse(json);
  assert.equal(Object.keys(listed).length, deals.length);
  for (const category of categories) assert.equal(count(submit, `<option value="${category.slug}">`), 1);
  assert.match(submit, new RegExp(`data-repo="${site.repo}" data-branch="${site.branch}" data-year="${year}"`));
});

test("hostile deal text reaches the page as text", () => {
  const attack = `</li></ol><script>alert(1)</script><img src=x onerror=alert(1)>`;
  const evil = [{
    slug: "utility-software", title: `Utility <script>alert(2)</script>`, emoji: `"><svg onload=alert(3)>`, anchor: "utility-software",
    deals: [{
      slug: "evil", category: "utility-software", path: "deals/2026/utility-software/evil.yml",
      name: `Evil ${attack}`, url: "javascript:alert(1)", description: `${attack} [x](javascript:alert(4)) **bold**`,
      discount: `[y](https://example.org/"onmouseover="alert(5))`, code: `"><script>alert(6)</script>`, terms: `</script><script>alert(7)</script>`,
      percent: 99, starts: `"><script>`, ends: "2026-11-30",
    }],
  }];
  const built = renderSite({ categories: evil, year: 2026, builtAt });
  assert.equal(built.warnings.length, 1, "the bad link is reported");
  for (const name of ["index.html", "submit/index.html"]) {
    const whole = built.files.get(name);
    // The list of existing deals is JSON inside a script element: data, never run, and free of "<".
    const data = whole.match(/<script type="application\/json" id="listed">(.*?)<\/script>/s)?.[1] ?? "";
    assert.doesNotMatch(data, /</);
    const html = whole.replace(data, "");
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
    const expected = name === "index.html" ? 2 : 3; // the no-js switch, the page's module, and on submit the JSON list
    assert.equal(scripts.length, expected, `${name}: ${scripts.join(" ")}`);
    assert.doesNotMatch(html, /<img|<svg onload|onerror=alert\(1\)>|javascript:alert/i);
    assert.doesNotMatch(html, /on(?:mouseover|load|error)="/i);
  }
  assert.match(built.files.get("index.html"), /<strong>bold<\/strong>/);
});

test("a clash between anchors stops the build", () => {
  const deal = { slug: "tools", category: "mac", path: "deals/2026/mac/tools.yml", name: "T", url: "https://example.org/", description: "d", discount: "x" };
  const clash = [
    { slug: "mac", title: "Mac", emoji: "", anchor: "mac", deals: [deal] },
    { slug: "mac-tools", title: "Mac Tools", emoji: "", anchor: "mac-tools", deals: [] },
  ];
  assert.throws(() => checkCatalog(clash), /share the anchor "mac-tools"/);
});
