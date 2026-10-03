// Loading, saving, migration and backups. Every path in and out goes
// through validate(). The store (localStorage) is passed in so tests can
// use a fake one.

import { validate, defaultState, hasBadKeys, isPlainObject, isId, isWeekKey, uid, DAYS, LIMITS } from "./schema.js";
import { parseHHMM, toHHMM, isoDate } from "./schedule.js";

export const KEY = "stick_v1";
export const BROKEN_KEY = "stick_v1_broken";
export const LEGACY_KEY = "mcjayy_tracker_v1";
export const LEGACY_SETTINGS_KEY = "mcjayy_settings_v1";

// ---------- built-in template: McJayy's week ----------
// The original hard-coded week, kept only as template source data.
// Times are "HH:MM" on the study day; hours above 23 run past midnight.
const MCJAYY_WEEK = {
  MON: [["13:00","16:00","nap","NAP · 3 hrs"],["16:30","19:30","uni","CSC 415 · review"],["20:00","22:00","cisco","Cisco JCA · module"],["22:00","24:00","thrive","Thrive · weekly task"],["24:00","27:00","uni","CSC 413 · practice"],["27:00","27:30","wind","Wind down · plan ahead"]],
  TUE: [["08:45","10:45","uni","CSC 405 · prep"],["11:00","13:00","uni","CSC 401 · prep"],["13:00","16:00","nap","NAP · 3 hrs"],["16:30","18:30","cisco","Cisco JCA · module+lab"],["19:30","21:30","thrive","Thrive · brief + start"],["21:30","23:30","cisco","Cisco · revise + quiz"],["23:30","26:00","git","Projects · build"],["26:00","27:00","python","Python practice"],["27:00","27:30","wind","Wind down · plan ahead"]],
  WED: [["10:15","12:15","uni","CSC 411 · prep"],["14:45","15:45","nap","NAP · 1 hr"],["19:00","22:00","uni","CSC 401 · review"],["22:00","24:00","cisco","Cisco JCA · module+lab"],["24:00","25:00","python","Python practice"],["25:00","27:00","git","Projects · build"],["27:00","27:30","wind","Wind down · plan ahead"]],
  THU: [["10:30","12:30","uni","CSC 413 · prep"],["12:30","15:30","nap","NAP · 3 hrs"],["15:30","18:30","uni","CSC 411 · review"],["19:00","22:00","uni","CSC 405 · review"],["22:00","24:00","cisco","Cisco JCA · module+lab"],["24:00","25:30","git","Projects · build"],["25:30","27:00","cisco","Cisco · revise + quiz"],["27:00","27:30","wind","Wind down · plan ahead"]],
  FRI: [["10:00","12:00","cisco","Cisco JCA · module+lab"],["15:00","17:00","nap","NAP · 2 hrs"],["17:00","20:00","uni","CSC 413 · review"],["20:30","23:30","uni","CSC 415 · practice"],["23:30","25:30","cisco","Cisco · Packet Tracer lab"],["25:30","27:00","git","Projects · build"],["27:00","27:30","wind","Wind down · plan ahead"]],
  SAT: [["09:00","10:00","git","Projects · build"],["10:00","13:00","uni","CSC 405 · practice"],["13:00","16:00","nap","NAP · 3 hrs"],["16:00","18:00","cisco","Cisco JCA · module+lab"],["18:00","21:00","uni","CSC 411 · practice"],["21:30","23:30","radar","UCC Radar · build"],["23:30","25:00","python","Python practice"],["25:00","27:00","cisco","Cisco · revise + quiz"],["27:00","27:30","wind","Wind down · plan ahead"]],
  SUN: [["09:30","12:30","uni","CSC 401 · practice"],["13:00","16:00","nap","NAP · 3 hrs"],["16:30","18:30","cisco","Cisco JCA · module+lab"],["19:30","21:30","uni","CSC 415 · prep"],["21:30","22:30","review","Weekly review + plan"],["22:30","24:30","radar","UCC Radar · build"],["24:30","26:00","cisco","Cisco JCA · get ahead"],["26:00","27:00","git","Projects · build"],["27:00","27:30","wind","Wind down · plan ahead"]],
};

const MCJAYY_CATEGORIES = [
  { id: "uni", name: "Uni courses", color: 0 },
  { id: "cisco", name: "Cisco JCA", color: 1 },
  { id: "thrive", name: "Thrive", color: 2 },
  { id: "radar", name: "UCC Radar", color: 3 },
  { id: "python", name: "Python", color: 4 },
  { id: "git", name: "Projects", color: 5 },
  { id: "review", name: "Weekly review", color: 6 },
];

const templateBlockId = (day, start) => `mcj-${day}-${start}`;

// A full, validated state built from McJayy's week. No progress.
export function templateMcJayy({ name = "" } = {}) {
  const s = defaultState();
  s.profile.name = name;
  s.profile.bedtime = "03:30";
  s.categories = MCJAYY_CATEGORIES.map(c => ({ ...c }));
  for (const day of DAYS) {
    for (const [st, en, c, title] of MCJAYY_WEEK[day]) {
      const start = parseHHMM(st), end = parseHHMM(en);
      const kind = c === "nap" ? "nap" : c === "wind" ? "rest" : "study";
      s.blocks.push({ id: templateBlockId(day, start), day, start, end, title, kind, cat: kind === "study" ? c : null });
    }
    // Wake 30 min before the day's first block
    const first = Math.min(...MCJAYY_WEEK[day].map(r => parseHHMM(r[0])));
    s.profile.wake[day] = toHHMM(first - 30);
  }
  return validate(s).data;
}

// ---------- migration from the single-user app ----------

