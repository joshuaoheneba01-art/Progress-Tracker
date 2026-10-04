// Loading, saving, migration and backups. Every path in and out goes
// through validate(). The store (localStorage) is passed in so tests can
// use a fake one.

import { validate, defaultState, hasBadKeys, isPlainObject, isId, isWeekKey, uid, LIMITS } from "./schema.js";
import { isoDate } from "./schedule.js";

export const KEY = "stick_v1";
export const BROKEN_KEY = "stick_v1_broken";
export const LEGACY_KEY = "mcjayy_tracker_v1";
export const LEGACY_SETTINGS_KEY = "mcjayy_settings_v1";

// ---------- templates ----------
// Static JSON files in templates/, treated like any import: size-capped,
// parsed safely and run through validate().

export const TEMPLATES = [
  { id: "student", name: "Student", desc: "Morning lectures, study in the afternoon and evening, in bed by 11:30pm.", file: "templates/student.json" },
  { id: "night-owl", name: "Night owl", desc: "Late start, study into the night, in bed by 2am and up at 10am.", file: "templates/night-owl.json" },
  { id: "early-bird", name: "Early bird", desc: "Deep work at 6am before lectures, in bed by 10pm.", file: "templates/early-bird.json" },
  { id: "mcjayy", name: "McJayy's week", desc: "A real final-year week: late nights, long naps, 85 hours of study. An example, not a target.", file: "templates/mcjayy.json" },
];

// A template is a timetable only: wake and bedtimes, subjects and blocks.
// Anything else in the file (name, ticks, projects, settings) is ignored.
export function parseTemplate(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > LIMITS.importBytes) {
    return { ok: false, data: null, notes: ["That template is too big."] };
  }
  const r = validate(safeParse(text));
  if (!r.ok) return { ok: false, data: null, notes: ["That template could not be read.", ...r.errors] };
  const s = defaultState();
  s.profile.bedtime = r.data.profile.bedtime;
  s.profile.wake = r.data.profile.wake;
  s.categories = r.data.categories;
  s.blocks = r.data.blocks;
  return { ok: true, data: validate(s).data, notes: r.errors };
}

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Returns { ok, data, notes }. `fetcher` is swappable so tests can read files.
export async function loadTemplate(id, fetcher = fetchText) {
  const t = TEMPLATES.find(x => x.id === id);
  if (!t) return { ok: false, data: null, notes: ["Unknown template."] };
  try {
    return parseTemplate(await fetcher(t.file));
  } catch {
    return { ok: false, data: null, notes: ["Could not load that template. Check your connection and try again."] };
  }
}

const getMcJayy = () => loadTemplate("mcjayy");

// ---------- migration from the single-user app ----------

function safeParse(text) {
  if (typeof text !== "string" || text.length > LIMITS.importBytes) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Turns the old app's object { weeks, projects, modules } (plus its old
// settings object) into a v1 state built on `template` (McJayy's week, as
// returned by parseTemplate). Pure: returns { data, notes }, never throws;
// garbage gives the bare template.
export function migrateLegacy(oldTracker, oldSettings, template) {
  const notes = [];
  const s = structuredClone(template);
  s.profile.name = "McJayy";

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

// Returns a promise of { state, source, notes }.
// source: "stored" | "migrated" | "new" | "broken"
// state is null for "new" and "broken" (the app shows onboarding).
// Async only because migrating old data needs McJayy's week from templates/.
export async function loadState(store = defaultStore(), getTemplate = getMcJayy) {
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
    const t = await getTemplate();
    if (!t.ok) {
      // Old data stays untouched; we try again next time the app opens.
      return { state: null, source: "new", notes: ["Your data from the old app was found but could not be moved yet. It is safe: open the app again while online."] };
    }
    const m = migrateLegacy(safeParse(legacy), safeParse(legacySettings), t.data);
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
// Returns a promise of { ok, data, notes } (async: old-app backups are
// rebuilt on McJayy's week, which is loaded from templates/).
export async function parseImport(text, getTemplate = getMcJayy) {
  if (typeof text !== "string") return { ok: false, data: null, notes: ["That file could not be read."] };
  if (new TextEncoder().encode(text).length > LIMITS.importBytes) {
    return { ok: false, data: null, notes: ["That file is too big to be a tracker backup (max 256 KB)."] };
  }
  const obj = safeParse(text);
  if (obj === null) return { ok: false, data: null, notes: ["That file is not valid JSON."] };
  if (isPlainObject(obj) && obj.v === undefined && "weeks" in obj && !hasBadKeys(obj)) {
    const t = await getTemplate();
    if (!t.ok) return { ok: false, data: null, notes: ["This is a backup from the old app. Converting it needs a connection the first time; try again online."] };
    const m = migrateLegacy(obj, null, t.data);
    return { ok: true, data: m.data, notes: ["This is a backup from the old app; it was converted.", ...m.notes] };
  }
  const r = validate(obj);
  return { ok: r.ok, data: r.data, notes: r.ok ? r.errors : ["That file is not a tracker backup.", ...r.errors] };
}

// True when it's time to nudge an export: more than 7 days since the last
// one, or (never exported) the user has ticks from over 7 days ago.
const WEEK_MS = 7 * 86400000;
export function needsBackup(state, now = Date.now()) {
  if (!state || !state.blocks.length) return false;
  if (state.settings.lastBackup > 0) return now - state.settings.lastBackup > WEEK_MS;
  const weeks = Object.keys(state.progress).sort();
  if (!weeks.length) return false;
  const [y, m, d] = weeks[0].split("-").map(Number);
  return now - new Date(y, m - 1, d, 12).getTime() > WEEK_MS;
}

// ---------- browser storage protection ----------

export async function isPersisted() {
  try { return !!(await navigator.storage?.persisted?.()); } catch { return false; }
}

export async function requestPersist() {
  try { return !!(await navigator.storage?.persist?.()); } catch { return false; }
}
