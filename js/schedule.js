// Pure time and schedule logic. No DOM, no storage.
// Times are minutes from midnight of the *study day* (0–1800). A study day
// runs until bedtime, so with bedtime 03:30 a 1:30am block is 1530 on the
// day it started. Local wall-clock time only.

import { DAYS, KINDS, LIMITS, PALETTE_SIZE, cleanText, isHHMM, uid } from "./schema.js";

const DAY_MIN = 1440;
const WEEK_MIN = 7 * DAY_MIN;
const pad = n => String(n).padStart(2, "0");

// ---------- parsing and formatting ----------

export function parseHHMM(s) {
  const [h, m] = s.split(":");
  return +h * 60 + +m;
}

// Bedtime as a study-day minute. Anything before noon is "after midnight".
// "23:30" → 1410, "03:30" → 1650.
export function bedtimeMin(bedtime) {
  const m = parseHHMM(bedtime);
  return m < 720 ? m + DAY_MIN : m;
}

// Study-day minute → "HH:MM" wall clock (for <input type="time">).
export function toHHMM(min) {
  const c = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return pad(Math.floor(c / 60)) + ":" + pad(c % 60);
}

// Two wall-clock inputs → { start, end } in study-day minutes.
// A time before tonight's (after-midnight) bedtime is read as next morning,
// and an end at or before the start rolls past midnight.
export function inputToRange(startHHMM, endHHMM, bedtime) {
  const bed = bedtimeMin(bedtime);
  const lift = m => (bed > DAY_MIN && m < bed - DAY_MIN ? m + DAY_MIN : m);
  const start = lift(parseHHMM(startHHMM));
  let end = lift(parseHHMM(endHHMM));
  if (end <= start) end += DAY_MIN;
  return { start, end };
}

function clock(min) {
  const c = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h = Math.floor(c / 60);
  return { h: h % 12 || 12, m: c % 60, s: h < 12 ? "am" : "pm" };
}

// 990 → "4:30pm"
export function fmtTime(min) {
  const a = clock(min);
  return a.h + ":" + pad(a.m) + a.s;
}

// (990, 1170) → "4:30–7:30pm"; (1380, 1530) → "11:00pm–1:30am"
export function fmtRange(start, end) {
  const a = clock(start), b = clock(end);
  return a.h + ":" + pad(a.m) + (a.s !== b.s ? a.s : "") + "–" + b.h + ":" + pad(b.m) + b.s;
}

// Minutes → hours text: 150 → "2.5", 120 → "2"
export function fmtHours(min) {
  const r = Math.round(min / 6) / 10;
  return r % 1 === 0 ? r.toFixed(0) : r.toFixed(1);
}

// ---------- dates ----------

export const dayKey = d => DAYS[(d.getDay() + 6) % 7];
export const isoDate = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Which study day `now` belongs to, and how far into it we are.
// Returns { date: Date at local noon of that day, day: "MON", minute }.
export function studyDayOf(now, bedtime) {
  const bed = bedtimeMin(bedtime);
  const d = new Date(now);
  let minute = d.getHours() * 60 + d.getMinutes();
  if (bed > DAY_MIN && minute < bed - DAY_MIN) {
    d.setDate(d.getDate() - 1);
    minute += DAY_MIN;
  }
  d.setHours(12, 0, 0, 0); // noon keeps date maths clear of DST jumps
  return { date: d, day: dayKey(d), minute };
}

// Monday (local noon) of the week containing `date`.
export function weekStart(date) {
  const x = new Date(date);
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export const weekKey = date => isoDate(weekStart(date));

// ---------- blocks ----------

export const isTickable = b => b.kind === "study";
export const dur = b => b.end - b.start;

export function blocksForDay(blocks, day) {
  return blocks.filter(b => b.day === day).sort((a, b) => a.start - b.start || a.end - b.end);
}

// Position in the week as [from, to) minutes, Monday 00:00 = 0.
function weekSpan(b) {
  const from = DAYS.indexOf(b.day) * DAY_MIN + b.start;
  return [from, from + dur(b)];
}

// True if two blocks share any time. Touching (one ends as the next starts)
// is fine. Works across days: a MON block till 3am clashes with a TUE 1am
// block, and a late SUN block wraps round to Monday morning.
export function blocksOverlap(a, b) {
  const [a0, a1] = weekSpan(a), [b0, b1] = weekSpan(b);
  for (const shift of [-WEEK_MIN, 0, WEEK_MIN]) {
    if (a0 < b1 + shift && b0 + shift < a1) return true;
  }
  return false;
}

// Every overlapping pair in a list of blocks.
export function findOverlaps(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocksOverlap(blocks[i], blocks[j])) out.push([blocks[i], blocks[j]]);
    }
  }
  return out;
}

