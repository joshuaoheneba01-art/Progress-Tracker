import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHHMM, bedtimeMin, toHHMM, inputToRange, fmtTime, fmtRange, fmtHours,
  studyDayOf, weekStart, weekKey, isoDate, blocksOverlap, findOverlaps, checkBlock,
  currentAndNext, blocksForDay, dayStats, weekStats, planned, streak,
} from "../js/schedule.js";
import { defaultState } from "../js/schema.js";

// 28 Sep 2026 is a Monday.
const at = (d, h, m = 0) => new Date(2026, 8, d, h, m);
const B = (id, day, start, end, kind = "study", cat = null) => ({ id, day, start, end, title: id, kind, cat });

test("parsing and formatting", () => {
  assert.equal(parseHHMM("16:30"), 990);
  assert.equal(bedtimeMin("03:30"), 1650);
  assert.equal(bedtimeMin("23:30"), 1410);
  assert.equal(toHHMM(1530), "01:30");
  assert.equal(toHHMM(990), "16:30");
  assert.equal(fmtTime(990), "4:30pm");
  assert.equal(fmtTime(1440), "12:00am");
  assert.equal(fmtTime(720), "12:00pm");
  assert.equal(fmtRange(990, 1170), "4:30–7:30pm");
  assert.equal(fmtRange(1380, 1530), "11:00pm–1:30am");
  assert.equal(fmtHours(150), "2.5");
  assert.equal(fmtHours(120), "2");
});

test("inputToRange puts after-midnight times on the right side", () => {
  assert.deepEqual(inputToRange("16:30", "19:30", "03:30"), { start: 990, end: 1170 });
  assert.deepEqual(inputToRange("01:30", "03:00", "03:30"), { start: 1530, end: 1620 });
  assert.deepEqual(inputToRange("23:00", "01:00", "03:30"), { start: 1380, end: 1500 });
  // early bedtime: no lifting, but an end before the start still rolls over
  assert.deepEqual(inputToRange("08:00", "09:00", "23:00"), { start: 480, end: 540 });
  assert.deepEqual(inputToRange("22:00", "00:30", "23:00"), { start: 1320, end: 1470 });
});

test("study day rolls over at bedtime, not at midnight", () => {
  // Tue 02:10 with bedtime 03:30 → still Monday, minute 1570
  let s = studyDayOf(at(29, 2, 10), "03:30");
  assert.equal(s.day, "MON");
  assert.equal(isoDate(s.date), "2026-09-28");
  assert.equal(s.minute, 1570);
  // Tue 03:30 exactly → Tuesday has begun
  s = studyDayOf(at(29, 3, 30), "03:30");
  assert.equal(s.day, "TUE");
  assert.equal(s.minute, 210);
  // bedtime before midnight: midnight is the boundary
  s = studyDayOf(at(29, 0, 30), "23:00");
  assert.equal(s.day, "TUE");
  assert.equal(s.minute, 30);
});

test("week start and week key", () => {
  assert.equal(isoDate(weekStart(at(28, 9))), "2026-09-28");
  assert.equal(isoDate(weekStart(at(30, 9))), "2026-09-28");
  assert.equal(weekKey(new Date(2026, 9, 4, 23)), "2026-09-28"); // Sunday
  assert.equal(weekKey(new Date(2026, 9, 5, 1)), "2026-10-05");  // next Monday
  // Mon 01:00 with bedtime 03:30 is still Sunday's study day → previous week
  const s = studyDayOf(new Date(2026, 9, 5, 1), "03:30");
  assert.equal(weekKey(s.date), "2026-09-28");
});

test("overlap detection", () => {
  assert.equal(blocksOverlap(B("a", "MON", 600, 660), B("b", "MON", 660, 720)), false, "touching is fine");
  assert.equal(blocksOverlap(B("a", "MON", 600, 700), B("b", "MON", 660, 720)), true);
  assert.equal(blocksOverlap(B("a", "MON", 600, 720), B("b", "MON", 630, 660)), true, "contained");
  assert.equal(blocksOverlap(B("a", "MON", 600, 720), B("b", "TUE", 600, 720)), false);
  // MON till 3:00am vs TUE 1:00–2:00am
  assert.equal(blocksOverlap(B("a", "MON", 1440, 1620), B("b", "TUE", 60, 120)), true);
  assert.equal(blocksOverlap(B("a", "MON", 1440, 1620), B("b", "TUE", 180, 240)), false);
  // SUN past midnight wraps onto Monday morning
  assert.equal(blocksOverlap(B("a", "SUN", 1440, 1560), B("b", "MON", 60, 90)), true);
  assert.equal(blocksOverlap(B("a", "SUN", 1440, 1560), B("b", "MON", 120, 180)), false);

  const pairs = findOverlaps([B("a", "MON", 0, 100), B("b", "MON", 50, 150), B("c", "MON", 150, 200)]);
  assert.deepEqual(pairs.map(p => p.map(x => x.id)), [["a", "b"]]);
});

