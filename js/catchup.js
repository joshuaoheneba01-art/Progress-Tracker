// Catch-up: study blocks missed in the last 7 days, free slots to make them
// up, and one-off make-up blocks ("extras") on a specific date. Pure.

import { uid } from "./schema.js";
import { studyDayOf, weekKey, isoDate, addDays, dayKey, blocksForDay, extrasOn, parseISODate } from "./schedule.js";
import { freeTime, subtract, BREAK, STEP } from "./generator.js";

export const LOOKBACK_DAYS = 7, AHEAD_DAYS = 7, SUGGESTIONS = 3;
const KEEP_UNTICKED_EXTRAS_DAYS = 60, KEEP_DISMISSED_DAYS = 14;

// Missed = an unticked study block (or make-up) from the last 7 days, or one
// from today that has already ended. Not counted: ones already rescheduled,
// ones the user skipped, and anything from before the app was set up.
// Returns oldest first: [{ key, date, day, id, title, start, end, cat, extra }]
export function missedBlocks(state, now) {
  const bedtime = state.profile.bedtime;
  const sd = studyDayOf(now, bedtime);
  let since = null, sinceMin = 0;
  if (state.settings.startedAt) {
    const s = studyDayOf(new Date(state.settings.startedAt), bedtime);
    since = isoDate(s.date);
    sinceMin = s.minute;
  }
  const handled = new Set([
    ...state.extras.filter(e => e.from && e.fromDate).map(e => `${e.fromDate}@${e.from}`),
    ...state.dismissed,
  ]);
  const out = [];
  for (let i = LOOKBACK_DAYS; i >= 0; i--) {
    const date = addDays(sd.date, -i);
    const iso = isoDate(date), day = dayKey(date);
    if (since && iso < since) continue;
    const ticks = state.progress[weekKey(date)] || {};
    for (const b of [...blocksForDay(state.blocks, day), ...extrasOn(state, iso)].sort((a, c) => a.start - c.start)) {
      if (b.kind !== "study" || ticks[b.id]) continue;
      if (i === 0 && b.end > sd.minute) continue;            // today: only blocks that are over
      if (iso === since && b.end <= sinceMin) continue;      // ended before the app was set up
      const key = `${iso}@${b.id}`;
      if (handled.has(key)) continue;
      out.push({ key, date: iso, day, id: b.id, title: b.title, start: b.start, end: b.end, cat: b.cat, extra: !!b.extra });
    }
  }
  return out;
}

// Earliest free slot of `len` minutes on each of the next days (today first,
// starting at least 15 min from now), up to `limit` days. Uses the same free
// time as the week generator (wake + 30 min → bedtime, lectures buffered,
// 7 h of sleep kept) and also avoids make-ups already on that date.
export function suggestSlots(state, now, len, limit = SUGGESTIONS) {
  const sd = studyDayOf(now, state.profile.bedtime);
  const free = freeTime(state, state.blocks);
  const out = [];
  for (let i = 0; i < AHEAD_DAYS && out.length < limit; i++) {
    const date = addDays(sd.date, i);
    const iso = isoDate(date), day = dayKey(date);
    let f = free[day];
    for (const e of extrasOn(state, iso)) f = subtract(f, e.start - BREAK, e.end + BREAK);
    if (i === 0) f = subtract(f, -Infinity, sd.minute + 15);
    for (const [a, b] of f) {
      const start = Math.ceil(a / STEP) * STEP;
      if (start + len <= b) { out.push({ date: iso, day, start, end: start + len }); break; }
    }
  }
  return out;
}

export function makeExtra(missed, slot, id = uid()) {
  const base = missed.title.replace(/ · catch-up$/, "");
  return { id, date: slot.date, start: slot.start, end: slot.end, title: `${base} · catch-up`, cat: missed.cat, from: missed.id, fromDate: missed.date };
}

// Housekeeping: drop unticked make-ups older than 60 days and skips older
// than 14 days. Ticked make-ups stay (they count in that week's history)
// until the 100-extras cap pushes the oldest out.
export function pruneCatchup(state, now) {
  const today = studyDayOf(now, state.profile.bedtime).date;
  const cutExtras = isoDate(addDays(today, -KEEP_UNTICKED_EXTRAS_DAYS));
  const cutDismissed = isoDate(addDays(today, -KEEP_DISMISSED_DAYS));
  const ticked = e => !!(state.progress[weekKey(parseISODate(e.date))] || {})[e.id];
  return {
    extras: state.extras.filter(e => e.date >= cutExtras || ticked(e)),
    dismissed: state.dismissed.filter(k => k.slice(0, 10) >= cutDismissed),
  };
}
