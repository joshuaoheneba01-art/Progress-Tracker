import { test } from "node:test";
import assert from "node:assert/strict";
import { sleepReport, fmtDuration } from "../js/schedule.js";
import { defaultState } from "../js/schema.js";
import { templateMcJayy } from "./fixtures.js";

function base(bedtime, wake = "07:00") {
  const s = defaultState();
  s.profile.bedtime = bedtime;
  for (const d of Object.keys(s.profile.wake)) s.profile.wake[d] = wake;
  return s;
}
const B = (id, day, start, end, kind = "study") => ({ id, day, start, end, title: id, kind, cat: null });
const on = (r, day) => r.find(x => x.day === day);

test("fmtDuration", () => {
  assert.equal(fmtDuration(285), "4 h 45 min");
  assert.equal(fmtDuration(420), "7 h");
  assert.equal(fmtDuration(0), "0 h");
});

test("no blocks: sleep is bedtime to wake time", () => {
  const r = sleepReport(base("23:00", "07:00"));
  assert.equal(r.length, 7);
  for (const d of r) { assert.equal(d.totalMin, 480); assert.equal(d.ok, true); assert.equal(d.message, null); }
  // after-midnight bedtime
  assert.equal(on(sleepReport(base("01:30", "08:00")), "TUE").nightMin, 390);
});

test("a late block the night before cuts sleep and is named", () => {
  const s = base("23:30", "07:00");
  s.blocks = [B("Cisco · revise", "MON", 1440, 1560)]; // until 2:00am
  const tue = on(sleepReport(s), "TUE");
  assert.equal(tue.totalMin, 300);
  assert.equal(tue.ok, false);
  assert.equal(tue.late.title, "Cisco · revise");
  assert.equal(tue.message, 'Tue: only 5 h of sleep. "Cisco · revise" (Mon) runs until 2:00am, past your 11:30pm bedtime. Move it earlier.');
  assert.equal(on(sleepReport(s), "MON").ok, true, "only the night after is affected");
});

test("an early block cuts sleep and is named", () => {
  const s = base("01:00", "08:00");
  s.blocks = [B("CSC 405 · prep", "TUE", 360, 420)]; // 6:00am
  const tue = on(sleepReport(s), "TUE");
  assert.equal(tue.totalMin, 300);
  assert.equal(tue.message, 'Tue: only 5 h of sleep. "CSC 405 · prep" starts at 6:00am, before your 8:00am wake time. Move it later.');
});

test("both ends squeezed: both blocks named", () => {
  const s = base("23:00", "08:00");
  s.blocks = [B("Late", "WED", 1500, 1620), B("Early", "THU", 405, 480)]; // until 3:00am, from 6:45am
  const thu = on(sleepReport(s), "THU");
  assert.equal(thu.totalMin, 225);
  assert.equal(thu.message, 'Thu: only 3 h 45 min of sleep. "Late" (Wed) runs until 3:00am and "Early" starts at 6:45am. Move one of them.');
});

test("naps count toward the day's sleep", () => {
  const s = base("03:30", "08:00"); // 4 h 30 min a night
  assert.equal(on(sleepReport(s), "MON").ok, false);
  assert.match(on(sleepReport(s), "MON").message, /between your 3:30am bedtime and 8:00am wake time/);
  s.blocks = [B("Nap", "MON", 780, 960, "nap")]; // 3 h
  const mon = on(sleepReport(s), "MON");
  assert.equal(mon.napMin, 180);
  assert.equal(mon.totalMin, 450);
  assert.equal(mon.ok, true);
});

test("the week wraps: Sunday night affects Monday", () => {
  const s = base("23:00", "07:00");
  s.blocks = [B("Sunday late", "SUN", 1500, 1680)]; // until 4:00am Monday
  const mon = on(sleepReport(s), "MON");
  assert.equal(mon.totalMin, 180);
  assert.equal(mon.late.title, "Sunday late");
});

test("blocks running into each other overnight give zero, never negative", () => {
  const s = base("23:00", "07:00");
  s.blocks = [B("All-nighter", "MON", 1320, 1800), B("Dawn", "TUE", 300, 360)];
  assert.equal(on(sleepReport(s), "TUE").nightMin, 0);
});

test("McJayy's week passes the sleep guard", () => {
  const r = sleepReport(templateMcJayy());
  assert.deepEqual(r.filter(d => !d.ok).map(d => d.message), []);
  // e.g. Tue: 3:30am → 8:15am = 4 h 45 min, plus the 3 h nap = 7 h 45 min
  assert.deepEqual(r.map(d => d.totalMin), [720, 465, 435, 570, 480, 480, 510]);
});
