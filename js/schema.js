// Data model v1: constants, defaults and the validator.
// Everything that comes from localStorage, a backup file or a share link
// goes through validate() before the app touches it. Never trust stored data.

export const VERSION = 1;
export const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const KINDS = ["study", "lecture", "nap", "rest"];
export const THEMES = ["auto", "light", "dark"];
export const LEADS = [5, 10, 15, 30];
export const SNOOZES = [5, 10];
export const PALETTE_SIZE = 12; // colors are CSS classes .c-0 … .c-11

export const LIMITS = {
  title: 60,          // block title
  name: 40,           // profile, category and counter names
  projectTitle: 80,
  note: 300,
  date: 40,
  id: 40,
  blocks: 300,
  categories: 30,
  projects: 200,
  counters: 20,
  goals: 30,
  weeks: 60,          // weeks of progress kept
  count: 100000,
  maxTime: 1800,      // 30 h study day, in minutes
  depth: 8,           // max nesting of any input
  errors: 50,
  importBytes: 256 * 1024,
};

const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ID_RE = /^[A-Za-z0-9_-]+$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEK_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// C0 controls except \n, DEL, C1 controls, and the Unicode line/paragraph separators
const CTRL_RE = /[\x00-\x09\x0B-\x1F\x7F-\x9F\u{2028}\u{2029}]/gu;

