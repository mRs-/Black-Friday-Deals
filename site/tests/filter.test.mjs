// The list's filters and date status, without a browser.
import assert from "node:assert/strict";
import test from "node:test";
import { addDays, dateStatus, datesLabel, formatDay, isDay, localDay } from "../src/dates.mjs";
import { EMPTY, fold, isFiltered, matches, readState, searchWords, writeQuery } from "../src/filter.mjs";

const categories = ["development-software", "utility-software"];

test("the query string and the filter state convert both ways", () => {
  const cases = [
    ["", EMPTY],
    ["?q=proxyman&category=development-software", { q: "proxyman", category: "development-software", high: false, hideEnded: false }],
    ["?q=time+tracking&min=50&ended=hide", { q: "time tracking", category: "", high: true, hideEnded: true }],
    ["?category=utility-software&min=50", { q: "", category: "utility-software", high: true, hideEnded: false }],
  ];
  for (const [query, state] of cases) {
    assert.deepEqual(readState(query, categories), state, query);
    assert.equal(writeQuery(state), query);
    assert.deepEqual(readState(writeQuery(state), categories), state);
  }
});

test("unknown values in the address are ignored, other parameters are kept", () => {
  assert.deepEqual(readState("?category=nope&min=10&ended=1&q=%20", categories), EMPTY);
  assert.equal(writeQuery({ ...EMPTY, q: " git " }, "?utm_source=x&q=old"), "?utm_source=x&q=git");
  assert.equal(writeQuery(EMPTY, "?q=old&category=x&min=50&ended=hide"), "");
  assert.equal(isFiltered(EMPTY), false);
  assert.equal(isFiltered({ ...EMPTY, hideEnded: true }), true);
  const special = { ...EMPTY, q: `50% & "more" #1` };
  assert.deepEqual(readState(writeQuery(special), categories), special);
});

test("search matches every word, ignoring case and accents", () => {
  const row = { text: fold("Proxyman Capture HTTP traffic 30% off all plans BF2026 Café"), category: "development-software", percent: 30, ended: false };
  const hit = (q, extra = {}) => matches(row, { ...EMPTY, q, ...extra });
  assert.ok(hit(""));
  assert.ok(hit("proxy"));
  assert.ok(hit("HTTP  proxyman"));
  assert.ok(hit("bf2026"));
  assert.ok(hit("cafe"));
  assert.ok(!hit("proxyman charles"));
  assert.ok(hit("", { category: "development-software" }));
  assert.ok(!hit("", { category: "utility-software" }));
  assert.ok(!hit("", { high: true }));
  assert.ok(matches({ ...row, percent: 50 }, { ...EMPTY, high: true }));
  assert.ok(!matches({ ...row, percent: 0 }, { ...EMPTY, high: true }));
  assert.ok(hit("", { hideEnded: true }));
  assert.ok(!matches({ ...row, ended: true }, { ...EMPTY, hideEnded: true }));
  assert.deepEqual(searchWords("  Über  Café "), ["uber", "cafe"]);
});

test("days are formatted without a time zone", () => {
  assert.equal(formatDay("2026-11-27"), "Nov 27");
  assert.equal(formatDay("2026-12-03", 2026), "Dec 3");
  assert.equal(formatDay("2027-01-05", 2026), "Jan 5, 2027");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(localDay(new Date(2026, 10, 9, 23, 59)), "2026-11-09");
  assert.ok(isDay("2026-11-27"));
  for (const bad of ["2026-02-30", "2026-13-01", "27.11.2026", "2026-11-27T00:00", "", null, 20261127]) assert.ok(!isDay(bad), String(bad));
});

test("the label written at build time needs no clock", () => {
  assert.equal(datesLabel("2026-11-16", "2026-12-03", 2026), "Nov 16 to Dec 3");
  assert.equal(datesLabel("", "2026-12-03", 2026), "Until Dec 3");
  assert.equal(datesLabel("2026-11-16", "", 2026), "From Nov 16");
  assert.equal(datesLabel("", "", 2026), "");
});

test("the status follows today's date", () => {
  const status = (today, starts = "2026-11-27", ends = "2026-11-30") => dateStatus(starts, ends, today, 2026);
  assert.deepEqual(status("2026-11-20"), { state: "upcoming", label: "Starts Nov 27, ends Nov 30" });
  assert.deepEqual(status("2026-11-26"), { state: "upcoming", label: "Starts tomorrow, ends Nov 30" });
  assert.deepEqual(status("2026-11-27"), { state: "live", label: "Ends Nov 30" });
  assert.deepEqual(status("2026-11-29"), { state: "live", label: "Ends tomorrow" });
  assert.deepEqual(status("2026-11-30"), { state: "live", label: "Ends today" });
  assert.deepEqual(status("2026-12-01"), { state: "ended", label: "Ended Nov 30" });
  assert.deepEqual(status("2026-11-20", "", "2026-11-30"), { state: "live", label: "Ends Nov 30" });
  assert.deepEqual(status("2026-12-01", "", "2026-11-30"), { state: "ended", label: "Ended Nov 30" });
  assert.deepEqual(status("2026-11-20", "2026-11-27", ""), { state: "upcoming", label: "Starts Nov 27" });
  assert.deepEqual(status("2026-12-24", "2026-11-27", ""), { state: "live", label: "Started Nov 27" });
  assert.deepEqual(status("2026-11-20", "", ""), { state: null, label: "" });
});
