import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDays, parseTimeRange, parseQuickAdd, parseCSV, parseICS, parseTimetable, previewImport, IMPORT_LIMITS } from "../js/importers.js";
import { defaultState, validate } from "../js/schema.js";

const XSS = "<img src=x onerror=alert(1)>";
const rows = r => r.rows.map(x => [x.day, x.start, x.end, x.title, x.kind]);
const lines = (...ls) => ls.join("\r\n");

// ---------- building blocks ----------

test("days: names, lists, ranges, groups", () => {
  assert.deepEqual(parseDays("Mon").days, ["MON"]);
  assert.deepEqual(parseDays("Tue/Thu").days, ["TUE", "THU"]);
  assert.deepEqual(parseDays("Thursday & tuesday").days, ["TUE", "THU"]);
  assert.deepEqual(parseDays("Mon-Wed").days, ["MON", "TUE", "WED"]);
  assert.deepEqual(parseDays("Fri-Mon").days, ["MON", "FRI", "SAT", "SUN"]);
  assert.deepEqual(parseDays("weekdays").days, ["MON", "TUE", "WED", "THU", "FRI"]);
  assert.deepEqual(parseDays("every day").days.length, 7);
  assert.equal(parseDays("Funday").bad, "funday");
});

test("days: JavaScript built-in names are just unknown words", () => {
  for (const w of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(parseDays(w).bad, w.toLowerCase(), w);
    assert.deepEqual(parseDays(w).days, []);
  }
});

test("time ranges: 24 h, am/pm, shared suffix, dots", () => {
  assert.deepEqual(parseTimeRange("9:30", "11:30"), { start: "09:30", end: "11:30" });
  assert.deepEqual(parseTimeRange("2pm", "4pm"), { start: "14:00", end: "16:00" });
  assert.deepEqual(parseTimeRange("2", "4pm"), { start: "14:00", end: "16:00" });
  assert.deepEqual(parseTimeRange("11", "1pm"), { start: "11:00", end: "13:00" });
  assert.deepEqual(parseTimeRange("12pm", "1pm"), { start: "12:00", end: "13:00" });
  assert.deepEqual(parseTimeRange("12am", "1am"), { start: "00:00", end: "01:00" });
  assert.deepEqual(parseTimeRange("9.30", "10.45"), { start: "09:30", end: "10:45" });
  assert.deepEqual(parseTimeRange("0930", "1130"), { start: "09:30", end: "11:30" });
  assert.deepEqual(parseTimeRange("23:00", "01:00"), { start: "23:00", end: "01:00" });
  for (const [a, b] of [["25:00", "26:00"], ["9:75", "10"], ["13pm", "2pm"], ["x", "10"], ["", "10"]]) assert.equal(parseTimeRange(a, b), null, `${a}-${b}`);
});

// ---------- quick-add ----------

test("quick-add: the documented formats", () => {
  const r = parseQuickAdd(lines(
    "Mon 9:30-11:30 CSC 415",
    "Tue/Thu 2pm-4pm CSC 401 Lab [lab]",
    "Wed 14:00–16:00 Lab",
    "  # a comment",
    "",
    "weekdays 8 to 9 Gym [study]",
    "Fri 10-11 Nap time [nap]",
  ));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(rows(r).slice(0, 4), [
    ["MON", "09:30", "11:30", "CSC 415", "lecture"],
    ["TUE", "14:00", "16:00", "CSC 401 Lab", "lecture"],
    ["THU", "14:00", "16:00", "CSC 401 Lab", "lecture"],
    ["WED", "14:00", "16:00", "Lab", "lecture"],
  ]);
  assert.equal(r.rows.filter(x => x.title === "Gym" && x.kind === "study").length, 5);
  assert.deepEqual(rows(r).at(-1), ["FRI", "10:00", "11:00", "Nap time", "nap"]);
});

test("quick-add: errors name the line and the problem", () => {
  const r = parseQuickAdd(lines("Mon 9:30-11:30 OK", "Funday 9-10 X", "Mon CSC 9-10", "Wed 25:00-26:00 X", "Fri 9-10", "no times here", "9-10 X"));
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.errors.map(e => [e.line, e.message]), [
    [2, `"funday" isn't a day.`],
    [3, `"csc" isn't a day.`],
    [4, `"25:00-26:00" isn't a valid time range.`],
    [5, "missing the course name."],
    [6, `no time range found (try "Mon 9:30-11:30 CSC 415").`],
    [7, "which day? Start the line with a day, e.g. Mon."],
  ]);
});

