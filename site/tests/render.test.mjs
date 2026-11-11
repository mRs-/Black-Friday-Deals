// Deal text is written by strangers. These tests pin down what may reach the page.
import assert from "node:assert/strict";
import test from "node:test";
import { DEAL_LINK_REL, dealRow, decodeEntities, escapeHtml, renderInline, safeUrl } from "../src/render.mjs";

// Every tag in the output must be one of the few the renderer writes itself.
function assertOnlyKnownTags(html, allowed = ["a", "strong", "s", "code"]) {
  for (const [, name] of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) {
    assert.ok(allowed.includes(name.toLowerCase()), `unexpected <${name}> in ${html}`);
  }
  assert.doesNotMatch(html, /<(?![a-z/])/i, `stray "<" in ${html}`);
}

test("renders the Markdown subset", () => {
  assert.equal(renderInline("**30% OFF** ($59 → $41)"), "<strong>30% OFF</strong> ($59 → $41)");
  assert.equal(renderInline("Lifetime ~~$249~~ $149"), "Lifetime <s>$249</s> $149");
  assert.equal(renderInline("use `BF2026` at checkout"), "use <code>BF2026</code> at checkout");
  assert.equal(
    renderInline("[Two years](https://labex.io/checkout?type=4&coupon=2026BF50): **2026BF50**"),
    `<a href="https://labex.io/checkout?type=4&amp;coupon=2026BF50" rel="${DEAL_LINK_REL}">Two years</a>: <strong>2026BF50</strong>`,
  );
  assert.equal(renderInline("**[bold link](https://example.org/)**"), `<strong><a href="https://example.org/" rel="${DEAL_LINK_REL}">bold link</a></strong>`);
});

test("leaves everything else as text", () => {
  assert.equal(renderInline("FIRST_30_OFF and snake_case_name"), "FIRST_30_OFF and snake_case_name");
  assert.equal(renderInline("2 * 3 * 4"), "2 * 3 * 4");
  assert.equal(renderInline("# not a heading"), "# not a heading");
  assert.equal(renderInline("![img](https://example.org/x.png)"), `!<a href="https://example.org/x.png" rel="${DEAL_LINK_REL}">img</a>`);
  assert.equal(renderInline("unclosed **bold and ~~strike"), "unclosed **bold and ~~strike");
  assert.equal(renderInline(""), "");
  assert.equal(renderInline(undefined), "");
});

