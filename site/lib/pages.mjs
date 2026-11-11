// The three pages. Each returns a complete HTML document.
import { site, repoUrl } from "../config.mjs";
import { formatDay } from "../src/dates.mjs";
import { MAX_LENGTH, productKey } from "../src/deal.mjs";
import { dealRow, escapeHtml } from "../src/render.mjs";
import { page } from "./layout.mjs";

const e = escapeHtml;
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function listPage({ categories, year, builtAt, version, highEmoji }) {
  const total = categories.reduce((sum, category) => sum + category.deals.length, 0);
  const filled = categories.filter((category) => category.deals.length).length;
  const builtText = `${formatDay(builtAt.slice(0, 10), year)}, ${builtAt.slice(11, 16)} UTC`;

  const lede =
    `Community-collected Black Friday and Cyber Monday discounts on macOS and iOS apps, developer tools, books and courses. ` +
    `${plural(total, "deal")} in ${plural(filled, "category", "categories")}, ` +
    `list built <time id="built" datetime="${e(builtAt)}">${e(builtText)}</time>.`;

  const options = categories
    .map((c) => `<option value="${e(c.slug)}">${e(c.title)} (${c.deals.length})</option>`)
    .join("");

  const tools = `<form class="tools" id="tools" role="search" action="./" method="get">
<div class="tools__search">
<label class="box box--search"><span class="box__label">Search</span><input id="q" name="q" type="search" placeholder="Name, code or keyword" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><kbd class="box__key" aria-hidden="true">/</kbd></label>
</div>
<div class="tools__filters">
<label class="box box--category"><span class="box__label">Category</span><select id="category" name="category"><option value="">All (${total})</option>${options}</select></label>
<label class="check"><input type="checkbox" id="high" name="min" value="50"><span>${e(highEmoji)} 50% or more</span></label>
<label class="check"><input type="checkbox" id="hide-ended" name="ended" value="hide"><span>Hide ended</span></label>
</div>
</form>`;

  const rail = `<nav class="rail" aria-label="Categories">
<ul>
<li><a href="#main" data-category="" aria-current="true"><span>All deals</span><span class="rail__count" data-count="">${total}</span></a></li>
${categories
  .map((c) => `<li><a href="#${e(c.slug)}" data-category="${e(c.slug)}"><span>${e(c.title)}</span><span class="rail__count" data-count="${e(c.slug)}">${c.deals.length}</span></a></li>`)
  .join("\n")}
</ul>
</nav>`;

  const sections = categories
    .map((c) => {
      const heading =
        `<h2 class="cat__title"><span class="cat__emoji" aria-hidden="true">${e(c.emoji)}</span> ${e(c.title)} ` +
        `<span class="cat__count" data-count="${e(c.slug)}"><span class="hide">, </span>${c.deals.length}<span class="hide"> ${c.deals.length === 1 ? "deal" : "deals"}</span></span></h2>`;
      const body = c.deals.length
        ? `<ol class="deals" role="list">\n${c.deals.map((deal) => dealRow(deal, { listYear: year, highEmoji })).join("\n")}\n</ol>`
        : `<p class="cat__empty">No deals in this category yet. <a href="submit/?category=${e(c.slug)}">Submit the first one</a>.</p>`;
      return `<section class="cat" id="${e(c.slug)}" data-category="${e(c.slug)}"${c.deals.length ? "" : " data-empty"}>\n${heading}\n${body}\n</section>`;
    })
    .join("\n");

  const main = `${tools}
<main class="wrap board" id="main">
${rail}
<div class="list" id="list" data-total="${total}" data-year="${year}">
<p class="result" id="result" hidden><span id="result-text" role="status"></span> <button class="link" type="button" id="clear">Clear filters</button></p>
${sections}
<div class="none" id="none" hidden>
<p class="none__title">No deal matches these filters.</p>
<p>Try a shorter search, or <button class="link" type="button" id="clear-none">clear the filters</button>. If the deal you are looking for is not on the list, <a href="submit/">submit it</a>.</p>
</div>
</div>
</main>
<p class="hide" id="live" role="status" aria-live="polite"></p>`;

  return page({
    year,
    path: "",
    root: "",
    title: `Black Friday Deals ${year}: Mac, iOS and developer software discounts`,
    description:
      `Search ${total} community-submitted Black Friday and Cyber Monday deals on macOS and iOS apps, ` +
      `developer tools, books and courses. Filter by category, by discount and by end date.`,
    lede,
    action: `<a class="btn btn--primary" href="submit/">Submit a deal</a>`,
    main,
    scripts: ["list.js"],
    preloads: ["filter.js", "dates.js", "copy.js"],
    version,
  });
}

