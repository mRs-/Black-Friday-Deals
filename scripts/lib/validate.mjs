// Checks deals/categories.yml and every deal file. Each problem is reported with the file,
// the line, the field, what is wrong and how to fix it, in words for someone who has
// never written YAML before.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LineCounter, parseDocument, isAlias, isMap, isScalar, isSeq, visit } from "yaml";
import { DEAL_FIELDS, REQUIRED_FIELDS, dealKey } from "./catalog.mjs";

export const FILE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.yml$/;
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Longest values in the 2026 catalog at the time of the move to YAML:
// name 40, url 126, description 211, discount 141, code 20, terms 215.
export const MAX_LENGTH = { name: 60, url: 300, description: 250, discount: 150, code: 40, terms: 250 };

const TEXT_FIELDS = ["name", "description", "discount", "code", "terms"];
const CATEGORY_FIELDS = ["slug", "title", "emoji", "anchor"];
const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>|<!--/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const EXAMPLES = {
  name: 'name: "Your App"',
  url: 'url: "https://yourapp.com/black-friday"',
  description: 'description: "What your app does, in one sentence."',
  discount: 'discount: "40% off all plans"',
  percent: "percent: 40",
  code: 'code: "BF2026"',
  terms: 'terms: "annual plan, first year only"',
  starts: 'starts: "2026-11-27"',
  ends: 'ends: "2026-11-30"',
};

// Other words people use for our field names.
const ALIASES = {
  title: "name", app: "name", product: "name",
  link: "url", website: "url", homepage: "url", site: "url", href: "url",
  desc: "description", summary: "description", about: "description",
  deal: "discount", offer: "discount", price: "discount", savings: "discount",
  percentage: "percent", percent_off: "percent", pct: "percent",
  coupon: "code", promo: "code", promocode: "code", coupon_code: "code", promo_code: "code",
  conditions: "terms", notes: "terms", note: "terms", restrictions: "terms",
  start: "starts", from: "starts", start_date: "starts", begins: "starts",
  end: "ends", until: "ends", end_date: "ends", expires: "ends", valid_until: "ends",
  date: "added", created: "added",
};

const quote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const shorten = (value, max = 60) => {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

export function closest(word, candidates) {
  const needle = String(word).toLowerCase();
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = distance(needle, candidate.toLowerCase());
    if (d < bestDistance) { best = candidate; bestDistance = d; }
  }
  return bestDistance <= Math.max(2, Math.floor(needle.length / 3)) ? best : null;
}