// Editor check for one new or edited block against the rest.
// Returns a list of plain-language problems (empty = OK).
export function checkBlock(cand, blocks) {
  const errs = [];
  if (!Number.isInteger(cand.start) || !Number.isInteger(cand.end) || cand.start < 0 || cand.end > LIMITS.maxTime) {
    errs.push("Times must fall within the study day (up to 6:00am the next morning).");
  } else if (cand.end <= cand.start) {
    errs.push("The end time must be after the start time.");
  }
  if (!errs.length) {
    for (const b of blocks) {
      if (b.id !== cand.id && blocksOverlap(cand, b)) {
        errs.push(`Overlaps "${b.title}" (${b.day} ${fmtRange(b.start, b.end)}).`);
      }
    }
  }
  return errs;
}

// What's on now and what's next, for a day's blocks and a study-day minute.
export function currentAndNext(dayBlocks, minute) {
  let cur = null, next = null;
  for (const b of dayBlocks) {
    if (b.start <= minute && minute < b.end) { if (!cur) cur = b; }
    else if (b.start > minute && !next) next = b;
  }
  return { cur, next };
}

// ---------- stats ----------
// `mins` is keyed by category id; uncategorised study time goes under "".

// "2026-10-05" → Date at local noon
export function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

// The calendar date of a weekday in a week: ("2026-09-28", "WED") → "2026-09-30"
export const dateFor = (wk, day) => isoDate(addDays(parseISODate(wk), DAYS.indexOf(day)));

// One-off make-up blocks on a date, shaped like blocks (kind study, day set).
export function extrasOn(state, iso) {
  const day = dayKey(parseISODate(iso));
  return (state.extras || []).filter(e => e.date === iso).map(e => ({ ...e, day, kind: "study", extra: true }));
}

// A weekly block or a make-up, by id.
export const findBlock = (state, id) => state.blocks.find(b => b.id === id) || (state.extras || []).find(e => e.id === id) || null;

export function dayStats(state, wk, day) {
  const ticks = state.progress[wk] || {};
  let tot = 0, done = 0;
  const mins = {};
  for (const b of [...state.blocks, ...extrasOn(state, dateFor(wk, day))]) {
    if (b.day !== day || !isTickable(b)) continue;
    tot++;
    if (ticks[b.id]) {
      done++;
      const k = b.cat || "";
      mins[k] = (mins[k] || 0) + dur(b);
    }
  }
  return { tot, done, mins };
}

export function weekStats(state, wk) {
  let tot = 0, done = 0;
  const mins = {};
  for (const d of DAYS) {
    const s = dayStats(state, wk, d);
    tot += s.tot;
    done += s.done;
    for (const k in s.mins) mins[k] = (mins[k] || 0) + s.mins[k];
  }
  return { tot, done, mins };
}

// Planned study minutes per category for a whole week.
export function planned(state) {
  const mins = {};
  for (const b of state.blocks) {
    if (!isTickable(b)) continue;
    const k = b.cat || "";
    mins[k] = (mins[k] || 0) + dur(b);
  }
  return mins;
}

export const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

// Consecutive study days with at least 60% of study blocks ticked, counting
// back from today. Today not being done yet doesn't break it, and days with
// no study blocks (a free Sunday) are skipped rather than breaking it.
export function streak(state, now, threshold = 0.6) {
  const today = studyDayOf(now, state.profile.bedtime).date;
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const d = addDays(today, -i);
    const s = dayStats(state, weekKey(d), dayKey(d));
    if (!s.tot) continue;
    if (s.done / s.tot >= threshold) n++;
    else if (i > 0) break;
  }
  return n;
}

// ---------- editing ----------

const DEFAULT_TITLE = { nap: "Nap", rest: "Wind down" };

// Editor form → block. `d` holds raw form values:
// { title, kind, cat, day, start: "HH:MM", end: "HH:MM" }.
// Returns { block, errors }; block is only safe to save when errors is empty.
export function draftToBlock(d, state, id = uid()) {
  const errors = [];
  const kind = KINDS.includes(d.kind) ? d.kind : "study";
  const title = cleanText(d.title ?? "", LIMITS.title) || DEFAULT_TITLE[kind] || "";
  if (!title) errors.push("Give the block a title.");
  if (!DAYS.includes(d.day)) errors.push("Pick a day.");
  if (!isHHMM(d.start) || !isHHMM(d.end)) {
    errors.push("Pick a start and an end time.");
    return { block: null, errors };
  }
  const { start, end } = inputToRange(d.start, d.end, state.profile.bedtime);
  const cat = (kind === "study" || kind === "lecture") && state.categories.some(c => c.id === d.cat) ? d.cat : null;
  const block = { id, day: d.day, start, end, title, kind, cat };
  if (!errors.length) errors.push(...checkBlock(block, state.blocks));
  if (!state.blocks.some(b => b.id === id) && state.blocks.length >= LIMITS.blocks) {
    errors.push(`You can have up to ${LIMITS.blocks} blocks.`);
  }
  return { block, errors };
}

