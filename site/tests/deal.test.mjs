// The submit form: file names, the YAML it writes, the checks, the GitHub address.
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";
import * as catalog from "../../scripts/lib/catalog.mjs";
import {
  MAX_LENGTH, cleanText, dealPath, dealYaml, editFileUrl, newFileUrl, percentFromDiscount, productKey, readDeal, slugify, validateDeal,
} from "../src/deal.mjs";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const github = { repo: "mRs-/Black-Friday-Deals", branch: "master", year: 2026 };
const categories = ["development-software", "utility-software", "books"];

const form = (values = {}) => readDeal({
  name: "Proxyman", url: "https://proxyman.com/", description: "Debugging proxy for HTTP traffic.",
  category: "development-software", discount: "30% off all plans", percent: "", code: "", terms: "", starts: "", ends: "",
  ...values,
});
const fields = (problems) => problems.map((problem) => problem.field);

test("file names come from the product name", () => {
  const cases = {
    "Proxyman": "proxyman",
    "Device MCP": "device-mcp",
    "SnapTidy: Photo Swipe & Delete": "snaptidy-photo-swipe-and-delete",
    "Chronoid - Automatic Time Tracking": "chronoid-automatic-time-tracking",
    "iKnow Suite: iKnowMyMac + iKnowMyDisplay": "iknow-suite-iknowmymac-iknowmydisplay",
    "  Café  Crème  ": "cafe-creme",
    "R&D": "r-and-d",
    "1Password 8": "1password-8",
    "--weird__name!!": "weird-name",
    "../../etc/passwd": "etc-passwd",
    "a/b\\c.yml": "a-b-c-yml",
    "アプリ": "",
    "": "",
  };
  for (const [name, slug] of Object.entries(cases)) {
    assert.equal(slugify(name), slug, name);
    if (slug) assert.match(slugify(name), SLUG);
  }
});

test("the YAML holds the filled-in fields, in order, as double-quoted strings", () => {
  const deal = form({ percent: "30", code: "BF2026", terms: "new customers", starts: "2026-11-16", ends: "2026-12-03" });
  assert.equal(
    dealYaml(deal),
    [
      'name: "Proxyman"',
      'url: "https://proxyman.com/"',
      'description: "Debugging proxy for HTTP traffic."',
      'discount: "30% off all plans"',
      "percent: 30",
      'code: "BF2026"',
      'terms: "new customers"',
      'starts: "2026-11-16"',
      'ends: "2026-12-03"',
      "",
    ].join("\n"),
  );
});

test("empty optional fields, the category and `added` are never written", () => {
  const yaml = dealYaml({ ...form(), added: "2026-11-01T00:00:00Z" });
  assert.deepEqual(Object.keys(parse(yaml)), ["name", "url", "description", "discount"]);
  assert.doesNotMatch(yaml, /added|category|slug|percent|code|terms|starts|ends/);
});

test("whatever is typed comes back unchanged when the YAML is parsed", () => {
  const awkward = [
    `She said "hi" and left`,
    `back\\slash and 'single' quotes`,
    `colon: hash # not a comment`,
    `- leading dash`,
    `{braces} [brackets] & *star !bang |pipe >fold`,
    `@at \`tick\` %percent`,
    `yes`, `no`, `null`, `~`, `true`, `123`, `1e3`, `0x1F`, `2026-11-27`,
    `emoji \u{1F4B8} and arrow → and €49`,
    `**bold** ~~old~~ [link](https://example.org/?a=1&b=2)`,
    `trailing backslash \\`,
    `tab\tand\nnewline become spaces`,
  ];
  for (const text of awkward) {
    const deal = form({ name: `App ${text}`, description: text, discount: text, terms: text, code: "CODE" });
    const data = parse(dealYaml(deal));
    const expected = cleanText(text);
    assert.equal(data.description, expected, text);
    assert.equal(data.discount, expected, text);
    assert.equal(data.terms, expected, text);
    assert.equal(data.name, `App ${expected}`);
    assert.equal(typeof data.description, "string");
    assert.doesNotMatch(dealYaml(deal).trimEnd(), /[\t\r]|\n(?![a-z]+: )/, "one field per line");
  }
  assert.equal(parse(dealYaml(form({ description: "tab\tand\nnewline" }))).description, "tab and newline");
});

test("percent is a bare whole number, dates are quoted strings", () => {
  const data = parse(dealYaml(form({ percent: "50 %", starts: "2026-11-27", ends: "2026-11-30" })));
  assert.strictEqual(data.percent, 50);
  assert.strictEqual(data.starts, "2026-11-27");
  assert.strictEqual(data.ends, "2026-11-30");
});

test("a complete deal passes; each missing field is named", () => {
  assert.deepEqual(validateDeal(form(), { categories }), []);
  const empty = validateDeal(readDeal({}), { categories });
  assert.deepEqual(fields(empty), ["name", "url", "description", "category", "discount"]);
  assert.ok(empty.every((problem) => problem.missing && problem.message));
});

test("links must be full http(s) addresses", () => {
  for (const url of ["proxyman.com", "javascript:alert(1)", "ftp://example.org/x", "https://localhost", "https://exa mple.org", "mailto:a@b.co", "https://example.com/deal", "https://x.org/<b>"]) {
    assert.deepEqual(fields(validateDeal(form({ url }), { categories })), ["url"], url);
  }
  for (const url of ["https://proxyman.com", "http://old.example.io/page?a=1#b", "https://xn--bcher-kva.example.org/"]) {
    assert.deepEqual(validateDeal(form({ url }), { categories }), [], url);
  }
  assert.match(validateDeal(form({ url: "proxyman.com/bf" }), { categories })[0].message, /https:\/\/proxyman\.com\/bf/);
});