export function suggestFileName(name) {
  const slug = String(name)
    .replace(/\.(ya?ml|txt|md)$/i, "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "your-app"}.yml`;
}

function isRealDate(text) {
  if (!ISO_DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

// ---------------------------------------------------------------------------------------
// YAML syntax

const SYNTAX_REASONS = {
  BLOCK_AS_IMPLICIT_KEY: "a colon followed by a space (\": \") inside a value looks like the start of a new field",
  MULTILINE_IMPLICIT_KEY: "a field name and its value must be on one line, written as \"field: value\"",
  BAD_SCALAR_START: "the value starts with a character that has a special meaning in YAML",
  UNEXPECTED_TOKEN: "part of the value has a special meaning in YAML (often a *, a quote, a [ or a { at the start)",
  MISSING_CHAR: "a quote or bracket was opened but never closed",
  BAD_INDENT: "the line is indented differently from the lines around it",
  BAD_ALIAS: "a value that starts with * is read as a YAML reference",
  BAD_DQ_ESCAPE: "inside double quotes a backslash must be written twice (\\\\)",
  TAG_RESOLVE_FAILED: "a value that starts with ! is read as a YAML tag",
};

// Turns the first YAML error of a file into a line number, a plain reason and a concrete fix.
// `flat` is true for deal files, where every field starts at the beginning of its line.
function explainSyntaxError(text, error, knownKeys, flat) {
  const lines = text.split(/\r?\n/);
  const keyAt = (index) => (lines[index] ?? "").match(/^([A-Za-z_][\w-]*)\s*:/)?.[1];
  let line = error.linePos?.[0]?.line ?? 1;

  if (error.code === "TAB_AS_INDENT") {
    return { line, problem: "this line starts with a tab", fix: "Delete the tab. Every field starts at the very beginning of its line." };
  }
  if (error.code === "MULTIPLE_DOCS") {
    const dashes = lines.findIndex((l, i) => i > 0 && /^---/.test(l));
    return {
      line: dashes >= 0 ? dashes + 1 : line,
      problem: "the file contains a \"---\" line, which starts a second YAML document",
      fix: "Delete the \"---\" line. One file holds exactly one deal.",
    };
  }
  if (error.code === "DUPLICATE_KEY") {
    const key = keyAt(line - 1);
    return {
      line,
      field: key,
      problem: `the field ${key ? `"${key}"` : "on this line"} appears twice`,
      fix: "Keep one of the two lines and delete the other.",
    };
  }

  // A field line that starts with spaces makes YAML attach it to the line above.
  const indented = !flat ? -1 : lines.findIndex((l) => /^[ \t]+[A-Za-z_][\w-]*\s*:(\s|$)/.test(l) && knownKeys.includes(l.trim().split(/\s*:/)[0]));
  if (indented >= 0) {
    return {
      line: indented + 1,
      field: lines[indented].trim().split(/\s*:/)[0],
      problem: "this line starts with spaces, so YAML reads it as part of the line above",
      fix: `Remove the spaces at the start of the line: ${lines[indented].trim()}`,
    };
  }
  // "name:Value" is missing the space after the colon.
  const noSpace = !flat ? -1 : lines.findIndex((l) => {
    const match = l.match(/^([A-Za-z_][\w-]*):\S/);
    return match && knownKeys.includes(match[1]);
  });
  if (noSpace >= 0) {
    const [, key, value] = lines[noSpace].match(/^([A-Za-z_][\w-]*):(.*)$/);
    return {
      line: noSpace + 1,
      field: key,
      problem: "there is no space after the colon",
      fix: `Add a space after "${key}:" and put the value in double quotes: ${key}: ${quote(value.trim())}`,
    };
  }
  // An unclosed quote is only noticed at the end of the file; point at the line that opened it.
  if (error.code === "MISSING_CHAR" && /quote/i.test(error.message)) {
    const open = lines.findIndex((l) => {
      const value = l.match(/^[A-Za-z_][\w-]*\s*:\s*(.*?)\s*$/)?.[1] ?? "";
      const mark = value[0];
      return (mark === '"' || mark === "'") && (value.length === 1 || value.at(-1) !== mark);
    });
    if (open >= 0) line = open + 1;
    return {
      line,
      field: keyAt(line - 1),
      problem: "a value starts with a quote but does not end with one",
      fix: "Put the same quote at the end of the value. Text values look like this: " + EXAMPLES.discount,
    };
  }

  line = Math.min(line, Math.max(lines.length, 1));
  const source = lines[line - 1] ?? "";
  const match = source.match(/^[\s-]*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/);
  const reason = SYNTAX_REASONS[error.code]
    ?? error.message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "");
  let fix = `Wrap the value in double quotes, for example: ${EXAMPLES.discount}`;
  if (match && match[2] && !/^".*"$/.test(match[2])) {
    fix = `Wrap the value in double quotes: ${match[1]}: ${quote(match[2])}`;
  } else if (match && /^".*"$/.test(match[2])) {
    fix = `Check the quotes in this value. A double quote inside the text must be written as \\" , for example: terms: "use the \\"Pro\\" plan"`;
  }
  return { line, field: match?.[1], problem: `YAML cannot read this line: ${reason}`, fix };
}

// Parses one YAML file. Returns { data, lineOf, errors }; data is null when the file
// cannot be read as a list of "field: value" lines.
function readYaml(text, file, knownKeys, shape) {
  const errors = [];
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  const lineAt = (node) => (node?.range ? lineCounter.linePos(node.range[0]).line : undefined);

  if (doc.errors.length) {
    const first = [...doc.errors].sort((a, b) => (a.pos?.[0] ?? 0) - (b.pos?.[0] ?? 0))[0];
    first.linePos ??= first.pos ? [lineCounter.linePos(first.pos[0])] : undefined;
    errors.push({ file, ...explainSyntaxError(text, first, knownKeys, shape === "map") });
    return { data: null, lineOf: () => undefined, errors };
  }

  // Things YAML accepts without complaint but that drop or change part of a value.
  let unreadable = false;
  const fieldAt = (line) => text.split(/\r?\n/)[line - 1]?.match(/^\s*-?\s*([A-Za-z_][\w-]*)\s*:/)?.[1];
  const silent = (line, problem) => {
    unreadable = true;
    const match = line ? text.split(/\r?\n/)[line - 1]?.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/) : null;
    errors.push({
      file, line, field: line ? fieldAt(line) : undefined, problem,
      fix: match?.[2] ? `Wrap the value in double quotes: ${match[1]}: ${quote(match[2])}` : "Wrap the whole value in double quotes.",
    });
  };
  for (const warning of doc.warnings) {
    silent(warning.pos ? lineCounter.linePos(warning.pos[0]).line : undefined,
      "the value starts with !, which has a special meaning in YAML, so it is not read as text");
  }
  visit(doc, {
    Alias(_, node) {
      silent(lineAt(node), "the value starts with *, which has a special meaning in YAML, so it is not read as text");
    },
    Node(_, node) {
      if (node.anchor) {
        silent(lineAt(node), `the value starts with &, which has a special meaning in YAML, so "&${node.anchor}" is dropped from it`);
      }
    },
  });

  const root = doc.contents;
  if (shape === "list") {
    if (!isSeq(root)) {
      errors.push({ file, line: 1, problem: "this file must be a list of categories", fix: "Each category starts with \"- slug: ...\" followed by title, emoji and anchor." });
      return { data: null, lineOf: () => undefined, errors };
    }
    return { data: unreadable ? null : doc.toJS(), lineOf: () => undefined, errors };
  }

  if (root === null) {
    errors.push({ file, line: 1, problem: "the file is empty", fix: `Add the deal, one field per line, starting with: ${EXAMPLES.name}` });
    return { data: null, lineOf: () => undefined, errors };
  }
  if (!isMap(root)) {
    const list = isSeq(root);
    errors.push({
      file, line: 1,
      problem: list ? "the lines start with \"- \", which makes this a list" : "the file does not contain \"field: value\" lines",
      fix: list
        ? "Remove the \"- \" at the start. A deal file is plain \"field: value\" lines and holds one deal."
        : `Write one field per line, for example: ${EXAMPLES.name}`,
    });
    return { data: null, lineOf: () => undefined, errors };
  }

  const lines = new Map();
  for (const pair of root.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : null;
    if (key === null) continue;
    lines.set(key, lineAt(pair.key));
    // "value # text": everything after " #" is a comment and is not part of the value.
    if (isScalar(pair.value) && typeof pair.value.comment === "string" && pair.value.range) {
      const raw = text.slice(pair.value.range[0], pair.value.range[1]);
      errors.push({
        file, line: lineAt(pair.key), field: key,
        problem: `everything after " #" is treated as a comment, so the value is cut off after ${quote(shorten(raw))}`,
        fix: `If the # belongs to the text, wrap the whole value in double quotes. If it is a comment, move it to its own line above "${key}:".`,
      });
    }
  }
  if (unreadable) {
    errors.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
    return { data: null, lineOf: () => undefined, errors };
  }
  return { data: doc.toJS(), lineOf: (key) => lines.get(key), errors };
}

// ---------------------------------------------------------------------------------------
// One deal file

function checkText(push, field, value) {
  if (typeof value !== "string") {
    const printed = value instanceof Date ? value.toISOString() : JSON.stringify(value);
    push(field, `must be text, but ${printed} is read as ${Array.isArray(value) ? "a list" : value === null ? "empty" : typeof value === "object" ? "a group of fields" : `a ${typeof value}`}`,
      typeof value === "number" || typeof value === "boolean"
        ? `Put it in double quotes: ${field}: "${value}"`
        : `Write it as one line of text in double quotes, for example: ${EXAMPLES[field] ?? `${field}: "..."`}`);
    return false;
  }
  if (!value.trim()) {
    push(field, "is empty", REQUIRED_FIELDS.includes(field)
      ? `Fill it in, for example: ${EXAMPLES[field]}`
      : `Fill it in, or delete the "${field}:" line (this field is optional).`);
    return false;
  }
  if (/[\r\n\t]/.test(value)) {
    push(field, "contains a line break or a tab", "Put the whole value on one line, in double quotes.");
    return false;
  }
  if (value !== value.trim()) {
    push(field, "has a space at the start or the end", "Remove the extra space inside the quotes.");
  }
  const tag = value.match(HTML_TAG);
  if (tag) {
    push(field, `contains HTML (${shorten(tag[0], 30)})`,
      "Remove the HTML. Markdown works for links and emphasis: [text](https://example.org), **bold**, ~~old price~~.");
  }
  if (MAX_LENGTH[field] && value.length > MAX_LENGTH[field]) {
    push(field, `is ${value.length} characters long; the limit is ${MAX_LENGTH[field]}`,
      `Shorten it by at least ${value.length - MAX_LENGTH[field]} characters.${field === "description" ? " Plan limits and conditions belong in \"terms\"." : ""}`);
  }
  return true;
}

// Validates the text of one deal file. `file` is only used in messages; `year` is the
// folder the file sits in (deals/<year>/...). Returns { deal, errors }.
export function validateDeal(text, { file = "deal.yml", year, now = Date.now() } = {}) {
  const { data, lineOf, errors } = readYaml(text, file, [...DEAL_FIELDS, ...Object.keys(ALIASES)], "map");
  if (!data) return { deal: null, errors };
  const push = (field, problem, fix) => errors.push({ file, line: lineOf(field), field, problem, fix });

  const renamed = new Set();
  for (const key of Object.keys(data)) {
    if (DEAL_FIELDS.includes(key)) continue;
    const guess = ALIASES[key.toLowerCase()] ?? closest(key, DEAL_FIELDS);
    if (guess && !(guess in data) && !renamed.has(guess)) {
      renamed.add(guess);
      push(key, "is not a field name this list uses", `Rename it to "${guess}" (all lowercase).`);
    } else {
      push(key, "is not a field name this list uses",
        `Delete the line${guess ? ` (there is already a "${guess}" line)` : ""}. The fields are: ${DEAL_FIELDS.filter((f) => f !== "added").join(", ")}.`);
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in data) && !renamed.has(field)) {
      errors.push({ file, field, problem: "is missing", fix: `Add this line: ${EXAMPLES[field]}` });
    }
  }

  for (const field of TEXT_FIELDS) {
    if (!(field in data)) continue;
    if (!checkText(push, field, data[field])) continue;
    const value = data[field];
    if (field === "name" && /[[\]*`]/.test(value)) {
      push(field, "contains Markdown characters ([ ] * or `)", "Write only the plain product name. It becomes the link text automatically.");
    }
    if (field === "code" && /[\s*]/.test(value)) {
      push(field, "must be the coupon code alone, without spaces or *",
        "Put only the code here, for example: code: \"BF2026\". With several codes or extra words, delete this line and describe them in \"terms\".");
    }
  }

  if ("url" in data && checkText(push, "url", data.url)) {
    const url = data.url;
    let parsed = null;
    try { parsed = new URL(url); } catch { /* reported below */ }
    if (/\s/.test(url)) {
      push("url", "contains a space", "Remove the space, or write it as %20.");
    } else if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes(".")) {
      push("url", `${quote(shorten(url))} is not a web address`,
        /^[\w-]+(\.[\w-]+)+/.test(url)
          ? `Start it with https:// like this: url: "https://${url}"`
          : `Use the full address of your sale or product page, for example: ${EXAMPLES.url}`);
    } else if (/^(www\.)?example\.(com|org|net)$/i.test(parsed.hostname)) {
      push("url", "is still the example address", "Replace it with the address of your sale or product page.");
    } else if ((url.match(/\(/g) ?? []).length !== (url.match(/\)/g) ?? []).length || /[<>]/.test(url)) {
      push("url", "contains ( ) < or > characters that break the link in the README", "Write ( as %28, ) as %29, < as %3C and > as %3E.");
    }
  }

  if ("percent" in data) {
    const value = data.percent;
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      const digits = typeof value === "string" ? value.match(/^\s*(\d{1,3})(\.\d+)?\s*%?\s*$/) : null;
      const rounded = digits ? Math.round(Number(digits[1] + (digits[2] ?? ""))) : typeof value === "number" ? Math.round(value) : null;
      const usable = rounded !== null && rounded >= 1 && rounded <= 100;
      push("percent", `must be a whole number from 1 to 100, but it is ${JSON.stringify(value)}`,
        usable
          ? `Write it without quotes and without a % sign: percent: ${rounded}`
          : "Write the number alone, for example: percent: 40. For a fixed price or a deal without a percentage, delete this line.");
    }
  }

  const dates = {};
  for (const field of ["starts", "ends"]) {
    if (!(field in data)) continue;
    const value = data[field];
    if (typeof value !== "string" || !isRealDate(value)) {
      const looksIso = typeof value === "string" && ISO_DATE.test(value);
      push(field, looksIso
        ? `${quote(value)} is not a day that exists in the calendar`
        : `must be a date written as YYYY-MM-DD, but it is ${JSON.stringify(value)}`,
        `Write year-month-day with two digits for month and day, for example: ${EXAMPLES[field]}. If there is no fixed day, delete this line and describe the timing in "terms".`);
    } else {
      dates[field] = value;
    }
  }
  if (dates.starts && dates.ends && dates.starts > dates.ends) {
    push("ends", `the deal ends (${dates.ends}) before it starts (${dates.starts})`, "Swap the two dates or correct the wrong one.");
  }
  if (year && dates.ends && dates.ends < `${year}-01-01`) {
    push("ends", `${dates.ends} is before ${year}, but this list only holds ${year} offers`, `Use this year's end date, or delete the file if the offer is from an earlier year.`);
  }

  if ("added" in data) {
    const value = data.added;
    const time = typeof value === "string" && ISO_TIMESTAMP.test(value) ? Date.parse(value) : NaN;
    if (Number.isNaN(time)) {
      push("added", `must be a full timestamp, but it is ${JSON.stringify(value)}`,
        "Delete this line: the order is taken from the time the file is merged. (Maintainers: use the form 2026-11-27T09:30:00Z.)");
    } else if (time > now + 24 * 60 * 60 * 1000) {
      push("added", `${value} is in the future`, "Delete this line: the order is taken from the time the file is merged.");
    }
  }

  errors.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
  return { deal: data, errors };
}