// Wizard helper: add the same block on several days, creating the course or
// subject category if needed. All or nothing: on any problem the state is
// returned untouched with the reasons.
// opts: { kind, subject, days: ["MON", …], start: "HH:MM", end: "HH:MM" }
export function addRecurring(state, opts) {
  const errors = [];
  const days = DAYS.filter(d => (opts.days || []).includes(d));
  if (!days.length) errors.push("Pick at least one day.");
  const subject = cleanText(opts.subject ?? "", LIMITS.name);
  const needsSubject = opts.kind === "study" || opts.kind === "lecture";
  if (needsSubject && !subject) errors.push("Type the course or subject name.");
  if (errors.length) return { state, errors };

  const next = structuredClone(state);
  let cat = null, title = subject;
  if (needsSubject) {
    const found = next.categories.find(c => c.name.toLowerCase() === subject.toLowerCase());
    if (found) { cat = found.id; title = found.name; }
    else if (next.categories.length >= LIMITS.categories) return { state, errors: [`You can have up to ${LIMITS.categories} subjects.`] };
    else {
      cat = uid();
      next.categories.push({ id: cat, name: subject, color: next.categories.length % PALETTE_SIZE });
    }
  }
  for (const day of days) {
    const r = draftToBlock({ title, kind: opts.kind, cat, day, start: opts.start, end: opts.end }, next);
    if (r.errors.length) return { state, errors: r.errors.map(e => `${day}: ${e}`) };
    next.blocks.push(r.block);
  }
  return { state: next, errors: [] };
}

// ---------- sleep guard ----------

export const MIN_SLEEP = 7 * 60;

// 285 → "4 h 45 min", 420 → "7 h"
export function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const DAY_SHORT = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };

// Sleep before each day. The night before D runs from the later of bedtime
// and the previous day's last block, to the earlier of D's wake time and
// D's first block. D's naps are added. Under 7 h gets a warning that names
// the block cutting into sleep.
// Returns [{ day, nightMin, napMin, totalMin, ok, late, early, message }].
export function sleepReport(state) {
  const bed = bedtimeMin(state.profile.bedtime);
  return DAYS.map((day, i) => {
    const prevDay = DAYS[(i + 6) % 7];
    const prev = state.blocks.filter(b => b.day === prevDay);
    const today = state.blocks.filter(b => b.day === day);
    const wake = parseHHMM(state.profile.wake[day]);

    const lastBlock = prev.reduce((a, b) => (!a || b.end > a.end ? b : a), null);
    const firstBlock = today.reduce((a, b) => (!a || b.start < a.start ? b : a), null);
    const late = lastBlock && lastBlock.end > bed ? lastBlock : null;
    const early = firstBlock && firstBlock.start < wake ? firstBlock : null;

    const sleepStart = late ? late.end : bed;               // previous day's minutes
    const sleepEnd = (early ? early.start : wake) + DAY_MIN; // same scale
    const nightMin = Math.max(0, sleepEnd - sleepStart);
    const napMin = today.filter(b => b.kind === "nap").reduce((s, b) => s + dur(b), 0);
    const totalMin = nightMin + napMin;
    const ok = totalMin >= MIN_SLEEP;

    let message = null;
    if (!ok) {
      const head = `${DAY_SHORT[day]}: only ${fmtDuration(totalMin)} of sleep`;
      const lateTxt = late && `"${late.title}" (${DAY_SHORT[prevDay]}) runs until ${fmtTime(late.end)}`;
      const earlyTxt = early && `"${early.title}" starts at ${fmtTime(early.start)}`;
      if (late && early) message = `${head}. ${lateTxt} and ${earlyTxt}. Move one of them.`;
      else if (late) message = `${head}. ${lateTxt}, past your ${fmtTime(bed)} bedtime. Move it earlier.`;
      else if (early) message = `${head}. ${earlyTxt}, before your ${fmtTime(wake)} wake time. Move it later.`;
      else message = `${head} between your ${fmtTime(bed)} bedtime and ${fmtTime(wake)} wake time. Go to bed earlier, wake later or add a nap.`;
    }
    return { day, nightMin, napMin, totalMin, ok, late, early, message };
  });
}
