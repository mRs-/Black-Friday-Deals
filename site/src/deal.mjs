// What the submit form knows about a deal file: its name, the rules the
// repository's checks apply to it, the YAML text, and the GitHub address that
// opens it as a new file.
import { isDay } from "./dates.mjs";

export const FIELDS = ["name", "url", "description", "category", "discount", "percent", "code", "terms", "starts", "ends"];

// Order of keys in a deal file. `category` is the folder and `added` is set
// from the merge time, so neither is written.
const YAML_KEYS = ["name", "url", "description", "discount", "percent", "code", "terms", "starts", "ends"];

// The same limits as scripts/lib/validate.mjs, which checks every pull request.
export const MAX_LENGTH = { name: 60, url: 300, description: 250, discount: 150, code: 40, terms: 250 };

export const LABELS = {
  name: "product name",
  url: "link",
  description: "description",
  category: "category",
  discount: "discount",
  percent: "percent",
  code: "code",
  terms: "terms",
  starts: "start date",
  ends: "end date",
};

const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>|<!--/;

// File name from the product name: "Crisp & Docket" -> "crisp-and-docket".
// Always matches [a-z0-9]+(-[a-z0-9]+)* or is empty.
export function slugify(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// One line of text: no control characters, no line breaks, single spaces.
export function cleanText(value) {
  const text = String(value ?? "");
  const whole = typeof text.toWellFormed === "function" ? text.toWellFormed() : text;
  return whole.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
}

// Form values (all strings) -> a tidy deal. `percent` stays a string until it
// is known to be a whole number, so validation can still see what was typed.
export function readDeal(values) {
  const deal = {};
  for (const field of FIELDS) deal[field] = cleanText(values[field]);
  const percent = deal.percent.replace(/\s*%$/, "");
  deal.percent = /^\d{1,3}$/.test(percent) ? Number(percent) : percent;
  deal.slug = slugify(deal.name);
  return deal;
}

// The first percentage in a discount text, for filling the percent field: "Up to 50% off" -> 50.
export function percentFromDiscount(text) {
  const match = String(text ?? "").match(/(?<![\d.,])(\d{1,3})\s?%/);
  const value = match ? Number(match[1]) : 0;
  return value >= 1 && value <= 100 ? value : null;
}

// Two deals are the same offer when the name and the page match; protocol,
// "www.", a trailing slash, query and fragment do not count. Mirrors dealKey()
// in scripts/lib/catalog.mjs.
export function productKey(deal) {
  const name = String(deal.name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  let url = String(deal.url ?? "").trim();
  try {
    const parsed = new URL(url);
    url = parsed.hostname.toLowerCase().replace(/^www\./, "") + parsed.pathname.replace(/\/+$/, "");
  } catch {
    url = url.toLowerCase();
  }
  return `${name}\n${url}`;
}

function urlProblem(value) {
  if (/\s/.test(value)) return "Remove the space from the link, or write it as %20.";
  let url = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) {
    return /^[\w-]+(\.[\w-]+)+/.test(value)
      ? `Start the link with https://, like this: https://${value}`
      : "Enter the full address of the sale or product page, starting with https://.";
  }
  if (/^(www\.)?example\.(com|org|net)$/i.test(url.hostname)) return "Replace the example address with your own page.";
  if ((value.match(/\(/g) ?? []).length !== (value.match(/\)/g) ?? []).length || /[<>]/.test(value)) {
    return "Write ( as %28, ) as %29, < as %3C and > as %3E in the link.";
  }
  return "";
}

// Problems with a deal, in form order, as { field, message, missing, existing }.
// `categories` is the list of valid slugs. `listed` maps "category/slug" to the
// productKey of every deal already on the list. `existing` on a problem is the
// "category/slug" of the deal that is in the way.
export function validateDeal(deal, { categories = [], listed = new Map(), year } = {}) {
  const problems = [];
  const add = (field, message, extra = {}) => problems.push({ field, message, missing: false, existing: "", ...extra });
  const tooLong = (field) => {
    const over = deal[field].length - MAX_LENGTH[field];
    if (over > 0) add(field, `Shorten the ${LABELS[field]} by ${over} ${over === 1 ? "character" : "characters"}. The limit is ${MAX_LENGTH[field]}.`);
    return over > 0;
  };
  const noHtml = (field) => {
    if (HTML_TAG.test(deal[field])) add(field, "Remove the HTML. Links are written [text](https://…), bold **like this**.");
  };

  if (!deal.name) add("name", "Enter the product name.", { missing: true });
  else if (!deal.slug) add("name", "Use at least one letter or digit in the name. The file name is made from it.");
  else if (/[[\]*`]/.test(deal.name)) add("name", "Write the plain product name, without [ ] * or `.");
  else if (!tooLong("name")) noHtml("name");

  if (!deal.url) add("url", "Enter the link to the sale or product page.", { missing: true });
  else if (urlProblem(deal.url)) add("url", urlProblem(deal.url));
  else tooLong("url");

  if (!deal.description) add("description", "Describe the product in a sentence.", { missing: true });
  else if (!tooLong("description")) noHtml("description");

  if (!deal.category) add("category", "Choose a category.", { missing: true });
  else if (categories.length && !categories.includes(deal.category)) add("category", "Choose one of the listed categories.");

  if (!deal.discount) add("discount", "Say what the discount is, for example “40% off all plans”.", { missing: true });
  else if (!tooLong("discount")) noHtml("discount");

  if (deal.percent !== "" && !(Number.isInteger(deal.percent) && deal.percent >= 1 && deal.percent <= 100)) {
    add("percent", "Enter a whole number from 1 to 100, or leave it empty.");
  }

  if (deal.code) {
    if (/[\s*]/.test(deal.code)) add("code", "Enter one code without spaces. Several codes or extra words go into the terms.");
    else if (!tooLong("code")) noHtml("code");
  }

  if (deal.terms && !tooLong("terms")) noHtml("terms");

  if (deal.starts && !isDay(deal.starts)) add("starts", "Enter the start date as a day in the calendar.");
  if (deal.ends && !isDay(deal.ends)) add("ends", "Enter the end date as a day in the calendar.");
  if (isDay(deal.starts) && isDay(deal.ends) && deal.starts > deal.ends) {
    add("ends", "The deal ends before it starts. Swap the dates or correct one.");
  } else if (year && isDay(deal.ends) && deal.ends < `${year}-01-01`) {
    add("ends", `This list holds ${year} offers only. Enter this year’s end date.`);
  }

  // One deal per product, and one file per name in a folder.
  if (deal.slug && deal.category && !problems.some((p) => p.field === "name" || p.field === "category")) {
    const file = `${deal.category}/${deal.slug}`;
    const key = productKey(deal);
    const same = [...listed].find(([, listedKey]) => listedKey === key)?.[0];
    if (listed.has(file)) {
      add("name", `${deal.slug}.yml is already on the list in this category. Edit that file, or change the name if this is another product.`, { existing: file });
    } else if (same && deal.url && !problems.some((p) => p.field === "url")) {
      add("name", `This product is already on the list. One deal per product: edit the existing file.`, { existing: same });
    }
  }
  return problems.sort((a, b) => FIELDS.indexOf(a.field) - FIELDS.indexOf(b.field));
}

// The deal as a YAML file. Strings are JSON strings, which YAML reads as
// double-quoted scalars; empty optional fields are left out.
export function dealYaml(deal) {
  const lines = [];
  for (const key of YAML_KEYS) {
    const value = deal[key];
    if (value === "" || value === undefined || value === null) continue;
    lines.push(`${key}: ${typeof value === "number" ? value : JSON.stringify(String(value))}`);
  }
  return lines.join("\n") + "\n";
}

export function dealPath(deal, year) {
  return `deals/${year}/${deal.category}/${deal.slug}.yml`;
}

// GitHub's "new file" page with path, file name and content filled in. The
// whole path goes into `filename`, which also works for a category folder that
// does not exist yet (GitHub creates it with the file).
export function newFileUrl(deal, { repo, branch, year }) {
  const query = `filename=${encodeURIComponent(dealPath(deal, year))}&value=${encodeURIComponent(dealYaml(deal))}`;
  return `https://github.com/${repo}/new/${encodeURIComponent(branch)}?${query}`;
}

// GitHub's editor for a deal that is already on the list ("category/slug").
export function editFileUrl(file, { repo, branch, year }) {
  return `https://github.com/${repo}/edit/${encodeURIComponent(branch)}/deals/${year}/${file}.yml`;
}