test("checkBlock reports end ≤ start, range and overlaps", () => {
  const others = [B("x", "MON", 600, 700)];
  assert.deepEqual(checkBlock(B("n", "MON", 700, 760), others), []);
  assert.match(checkBlock(B("n", "MON", 760, 700), others)[0], /end time/);
  assert.match(checkBlock(B("n", "MON", 760, 760), others)[0], /end time/);
  assert.match(checkBlock(B("n", "MON", 1700, 1900), others)[0], /study day/);
  assert.match(checkBlock(B("n", "MON", 650, 760), others)[0], /Overlaps "x"/);
  // editing a block never clashes with itself
  assert.deepEqual(checkBlock(B("x", "MON", 610, 690), others), []);
});

test("current and next block", () => {
  const day = blocksForDay([B("c", "MON", 900, 960), B("a", "MON", 600, 660), B("b", "MON", 660, 720), B("z", "TUE", 0, 10)], "MON");
  assert.deepEqual(day.map(b => b.id), ["a", "b", "c"]);
  let r = currentAndNext(day, 630);
  assert.equal(r.cur.id, "a"); assert.equal(r.next.id, "b");
  r = currentAndNext(day, 660);
  assert.equal(r.cur.id, "b"); assert.equal(r.next.id, "c");
  r = currentAndNext(day, 800);
  assert.equal(r.cur, null); assert.equal(r.next.id, "c");
  r = currentAndNext(day, 1000);
  assert.equal(r.cur, null); assert.equal(r.next, null);
});

function sample() {
  const s = defaultState();
  s.profile.bedtime = "03:30";
  s.blocks = [
    B("s1", "MON", 600, 720, "study", "uni"),
    B("s2", "MON", 1440, 1530, "study", "cisco"),
    B("s3", "TUE", 600, 660, "study", null),
    B("l1", "MON", 480, 600, "lecture", "uni"),
    B("n1", "MON", 780, 960, "nap"),
    B("r1", "MON", 1620, 1650, "rest"),
  ];
  return s;
}

test("stats: only study blocks are tickable and counted", () => {
  const s = sample();
  s.progress["2026-09-28"] = { s1: true, l1: true, n1: true };
  const d = dayStats(s, "2026-09-28", "MON");
  assert.equal(d.tot, 2);
  assert.equal(d.done, 1);
  assert.deepEqual(d.mins, { uni: 120 });
  const w = weekStats(s, "2026-09-28");
  assert.equal(w.tot, 3);
  assert.equal(w.done, 1);
  assert.deepEqual(planned(s), { uni: 120, cisco: 90, "": 60 });
  assert.deepEqual(dayStats(s, "2026-09-21", "MON"), { tot: 2, done: 0, mins: {} });
});

test("streak counts back, skips free days, and ignores today being unfinished", () => {
  const s = sample(); // study only on MON and TUE
  s.progress["2026-09-21"] = { s1: true, s2: true, s3: true };    // last Mon + Tue done
  s.progress["2026-09-28"] = { s1: true, s2: true };              // this Mon done, Tue not yet
  // Tue 29 Sep, 10am: today (Tue) unfinished → no break; Mon ✓, then WED–SUN free, last Tue ✓, last Mon ✓
  assert.equal(streak(s, at(29, 10)), 3);
  // Wed 30 Sep: Tue was missed → streak is 0
  assert.equal(streak(s, at(30, 10)), 0);
  // 60% threshold: 1 of 2 on Monday is not enough. Seen from Tuesday that breaks the streak…
  s.progress["2026-09-28"] = { s1: true };
  assert.equal(streak(s, at(29, 10)), 0);
  // …but seen from Monday itself it is just "today, unfinished": last Tue ✓ + last Mon ✓
  assert.equal(streak(s, at(28, 23)), 2);
});
