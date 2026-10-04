import { test } from "node:test";
import assert from "node:assert/strict";
import { startFocus, elapsedMs, remainingMs, isDone, progress, pauseFocus, resumeFocus, fmtClock } from "../js/focus.js";
import { defaultState, validate } from "../js/schema.js";

const MIN = 60000;
const block = { id: "b1", day: "MON", start: 600, end: 720, title: "CSC 401", kind: "study", cat: null }; // 10:00–12:00
const T0 = new Date(2026, 9, 5, 10, 30).getTime();

test("length: rest of the block when started inside it, full block otherwise", () => {
  assert.equal(startFocus(block, "2026-10-05", 630, T0).durationMin, 90);
  assert.equal(startFocus(block, "2026-10-05", 540, T0).durationMin, 120, "started early");
  assert.equal(startFocus(block, "2026-10-05", 800, T0).durationMin, 120, "catching up later");
  assert.equal(startFocus(block, "2026-10-05", 718, T0).durationMin, 5, "at least 5 minutes");
  assert.deepEqual(startFocus(block, "2026-10-05", 630, T0), { blockId: "b1", date: "2026-10-05", startedAt: T0, pausedAt: null, pausedMs: 0, durationMin: 90 });
});

test("time comes from timestamps: any gap between checks is counted", () => {
  const f = startFocus(block, "2026-10-05", 630, T0);
  assert.equal(elapsedMs(f, T0 + 10 * MIN), 10 * MIN);
  // the phone slept for 50 minutes with no ticks at all
  assert.equal(remainingMs(f, T0 + 60 * MIN), 30 * MIN);
  assert.equal(progress(f, T0 + 45 * MIN), 0.5);
  assert.equal(isDone(f, T0 + 89 * MIN), false);
  assert.equal(isDone(f, T0 + 90 * MIN), true);
  assert.equal(remainingMs(f, T0 + 500 * MIN), 0, "never negative");
  assert.equal(progress(f, T0 + 500 * MIN), 1);
});

test("pause and resume: paused time doesn't count", () => {
  let f = startFocus(block, "2026-10-05", 630, T0);
  f = pauseFocus(f, T0 + 20 * MIN);
  assert.equal(elapsedMs(f, T0 + 80 * MIN), 20 * MIN, "frozen while paused");
  assert.equal(pauseFocus(f, T0 + 30 * MIN), f, "pausing twice changes nothing");
  f = resumeFocus(f, T0 + 80 * MIN);
  assert.equal(f.pausedMs, 60 * MIN);
  assert.equal(f.pausedAt, null);
  assert.equal(elapsedMs(f, T0 + 90 * MIN), 30 * MIN);
  assert.equal(resumeFocus(f, T0 + 95 * MIN), f, "resuming a running timer changes nothing");
  // two pauses add up
  f = resumeFocus(pauseFocus(f, T0 + 100 * MIN), T0 + 110 * MIN);
  assert.equal(elapsedMs(f, T0 + 120 * MIN), 50 * MIN);
});

test("a clock set backwards never gives negative or extra time", () => {
  const f = startFocus(block, "2026-10-05", 630, T0);
  assert.equal(elapsedMs(f, T0 - 30 * MIN), 0);
  assert.equal(remainingMs(f, T0 - 30 * MIN), 90 * MIN);
  const p = pauseFocus(f, T0 - 5 * MIN);
  assert.equal(p.pausedAt, T0, "pause time never before the start");
  assert.equal(resumeFocus(p, T0 - 10 * MIN).pausedMs, 0);
});

test("clock format", () => {
  assert.equal(fmtClock(2_534_000), "42:14");
  assert.equal(fmtClock(3_725_000), "1:02:05");
  assert.equal(fmtClock(59_001), "01:00", "rounds up so 0:00 means done");
  assert.equal(fmtClock(0), "00:00");
});

function withFocus(focus, blocks = [block]) {
  const s = defaultState();
  s.blocks = blocks;
  s.focus = focus;
  return validate(s);
}
const good = { blockId: "b1", date: "2026-10-05", startedAt: T0, pausedAt: null, pausedMs: 0, durationMin: 90 };

test("validator: a good timer survives a save", () => {
  assert.deepEqual(withFocus(good).data.focus, good);
  assert.deepEqual(withFocus({ ...good, pausedAt: T0 + MIN, pausedMs: 5 }).data.focus.pausedAt, T0 + MIN);
  assert.equal(withFocus(null).data.focus, null);
  assert.deepEqual(withFocus(null).errors, []);
});

test("validator: anything off clears the timer", () => {
  const lecture = { ...block, kind: "lecture" };
  const bad = [
    { ...good, blockId: "ghost" }, { ...good, blockId: "<img src=x onerror=alert(1)>" },
    { ...good, date: "2026-02-30" }, { ...good, startedAt: -1 }, { ...good, startedAt: 1e20 }, { ...good, startedAt: "now" },
    { ...good, pausedAt: T0 - 1 }, { ...good, pausedMs: -5 }, { ...good, durationMin: 0 }, { ...good, durationMin: 5000 },
    { ...good, durationMin: 1.5 }, "running", [good],
  ];
  for (const f of bad) {
    const r = withFocus(f);
    assert.equal(r.data.focus, null, JSON.stringify(f));
    assert.ok(r.errors.some(e => /focus timer/.test(e)));
  }
  assert.equal(withFocus(good, [lecture]).data.focus, null, "only study blocks can be focused");
  assert.equal(validate({ v: 1, focus: JSON.parse('{"__proto__":{"x":1}}') }).ok, false);
  const extra = withFocus({ ...good, evil: "x" }).data.focus;
  assert.equal("evil" in extra, false);
});