// ---------------------------------------------------------------------------------------
// categories.yml

export function validateCategories(text, { file = "deals/categories.yml" } = {}) {
  const { data, errors } = readYaml(text, file, CATEGORY_FIELDS, "list");
  if (!data) return { categories: null, errors };
  const seen = { slug: new Map(), anchor: new Map(), title: new Map() };
  data.forEach((category, index) => {
    const where = `category ${index + 1}`;
    const push = (field, problem, fix) => errors.push({ file, field: `${where}, ${field}`, problem, fix });
    if (category === null || typeof category !== "object" || Array.isArray(category)) {
      errors.push({ file, field: where, problem: "must have the fields slug, title, emoji and anchor", fix: "Write it as \"- slug: ...\" followed by title, emoji and anchor lines." });
      return;
    }
    for (const key of Object.keys(category)) {
      if (!CATEGORY_FIELDS.includes(key)) push(key, "is not a known field", `Delete it. The fields are: ${CATEGORY_FIELDS.join(", ")}.`);
    }
    for (const field of CATEGORY_FIELDS) {
      const value = category[field];
      if (typeof value !== "string" || !value.trim()) {
        push(field, "is missing or empty", `Add a "${field}" value in double quotes.`);
        continue;
      }
      if (field === "slug" && !SLUG.test(value)) {
        push(field, `${quote(value)} may only use lowercase letters, numbers and single dashes`, `Use something like ${quote(suggestFileName(value).replace(/\.yml$/, ""))}. It is also the folder name under deals/<year>/.`);
      }
      if (field === "anchor" && !/^[a-z0-9-]+$/.test(value)) {
        push(field, `${quote(value)} may only use lowercase letters, numbers and dashes`, "Use the id that existing links to this README section already use.");
      }
      if (field === "title" && (/[\r\n|]/.test(value) || HTML_TAG.test(value))) {
        push(field, "must be one line of plain text", "Remove line breaks, | characters and HTML.");
      }
      if (seen[field]) {
        const key = value.toLowerCase();
        if (seen[field].has(key)) push(field, `${quote(value)} is used twice (also by category ${seen[field].get(key)})`, `Give every category its own ${field}.`);
        else seen[field].set(key, index + 1);
      }
    }
  });
  return { categories: data, errors };
}

