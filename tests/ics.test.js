import { test } from "node:test";
import assert from "node:assert/strict";
import { buildICS, icsText, foldLine } from "../js/ics.js";
import { defaultState } from "../js/schema.js";
import { templateMcJayy } from "../js/storage.js";

const NOW = new Date(2026, 9, 3, 10, 0); // Sat 3 Oct 2026 → first Monday is 5 Oct
const enc = new TextEncoder();

function stateWith(blocks, cats = []) {
  const s = defaultState();
  s.categories = cats;
  s.blocks = blocks;
  return s;
}
const B = (over) => ({ id: "b1", day: "MON", start: 990, end: 1170, title: "CSC 401", kind: "study", cat: null, ...over });

// Undo folding and split into logical lines.
const unfold = ics => ics.replace(/\r\n /g, "").split("\r\n");
const field = (ics, name) => unfold(ics).filter(l => l.startsWith(name + ":")).map(l => l.slice(name.length + 1));

test("escaping strips CR/LF and controls and escapes \\ ; ,", () => {
  assert.equal(icsText("Line1\nLine2, a;b\\c"), "Line1 Line2\\, a\\;b\\\\c");
  assert.equal(icsText("a\r\nb\rc\u0000d\u0007e\u{2028}f"), "a b cdef");
  assert.equal(icsText("<img src=x onerror=alert(1)>"), "<img src=x onerror=alert(1)>");
});

test("a hostile title cannot break out of its field", () => {
  const title = "Line1\nLine2, a;b\\c\r\nEND:VEVENT\nBEGIN:VEVENT";
  const ics = buildICS(stateWith([B({ title })]), NOW);
  const lines = unfold(ics);
  assert.equal(lines.filter(l => l === "BEGIN:VEVENT").length, 1);
  assert.equal(lines.filter(l => l === "END:VEVENT").length, 1);
  assert.deepEqual(field(ics, "SUMMARY"), ["Line1 Line2\\, a\\;b\\\\c END:VEVENT BEGIN:VEVENT"]);
  // only CRLF line breaks anywhere
  assert.equal(/[^\r]\n|\r[^\n]/.test(ics), false);
});

test("every physical line is at most 75 octets, emoji never split", () => {
  const title = "📚🔥 Revise ".repeat(12).slice(0, 60);
  const ics = buildICS(stateWith([B({ title })]), NOW);
  for (const line of ics.split("\r\n")) {
    assert.ok(enc.encode(line).length <= 75, `${enc.encode(line).length}: ${line}`);
    assert.equal(line.includes("�"), false);
  }
  assert.deepEqual(field(ics, "SUMMARY"), [icsText(title)]);
});

test("foldLine edge cases", () => {
  assert.equal(foldLine("x".repeat(75)), "x".repeat(75));
  assert.equal(foldLine("x".repeat(76)), "x".repeat(75) + "\r\n x");
  const s = "é".repeat(40); // 80 octets, 2 each
  const parts = foldLine(s).split("\r\n");
  assert.equal(parts[0], "é".repeat(37)); // 74 octets: one more would be 76
  assert.equal(parts[1], " " + "é".repeat(3));
});

test("floating local times, weekly, with after-midnight blocks on the next date", () => {
  const ics = buildICS(stateWith([
    B({ id: "a", day: "MON", start: 990, end: 1170 }),
    B({ id: "b", day: "MON", start: 1440, end: 1620 }),   // 12:00am–3:00am Tue
    B({ id: "c", day: "SUN", start: 1530, end: 1560 }),   // 1:30am the following Monday
  ]), NOW);
  assert.deepEqual(field(ics, "DTSTART"), ["20261005T163000", "20261006T000000", "20261012T013000"]);
  assert.deepEqual(field(ics, "DTEND"), ["20261005T193000", "20261006T030000", "20261012T020000"]);
  assert.equal(field(ics, "RRULE").every(r => r === "FREQ=WEEKLY"), true);
  assert.equal(/DTSTART:[0-9T]+Z/.test(ics), false);
  assert.match(field(ics, "DTSTAMP")[0], /^\d{8}T\d{6}Z$/); // DTSTAMP must be UTC
});

test("starts today if today is Monday", () => {
  const ics = buildICS(stateWith([B()]), new Date(2026, 9, 5, 9));
  assert.deepEqual(field(ics, "DTSTART"), ["20261005T163000"]);
});

test("UIDs come from code, are unique and stable", () => {
  const evil = "x\r\nUID:evil@attacker";
  const s = stateWith([B({ id: "a", title: evil }), B({ id: "b", day: "TUE" })]);
  const uids = field(buildICS(s, NOW), "UID");
  assert.equal(uids.length, 2);
  assert.notEqual(uids[0], uids[1]);
  for (const u of uids) assert.match(u, /^[0-9a-f]{8}-\d+@stick-tracker$/);
  assert.deepEqual(field(buildICS(s, new Date(2026, 9, 10)), "UID"), uids);
});

test("alarms use the lead time and skip rest blocks; categories label study", () => {
  const s = stateWith([
    B({ id: "a", cat: "u" }),
    B({ id: "n", start: 600, end: 700, kind: "nap", title: "Nap" }),
    B({ id: "r", start: 1600, end: 1650, kind: "rest", title: "Wind down" }),
  ], [{ id: "u", name: "Uni, year 4; CS", color: 0 }]);
  s.settings.lead = 15;
  const ics = buildICS(s, NOW);
  assert.equal(unfold(ics).filter(l => l === "BEGIN:VALARM").length, 2);
  assert.deepEqual(field(ics, "TRIGGER"), ["-PT15M", "-PT15M"]);
  assert.deepEqual(field(ics, "DESCRIPTION").slice(0, 2), ["Uni\\, year 4\\; CS", "CSC 401 in 15 minutes"]);
});

test("empty and full schedules produce well-formed calendars", () => {
  const empty = unfold(buildICS(defaultState(), NOW));
  assert.deepEqual(empty.slice(0, 2), ["BEGIN:VCALENDAR", "VERSION:2.0"]);
  assert.equal(empty.at(-2), "END:VCALENDAR");
  assert.equal(empty.at(-1), "");
  const full = unfold(buildICS(templateMcJayy(), NOW));
  assert.equal(full.filter(l => l === "BEGIN:VEVENT").length, 55);
  assert.equal(full.filter(l => l === "BEGIN:VALARM").length, 48); // 55 minus 7 rest
});
