// The list page. Every deal is already in the HTML; this adds search, the
// filters, the date status and the copy buttons, and keeps the filters in the
// address so a view can be shared.
import { copyText } from "./copy.mjs";
import { dateStatus, localDay } from "./dates.mjs";
import { fold, isFiltered, matches, readState, searchWords, writeQuery } from "./filter.mjs";

const list = document.getElementById("list");
const form = document.getElementById("tools");
const year = Number(list.dataset.year);
const total = Number(list.dataset.total);

const controls = {
  q: document.getElementById("q"),
  category: document.getElementById("category"),
  high: document.getElementById("high"),
  hideEnded: document.getElementById("hide-ended"),
};
const result = document.getElementById("result");
const resultText = document.getElementById("result-text");
const none = document.getElementById("none");
const live = document.getElementById("live");
const railLinks = [...document.querySelectorAll(".rail a")];

const today = localDay();

// Read each row once. The search text is what a visitor can read in the row:
// name, description, discount, terms and code.
const sections = [...list.querySelectorAll(".cat")].map((el) => {
  const slug = el.dataset.category;
  const rows = [...el.querySelectorAll(".deal")].map((row) => {
    const { starts = "", ends = "", percent } = row.dataset;
    const status = dateStatus(starts, ends, today, year);
    const dates = row.querySelector(".deal__dates");
    if (dates && status.label) {
      dates.textContent = status.label;
      row.classList.toggle("is-ended", status.state === "ended");
      row.classList.toggle("is-closing", /today|tomorrow/.test(status.label) && status.state === "live");
    }
    const parts = [".deal__what", ".deal__discount", ".deal__terms"].map((selector) => row.querySelector(selector)?.textContent ?? "");
    return { el: row, category: slug, percent: Number(percent) || 0, ended: status.state === "ended", text: fold(parts.join(" ")) };
  });
  return { el, slug, rows, count: el.querySelector(".cat__count"), size: rows.length };
});

const categories = sections.map((section) => section.slug);
const optionFor = new Map([...controls.category.options].map((option) => [option.value, option]));
const titleFor = new Map([...controls.category.options].map((option) => [option.value, option.textContent.replace(/\s*\(\d+\)$/, "")]));

let state = readState(location.search, categories);

function setCount(el, count) {
  if (el) el.innerHTML = `<span class="hide">, </span>${count}<span class="hide"> ${count === 1 ? "deal" : "deals"}</span>`;
}

function apply() {
  const words = searchWords(state.q);
  const filtered = isFiltered(state);
  const anyCategory = { ...state, category: "" };
  let shown = 0;
  let reachable = 0; // matches if the category filter were off: the numbers beside each category

  for (const section of sections) {
    let visible = 0;
    let possible = 0;
    for (const row of section.rows) {
      const fits = matches(row, anyCategory, words);
      const show = fits && (!state.category || state.category === section.slug);
      if (fits) possible += 1;
      if (show) visible += 1;
      row.el.hidden = !show;
    }
    shown += visible;
    reachable += possible;

    // A category without deals keeps its invitation to add one, unless a search or filter is on.
    const chosenEmpty = state.category === section.slug && !state.q && !state.high && !state.hideEnded;
    section.el.hidden = filtered && visible === 0 && !(section.size === 0 && chosenEmpty);

    setCount(section.count, filtered ? visible : section.size);
    optionFor.get(section.slug).textContent = `${titleFor.get(section.slug)} (${possible})`;
    const link = railLinks.find((a) => a.dataset.category === section.slug);
    link.querySelector(".rail__count").textContent = possible;
    link.classList.toggle("is-none", possible === 0);
  }

  optionFor.get("").textContent = `All (${reachable})`;
  for (const link of railLinks) {
    if (link.dataset.category === "") link.querySelector(".rail__count").textContent = reachable;
    link.setAttribute("aria-current", String(link.dataset.category === state.category));
  }

  const emptyCategoryShown = sections.some((section) => !section.el.hidden && section.size === 0 && state.category === section.slug);
  result.hidden = !filtered;
  resultText.textContent = filtered ? `Showing ${shown} of ${total} ${total === 1 ? "deal" : "deals"}.` : "";
  none.hidden = shown > 0 || emptyCategoryShown || !filtered;

  controls.q.value = controls.q.value.trim() === state.q ? controls.q.value : state.q;
  controls.category.value = state.category;
  controls.high.checked = state.high;
  controls.hideEnded.checked = state.hideEnded;
}

let urlTimer = 0;
function saveToAddress() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const next = location.pathname + writeQuery(state, location.search) + location.hash;
    try {
      history.replaceState(null, "", next);
    } catch {
      // Some browsers limit how often the address may change; the next change catches up.
    }
  }, 200);
}

// After a change, bring the start of the list back under the search bar.
function backToTop() {
  const stuck = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--stuck")) || 0;
  const top = list.getBoundingClientRect().top;
  if (top < stuck) window.scrollBy(0, top - stuck);
}

function change(patch) {
  state = { ...state, ...patch };
  apply();
  saveToAddress();
  backToTop();
}

controls.q.addEventListener("input", () => change({ q: controls.q.value.trim() }));
controls.category.addEventListener("change", () => change({ category: controls.category.value }));
controls.high.addEventListener("change", () => change({ high: controls.high.checked }));
controls.hideEnded.addEventListener("change", () => change({ hideEnded: controls.hideEnded.checked }));
form.addEventListener("submit", (event) => {
  event.preventDefault();
  controls.q.blur();
});

for (const link of railLinks) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const category = link.dataset.category;
    change({ category: category === state.category ? "" : category });
  });
}

function clear() {
  change({ q: "", category: "", high: false, hideEnded: false });
  controls.q.focus();
}
document.getElementById("clear").addEventListener("click", clear);
document.getElementById("clear-none").addEventListener("click", clear);

window.addEventListener("popstate", () => {
  state = readState(location.search, categories);
  apply();
});

// "/" jumps to the search field, as on GitHub.
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest("input, select, textarea, [contenteditable]")) return;
  event.preventDefault();
  controls.q.focus();
  controls.q.select();
});

list.addEventListener("click", async (event) => {
  const button = event.target.closest(".code");
  if (!button) return;
  const code = button.dataset.code;
  const copied = await copyText(code);
  live.textContent = copied ? `Code ${code} copied.` : `Could not copy. The code is ${code}.`;
  if (!copied) return;
  const icon = button.querySelector("use");
  button.classList.add("is-copied");
  icon.setAttribute("href", "#icon-done");
  clearTimeout(button.timer);
  button.timer = setTimeout(() => {
    button.classList.remove("is-copied");
    icon.setAttribute("href", "#icon-copy");
  }, 1600);
});

// The build time in the visitor's own time zone.
const built = document.getElementById("built");
const builtAt = new Date(built.dateTime);
if (!Number.isNaN(builtAt.getTime())) {
  built.title = built.textContent;
  built.textContent = new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(builtAt.getFullYear() === year ? {} : { year: "numeric" }),
  }).format(builtAt);
}

apply();
document.documentElement.classList.add("is-ready");