function safeParse(text) {
  if (typeof text !== "string" || text.length > LIMITS.importBytes) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Turns the old app's object { weeks, projects, modules } (plus its old
// settings object) into a v1 state built on McJayy's week.
// Returns { data, notes }. Never throws; garbage gives the bare template.
export function migrateLegacy(oldTracker, oldSettings) {
  const notes = [];
  const s = templateMcJayy({ name: "McJayy" });

  const old = isPlainObject(oldTracker) && !hasBadKeys(oldTracker) ? oldTracker : null;
  if (oldTracker != null && !old) notes.push("Old progress could not be read; started from the template.");

  if (old) {
    // "MON@16:30" → block id. Old start strings can be "24:00"+.
    // Only study blocks were ever tickable.
    const byOldKey = new Map();
    for (const b of s.blocks) if (b.kind === "study") byOldKey.set(`${b.day}@${toOldHHMM(b.start)}`, b.id);

    let ticks = 0, skipped = 0;
    if (isPlainObject(old.weeks)) {
      for (const wk of Object.keys(old.weeks)) {
        const src = old.weeks[wk];
        if (!isWeekKey(wk) || !isPlainObject(src)) continue;
        const dst = {};
        for (const k of Object.keys(src)) {
          const id = byOldKey.get(k);
          if (src[k] && id) { dst[id] = true; ticks++; } else skipped++;
        }
        if (Object.keys(dst).length) s.progress[wk] = dst;
      }
    }
    notes.push(`Moved ${ticks} ticked block${ticks === 1 ? "" : "s"}.`);
    if (skipped) notes.push(`${skipped} old entr${skipped === 1 ? "y" : "ies"} did not match a block and were skipped.`);

    if (Array.isArray(old.projects)) {
      for (const p of old.projects) {
        if (!isPlainObject(p)) continue;
        s.projects.push({ id: isId(p.id) ? p.id : uid(), title: p.t, note: p.n ?? "", date: p.d ?? "" });
      }
    }
    const modules = Number.isInteger(old.modules) && old.modules > 0 ? old.modules : 0;
    s.counters.push({ id: "cisco-modules", name: "Cisco JCA modules", count: modules });
  }

  const st = isPlainObject(oldSettings) && !hasBadKeys(oldSettings) ? oldSettings : {};
  if (typeof st.remind === "boolean") s.settings.remind = st.remind;
  if (st.lead !== undefined) s.settings.lead = st.lead; // validator falls back if not allowed

  const r = validate(s);
  return { data: r.data, notes: notes.concat(r.errors) };
}

// 1530 → "25:30" (the old app's way of writing after-midnight times)
function toOldHHMM(min) {
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}

// ---------- load / save ----------

const defaultStore = () => globalThis.localStorage;

// Returns { state, source, notes }.
// source: "stored" | "migrated" | "new" | "broken"
// state is null for "new" and "broken" (the app shows onboarding).
export function loadState(store = defaultStore()) {
  let raw = null;
  try { raw = store.getItem(KEY); } catch { /* storage blocked */ }

  if (raw !== null) {
    const r = validate(safeParse(raw));
    if (r.ok) return { state: r.data, source: "stored", notes: r.errors };
    // Keep the unreadable copy so nothing is silently lost.
    try { store.setItem(BROKEN_KEY, raw); } catch { /* ignore */ }
    return { state: null, source: "broken", notes: r.errors };
  }

  let legacy = null, legacySettings = null;
  try { legacy = store.getItem(LEGACY_KEY); legacySettings = store.getItem(LEGACY_SETTINGS_KEY); } catch { /* ignore */ }
  if (legacy !== null) {
    const m = migrateLegacy(safeParse(legacy), safeParse(legacySettings));
    saveState(m.data, store); // old keys are left in place as a safety net
    return { state: m.data, source: "migrated", notes: m.notes };
  }
  return { state: null, source: "new", notes: [] };
}

// Validates, then writes. Returns the saved (clean) state, or null if the
// state was invalid or storage refused (full, private mode…).
export function saveState(state, store = defaultStore()) {
  const r = validate(state);
  if (!r.ok) return null;
  try { store.setItem(KEY, JSON.stringify(r.data)); } catch { return null; }
  return r.data;
}

// ---------- backups ----------

export function exportBackup(state, now = new Date()) {
  return {
    name: `stick-tracker-backup-${isoDate(now)}.json`,
    text: JSON.stringify(state, null, 2),
  };
}

// Reads a backup file's text. Accepts v1 backups and the old app's export.
// Returns { ok, data, notes }.
export function parseImport(text) {
  if (typeof text !== "string") return { ok: false, data: null, notes: ["That file could not be read."] };
  if (new TextEncoder().encode(text).length > LIMITS.importBytes) {
    return { ok: false, data: null, notes: ["That file is too big to be a tracker backup (max 256 KB)."] };
  }
  const obj = safeParse(text);
  if (obj === null) return { ok: false, data: null, notes: ["That file is not valid JSON."] };
  if (isPlainObject(obj) && obj.v === undefined && "weeks" in obj && !hasBadKeys(obj)) {
    const m = migrateLegacy(obj, null);
    return { ok: true, data: m.data, notes: ["This is a backup from the old app; it was converted.", ...m.notes] };
  }
  const r = validate(obj);
  return { ok: r.ok, data: r.data, notes: r.ok ? r.errors : ["That file is not a tracker backup.", ...r.errors] };
}

// ---------- browser storage protection ----------

export async function isPersisted() {
  try { return !!(await navigator.storage?.persisted?.()); } catch { return false; }
}

export async function requestPersist() {
  try { return !!(await navigator.storage?.persist?.()); } catch { return false; }
}