// ---------------------------------------------------------------------------------------
// The whole deals/ folder

const entries = (dir) => readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

// Validates deals/categories.yml and every file under deals/<year>/.
// Returns { errors, deals, categories, years }.
export function validateTree(root, { now = Date.now() } = {}) {
  const errors = [];
  const dealsDir = join(root, "deals");
  const categoriesFile = "deals/categories.yml";
  const result = { errors, deals: 0, categories: 0, years: [] };

  if (!existsSync(join(root, categoriesFile))) {
    errors.push({ file: categoriesFile, problem: "the file is missing", fix: "Restore it from the master branch. It lists the categories and must not be deleted." });
    return result;
  }
  const checked = validateCategories(readFileSync(join(root, categoriesFile), "utf8"), { file: categoriesFile });
  errors.push(...checked.errors);
  const slugs = (checked.categories ?? []).map((category) => category?.slug).filter((slug) => typeof slug === "string");
  result.categories = slugs.length;
  const categoriesKnown = checked.categories !== null;
  const folderHelp = `The category folders are: ${slugs.join(", ")}.`;

  for (const entry of entries(dealsDir)) {
    const path = `deals/${entry.name}`;
    if (entry.isDirectory() && /^\d{4}$/.test(entry.name)) { result.years.push(entry.name); continue; }
    if (entry.name === "categories.yml" || entry.name === ".gitkeep") continue;
    const year = result.years.at(-1) ?? String(new Date(now).getFullYear());
    errors.push({
      file: path,
      problem: entry.isDirectory() ? "this folder does not belong here" : "this file is not inside a year and category folder",
      fix: entry.isDirectory()
        ? `Deals live in deals/<year>/<category>/, for example deals/${year}/${slugs[0] ?? "category"}/${suggestFileName(entry.name)}.`
        : `Move it to deals/<year>/<category>/${suggestFileName(entry.name)}. ${folderHelp}`,
    });
  }

  for (const year of result.years) {
    const seen = new Map();
    for (const entry of entries(join(dealsDir, year))) {
      const categoryPath = `deals/${year}/${entry.name}`;
      if (entry.name === ".gitkeep") continue;
      if (!entry.isDirectory()) {
        errors.push({
          file: categoryPath,
          problem: "this file is not inside a category folder",
          fix: `Move it into the folder of the best matching category: deals/${year}/<category>/${suggestFileName(entry.name)}. ${folderHelp}`,
        });
        continue;
      }
      if (categoriesKnown && !slugs.includes(entry.name)) {
        const guess = closest(entry.name, slugs);
        errors.push({
          file: categoryPath,
          problem: `"${entry.name}" is not one of the categories`,
          fix: `${guess ? `Did you mean "${guess}"? ` : ""}Move the file into an existing category folder. ${folderHelp}`,
        });
      }
      for (const item of entries(join(dealsDir, year, entry.name))) {
        const file = `${categoryPath}/${item.name}`;
        if (item.name === ".gitkeep") continue;
        if (item.isDirectory()) {
          errors.push({ file, problem: "folders inside a category are not allowed", fix: `Put the deal file directly in deals/${year}/${entry.name}/.` });
          continue;
        }
        if (!/\.ya?ml$/i.test(item.name)) {
          errors.push({ file, problem: "this is not a deal file", fix: `Delete it, or if it is your deal rename it to ${suggestFileName(item.name)}.` });
          continue;
        }
        if (!FILE_NAME.test(item.name)) {
          errors.push({
            file, field: "file name",
            problem: `"${item.name}" must use only lowercase letters, numbers and single dashes, and end in .yml`,
            fix: `Rename the file to ${suggestFileName(item.name)}`,
          });
        }
        const { deal, errors: dealErrors } = validateDeal(readFileSync(join(root, file), "utf8"), { file, year, now });
        errors.push(...dealErrors);
        result.deals++;
        if (deal && typeof deal.name === "string" && typeof deal.url === "string") {
          const key = dealKey(deal);
          if (seen.has(key)) {
            errors.push({
              file, field: "name and url",
              problem: `this is the same deal as ${seen.get(key)} (same name, same page)`,
              fix: "Each product is listed once, in its most relevant category. Delete one of the two files; to change an existing deal, edit its file.",
            });
          } else {
            seen.set(key, file);
          }
        }
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------
// Output

export function formatErrors(errors) {
  const byFile = new Map();
  for (const error of errors) {
    if (!byFile.has(error.file)) byFile.set(error.file, []);
    byFile.get(error.file).push(error);
  }
  const blocks = [];
  for (const [file, list] of byFile) {
    const lines = [file];
    for (const error of list) {
      const where = [error.line ? `line ${error.line}` : null, error.field ?? null].filter(Boolean).join(", ");
      lines.push(`  ✗ ${where ? `${where}: ` : ""}${error.problem}`);
      lines.push(`    Fix: ${error.fix}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

// GitHub Actions shows these next to the file in the pull request.
export function githubAnnotations(errors) {
  const data = (text) => String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const property = (text) => data(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return errors.map((error) => {
    const properties = [`file=${property(error.file)}`];
    if (error.line) properties.push(`line=${error.line}`);
    properties.push(`title=${property(error.field ? `Deal check: ${error.field}` : "Deal check")}`);
    const where = error.field ? `${error.field}: ` : "";
    return `::error ${properties.join(",")}::${data(`${where}${error.problem}. Fix: ${error.fix}`)}`;
  }).join("\n");
}
