// The frame every page shares: head, masthead, footer.
import { site, repoUrl } from "../config.mjs";
import { escapeHtml } from "../src/render.mjs";

const e = escapeHtml;

// Colours the browser chrome takes; the same values as --paper in site.css.
const PAPER = { light: "#f4f5f1", dark: "#11151b" };

export const mark =
  `<svg class="mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">` +
  `<rect width="32" height="32" rx="5" fill="#ffd60a"/>` +
  `<g fill="none" stroke="#14171c" stroke-width="3.2"><circle cx="10.6" cy="11" r="4"/><circle cx="21.4" cy="21" r="4"/>` +
  `<path d="M21.6 6.5 10.4 25.5" stroke-linecap="round"/></g></svg>`;

const sprite =
  `<svg width="0" height="0" class="sprite" aria-hidden="true">` +
  `<symbol id="icon-copy" viewBox="0 0 14 14"><rect x="4.75" y="4.75" width="7.5" height="7.5" rx="1.25" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
  `<path d="M9.25 2.5v-.25c0-.55-.45-1-1-1h-6c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h.25" fill="none" stroke="currentColor" stroke-width="1.5"/></symbol>` +
  `<symbol id="icon-done" viewBox="0 0 14 14"><path d="m2 7.5 3.25 3.25L12 3.75" fill="none" stroke="currentColor" stroke-width="1.75"/></symbol>` +
  `</svg>`;

// `root` is the relative path from the page to the site root ("" or "../"),
// so the same files work on the custom domain and under /Black-Friday-Deals/.
export function page({ year, path, root, title, description, lede = "", action = "", main, scripts = [], preloads = [], version, index = true, absoluteBase = false }) {
  const asset = (file) => `${root}assets/${file}?v=${version}`;
  const canonical = `${site.origin}/${path}`;
  const home = root || "./";
  const siteTitle = `Black Friday deals ${year}`;

  const brand = lede
    ? `<h1 class="brand">${mark}<span>${e(siteTitle)}</span></h1>`
    : `<p class="brand"><a href="${home}">${mark}<span>${e(siteTitle)}</span></a></p>`;

  // The 404 page is served at any depth, so its relative links need a base.
  // On the custom domain that is "/"; on github.io it is the repository folder.
  const base = absoluteBase
    ? `<base href="/">\n<script>if(/\\.github\\.io$/.test(location.hostname))document.querySelector("base").href="/"+location.pathname.split("/")[1]+"/"</script>\n`
    : "";

  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${base}<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
${index ? `<link rel="canonical" href="${e(canonical)}">` : `<meta name="robots" content="noindex">`}
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="${PAPER.light}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${PAPER.dark}" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${e(site.name)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(canonical)}">
<meta property="og:image" content="${site.origin}/share.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${e(siteTitle)}: macOS and iOS apps, developer tools, books and courses">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${root}favicon.png" sizes="48x48" type="image/png">
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${root}apple-touch-icon.png">
<link rel="preload" href="${root}assets/fonts/archivo-latin-wdth-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset("site.css")}">
<script>document.documentElement.className="js"</script>
${scripts.map((file) => `<script type="module" src="${asset(file)}"></script>`).join("\n")}
${preloads.map((file) => `<link rel="modulepreload" href="${asset(file)}">`).join("\n")}
</head>
<body>
${sprite}
<header class="masthead">
<div class="wrap masthead__row">
${absoluteBase ? "" : `<a class="skip" href="#main">Skip to content</a>`}
${brand}
${action}
</div>
${lede ? `<div class="wrap"><p class="lede">${lede}</p></div>` : ""}
</header>
${main}
<footer class="footer">
<div class="wrap">
<p>Maintained by <a href="${e(site.maintainer.url)}">${e(site.maintainer.name)}</a> and the community. Deals are submitted by their makers and other contributors, and nobody tests them at checkout, so check the price before you pay.</p>
<ul class="footer__links">
<li><a href="${repoUrl}">GitHub repository</a></li>
<li><a href="${repoUrl}/blob/${site.branch}/CONTRIBUTING.md">Contributing guide</a></li>
<li><a href="${repoUrl}/blob/${site.branch}/LICENSE">MIT licence</a></li>
<li><a href="${root}assets/fonts/OFL.txt">Archivo typeface, SIL Open Font License</a></li>
</ul>
</div>
</footer>
</body>
</html>
`;
}
