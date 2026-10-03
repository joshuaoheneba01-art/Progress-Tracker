import { test } from "node:test";
import assert from "node:assert/strict";
import { dueAlarms, addSnooze, cleanAlarmStore } from "../js/reminders.js";
import { defaultState } from "../js/schema.js";

// 28 Sep 2026 is a Monday.
const at = (d, h, m = 0, s = 0) => new Date(2026, 8, d, h, m, s);
const empty = () => cleanAlarmStore(null);

function state() {
  const s = defaultState();
  s.profile.bedtime = "03:30";
  s.blocks = [
    { id: "study", day: "MON", start: 990, end: 1170, title: "CSC 401", kind: "study", cat: null },
    { id: "lec", day: "MON", start: 540, end: 600, title: "Lecture", kind: "lecture", cat: null },
    { id: "nap", day: "MON", start: 780, end: 900, title: "Nap", kind: "nap", cat: null },
    { id: "rest", day: "MON", start: 1620, end: 1650, title: "Wind down", kind: "rest", cat: null },
    { id: "late", day: "MON", start: 1530, end: 1590, title: "Late study", kind: "study", cat: null },
  ];
  return s;
}
const keys = r => r.fire.map(a => a.key);

test("rings at block start, once", () => {
  const s = state();
  let r = dueAlarms(s, at(28, 16, 29, 50), empty());
  assert.deepEqual(r.fire, [], "not before the start");
  r = dueAlarms(s, at(28, 16, 30, 5), r.store);
  assert.deepEqual(keys(r), ["2026-09-28@study"]);
  assert.deepEqual(r.fire[0], { key: "2026-09-28@study", blockId: "study", title: "CSC 401", start: 990, end: 1170, kind: "study" });
  r = dueAlarms(s, at(28, 16, 31), r.store);
  assert.deepEqual(r.fire, [], "not twice");
});

test("still rings if the app opens a few minutes late, not much later", () => {
  assert.deepEqual(keys(dueAlarms(state(), at(28, 16, 34), empty())), ["2026-09-28@study"]);
  assert.deepEqual(keys(dueAlarms(state(), at(28, 16, 35), empty())), []);
});

test("lectures and naps ring, rest blocks don't", () => {
  assert.deepEqual(keys(dueAlarms(state(), at(28, 9, 0), empty())), ["2026-09-28@lec"]);
  assert.deepEqual(keys(dueAlarms(state(), at(28, 13, 0), empty())), ["2026-09-28@nap"]);
  assert.deepEqual(keys(dueAlarms(state(), at(29, 3, 0), empty())), [], "rest block at 3:00am");
});

test("an after-midnight block rings on its own study day", () => {
  // Tue 01:30 is still Monday's study day (bedtime 03:30)
  assert.deepEqual(keys(dueAlarms(state(), at(29, 1, 30), empty())), ["2026-09-28@late"]);
});

test("an already ticked study block stays quiet", () => {
  const s = state();
  s.progress["2026-09-28"] = { study: true };
  const r = dueAlarms(s, at(28, 16, 30), empty());
  assert.deepEqual(r.fire, []);
  assert.equal(r.store.fired["2026-09-28@study"], 1);
});

test("snooze rings again after the chosen minutes", () => {
  const s = state();
  const first = dueAlarms(s, at(28, 16, 30), empty());
  const snoozed = addSnooze(first.store, first.fire[0], 5, at(28, 16, 30, 20).getTime());
  assert.deepEqual(dueAlarms(s, at(28, 16, 35, 10), snoozed).fire, []);
  const r = dueAlarms(s, at(28, 16, 35, 20), snoozed);
  assert.deepEqual(keys(r), ["2026-09-28@study"]);
  assert.equal(r.fire[0].snoozed, true);
  assert.deepEqual(r.store.snoozes, [], "used up");
  // snoozing the same alarm again replaces, never duplicates
  const twice = addSnooze(addSnooze(r.store, r.fire[0], 5, 0), r.fire[0], 10, 0);
  assert.equal(twice.snoozes.length, 1);
  assert.equal(twice.snoozes[0].at, 10 * 60000);
});

test("alarms off: nothing rings and snoozes are dropped", () => {
  const s = state();
  s.settings.alarms = false;
  const store = addSnooze(empty(), { key: "2026-09-28@study", blockId: "study", title: "x", start: 990, end: 1170, kind: "study" }, 5, 0);
  const r = dueAlarms(s, at(28, 16, 30), store);
  assert.deepEqual(r.fire, []);
  assert.deepEqual(r.store.snoozes, []);
});

test("old fired keys are pruned", () => {
  const store = cleanAlarmStore({ fired: { "2026-09-01@study": 1, "2026-09-27@study": 1 }, snoozes: [] });
  const r = dueAlarms(state(), at(28, 12), store);
  assert.deepEqual(Object.keys(r.store.fired), ["2026-09-27@study"]);
});

test("the stored alarm data is validated like everything else", () => {
  const good = { key: "2026-09-28@study", blockId: "study", title: "CSC 401", start: 990, end: 1170, kind: "study", at: 5 };
  assert.deepEqual(cleanAlarmStore(JSON.parse('{"__proto__":{"x":1},"fired":{}}')), { fired: {}, snoozes: [] });
  const r = cleanAlarmStore({
    fired: { "2026-09-28@ok": 1, "<img src=x onerror=alert(1)>": 1, "2026-09-28@bad key": 1 },
    snoozes: [
      good,
      { ...good, title: "<img src=x onerror=alert(1)>" + "A".repeat(500) },
      { ...good, kind: "party" }, { ...good, start: -1 }, { ...good, key: "nope" }, { ...good, at: "soon" }, "junk",
    ],
  });
  assert.deepEqual(Object.keys(r.fired), ["2026-09-28@ok"]);
  assert.equal(r.snoozes.length, 2);
  assert.equal(r.snoozes[1].title.length, 60);
  assert.ok(r.snoozes[1].title.startsWith("<img"));
  assert.equal(cleanAlarmStore({ snoozes: Array(100).fill(good) }).snoozes.length, 20);
});