test("decodes entities to text, never to markup", () => {
  assert.equal(renderInline("**FIRST&#95;30&#95;OFF** (monthly)"), "<strong>FIRST_30_OFF</strong> (monthly)");
  assert.equal(renderInline("a &#124; b &#x7C; c"), "a | b | c");
  assert.equal(renderInline("Tom &amp; Jerry &lt;3"), "Tom &amp; Jerry &lt;3");
  assert.equal(renderInline("&#60;script&#62;alert(1)&#60;/script&#62;"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(renderInline("&#x3C;img src=x onerror=alert(1)&#x3E;"), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(renderInline("&bogus; &#0; &#xD800; &#99999999;"), "&amp;bogus; \ufffd \ufffd &amp;#99999999;");
  // Entities are resolved after the Markdown is read, so they cannot build markup.
  assert.equal(renderInline("&#42;&#42;not bold&#42;&#42;"), "**not bold**");
  assert.equal(renderInline("&#91;x&#93;(https://example.org)"), "[x](https://example.org)");
  assert.equal(decodeEntities("&rarr;&euro;&nbsp;"), "\u2192\u20ac\u00a0");
});

test("escapes raw HTML", () => {
  const hostile = [
    "<script>alert(1)</script>",
    "<SCRIPT SRC=//evil.example/x.js></SCRIPT>",
    "<img src=x onerror=alert(1)>",
    "<a href=\"javascript:alert(1)\">x</a>",
    "</p></li><script>alert(1)</script>",
    "<svg/onload=alert(1)>",
    "<!-- comment --><style>*{display:none}</style>",
    "**<b onmouseover=alert(1)>bold</b>**",
    "`<script>alert(1)</script>`",
    "[<img src=x onerror=alert(1)>](https://example.org)",
    "<scr<script>ipt>alert(1)</scr</script>ipt>",
  ];
  for (const input of hostile) {
    const html = renderInline(input);
    assertOnlyKnownTags(html);
    assert.doesNotMatch(html, /<script|<img|<svg|<style|<b[ >]/i, input);
  }
  assert.equal(renderInline("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("links only go to http(s) addresses", () => {
  const refused = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java&#115;cript:alert(1)",
    "&#106;avascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example/x",
    "/relative/path",
    "mailto:someone@example.org",
    "ftp://example.org/file",
    "https://",
  ];
  for (const url of refused) {
    assert.equal(safeUrl(url), null, url);
    const html = renderInline(`[click](${url})`);
    assert.doesNotMatch(html, /<a\b/, `${url} became a link: ${html}`);
    assert.doesNotMatch(html, /href/i, url);
  }
  assert.equal(safeUrl("https://example.org/a?b=1&c=2#d"), "https://example.org/a?b=1&c=2#d");
  assert.equal(safeUrl(" HTTP://Example.ORG "), "http://example.org/");
  assert.equal(safeUrl("https://example.org/a&amp;b"), "https://example.org/a&b");
});

test("a link cannot add attributes or break out of href", () => {
  const attempts = [
    `[x](https://example.org/"onmouseover="alert(1))`,
    `[x](https://example.org/'onmouseover='alert(1))`,
    `[x](https://example.org/?q="><script>alert(1)</script>)`,
    `[x](https://example.org/#"onclick="alert(1))`,
    `[x](https://example.org/&quot;onmouseover=&quot;alert(1))`,
    `[x" onmouseover="alert(1)](https://example.org/)`,
    `[x](https://example.org/ "title" onmouseover=alert(1))`,
    `[x](https://exa"mple.org/)`,
  ];
  for (const input of attempts) {
    const html = renderInline(input);
    assertOnlyKnownTags(html);
    for (const [tag] of html.matchAll(/<a\b[^>]*>/g)) {
      assert.match(tag, new RegExp(`^<a href="[^"<>]*" rel="${DEAL_LINK_REL}">$`), `${input} -> ${tag}`);
    }
    assert.doesNotMatch(html, /<script/i, input);
  }
});

test("deal links carry rel and never open a javascript: address", () => {
  const row = dealRow({
    category: "utility-software", slug: "example", name: "Example", url: "javascript:alert(1)",
    description: "[site](https://example.org)", discount: "50% off",
  });
  assert.doesNotMatch(row, /javascript:/i);
  assert.match(row, /<h3 class="deal__name">Example<\/h3>/);
  assert.match(row, new RegExp(`<a href="https://example.org/" rel="${DEAL_LINK_REL}">site</a>`));
});

test("a row escapes every field, including the plain-text ones", () => {
  const evil = `"><script>alert(1)</script><x y="`;
  const row = dealRow({
    category: "utility-software", slug: "example",
    name: `Evil ${evil} &#60;b&#62;`, url: `https://example.org/${evil}`, description: evil, discount: evil,
    code: evil, terms: evil, percent: 60, starts: `2026-11-27${evil}`, ends: "2026-13-45",
  }, { listYear: 2026 });
  assertOnlyKnownTags(row, ["li", "p", "div", "h3", "a", "span", "button", "svg", "use", "strong", "s", "code"]);
  assert.doesNotMatch(row, /<script|<x\b/i);
  // The name is plain text: its entities are shown, not decoded.
  assert.ok(row.includes("&amp;#60;b&amp;#62;"));
  // Invalid dates are dropped instead of being written into attributes.
  assert.doesNotMatch(row, /data-starts|data-ends|deal__dates/);
  // Every attribute value is closed by the quote that opened it.
  for (const [, value] of row.matchAll(/="([^"]*)"/g)) assert.doesNotMatch(value, /[<>]/);
});

test("a row shows what the deal has and nothing it lacks", () => {
  const full = dealRow({
    category: "development-software", slug: "proxyman", name: "Proxyman", url: "https://proxyman.com/",
    description: "Debugging proxy.", discount: "30% off all plans", percent: 30, code: "BF2026",
    terms: "new customers", starts: "2026-11-16", ends: "2026-12-03",
  }, { listYear: 2026 });
  assert.match(full, /^<li class="deal" id="development-software-proxyman" data-percent="30" data-starts="2026-11-16" data-ends="2026-12-03">/);
  assert.match(full, /<span class="pct">30<span class="pct__sign">%<\/span><\/span>/);
  assert.match(full, /data-code="BF2026" aria-label="Copy code BF2026"/);
  assert.match(full, /<p class="deal__dates">Nov 16 to Dec 3<\/p>/);
  assert.match(full, new RegExp(`<a href="https://proxyman.com/" rel="${DEAL_LINK_REL}">Proxyman</a>`));

  const bare = dealRow({ category: "books", slug: "a-book", name: "A Book", url: "https://example.org/", description: "A book.", discount: "$10" });
  assert.doesNotMatch(bare, /class="pct|class="code|deal__terms|deal__dates|data-percent/);
  assert.match(dealRow({ ...{ category: "books", slug: "b", name: "B", url: "https://example.org/", description: "d", discount: "50%" }, percent: 50 }), /pct pct--high/);
  // "50" as text, 49.5 or 0 are not percentages.
  for (const percent of ["50", 49.5, 0, 101, null]) {
    assert.doesNotMatch(dealRow({ category: "books", slug: "b", name: "B", url: "https://example.org/", description: "d", discount: "x", percent }), /class="pct/);
  }
});

test("control characters and text-direction overrides are dropped", () => {
  const html = renderInline("safe" + String.fromCodePoint(0x202e) + "evil" + String.fromCodePoint(0, 7, 0x2066));
  assert.equal(html, "safe evil   ");
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});
