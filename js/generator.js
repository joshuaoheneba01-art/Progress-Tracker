// Week generator: fills free time with study sessions for the user's goals.
// Pure and deterministic: the same timetable and goals always give the same
// week. Blocks the user made by hand are never moved; only blocks marked
// gen: true (made by an earlier run) are replaced.
//
// Rules
// - Free time is 30 min after waking → bedtime, minus every hand-made block. Lectures
//   get a 30 min buffer on both sides. Blocks running past midnight count on
//   the next morning, and the window ends early if needed to keep 7 h of sleep.
// - Study you already placed by hand for a goal's subject counts toward it.
// - Sessions are 15-minute multiples between the goal's min and max.
// - Biggest goals first. Each session goes to a day without that subject yet,
//   then the day with the least study, then the earliest slot that fits under
//   the daily limit, with a 15 min break after it.
// - "3 touches" (optional): for a subject with lectures, the first sessions
//   go the day before and the day after its first lecture of the week.

import { DAYS, LIMITS, PALETTE_SIZE, cleanText, uid } from "./schema.js";
import { parseHHMM, bedtimeMin, dur, MIN_SLEEP, fmtDuration } from "./schedule.js";

const DAY_MIN = 1440, WEEK_MIN = 7 * DAY_MIN;
export const LECTURE_BUFFER = 30, WAKE_BUFFER = 30, BREAK = 15, STEP = 15;
export const SESSION_CHOICES = [30, 45, 60, 90, 120, 150, 180, 240];

const ceil15 = n => Math.ceil(n / STEP) * STEP;
const floor15 = n => Math.floor(n / STEP) * STEP;

// ---------- intervals: sorted [[from, to), …] ----------

export function subtract(free, a, b) {
  const out = [];
  for (const [x, y] of free) {
    if (b <= x || a >= y) { out.push([x, y]); continue; }
    if (a > x) out.push([x, a]);
    if (b < y) out.push([b, y]);
  }
  return out;
}

// Free minutes per day (study-day minutes), before any generated block.
export function freeTime(state, base) {
  const bed = bedtimeMin(state.profile.bedtime);
  const free = {};
  DAYS.forEach((day, di) => {
    const wake = parseHHMM(state.profile.wake[day]) + WAKE_BUFFER;
    const nextWake = parseHHMM(state.profile.wake[DAYS[(di + 1) % 7]]) + DAY_MIN;
    const end = Math.min(bed, nextWake - MIN_SLEEP);
    let f = end > wake ? [[wake, end]] : [];
    for (const b of base) {
      const buf = b.kind === "lecture" ? LECTURE_BUFFER : 0;
      const offset = (DAYS.indexOf(b.day) - di) * DAY_MIN;
      for (const shift of [-WEEK_MIN, 0, WEEK_MIN]) {
        f = subtract(f, offset + shift + b.start - buf, offset + shift + b.end + buf);
      }
    }
    free[day] = f;
  });
  return free;
}

// Split `minutes` into session lengths between smin and smax (15-min steps).
// Returns { lengths, leftover } where leftover (< smin) couldn't be scheduled.
export function sessionsFor(minutes, smin, smax) {
  const q = ceil15(Math.max(0, minutes));
  if (q === 0) return { lengths: [], leftover: 0 };
  if (q < smin) return { lengths: [], leftover: q };
  const n = Math.ceil(q / smax);
  const len = floor15(q / n);
  if (len >= smin) {
    const lengths = Array(n).fill(len);
    for (let i = 0, extra = (q - len * n) / STEP; i < extra; i++) lengths[i] += STEP;
    return { lengths, leftover: 0 };
  }
  // Can't split evenly inside [smin, smax]: as many full sessions as fit.
  const n2 = Math.floor(q / smin);
  const len2 = Math.min(smax, floor15(q / n2));
  return { lengths: Array(n2).fill(len2), leftover: q - n2 * len2 };
}

// Earliest slot of exactly `len` minutes, or (fit mode) the earliest slot of
// at least `min` minutes, as long as possible up to `len`.
function findSlot(intervals, len, capLeft, min = len) {
  for (const [a, b] of intervals) {
    const s = ceil15(a);
    const room = floor15(Math.min(b - s, capLeft, len));
    if (room >= min) return [s, s + room];
  }
  return null;
}

// ---------- the generator ----------

