// Deal dates are plain calendar days ("2026-11-27") with no time zone. A deal
// that ends on a day is still live for the whole of that day, wherever the
// visitor is. Used by the build (static labels) and in the browser (status).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDay(value) {
  const m = typeof value === "string" && value.match(DAY);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

// "2026-11-27" -> "Nov 27". The year is added only when it is not the list's year.
export function formatDay(day, listYear) {
  const [, y, mo, d] = day.match(DAY);
  const text = `${MONTHS[Number(mo) - 1]} ${Number(d)}`;
  return listYear && Number(y) !== Number(listYear) ? `${text}, ${y}` : text;
}

// The visitor's own calendar day as "YYYY-MM-DD".
export function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(day, count) {
  const [, y, mo, d] = day.match(DAY);
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + count)).toISOString().slice(0, 10);
}

// Label that needs no clock, written into the HTML at build time.
export function datesLabel(starts, ends, listYear) {
  if (starts && ends) return `${formatDay(starts, listYear)} to ${formatDay(ends, listYear)}`;
  if (ends) return `Until ${formatDay(ends, listYear)}`;
  if (starts) return `From ${formatDay(starts, listYear)}`;
  return "";
}

// Where a deal stands today. state: "upcoming" | "live" | "ended" | null (no dates).
export function dateStatus(starts, ends, today, listYear) {
  if (!starts && !ends) return { state: null, label: "" };
  const day = (value) => formatDay(value, listYear);
  if (ends && today > ends) return { state: "ended", label: `Ended ${day(ends)}` };
  if (starts && today < starts) {
    const begins = starts === addDays(today, 1) ? "Starts tomorrow" : `Starts ${day(starts)}`;
    return { state: "upcoming", label: ends ? `${begins}, ends ${day(ends)}` : begins };
  }
  if (!ends) return { state: "live", label: `Started ${day(starts)}` };
  if (ends === today) return { state: "live", label: "Ends today" };
  if (ends === addDays(today, 1)) return { state: "live", label: "Ends tomorrow" };
  return { state: "live", label: `Ends ${day(ends)}` };
}