test("quick-add: hostile text stays plain, huge input is refused", () => {
  const r = parseQuickAdd(`Mon 9-10 ${XSS}\nTue 9-10 ${"A".repeat(500)}\nWed 9-10 a\u0000b‮c`);
  assert.equal(r.rows[0].title, XSS);
  assert.equal(r.rows[1].title.length, 60);
  assert.equal(r.rows[2].title, "ab‮c", "control chars removed; other text kept as plain text");
  assert.match(parseQuickAdd("x".repeat(IMPORT_LIMITS.bytes + 1)).errors[0].message, /too much/);
  assert.match(parseQuickAdd("Mon 9-10 " + "x".repeat(3000)).errors[0].message, /too long/);
  assert.equal(parseQuickAdd(null).rows.length, 0);
  const many = Array.from({ length: 400 }, (_, i) => `Mon ${String(i % 24).padStart(2, "0")}:00-${String(i % 24).padStart(2, "0")}:30 C${i}`).join("\n");
  const big = parseQuickAdd(many);
  assert.equal(big.rows.length, IMPORT_LIMITS.rows);
  assert.ok(big.notes.some(n => /first 300/.test(n)));
});

test("quick-add: repeated lines are merged", () => {
  const r = parseQuickAdd("Mon 9-10 CSC\nMon 9-10 csc\nMon 9-10 CSC");
  assert.equal(r.rows.length, 1);
  assert.match(r.notes[0], /2 repeated copies were merged/);
});

// ---------- CSV ----------

test("CSV with a header, any column order, quotes and commas", () => {
  const r = parseCSV(lines("Course,Day,Start,End,Type", `"CSC 415, room 3",Mon,09:30,11:30,lecture`, `"He said ""hi""",Wed,9am,11am,study`, ",,,,"));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(rows(r), [
    ["MON", "09:30", "11:30", "CSC 415, room 3", "lecture"],
    ["WED", "09:00", "11:00", `He said "hi"`, "study"],
  ]);
});

test("CSV without a header, semicolons, tabs, a single time column", () => {
  assert.deepEqual(rows(parseCSV("Mon;9:30;11:30;CSC 415\nTue/Thu;14:00;16:00;CSC 401;lab")), [
    ["MON", "09:30", "11:30", "CSC 415", "lecture"], ["TUE", "14:00", "16:00", "CSC 401", "lecture"], ["THU", "14:00", "16:00", "CSC 401", "lecture"],
  ]);
  assert.deepEqual(rows(parseCSV("Mon\t9:30-11:30\tCSC 415")), [["MON", "09:30", "11:30", "CSC 415", "lecture"]]);
  assert.deepEqual(rows(parseCSV("day,time,subject\nFri,2-4pm,Stats")), [["FRI", "14:00", "16:00", "Stats", "lecture"]]);
});

test("CSV: bad rows are reported, hostile cells stay plain", () => {
  const r = parseCSV(lines("day,start,end,title", "Mon,9,10," + XSS, "Nope,9,10,X", "Mon,25:00,26:00,X", "Mon", `Tue,9,10,"=HYPERLINK(""http://evil"")"`, `__proto__,9,10,X`));
  assert.equal(r.rows[0].title, XSS);
  assert.equal(r.rows[1].title, `=HYPERLINK("http://evil")`); // we never export CSV, so formulas are just text
  assert.deepEqual(r.errors.map(e => e.line), [3, 4, 5, 7]);
  assert.equal({}.polluted, undefined);
  // an unclosed quote doesn't hang or crash
  assert.doesNotThrow(() => parseCSV(`day,start,end,title\nMon,9,10,"never closed${"x".repeat(10000)}`));
});

// ---------- .ics ----------

const cal = (...body) => lines("BEGIN:VCALENDAR", "VERSION:2.0", ...body, "END:VCALENDAR");
const ev = (...props) => ["BEGIN:VEVENT", ...props, "END:VEVENT"];

test(".ics: weekly classes with BYDAY, escaped and folded titles", () => {
  const r = parseICS(cal(
    ...ev("SUMMARY:CSC 415\\, Room 3\\; L1", "DTSTART:20261005T093000", "DTEND:20261005T113000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE"),
    // RFC 5545 unfolding removes the line break plus ONE space, so a folded
    // "long course" continues with two spaces.
    ...ev("SUMMARY:A very long", "  course name that was folded", "DTSTART;TZID=Africa/Accra:20261006T140000", "DURATION:PT1H30M"),
  ));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(rows(r), [
    ["MON", "09:30", "11:30", "CSC 415, Room 3; L1", "lecture"],
    ["WED", "09:30", "11:30", "CSC 415, Room 3; L1", "lecture"],
    ["TUE", "14:00", "15:30", "A very long course name that was folded", "lecture"],
  ]);
});

