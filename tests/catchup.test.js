import { test } from "node:test";
import assert from "node:assert/strict";
import { missedBlocks, suggestSlots, makeExtra, pruneCatchup } from "../js/catchup.js";
import { defaultState, validate, DAYS } from "../js/schema.js";
import { dayStats, weekStats, dateFor, extrasOn, findOverlaps } from "../js/schedule.js";
import { dueAlarms, cleanAlarmStore } from "../js/reminders.js";

// Mon 5 Oct 2026 – Sun 11 Oct. "Now" is Thu 8 Oct, 2pm.
const NOW = new Date(2026, 9, 8, 14, 0);
const B = (id, day, start, end, kind = "study", cat = null) => ({ id, day, start, end, title: id, kind, cat });

function state() {
  const s = defaultState();
  s.profile.bedtime = "23:00";
  for (const d of DAYS) s.profile.wake[d] = "08:00";
  s.categories = [{ id: "c1", name: "CSC 401", color: 0 }];
  s.blocks = [
    B("monStudy", "MON", 600, 720, "study", "c1"),   // 10–12
    B("monLec", "MON", 780, 840, "lecture", "c1"),   // lecture: never "missed"
    B("wedStudy", "WED", 960, 1080, "study"),        // 4–6pm
    B("thuMorning", "THU", 540, 660, "study"),       // 9–11am, over by 2pm
    B("thuEvening", "THU", 1140, 1260, "study"),     // 7–9pm, not over yet
    B("satStudy", "SAT", 600, 720, "study"),          // last Saturday (3 Oct) is in range
  ];
  return s;
}
const keys = l => l.map(m => m.key);

test("missed: unticked study blocks from the last 7 days and today's finished ones, oldest first", () => {
  assert.deepEqual(keys(missedBlocks(state(), NOW)), [
    "2026-10-01@thuMorning", "2026-10-01@thuEvening", "2026-10-03@satStudy",
    "2026-10-05@monStudy", "2026-10-07@wedStudy", "2026-10-08@thuMorning",
  ]);
});

test("missed: ticked, rescheduled, skipped and pre-setup blocks don't count", () => {
  const s = state();
  s.progress["2026-10-05"] = { monStudy: true };                 // ticked this week
  s.progress["2026-09-28"] = { satStudy: true };                 // last week's Saturday ticked in last week's key
  s.extras = [makeExtra({ id: "wedStudy", date: "2026-10-07", title: "wedStudy", cat: null }, { date: "2026-10-09", start: 600, end: 720 }, "x1")];
  s.dismissed = ["2026-10-01@thuMorning"];
  assert.deepEqual(keys(missedBlocks(s, NOW)), ["2026-10-01@thuEvening", "2026-10-08@thuMorning"]);
  s.settings.startedAt = new Date(2026, 9, 1, 20, 0).getTime();  // set up Thu 1 Oct, 8pm
  assert.deepEqual(keys(missedBlocks(s, NOW)), ["2026-10-01@thuEvening", "2026-10-08@thuMorning"], "7–9pm block still counts");
  s.settings.startedAt = new Date(2026, 9, 6, 9, 0).getTime();
  assert.deepEqual(keys(missedBlocks(s, NOW)), ["2026-10-08@thuMorning"]);
});

test("missed: a make-up that was itself missed shows up too", () => {
  const s = state();
  s.extras = [{ id: "mk", date: "2026-10-06", start: 600, end: 660, title: "X · catch-up", cat: null, from: "monStudy", fromDate: "2026-10-05" }];
  const m = missedBlocks(s, NOW);
  assert.ok(m.some(x => x.key === "2026-10-06@mk" && x.extra));
  assert.ok(!m.some(x => x.key === "2026-10-05@monStudy"), "original counted as rescheduled");
});

test("suggestions: earliest fitting slot per day, from now on, around everything", () => {
  const s = state();
  const slots = suggestSlots(s, NOW, 120);
  // Thu: after 2:15pm, before the 7pm block → 2:15–4:15pm; Fri: 8:30am (wake + 30);
  // Sat: 8:30–10:00 is too short before the 10–12 block, so 12:00–2:00pm
  assert.deepEqual(slots, [
    { date: "2026-10-08", day: "THU", start: 855, end: 975 },
    { date: "2026-10-09", day: "FRI", start: 510, end: 630 },
    { date: "2026-10-10", day: "SAT", start: 720, end: 840 },
  ]);
  // an existing make-up on Friday morning pushes Friday's suggestion later
  s.extras = [{ id: "mk", date: "2026-10-09", start: 510, end: 630, title: "x", cat: null, from: null, fromDate: null }];
  assert.equal(suggestSlots(s, NOW, 120)[1].start, 645);
  const all = suggestSlots(s, NOW, 60, 7);
  assert.equal(all.length, 7);
  assert.deepEqual(suggestSlots(s, NOW, 60, 7), all, "deterministic");
  for (const sl of all) {
    const same = [...s.blocks.filter(b => b.day === sl.day), ...extrasOn(s, sl.date)];
    assert.deepEqual(findOverlaps([...same, { id: "new", day: sl.day, start: sl.start, end: sl.end }]).filter(p => p.some(b => b.id === "new")), []);
  }
});