test("percent must be a whole number from 1 to 100", () => {
  for (const percent of ["0", "101", "12.5", "-5", "fifty", "1e2", "999"]) {
    assert.deepEqual(fields(validateDeal(form({ percent }), { categories })), ["percent"], percent);
  }
  for (const percent of ["1", "50", "100", "40%", " 40 % "]) {
    assert.deepEqual(validateDeal(form({ percent }), { categories }), [], percent);
  }
});

test("dates must exist and be in order", () => {
  assert.deepEqual(fields(validateDeal(form({ starts: "2026-12-01", ends: "2026-11-30" }), { categories })), ["ends"]);
  assert.deepEqual(fields(validateDeal(form({ starts: "2026-02-30" }), { categories })), ["starts"]);
  assert.deepEqual(fields(validateDeal(form({ ends: "27.11.2026" }), { categories })), ["ends"]);
  assert.deepEqual(fields(validateDeal(form({ ends: "2025-11-30" }), { categories, year: 2026 })), ["ends"]);
  assert.deepEqual(validateDeal(form({ starts: "2026-11-27", ends: "2026-11-27" }), { categories, year: 2026 }), []);
  assert.deepEqual(validateDeal(form({ ends: "2026-11-30" }), { categories }), []);
});

test("the same limits as the pull request check", () => {
  for (const [field, limit] of Object.entries(MAX_LENGTH)) {
    const filler = field === "url" ? `https://example.org/${"a".repeat(limit)}` : "a".repeat(limit + 1);
    assert.deepEqual(fields(validateDeal(form({ [field]: filler }), { categories })), [field], field);
  }
  assert.deepEqual(fields(validateDeal(form({ description: "Now <b>bold</b>" }), { categories })), ["description"]);
  assert.deepEqual(fields(validateDeal(form({ name: "**Proxyman**" }), { categories })), ["name"]);
  assert.deepEqual(fields(validateDeal(form({ code: "BF 2026" }), { categories })), ["code"]);
  assert.deepEqual(fields(validateDeal(form({ category: "made-up" }), { categories })), ["category"]);
  assert.deepEqual(fields(validateDeal(form({ name: "!!!" }), { categories })), ["name"]);
});

test("a deal that is already listed is pointed to its file", () => {
  const listed = new Map([["development-software/proxyman", productKey({ name: "Proxyman", url: "https://proxyman.com/" })]]);
  const [sameFile] = validateDeal(form(), { categories, listed });
  assert.equal(sameFile.field, "name");
  assert.equal(sameFile.existing, "development-software/proxyman");

  // Same product under another category, with a tracking parameter and "www.".
  const [moved] = validateDeal(form({ category: "utility-software", url: "http://www.proxyman.com?ref=bf" }), { categories, listed });
  assert.equal(moved.existing, "development-software/proxyman");

  assert.deepEqual(validateDeal(form({ name: "Proxyman Pro", url: "https://proxyman.com/pro" }), { categories, listed }), []);
  assert.equal(editFileUrl("development-software/proxyman", github), "https://github.com/mRs-/Black-Friday-Deals/edit/master/deals/2026/development-software/proxyman.yml");
});

test("productKey agrees with the repository's own duplicate rule", { skip: typeof catalog.dealKey !== "function" }, () => {
  const samples = [
    { name: "Proxyman", url: "https://proxyman.com/" },
    { name: "  Mixed   Case ", url: "HTTP://WWW.Example.org/Path/?utm=1#x" },
    { name: "No Url", url: "not a url" },
    { name: "", url: "" },
  ];
  for (const sample of samples) assert.equal(productKey(sample), catalog.dealKey(sample));
});

test("the percent can be read from the discount text", () => {
  assert.equal(percentFromDiscount("40% off the yearly plan"), 40);
  assert.equal(percentFromDiscount("Up to 50 % off: 1 Mac $25"), 50);
  assert.equal(percentFromDiscount("**30% OFF** ($59 → $41)"), 30);
  assert.equal(percentFromDiscount("Lifetime $249 → $149"), null);
  assert.equal(percentFromDiscount("12.5% off"), null);
  assert.equal(percentFromDiscount("150% more"), null);
  assert.equal(percentFromDiscount(""), null);
});

test("the GitHub address opens a new file with path, name and content filled in", () => {
  const deal = form({ percent: "30", code: "BF2026", description: `Fast & "native" proxy #1 → 100% + more` });
  const url = new URL(newFileUrl(deal, github));
  assert.equal(url.origin + url.pathname, "https://github.com/mRs-/Black-Friday-Deals/new/master");
  assert.deepEqual([...url.searchParams.keys()], ["filename", "value"]);
  assert.equal(url.searchParams.get("filename"), "deals/2026/development-software/proxyman.yml");
  assert.equal(url.searchParams.get("filename"), dealPath(deal, 2026));
  assert.equal(url.searchParams.get("value"), dealYaml(deal));
  assert.equal(parse(url.searchParams.get("value")).description, `Fast & "native" proxy #1 → 100% + more`);
  // Nothing in the address is left for a browser or GitHub to misread.
  assert.doesNotMatch(newFileUrl(deal, github).split("?")[1], /[ "#<>+]/);
  assert.ok(newFileUrl(form({ description: "d".repeat(250), terms: "t".repeat(250), discount: "x".repeat(150) }), github).length < 2000);
});