test(".ics: UTC times are converted to this device's local time", () => {
  const r = parseICS(cal(...ev("SUMMARY:UTC class", "DTSTART:20261007T120000Z", "DTEND:20261007T130000Z")));
  const s = new Date(Date.UTC(2026, 9, 7, 12, 0));
  const hh = d => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  assert.deepEqual(rows(r), [[["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][s.getDay()], hh(s), hh(new Date(s.getTime() + 3600000)), "UTC class", "lecture"]]);
});

test(".ics: one event per week is merged; all-day and monthly events are skipped", () => {
  const weeks = [5, 12, 19, 26].flatMap(d => ev("SUMMARY:Stats", `DTSTART:202610${String(d).padStart(2, "0")}T100000`, `DTEND:202610${String(d).padStart(2, "0")}T120000`));
  const r = parseICS(cal(...weeks,
    ...ev("SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261009", "DTEND;VALUE=DATE:20261010"),
    ...ev("SUMMARY:Monthly", "DTSTART:20261005T090000", "DTEND:20261005T100000", "RRULE:FREQ=MONTHLY")));
  assert.deepEqual(rows(r), [["MON", "10:00", "12:00", "Stats", "lecture"]]);
  assert.deepEqual(r.notes.sort(), ["1 all-day event was skipped.", "1 event repeats monthly or yearly and was skipped.", "3 repeated copies were merged."]);
});

test(".ics: alarms inside an event don't overwrite it; broken events are reported", () => {
  const r = parseICS(cal(
    ...ev("SUMMARY:Real title", "DTSTART:20261005T090000", "DTEND:20261005T100000", "BEGIN:VALARM", "SUMMARY:alarm text", "DTSTART:20261231T235900", "END:VALARM"),
    ...ev("SUMMARY:No end", "DTSTART:20261005T090000"),
    ...ev("SUMMARY:Bad", "DTSTART:2026-10-05", "DTEND:20261005T100000"),
    ...ev("SUMMARY:Backwards", "DTSTART:20261005T100000", "DTEND:20261005T090000"),
    ...ev("DTSTART:20261005T130000", "DTEND:20261005T140000"),
  ));
  assert.deepEqual(rows(r), [["MON", "09:00", "10:00", "Real title", "lecture"]]);
  assert.deepEqual(r.errors.map(e => e.message), [
    "event has no end time.", "event has an unreadable start time.", "event's length isn't a normal class length.", "missing the course name.",
  ]);
});

test(".ics: hostile content", () => {
  const r = parseICS(cal(
    ...ev(`SUMMARY:${XSS}\\nEND:VEVENT\\nBEGIN:VEVENT`, "DTSTART:20261005T090000", "DTEND:20261005T100000"),
    ...ev("__PROTO__:x", "CONSTRUCTOR;PROTOTYPE=x:y", "SUMMARY;LANGUAGE=\"a:b;c\":Quoted params", "DTSTART;TZID=__proto__:20261006T090000", "DTEND:20261006T100000"),
  ));
  assert.deepEqual(rows(r), [
    ["MON", "09:00", "10:00", `${XSS} END:VEVENT BEGIN:VEVENT`.slice(0, 60), "lecture"],
    ["TUE", "09:00", "10:00", "Quoted params", "lecture"],
  ]);
  assert.equal({}.x, undefined);
  assert.match(parseICS("hello").errors[0].message, /isn't a calendar/);
  assert.match(parseICS("BEGIN:VCALENDAR\n" + "X".repeat(IMPORT_LIMITS.bytes)).errors[0].message, /too big/);
  assert.doesNotThrow(() => parseICS("BEGIN:VCALENDAR\n" + "BEGIN:VEVENT\n".repeat(5000)));
});

test("format detection", () => {
  assert.equal(parseTimetable("BEGIN:VCALENDAR\nEND:VCALENDAR").format, "ics");
  assert.equal(parseTimetable("day,start,end,title", "x.csv").format, "csv");
  assert.equal(parseTimetable("Mon 9-10 X").format, "text");
});

// ---------- review ----------

function state() {
  const s = defaultState();
  s.profile.bedtime = "23:30";
  s.categories = [{ id: "c1", name: "CSC 415", color: 0 }];
  s.blocks = [{ id: "b1", day: "MON", start: 600, end: 660, title: "Existing", kind: "study", cat: "c1" }];
  return s;
}

test("preview: exactly what Apply will do, without touching the real state", () => {
  const s = state();
  const r = parseQuickAdd("Mon 9:30-11:30 CSC 415\nTue 9-11 csc 415\nTue 10-12 Clash\nWed 9-10 New course");
  const p = previewImport(s, r.rows);
  assert.deepEqual(p.items.map(i => [i.day, i.status, i.error]), [
    ["MON", "error", `Overlaps "Existing" (MON 10:00–11:00am).`],
    ["TUE", "ok", null],
    ["TUE", "error", `Overlaps "CSC 415" (TUE 9:00–11:00am).`],
    ["WED", "ok", null],
  ]);
  assert.equal(p.added, 2);
  assert.deepEqual(p.state.categories.map(c => c.name), ["CSC 415", "New course"], "existing subject reused, case-insensitively");
  assert.equal(p.state.blocks.find(b => b.day === "TUE").title, "CSC 415");
  assert.equal(validate(p.state).ok, true);
  assert.equal(s.blocks.length, 1, "real state untouched");
});

test("preview: unticking and changing the type", () => {
  const r = parseQuickAdd("Mon 9:30-11:30 CSC 415\nTue 9-11 Stats");
  const p = previewImport(state(), r.rows, [{ on: false }, { kind: "study" }]);
  assert.deepEqual(p.items.map(i => [i.status, i.kind]), [["skipped", "lecture"], ["ok", "study"]]);
  assert.equal(p.state.blocks.at(-1).kind, "study");
  assert.equal(previewImport(state(), r.rows, [{ kind: "party" }]).items[0].kind, "lecture", "unknown types are ignored");
});
