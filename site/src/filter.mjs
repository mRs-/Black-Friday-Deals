// The list's filters as plain data: what the query string says, and whether a
// deal passes. Kept free of the DOM so it can be tested.

export const EMPTY = Object.freeze({ q: "", category: "", high: false, hideEnded: false });

// "?q=proxyman&category=development-software&min=50&ended=hide" -> state
export function readState(search, categories = []) {
  const params = new URLSearchParams(search);
  const category = params.get("category") ?? "";
  return {
    q: (params.get("q") ?? "").trim(),
    category: categories.includes(category) ? category : "",
    high: params.get("min") === "50",
    hideEnded: params.get("ended") === "hide",
  };
}

// state -> "?q=..." (or "" when nothing is filtered), keeping any parameters it does not own.
export function writeQuery(state, search = "") {
  const params = new URLSearchParams(search);
  for (const key of ["q", "category", "min", "ended"]) params.delete(key);
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.category) params.set("category", state.category);
  if (state.high) params.set("min", "50");
  if (state.hideEnded) params.set("ended", "hide");
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function isFiltered(state) {
  return Boolean(state.q.trim() || state.category || state.high || state.hideEnded);
}

// Lower case, accents removed, so "cafe" finds "Café".
export function fold(text) {
  return String(text ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function searchWords(q) {
  return fold(q).split(/\s+/).filter(Boolean);
}

// row: { text (already folded), category, percent, ended }
export function matches(row, state, words = searchWords(state.q)) {
  if (state.category && row.category !== state.category) return false;
  if (state.high && !(row.percent >= 50)) return false;
  if (state.hideEnded && row.ended) return false;
  return words.every((word) => row.text.includes(word));
}