function field({ name, label, hint, optional = false, control, wide = false }) {
  return `<div class="field${wide ? " field--wide" : ""}" data-field="${name}">
<label for="f-${name}">${label}${optional ? ` <span class="field__optional">optional</span>` : ""}</label>
${control}
${hint ? `<p class="field__hint" id="h-${name}">${hint}</p>` : ""}
<p class="field__error" id="e-${name}" hidden></p>
</div>`;
}

const describedBy = (name, hint = true) => `aria-describedby="${hint ? `h-${name} ` : ""}e-${name}"`;

export function submitPage({ categories, year, version }) {
  // Deals already on the list, so the form can say so before GitHub does.
  const listed = Object.fromEntries(categories.flatMap((c) => c.deals.map((deal) => [`${c.slug}/${deal.slug}`, productKey(deal)])));
  const options = categories.map((c) => `<option value="${e(c.slug)}">${e(c.title)}</option>`).join("");
  const json = JSON.stringify(listed).replace(/</g, "\\u003c");

  const fields = [
    field({
      name: "name", label: "Product name", wide: true,
      hint: `The file name is made from it.`,
      control: `<input id="f-name" name="name" type="text" maxlength="${MAX_LENGTH.name}" autocomplete="off" required ${describedBy("name")}>`,
    }),
    field({
      name: "url", label: "Link", wide: true,
      hint: `Where the deal can be bought. Tracking parameters are fine.`,
      control: `<input id="f-url" name="url" type="url" inputmode="url" maxlength="${MAX_LENGTH.url}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://" required ${describedBy("url")}>`,
    }),
    field({
      name: "description", label: "Description", wide: true,
      hint: `One sentence on what the product does.`,
      control: `<textarea id="f-description" name="description" rows="2" maxlength="${MAX_LENGTH.description}" required ${describedBy("description")}></textarea>`,
    }),
    field({
      name: "category", label: "Category", wide: true,
      hint: `The single one that fits best.`,
      control: `<select id="f-category" name="category" required ${describedBy("category")}><option value="">Choose a category</option>${options}</select>`,
    }),
    field({
      name: "discount", label: "Discount", wide: true,
      hint: `The offer in words, with prices if you like: 40% off the yearly plan ($59 → $35).`,
      control: `<input id="f-discount" name="discount" type="text" maxlength="${MAX_LENGTH.discount}" autocomplete="off" required ${describedBy("discount")}>`,
    }),
    field({
      name: "percent", label: "Percent", optional: true,
      hint: `A whole number from 1 to 100. From 50 up the deal counts as ${"\u{1F4B8}"}.`,
      control: `<input id="f-percent" name="percent" type="text" inputmode="numeric" maxlength="4" autocomplete="off" ${describedBy("percent")}>`,
    }),
    field({
      name: "code", label: "Code", optional: true,
      hint: `Leave empty when the discount applies by itself.`,
      control: `<input id="f-code" name="code" type="text" maxlength="${MAX_LENGTH.code}" autocomplete="off" autocapitalize="characters" spellcheck="false" ${describedBy("code")}>`,
    }),
    field({
      name: "terms", label: "Terms", optional: true, wide: true,
      hint: `Which plans, new customers only, the renewal price and the like.`,
      control: `<input id="f-terms" name="terms" type="text" maxlength="${MAX_LENGTH.terms}" autocomplete="off" ${describedBy("terms")}>`,
    }),
    field({
      name: "starts", label: "Starts", optional: true,
      control: `<input id="f-starts" name="starts" type="date" ${describedBy("starts", false)}>`,
    }),
    field({
      name: "ends", label: "Ends", optional: true,
      control: `<input id="f-ends" name="ends" type="date" ${describedBy("ends", false)}>`,
    }),
  ].join("\n");

  const main = `<main class="wrap submit" id="main">
<div class="submit__intro">
<h1>Submit a deal</h1>
<p>Fill in the form. GitHub then opens with your deal as a new file, ready to propose, and it joins the list when the pull request is merged. You need a GitHub account.</p>
<noscript><p class="notice">This form builds the file in your browser and needs JavaScript. Without it, add the file by hand as the <a href="${repoUrl}/blob/${site.branch}/CONTRIBUTING.md">contributing guide</a> describes.</p></noscript>
</div>
<form class="submit__form" id="deal-form" novalidate data-repo="${e(site.repo)}" data-branch="${e(site.branch)}" data-year="${year}">
<div class="fields">
${fields}
<p class="fields__note">Description, discount and terms take links as <code>[text](https://…)</code>, <code>**bold**</code>, <code>~~struck out~~</code> and <code>\`code\`</code>.</p>
<p class="fields__note"><button class="link" type="button" id="clear-form">Clear the form</button></p>
</div>
<div class="file">
<h2>Your row on the list</h2>
<ol class="deals deals--preview" role="list" id="preview"></ol>
<h2>Your file</h2>
<p class="file__path" id="path"></p>
<pre class="file__yaml" id="yaml" tabindex="0" aria-label="The deal file as YAML"></pre>
<p class="file__status" id="status" role="status"></p>
<div class="file__actions">
<a class="btn btn--primary" id="propose" href="${repoUrl}/tree/${site.branch}/deals/${year}" target="_blank" rel="noopener">Propose on GitHub</a>
<button class="btn" type="button" id="copy-yaml">Copy YAML</button>
</div>
<ol class="steps">
<li>Press <strong>Propose on GitHub</strong>. GitHub opens a new file with the path and the content filled in.</li>
<li>Press <strong>Commit changes</strong>, then <strong>Propose changes</strong>. If you cannot write to the repository, GitHub forks it to your account first.</li>
<li>Press <strong>Create pull request</strong>. Your deal is on the list after the merge.</li>
</ol>
<p class="file__manual">If GitHub opens the file empty, or you would rather add it by hand: copy the YAML and save it under the path shown above. The <a href="${repoUrl}/blob/${site.branch}/CONTRIBUTING.md">contributing guide</a> has the details.</p>
</div>
</form>
<script type="application/json" id="listed">${json}</script>
</main>`;

  return page({
    year,
    path: "submit/",
    root: "../",
    title: `Submit a deal: ${site.name} ${year}`,
    description:
      `Add your Black Friday or Cyber Monday deal to the list. Fill in one form and GitHub opens with the deal file ready to propose.`,
    action: `<a class="masthead__link" href="../">All deals</a>`,
    main,
    scripts: ["submit.js"],
    preloads: ["deal.js", "render.js", "dates.js", "copy.js"],
    version,
  });
}

export function notFoundPage({ year, version }) {
  const main = `<main class="wrap lost" id="main">
<h1>Page not found</h1>
<p>Nothing is at this address. Every deal is on the list, and the search there covers names, codes and terms.</p>
<p class="lost__actions"><a class="btn btn--primary" href="./">See all deals</a> <a class="btn" href="submit/">Submit a deal</a></p>
</main>`;
  return page({
    year,
    path: "404.html",
    root: "",
    title: `Page not found: ${site.name} ${year}`,
    description: `This page does not exist. The list of Black Friday deals is on the front page.`,
    main,
    version,
    index: false,
    absoluteBase: true,
  });
}