test("suggestions respect lecture buffers and long sessions that don't fit", () => {
  const s = state();
  s.blocks.push(B("friLec", "FRI", 540, 600, "lecture"));  // 9–10am → busy 8:30–10:30
  assert.equal(suggestSlots(s, NOW, 120)[1].start, 630);
  assert.deepEqual(suggestSlots(s, NOW, 20 * 60), [], "nothing fits a 20 h session");
});

test("makeExtra links back to what it makes up for", () => {
  const m = { id: "monStudy", date: "2026-10-05", title: "CSC 401 · revise", cat: "c1" };
  const e = makeExtra(m, { date: "2026-10-09", start: 600, end: 720 }, "e1");
  assert.deepEqual(e, { id: "e1", date: "2026-10-09", start: 600, end: 720, title: "CSC 401 · revise · catch-up", cat: "c1", from: "monStudy", fromDate: "2026-10-05" });
  assert.equal(makeExtra({ ...m, title: e.title }, { date: "2026-10-10", start: 1, end: 2 }).title, e.title, "no double suffix");
});

test("make-ups count in that day's stats, the week, and ring alarms", () => {
  const s = state();
  s.extras = [{ id: "mk", date: "2026-10-09", start: 600, end: 720, title: "Make-up", cat: "c1", from: "monStudy", fromDate: "2026-10-05" }];
  assert.equal(dateFor("2026-10-05", "FRI"), "2026-10-09");
  assert.deepEqual(dayStats(s, "2026-10-05", "FRI"), { tot: 1, done: 0, mins: {} });
  assert.deepEqual(dayStats(s, "2026-10-12", "FRI"), { tot: 0, done: 0, mins: {} }, "only on its own date");
  s.progress["2026-10-05"] = { mk: true };
  assert.deepEqual(dayStats(s, "2026-10-05", "FRI").mins, { c1: 120 });
  assert.equal(weekStats(s, "2026-10-05").done, 1);
  const r = dueAlarms(s, new Date(2026, 9, 9, 10, 0), cleanAlarmStore(null));
  assert.deepEqual(r.fire, [], "ticked make-up stays quiet");
  delete s.progress["2026-10-05"].mk;
  assert.deepEqual(dueAlarms(s, new Date(2026, 9, 9, 10, 0), cleanAlarmStore(null)).fire.map(a => a.key), ["2026-10-09@mk"]);
});

test("validator: make-ups and skips are checked like everything else", () => {
  const s = state();
  const ok = { id: "mk", date: "2026-10-09", start: 600, end: 720, title: "Make-up", cat: "c1", from: "monStudy", fromDate: "2026-10-05" };
  s.extras = [
    ok,
    { ...ok, id: "mk" },                                    // duplicate id
    { ...ok, id: "monStudy" },                              // clashes with a block id
    { ...ok, id: "d1", date: "2026-02-30" },
    { ...ok, id: "d2", start: 720, end: 600 },
    { ...ok, id: "d3", title: "" },
    { ...ok, id: "x1", title: "<img src=x onerror=alert(1)>", cat: "ghost", from: "<b>", fromDate: "nope", extra: "evil" },
  ];
  s.dismissed = ["2026-10-01@thuMorning", "2026-10-01@thuMorning", "junk", "2026-13-01@x", 42];
  s.progress["2026-10-05"] = { mk: true, ghost: true };
  s.settings.startedAt = -5;
  const r = validate(s);
  assert.deepEqual(r.data.extras.map(e => e.id), ["mk", "x1"]);
  assert.deepEqual(r.data.extras[1], { id: "x1", date: "2026-10-09", start: 600, end: 720, title: "<img src=x onerror=alert(1)>", cat: null, from: null, fromDate: null });
  assert.deepEqual(r.data.dismissed, ["2026-10-01@thuMorning"]);
  assert.deepEqual(r.data.progress, { "2026-10-05": { mk: true } }, "ticks on make-ups are kept");
  assert.equal(r.data.settings.startedAt, 0);
  const many = Array.from({ length: 150 }, (_, i) => ({ ...ok, id: `e${i}`, date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}` }));
  const capped = validate({ ...s, extras: many }).data.extras;
  assert.equal(capped.length, 100);
  assert.equal(capped[0].id, "e50", "the oldest are dropped");
});

test("housekeeping drops old unticked make-ups and old skips", () => {
  const s = state();
  s.extras = [
    { id: "old", date: "2026-07-01", start: 600, end: 660, title: "old", cat: null, from: null, fromDate: null },
    { id: "oldDone", date: "2026-07-02", start: 600, end: 660, title: "done", cat: null, from: null, fromDate: null },
    { id: "recent", date: "2026-10-01", start: 600, end: 660, title: "recent", cat: null, from: null, fromDate: null },
  ];
  s.progress["2026-06-29"] = { oldDone: true };
  s.dismissed = ["2026-09-01@a", "2026-10-01@b"];
  const p = pruneCatchup(s, NOW);
  assert.deepEqual(p.extras.map(e => e.id), ["oldDone", "recent"]);
  assert.deepEqual(p.dismissed, ["2026-10-01@b"]);
});
