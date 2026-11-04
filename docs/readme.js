const tableHeader = ["Savings", "Name", "Description", "Discount", "Code & Terms", "Valid Dates"];

function formatInline(text) {
  return text
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

// Recognize categories by their deal-table header so empty tables survive without counting prose or headers as offers.
export function parseReadme(text) {
  const sections = [];
  let current = null;
  let inDealTable = false;
  let fenced = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    if (line.startsWith("## ")) {
      current = { title: line.slice(3), deals: [] };
      inDealTable = false;
      continue;
    }
    if (!current) continue;
    if (!line.startsWith("|")) {
      inDealTable = false;
      continue;
    }

    const parts = line.split("|").slice(1, -1).map((part) => part.trim());
    if (parts.length !== tableHeader.length) continue;
    if (parts.every((part, index) => part === tableHeader[index])) {
      if (!sections.includes(current)) sections.push(current);
      inDealTable = true;
      continue;
    }
    if (!inDealTable || parts.every((part) => /^:?-{3,}:?$/.test(part))) continue;

    const [emoji, name, description, discount, terms, dates] = parts;
    if (!name) continue;
    current.deals.push({
      emoji,
      name: formatInline(name),
      description: formatInline(description),
      discount: formatInline(discount),
      terms: formatInline(terms),
      dates: formatInline(dates),
    });
  }

  return sections;
}

export function filterSections(sections, query, selectedCategory) {
  const normalizedQuery = query.trim().toLowerCase();
  return sections
    .filter((section) => selectedCategory === "all" || section.title === selectedCategory)
    .map((section) => ({
      ...section,
      deals: section.deals.filter((deal) => {
        const haystack = `${deal.name} ${deal.description} ${deal.discount} ${deal.terms} ${deal.dates}`
          .replace(/<[^>]+>/g, "")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    }))
    .filter((section) => !normalizedQuery || section.deals.length);
}