// Returns {
//   blocks:    the full new block list (hand-made + generated),
//   generated: the generated blocks,
//   goals:     per goal { id, title, targetMin, haveMin, placedMin, missingMin, reason },
//   notes:     plain-language remarks
// }
export function generateWeek(state) {
  const base = state.blocks.filter(b => !b.gen);
  const free = freeTime(state, base);
  const cap = state.settings.maxStudyPerDay;
  const studyMin = Object.fromEntries(DAYS.map(d => [d, 0]));
  for (const b of base) if (b.kind === "study") studyMin[b.day] += dur(b);

  const notes = [];
  const generated = [];
  const report = [];

  const goals = [...state.goals].sort((a, b) => b.hoursPerWeek - a.hoursPerWeek || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  for (const g of goals) {
    const mine = g.cat ? base.filter(b => b.kind === "study" && b.cat === g.cat) : [];
    const targetMin = Math.round(g.hoursPerWeek * 60);
    const haveMin = mine.reduce((s, b) => s + dur(b), 0);
    const r = { id: g.id, title: g.title, targetMin, haveMin, placedMin: 0, missingMin: 0, reason: null };
    report.push(r);
    if (haveMin >= targetMin) continue;

    const { lengths, leftover } = sessionsFor(targetMin - haveMin, g.sessionMin, g.sessionMax);
    if (leftover) notes.push(`${g.title}: ${fmtDuration(leftover)} left over is shorter than your ${fmtDuration(g.sessionMin)} minimum session, so it wasn't scheduled.`);

    const goalDays = new Set(mine.map(b => b.day));
    const prefs = [];
    if (state.settings.threeTouches && g.cat) {
      const lec = DAYS.find(d => base.some(b => b.kind === "lecture" && b.cat === g.cat && b.day === d));
      if (lec) { const i = DAYS.indexOf(lec); prefs.push(DAYS[(i + 6) % 7], DAYS[(i + 1) % 7]); }
    }

    let n = 0;
    lengths.forEach((len, k) => {
      const order = [...DAYS].sort((a, b) =>
        (a === prefs[k] ? 0 : 1) - (b === prefs[k] ? 0 : 1)
        || (goalDays.has(a) ? 1 : 0) - (goalDays.has(b) ? 1 : 0)
        || studyMin[a] - studyMin[b]
        || DAYS.indexOf(a) - DAYS.indexOf(b));
      // First the full length on the best day; failing that, the longest
      // piece (at least the minimum) that fits anywhere, in the same day order.
      for (const min of len > g.sessionMin ? [len, g.sessionMin] : [len]) {
        for (const day of order) {
          const slot = findSlot(free[day], len, cap - studyMin[day], min);
          if (!slot) continue;
          const got = slot[1] - slot[0];
          generated.push({ id: `g-${g.id}-${n++}`, day, start: slot[0], end: slot[1], title: `${g.title} · study`, kind: "study", cat: g.cat, gen: true });
          free[day] = subtract(free[day], slot[0], slot[1] + BREAK);
          studyMin[day] += got;
          goalDays.add(day);
          r.placedMin += got;
          return;
        }
      }
    });

    r.missingMin = Math.max(0, targetMin - haveMin - r.placedMin - leftover);
    if (r.missingMin) {
      const anyRoom = DAYS.some(d => findSlot(free[d], g.sessionMin, Infinity));
      r.reason = anyRoom
        ? `your daily study limit of ${fmtDuration(cap)} is reached on the days with free time`
        : `no free ${fmtDuration(g.sessionMin)} slot is left in your week`;
    }
  }

  const bed = bedtimeMin(state.profile.bedtime);
  const shortNights = DAYS.filter((d, i) => parseHHMM(state.profile.wake[DAYS[(i + 1) % 7]]) + DAY_MIN - bed < MIN_SLEEP);
  if (shortNights.length) notes.push("Your bedtime and wake times leave under 7 h of sleep on some nights, so study was kept earlier in the evening.");

  return { blocks: [...base, ...generated], generated, goals: report, notes };
}

// ---------- goals editor ----------

// Form → goal. d: { subject, hours, smin, smax }. Creates the subject if new.
// Returns { state, errors } (state untouched on errors).
export function goalFromDraft(d, state, id = uid()) {
  const errors = [];
  const subject = cleanText(d.subject ?? "", LIMITS.name);
  const hours = Math.round(parseFloat(d.hours) * 4) / 4;
  const smin = +d.smin, smax = +d.smax;
  if (!subject) errors.push("Type the course or subject.");
  if (!(hours >= 0.5 && hours <= 60)) errors.push("Hours per week must be between 0.5 and 60.");
  if (!SESSION_CHOICES.includes(smin) || !SESSION_CHOICES.includes(smax)) errors.push("Pick session lengths.");
  else if (smin > smax) errors.push("The shortest session can't be longer than the longest.");
  const isNew = !state.goals.some(g => g.id === id);
  if (isNew && state.goals.length >= LIMITS.goals) errors.push(`You can have up to ${LIMITS.goals} goals.`);
  if (subject && state.goals.some(g => g.id !== id && g.title.toLowerCase() === subject.toLowerCase())) errors.push(`There is already a goal for "${subject}".`);
  if (errors.length) return { state, errors };

  const next = structuredClone(state);
  let cat = next.categories.find(c => c.name.toLowerCase() === subject.toLowerCase());
  if (!cat) {
    if (next.categories.length >= LIMITS.categories) return { state, errors: [`You can have up to ${LIMITS.categories} subjects.`] };
    cat = { id: uid(), name: subject, color: next.categories.length % PALETTE_SIZE };
    next.categories.push(cat);
  }
  const goal = { id, title: cat.name, cat: cat.id, hoursPerWeek: hours, sessionMin: smin, sessionMax: smax };
  const i = next.goals.findIndex(g => g.id === id);
  if (i >= 0) next.goals[i] = goal; else next.goals.push(goal);
  return { state: next, errors: [] };
}
