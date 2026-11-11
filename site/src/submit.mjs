// The submit page: turns the form into a deal file as the maker types, shows
// the row and the YAML, and hands both to GitHub's "new file" page.
import { copyText } from "./copy.mjs";
import { FIELDS, LABELS, dealPath, dealYaml, editFileUrl, newFileUrl, percentFromDiscount, readDeal, validateDeal } from "./deal.mjs";
import { dateStatus, isDay, localDay } from "./dates.mjs";
import { dealRow } from "./render.mjs";

const form = document.getElementById("deal-form");
const config = { repo: form.dataset.repo, branch: form.dataset.branch, year: Number(form.dataset.year) };
const inputs = Object.fromEntries(FIELDS.map((name) => [name, form.elements[name]]));
const categories = [...inputs.category.options].map((option) => option.value).filter(Boolean);
const listed = new Map(Object.entries(JSON.parse(document.getElementById("listed").textContent)));

const preview = document.getElementById("preview");
const path = document.getElementById("path");
const yaml = document.getElementById("yaml");
const status = document.getElementById("status");
const propose = document.getElementById("propose");
const copyButton = document.getElementById("copy-yaml");
const fallbackHref = propose.href;
const percentHint = document.getElementById("h-percent");
const percentHintText = percentHint.textContent;

const DRAFT = "deal-draft";
const touched = new Set(); // fields the maker has left, so their errors may show
let attempted = false; // a button was pressed: show every error
let percentByHand = false;
let current = { deal: readDeal({}), problems: [] };

const values = () => Object.fromEntries(FIELDS.map((name) => [name, inputs[name].value]));

function list(words) {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function showErrors(problems) {
  for (const name of FIELDS) {
    const problem = problems.find((p) => p.field === name);
    const visible = problem && (attempted || touched.has(name) || problem.existing);
    const error = document.getElementById(`e-${name}`);
    error.hidden = !visible;
    error.textContent = visible ? problem.message : "";
    if (visible && problem.existing) {
      const link = document.createElement("a");
      link.href = editFileUrl(problem.existing, config);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = `Open ${problem.existing}.yml on GitHub`;
      error.append(" ", link, ".");
    }
    if (visible) inputs[name].setAttribute("aria-invalid", "true");
    else inputs[name].removeAttribute("aria-invalid");
  }
}

function showPath(deal) {
  const part = (value, stand) => {
    const span = document.createElement("span");
    span.textContent = value || stand;
    if (!value) span.className = "todo";
    return span;
  };
  path.replaceChildren(`deals/${config.year}/`, part(deal.category, "category"), "/", part(deal.slug, "product-name"), ".yml");
}

function update() {
  const deal = readDeal(values());
  const problems = validateDeal(deal, { categories, listed, year: config.year });
  current = { deal, problems };

  showErrors(problems);
  showPath(deal);

  const started = FIELDS.some((name) => name !== "category" && deal[name] !== "");
  const text = dealYaml(deal);
  yaml.classList.toggle("is-blank", !started);
  yaml.textContent = started ? text : "The file fills in as you type.";

  preview.innerHTML = deal.name
    ? dealRow({ ...deal, category: deal.category || "category", slug: deal.slug || "deal" }, { listYear: config.year })
    : `<li class="deals__blank">Your deal shows here the way it will read on the list.</li>`;
  for (const control of preview.querySelectorAll("a, button")) control.tabIndex = -1;
  // The same date status the list shows today.
  const dates = preview.querySelector(".deal__dates");
  if (dates) dates.textContent = dateStatus(isDay(deal.starts) ? deal.starts : "", isDay(deal.ends) ? deal.ends : "", localDay(), config.year).label;

  const missing = problems.filter((p) => p.missing).map((p) => LABELS[p.field]);
  const wrong = [...new Set(problems.filter((p) => !p.missing).map((p) => LABELS[p.field]))];
  const parts = [];
  if (missing.length) parts.push(`Still missing: ${list(missing)}.`);
  if (wrong.length) parts.push(`Needs a fix: ${list(wrong)}.`);
  status.textContent = parts.length ? parts.join(" ") : "Ready. GitHub opens with this file filled in.";

  propose.href = problems.length ? fallbackHref : newFileUrl(deal, config);
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({ values: values(), percentByHand }));
  } catch {
    // Private windows may refuse storage; the form works without the draft.
  }
}

// Shows every error and moves to the first field that needs attention.
function ready() {
  attempted = true;
  update();
  const first = current.problems[0];
  if (!first) return true;
  inputs[first.field].focus();
  return false;
}

form.addEventListener("input", (event) => {
  const name = event.target.name;
  if (name === "percent") percentByHand = true;
  if (name === "discount" && !percentByHand) {
    const guess = percentFromDiscount(inputs.discount.value);
    inputs.percent.value = guess ?? "";
    percentHint.textContent = guess ? "Taken from the discount. Change or clear it if it is wrong." : percentHintText;
  }
  if (name === "percent") percentHint.textContent = percentHintText;
  update();
});

form.addEventListener("focusout", (event) => {
  if (event.target.name && FIELDS.includes(event.target.name)) {
    touched.add(event.target.name);
    update();
  }
});

// Enter in a one-line field does what the main button does.
form.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing || !event.target.matches("input")) return;
  event.preventDefault();
  propose.click();
});
form.addEventListener("submit", (event) => event.preventDefault());

propose.addEventListener("click", (event) => {
  if (!ready()) event.preventDefault();
});

copyButton.addEventListener("click", async () => {
  if (!ready()) return;
  const copied = await copyText(dealYaml(current.deal));
  status.textContent = copied
    ? `YAML copied. Save it as ${dealPath(current.deal, config.year)}.`
    : "Could not copy. Select the YAML above and copy it by hand.";
});

document.getElementById("clear-form").addEventListener("click", () => {
  for (const name of FIELDS) inputs[name].value = "";
  touched.clear();
  attempted = false;
  percentByHand = false;
  percentHint.textContent = percentHintText;
  update();
  inputs.name.focus();
});

// Start from the address (?category=books, or any field), then from an unfinished draft.
let draft = {};
try {
  draft = JSON.parse(sessionStorage.getItem(DRAFT) ?? "{}") ?? {};
} catch {
  draft = {};
}
const params = new URLSearchParams(location.search);
for (const name of FIELDS) {
  const value = params.get(name) ?? draft.values?.[name];
  if (value !== undefined && value !== null) inputs[name].value = value;
}
percentByHand = Boolean(draft.percentByHand) || params.has("percent");

update();
document.documentElement.classList.add("is-ready");