export function uid() {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

export function defaultState() {
  const wake = {};
  for (const d of DAYS) wake[d] = "08:00";
  return {
    v: VERSION,
    profile: { name: "", bedtime: "23:30", wake },
    categories: [],
    blocks: [],
    progress: {},
    projects: [],
    counters: [],
    goals: [],
    focus: null,  // running focus timer, see focus.js
    settings: { remind: false, alarms: true, lead: 10, snooze: 10, lastBackup: 0, theme: "auto", maxStudyPerDay: 600, threeTouches: false },
  };
}

// ---------- small checkers ----------

export function isPlainObject(x) {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const p = Object.getPrototypeOf(x);
  return p === Object.prototype || p === null;
}

// True if any own key at any depth is __proto__/constructor/prototype,
// or the input is nested deeper than LIMITS.depth.
export function hasBadKeys(x, depth = 0) {
  if (typeof x !== "object" || x === null) return false;
  if (depth > LIMITS.depth) return true;
  for (const k of Object.keys(x)) {
    if (BAD_KEYS.has(k)) return true;
    if (hasBadKeys(x[k], depth + 1)) return true;
  }
  return false;
}

// Cleans a user string: control chars removed, whitespace trimmed, cut to max
// code points (never splits an emoji). Returns null if not a string.
export function cleanText(s, max, { multiline = false } = {}) {
  if (typeof s !== "string") return null;
  let t = s.length > max * 4 + 16 ? s.slice(0, max * 4 + 16) : s; // cheap pre-cut for huge strings
  if (!multiline) t = t.replace(/\n/g, " ");
  t = t.replace(CTRL_RE, "").trim();
  const cps = Array.from(t);
  return cps.length > max ? cps.slice(0, max).join("").trim() : t;
}

export const isId = s => typeof s === "string" && s.length >= 1 && s.length <= LIMITS.id && ID_RE.test(s);
export const isHHMM = s => typeof s === "string" && HHMM_RE.test(s);
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

export function isWeekKey(s) {
  if (typeof s !== "string") return false;
  const m = WEEK_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

// ---------- validator ----------

// Returns { ok, data, errors }.
// ok=false: the input is unusable (wrong shape, wrong version, hostile keys); data is null.
// ok=true:  data is a fresh, fully cleaned object; errors lists anything dropped or defaulted.
export function validate(raw) {
  const errors = [];
  const note = msg => { if (errors.length < LIMITS.errors) errors.push(msg); };

  if (!isPlainObject(raw)) return { ok: false, data: null, errors: ["Not a tracker data object."] };
  if (hasBadKeys(raw)) return { ok: false, data: null, errors: ["Data contains forbidden keys or is nested too deeply."] };
  if (raw.v !== VERSION) return { ok: false, data: null, errors: ["Unsupported data version."] };

  const out = defaultState();

  // profile
  const p = isPlainObject(raw.profile) ? raw.profile : {};
  if (raw.profile !== undefined && !isPlainObject(raw.profile)) note("profile was invalid and was reset.");
  const name = cleanText(p.name, LIMITS.name);
  if (name !== null) out.profile.name = name;
  if (isHHMM(p.bedtime)) out.profile.bedtime = p.bedtime;
  else if (p.bedtime !== undefined) note("bedtime was invalid and was reset.");
  const w = isPlainObject(p.wake) ? p.wake : {};
  for (const d of DAYS) {
    if (isHHMM(w[d])) out.profile.wake[d] = w[d];
    else if (w[d] !== undefined) note(`wake time for ${d} was invalid and was reset.`);
  }

  // categories
  const catIds = new Set();
  for (const c of arr(raw.categories, "categories", note)) {
    if (out.categories.length >= LIMITS.categories) { note("Too many categories; extras dropped."); break; }
    if (!isPlainObject(c) || !isId(c.id) || catIds.has(c.id)) { note("A category had a bad or duplicate id and was dropped."); continue; }
    const cname = cleanText(c.name, LIMITS.name);
    if (!cname) { note("A category had no name and was dropped."); continue; }
    const color = isInt(c.color, 0, PALETTE_SIZE - 1) ? c.color : 0;
    catIds.add(c.id);
    out.categories.push({ id: c.id, name: cname, color });
  }

  // blocks
  const blockIds = new Set();
  for (const b of arr(raw.blocks, "blocks", note)) {
    if (out.blocks.length >= LIMITS.blocks) { note(`More than ${LIMITS.blocks} blocks; extras dropped.`); break; }
    if (!isPlainObject(b) || !isId(b.id) || blockIds.has(b.id)) { note("A block had a bad or duplicate id and was dropped."); continue; }
    if (!DAYS.includes(b.day)) { note("A block had an unknown day and was dropped."); continue; }
    if (!KINDS.includes(b.kind)) { note("A block had an unknown kind and was dropped."); continue; }
    if (!isInt(b.start, 0, LIMITS.maxTime) || !isInt(b.end, 0, LIMITS.maxTime) || b.end <= b.start) {
      note("A block had invalid times and was dropped."); continue;
    }
    const title = cleanText(b.title, LIMITS.title);
    if (!title) { note("A block had no title and was dropped."); continue; }
    let cat = null;
    if (b.cat !== undefined && b.cat !== null) {
      if (isId(b.cat) && catIds.has(b.cat)) cat = b.cat;
      else note(`Block "${title}" pointed at a missing category; category cleared.`);
    }
    blockIds.add(b.id);
    const block = { id: b.id, day: b.day, start: b.start, end: b.end, title, kind: b.kind, cat };
    if (b.gen === true && b.kind === "study") block.gen = true; // made by the week generator
    out.blocks.push(block);
  }

  // progress: only weeks with valid keys, only ticks for study blocks that exist
  const studyIds = new Set(out.blocks.filter(b => b.kind === "study").map(b => b.id));
  if (raw.progress !== undefined && !isPlainObject(raw.progress)) note("progress was invalid and was reset.");
  const prog = isPlainObject(raw.progress) ? raw.progress : {};
  const weeks = Object.keys(prog).filter(isWeekKey).sort().slice(-LIMITS.weeks);
  for (const wk of weeks) {
    const src = prog[wk];
    if (!isPlainObject(src)) continue;
    const dst = {};
    let any = false;
    for (const id of Object.keys(src)) {
      if (src[id] === true && studyIds.has(id)) { dst[id] = true; any = true; }
    }
    if (any) out.progress[wk] = dst;
  }

  // focus timer: anything off → no timer, never a half-valid one
  out.focus = cleanFocus(raw.focus, studyIds);
  if (raw.focus != null && !out.focus) note("The focus timer was invalid and was cleared.");

  // goals (week generator): hours in quarter-hours, sessions in 15-min steps
  const goalIds = new Set();
  for (const g of arr(raw.goals, "goals", note)) {
    if (out.goals.length >= LIMITS.goals) { note("Too many goals; extras dropped."); break; }
    if (!isPlainObject(g) || !isId(g.id) || goalIds.has(g.id)) { note("A goal had a bad or duplicate id and was dropped."); continue; }
    const gtitle = cleanText(g.title, LIMITS.name);
    const hrs = g.hoursPerWeek;
    const okHrs = typeof hrs === "number" && Number.isFinite(hrs) && hrs >= 0.5 && hrs <= 60 && Number.isInteger(hrs * 4);
    const okSess = n => isInt(n, 15, 300) && n % 15 === 0;
    if (!gtitle || !okHrs || !okSess(g.sessionMin) || !okSess(g.sessionMax) || g.sessionMin > g.sessionMax) {
      note("A goal had invalid values and was dropped."); continue;
    }
    goalIds.add(g.id);
    out.goals.push({ id: g.id, title: gtitle, cat: isId(g.cat) && catIds.has(g.cat) ? g.cat : null, hoursPerWeek: hrs, sessionMin: g.sessionMin, sessionMax: g.sessionMax });
  }

  // projects
  const projIds = new Set();
  for (const pj of arr(raw.projects, "projects", note)) {
    if (out.projects.length >= LIMITS.projects) { note("Too many projects; extras dropped."); break; }
    if (!isPlainObject(pj) || !isId(pj.id) || projIds.has(pj.id)) { note("A project had a bad or duplicate id and was dropped."); continue; }
    const title = cleanText(pj.title, LIMITS.projectTitle);
    if (!title) { note("A project had no title and was dropped."); continue; }
    projIds.add(pj.id);
    out.projects.push({
      id: pj.id,
      title,
      note: cleanText(pj.note, LIMITS.note, { multiline: true }) ?? "",
      date: cleanText(pj.date, LIMITS.date) ?? "",
    });
  }

  // counters
  const ctrIds = new Set();
  for (const c of arr(raw.counters, "counters", note)) {
    if (out.counters.length >= LIMITS.counters) { note("Too many counters; extras dropped."); break; }
    if (!isPlainObject(c) || !isId(c.id) || ctrIds.has(c.id)) { note("A counter had a bad or duplicate id and was dropped."); continue; }
    const cname = cleanText(c.name, LIMITS.name);
    if (!cname) { note("A counter had no name and was dropped."); continue; }
    ctrIds.add(c.id);
    out.counters.push({ id: c.id, name: cname, count: isInt(c.count, 0, LIMITS.count) ? c.count : 0 });
  }

  // settings
  const s = isPlainObject(raw.settings) ? raw.settings : {};
  if (typeof s.remind === "boolean") out.settings.remind = s.remind;
  if (LEADS.includes(s.lead)) out.settings.lead = s.lead;
  if (SNOOZES.includes(s.snooze)) out.settings.snooze = s.snooze;
  if (isInt(s.lastBackup, 0, 8.64e15)) out.settings.lastBackup = s.lastBackup;
  if (THEMES.includes(s.theme)) out.settings.theme = s.theme;
  if (typeof s.alarms === "boolean") out.settings.alarms = s.alarms;
  if (isInt(s.maxStudyPerDay, 60, 960) && s.maxStudyPerDay % 30 === 0) out.settings.maxStudyPerDay = s.maxStudyPerDay;
  if (typeof s.threeTouches === "boolean") out.settings.threeTouches = s.threeTouches;

  return { ok: true, data: out, errors };
}

function arr(x, label, note) {
  if (x === undefined) return [];
  if (!Array.isArray(x)) { note(`${label} was not a list and was reset.`); return []; }
  return x;
}

const MAX_MS = 8.64e15; // largest valid Date value

function cleanFocus(f, studyIds) {
  if (!isPlainObject(f)) return null;
  if (!isId(f.blockId) || !studyIds.has(f.blockId) || !isWeekKey(f.date)) return null;
  if (!isInt(f.startedAt, 0, MAX_MS) || !isInt(f.pausedMs, 0, MAX_MS) || !isInt(f.durationMin, 1, LIMITS.maxTime)) return null;
  if (f.pausedAt !== null && !isInt(f.pausedAt, f.startedAt, MAX_MS)) return null;
  return { blockId: f.blockId, date: f.date, startedAt: f.startedAt, pausedAt: f.pausedAt, pausedMs: f.pausedMs, durationMin: f.durationMin };
}
