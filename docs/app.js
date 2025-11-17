const resultsEl = document.getElementById("results");
const searchInput = document.getElementById("searchInput");
const categoryFilter = document.getElementById("categoryFilter");
const dealsCountEl = document.getElementById("dealsCount");
const categoryCountEl = document.getElementById("categoryCount");
const lastUpdatedEl = document.getElementById("lastUpdated");
const repoLinkEl = document.getElementById("repoLink");
const bodyDataset = document.body.dataset;
const defaultBranch = bodyDataset.defaultBranch || "master";

let allSections = [];

function getRepoInfo() {
  if (bodyDataset.repoOwner && bodyDataset.repoName) {
    return { owner: bodyDataset.repoOwner, repo: bodyDataset.repoName };
  }

  const { hostname, pathname } = window.location;

  if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) {
    const segments = pathname.split("/").filter(Boolean);
    const repo = segments[0] || "Black-Friday-Deals";
    return { owner: "local", repo };
  }

  if (hostname.endsWith("github.io")) {
    const owner = hostname.replace(".github.io", "");
    const pathSegments = pathname.split("/").filter(Boolean);
    const repo = pathSegments[0] || owner;
    return { owner, repo };
  }

  return null;
}

async function fetchReadme() {
  const repoInfo = getRepoInfo();
  const candidates = [];

  if (repoInfo && repoInfo.owner !== "local") {
    candidates.push(
      `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${defaultBranch}/README.md`
    );
  }

  candidates.push("../README.md", "README.md");

  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const text = await response.text();
      return { text, source: url };
    } catch (error) {
      console.warn("Failed to load", url, error);
    }
  }

  throw new Error("Unable to fetch README.md");
}

function markdownLinkToHtml(text) {
  return text.replace(/\[(.+?)\]\((.+?)\)/g, (_, label, href) => {
    return `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
  });
}

function formatInline(text) {
  const formatted = markdownLinkToHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
  return formatted;
}

function parseReadme(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      if (current) {
        sections.push(current);
      }
      current = {
        title: line.replace(/^##\s+/, ""),
        deals: [],
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("|")) {
      if (line.includes("--")) continue;
      const parts = line.split("|").slice(1, -1).map((part) => part.trim());
      if (parts.length < 4) continue;
      const [emoji, name, description, ...discountParts] = parts;
      const discount = discountParts.join(" | ");
      current.deals.push({
        emoji,
        name: formatInline(name),
        description: formatInline(description),
        discount: formatInline(discount),
      });
      continue;
    }

    if (line.startsWith("⬆️")) {
      if (current && current.deals.length) {
        sections.push(current);
      }
      current = null;
    }
  }

  if (current && current.deals.length) {
    sections.push(current);
  }

  return sections;
}

function renderSections(sections) {
  resultsEl.innerHTML = "";

  if (!sections.length) {
    resultsEl.innerHTML = `
      <div class="empty-state">
        <p>No deals match your filters yet.</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  sections.forEach((section) => {
    const card = document.createElement("article");
    card.className = "category-card";
    card.innerHTML = `
      <h2>${section.title}</h2>
      <div class="deals-grid">
        ${section.deals
          .map(
            (deal) => `
              <div class="deal">
                <span class="deal__emoji" aria-hidden="true">${deal.emoji}</span>
                <div class="deal__name">${deal.name}</div>
                <p class="deal__description">${deal.description}</p>
                <p class="deal__discount">${deal.discount}</p>
              </div>
            `
          )
          .join("")}
      </div>
    `;
    fragment.appendChild(card);
  });

  resultsEl.appendChild(fragment);
}

function populateCategoryFilter(sections) {
  const uniqueTitles = sections.map((section) => section.title);
  categoryFilter.innerHTML = '<option value="all">All categories</option>';
  uniqueTitles.forEach((title) => {
    const option = document.createElement("option");
    option.value = title;
    option.textContent = title;
    categoryFilter.appendChild(option);
  });
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedCategory = categoryFilter.value;

  const filtered = allSections
    .map((section) => {
      if (selectedCategory !== "all" && section.title !== selectedCategory) {
        return { ...section, deals: [] };
      }
      const deals = section.deals.filter((deal) => {
        if (!query) return true;
        const haystack = `${deal.name} ${deal.description} ${deal.discount}`
          .replace(/<[^>]+>/g, "")
          .toLowerCase();
        return haystack.includes(query);
      });
      return { ...section, deals };
    })
    .filter((section) => section.deals.length);

  renderSections(filtered);
  const totalDeals = filtered.reduce((sum, section) => sum + section.deals.length, 0);
  dealsCountEl.textContent = totalDeals.toString();
}

async function init() {
  try {
    const { text, source } = await fetchReadme();
    const sections = parseReadme(text);
    allSections = sections;
    populateCategoryFilter(sections);
    renderSections(sections);
    dealsCountEl.textContent = sections
      .reduce((sum, section) => sum + section.deals.length, 0)
      .toString();
    categoryCountEl.textContent = sections.length.toString();
    lastUpdatedEl.textContent = `Source: ${source}`;

    const repoInfo = getRepoInfo();
    if (repoInfo && repoInfo.owner !== "local") {
      repoLinkEl.href = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`;
      repoLinkEl.textContent = `${repoInfo.owner}/${repoInfo.repo}`;
    }
  } catch (error) {
    console.error(error);
    resultsEl.innerHTML = `
      <div class="empty-state">
        <p>We couldn't load the README. Please refresh the page.</p>
      </div>
    `;
    lastUpdatedEl.textContent = "Unable to load README.md";
  }
}

searchInput.addEventListener("input", () => applyFilters());
categoryFilter.addEventListener("change", () => applyFilters());

init();
