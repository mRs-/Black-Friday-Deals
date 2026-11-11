// Turns deal data into HTML. Deal text is written by strangers, so nothing
// from a deal reaches the page without going through escapeHtml, and the only
// markup that survives is the small inline subset below. Used by the build and
// by the live preview on the submit page, so both show the same row.
import { datesLabel, isDay } from "./dates.mjs";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// Entities the README-era deals use, plus the few a maker is likely to type.
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", rarr: "\u2192", euro: "\u20ac",
  copy: "\u00a9", reg: "\u00ae", trade: "\u2122",
};

// Control characters and the bidi overrides that can reorder text on screen.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufffe\uffff]/g;

function fromCodePoint(code) {
  if (!(code > 0 && code <= 0x10ffff) || (code >= 0xd800 && code <= 0xdfff)) return "\ufffd";
  return String.fromCodePoint(code);
}

export function decodeEntities(text) {
  return String(text).replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g, (match, dec, hex, name) => {
    if (name) return Object.hasOwn(NAMED, name) ? NAMED[name] : match;
    return fromCodePoint(dec ? Number(dec) : parseInt(hex, 16));
  });
}

// Plain text for the page: entities resolved, unsafe characters dropped, then escaped.
// Decoding first is what makes "&#60;script&#62;" come out as visible text.
function text(raw) {
  return escapeHtml(decodeEntities(raw).replace(UNSAFE, " "));
}

// Absolute http(s) URL in normalised form, or null. Anything else (javascript:,
// data:, relative paths, garbage) is refused.
export function safeUrl(raw) {
  const value = decodeEntities(String(raw ?? "")).replace(UNSAFE, "").trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.href;
}

export const DEAL_LINK_REL = "noopener nofollow ugc";

// `code`, [label](url), **bold**, ~~strike~~. Nothing else is markup.
const TOKEN = /`([^`]+)`|\[([^\[\]]+)\]\(\s*((?:[^\s()]|\([^\s()]*\))+)\s*\)|\*\*(?=\S)(.+?)(?<=\S)\*\*|~~(?=\S)(.+?)(?<=\S)~~/gs;

function inline(source, allowLinks, depth) {
  if (depth > 4) return text(source);
  let html = "";
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const [whole, code, label, href, bold, strike] = match;
    html += text(source.slice(last, match.index));
    last = match.index + whole.length;
    if (code !== undefined) {
      html += `<code>${text(code)}</code>`;
    } else if (label !== undefined) {
      const url = allowLinks ? safeUrl(href) : null;
      const inner = inline(label, false, depth + 1);
      html += url ? `<a href="${escapeHtml(url)}" rel="${DEAL_LINK_REL}">${inner}</a>` : inner;
    } else if (bold !== undefined) {
      html += `<strong>${inline(bold, allowLinks, depth + 1)}</strong>`;
    } else {
      html += `<s>${inline(strike, allowLinks, depth + 1)}</s>`;
    }
  }
  return html + text(source.slice(last));
}

// Inline Markdown from a deal's description, discount or terms as safe HTML.
export function renderInline(markdown) {
  return inline(String(markdown ?? ""), true, 0);
}

// A deal's plain-text field (the name).
export function renderText(value) {
  return escapeHtml(String(value ?? "").replace(UNSAFE, " "));
}

export function dealId(category, slug) {
  return `${category}-${slug}`;
}

export function wholePercent(value) {
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : null;
}

// One row of the list. `deal` needs category, slug, name and whatever else it has.
export function dealRow(deal, { listYear, highEmoji = "" } = {}) {
  const id = dealId(deal.category, deal.slug);
  const url = safeUrl(deal.url);
  const name = renderText(deal.name);
  const percent = wholePercent(deal.percent);
  const starts = isDay(deal.starts) ? deal.starts : "";
  const ends = isDay(deal.ends) ? deal.ends : "";
  const code = String(deal.code ?? "").replace(UNSAFE, " ").trim();

  const attrs = [`class="deal"`, `id="${escapeHtml(id)}"`];
  if (percent) attrs.push(`data-percent="${percent}"`);
  if (starts) attrs.push(`data-starts="${starts}"`);
  if (ends) attrs.push(`data-ends="${ends}"`);

  const figure = percent
    ? `<span class="pct${percent >= 50 ? " pct--high" : ""}"${percent >= 50 && highEmoji ? ` title="${escapeHtml(highEmoji)} 50% or more"` : ""}>${percent}<span class="pct__sign">%</span></span>`
    : "";
  const link = url ? `<a href="${escapeHtml(url)}" rel="${DEAL_LINK_REL}">${name}</a>` : name;

  const terms = [];
  if (code) {
    terms.push(
      `<button class="code" type="button" data-code="${escapeHtml(code)}" aria-label="Copy code ${escapeHtml(code)}">` +
        escapeHtml(code) +
        `<svg class="code__icon" width="14" height="14" aria-hidden="true"><use href="#icon-copy"/></svg></button>`,
    );
  }
  if (deal.terms) terms.push(renderInline(deal.terms));
  const dates = datesLabel(starts, ends, listYear);

  return (
    `<li ${attrs.join(" ")}>` +
    `<p class="deal__pct">${figure}</p>` +
    `<div class="deal__what"><h3 class="deal__name">${link}</h3>` +
    `<p class="deal__desc">${renderInline(deal.description)}</p></div>` +
    `<div class="deal__offer"><p class="deal__discount">${renderInline(deal.discount)}</p>` +
    (terms.length ? `<p class="deal__terms">${terms.join(" ")}</p>` : "") +
    (dates ? `<p class="deal__dates">${escapeHtml(dates)}</p>` : "") +
    `</div>` +
    `<a class="deal__anchor" href="#${escapeHtml(id)}" aria-label="Link to ${name} on this list">#</a>` +
    `</li>`
  );
}
