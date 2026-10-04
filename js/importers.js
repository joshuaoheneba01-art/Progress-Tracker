// Timetable import: quick-add text, CSV and .ics, parsed on the device with
// our own code. Pure (no DOM): every parser returns
//   { rows: [{ line, day, start: "HH:MM", end: "HH:MM", title, kind }], errors: [{ line, message }], notes: [] }
// Rows are only suggestions: previewImport() runs them through the same rules
// as the editor (addRecurring) on a copy of the state, and nothing is saved
// until the user confirms the review screen.
//
// Input is hostile until proven otherwise: size caps on everything, lookups
// via Map (so "constructor" is just an unknown word), titles cleaned.

import { DAYS, KINDS, LIMITS, cleanText } from "./schema.js";
import { addRecurring } from "./schedule.js";

export const IMPORT_LIMITS = { bytes: LIMITS.importBytes, lines: 5000, lineLength: 2000, rows: 300, events: 3000, fields: 20 };

const pad = n => String(n).padStart(2, "0");
const hhmm = min => pad(Math.floor(min / 60)) + ":" + pad(min % 60);

// ---------- days ----------

const DAY_WORDS = new Map([
  ["mon", "MON"], ["monday", "MON"], ["tue", "TUE"], ["tues", "TUE"], ["tuesday", "TUE"],
  ["wed", "WED"], ["weds", "WED"], ["wednesday", "WED"], ["thu", "THU"], ["thur", "THU"], ["thurs", "THU"], ["thursday", "THU"],
  ["fri", "FRI"], ["friday", "FRI"], ["sat", "SAT"], ["saturday", "SAT"], ["sun", "SUN"], ["sunday", "SUN"],
  ["mo", "MON"], ["tu", "TUE"], ["we", "WED"], ["th", "THU"], ["fr", "FRI"], ["sa", "SAT"], ["su", "SUN"],
]);
const DAY_GROUPS = new Map([
  ["weekdays", DAYS.slice(0, 5)], ["weekday", DAYS.slice(0, 5)], ["weekends", ["SAT", "SUN"]], ["weekend", ["SAT", "SUN"]],
  ["daily", DAYS], ["everyday", DAYS],
]);

// "Mon/Wed", "Mon-Fri", "Tue & Thu", "weekdays", "every day" → { days, bad }
export function parseDays(text) {
  const found = new Set();
  const words = String(text).toLowerCase().replace(/every\s+day/g, "daily").replace(/\band\b/g, " ")
    .split(/[\s,/&+;|]+/).map(w => w.replace(/\.$/, "")).filter(Boolean);
  for (const w of words) {
    if (DAY_WORDS.has(w)) { found.add(DAY_WORDS.get(w)); continue; }
    if (DAY_GROUPS.has(w)) { for (const d of DAY_GROUPS.get(w)) found.add(d); continue; }
    const range = /^([a-z]+)[-–]([a-z]+)$/.exec(w);
    if (range && DAY_WORDS.has(range[1]) && DAY_WORDS.has(range[2])) {
      let i = DAYS.indexOf(DAY_WORDS.get(range[1]));
      const to = DAYS.indexOf(DAY_WORDS.get(range[2]));
      for (let n = 0; n < 7; n++) { found.add(DAYS[i]); if (i === to) break; i = (i + 1) % 7; }
      continue;
    }
    return { days: [], bad: w.slice(0, 30) };
  }
  return { days: DAYS.filter(d => found.has(d)), bad: null };
}

// ---------- times ----------

// "9", "9:30", "9.30", "0930", "14:00", with optional am/pm.
// Returns { min, mer } (mer = "am" | "pm" | null) or null.
function parseClock(s) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(s.trim()) || /^(\d{2})(\d{2})()$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  const mer = m[3] ? (m[3][0].toLowerCase() === "a" ? "am" : "pm") : null;
  if (mi > 59) return null;
  if (mer ? h < 1 || h > 12 : h > 23) return null;
  return { h, mi, mer };
}
const to24 = (c, mer) => ((c.h % 12) + (mer === "pm" ? 12 : 0)) * 60 + c.mi;

// "2-4pm" → 14:00–16:00, "11-1pm" → 11:00–13:00, "9:30–11:30" → as is.
export function parseTimeRange(a, b) {
  const s = parseClock(a), e = parseClock(b);
  if (!s || !e) return null;
  const end = e.mer ? to24(e, e.mer) : e.h * 60 + e.mi;
  let start;
  if (s.mer) start = to24(s, s.mer);
  else if (e.mer) {
    start = to24(s, e.mer);                       // "2-4pm": same half of the day…
    if (start >= end) start = to24(s, e.mer === "pm" ? "am" : "pm"); // …unless that's after the end ("11-1pm")
  } else start = s.h * 60 + s.mi;
  return { start: hhmm(start), end: hhmm(end % 1440) };
}

const TIME = String.raw`(\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?)?|\d{4})`;
const RANGE_RE = new RegExp(String.raw`(^|\s)` + TIME + String.raw`\s*(?:-|–|—|to|until)\s*` + TIME + String.raw`(?=\s|$)`, "i");

// ---------- kinds ----------

const KIND_WORDS = new Map([
  ["lecture", "lecture"], ["class", "lecture"], ["lab", "lecture"], ["tutorial", "lecture"], ["seminar", "lecture"], ["practical", "lecture"],
  ["study", "study"], ["nap", "nap"], ["rest", "rest"],
]);
const kindOf = w => KIND_WORDS.get(String(w || "").trim().toLowerCase()) || null;

// ---------- shared ----------

function result() { return { rows: [], errors: [], notes: [] }; }
const err = (r, line, message) => { if (r.errors.length < 50) r.errors.push({ line, message }); };

function addRows(r, line, days, range, title, kind) {
  const t = cleanText(title, LIMITS.title);
  if (!t) return err(r, line, "missing the course name.");
  for (const day of days) r.rows.push({ line, day, start: range.start, end: range.end, title: t, kind });
}

// Same class listed many times (e.g. one .ics event per week) → one row.
function finish(r) {
  const seen = new Set(), out = [];
  let dupes = 0;
  for (const row of r.rows) {
    const k = `${row.day}|${row.start}|${row.end}|${row.title.toLowerCase()}`;
    if (seen.has(k)) { dupes++; continue; }
    seen.add(k);
    out.push(row);
  }
  if (dupes) r.notes.push(`${dupes} repeated cop${dupes === 1 ? "y was" : "ies were"} merged.`);
  if (out.length > IMPORT_LIMITS.rows) {
    r.notes.push(`Only the first ${IMPORT_LIMITS.rows} classes were kept.`);
    out.length = IMPORT_LIMITS.rows;
  }
  r.rows = out;
  return r;
}

function tooBig(text) {
  return typeof text !== "string" || new TextEncoder().encode(text).length > IMPORT_LIMITS.bytes;
}

function lines(text) {
  return text.replace(/\r\n?/g, "\n").split("\n").slice(0, IMPORT_LIMITS.lines);
}

// ---------- quick-add text ----------
// One class per line: <days> <start>-<end> <title> [optional type]
//   Mon 9:30-11:30 CSC 415
//   Tue/Thu 2pm-4pm CSC 401 Lab [lab]
// Blank lines and lines starting with # are ignored.

export function parseQuickAdd(text) {
  const r = result();
  if (tooBig(text)) { err(r, 0, "That is too much text (max 256 KB)."); return r; }
  lines(text).forEach((raw, i) => {
    const line = i + 1, s = raw.trim();
    if (!s || s.startsWith("#")) return;
    if (s.length > IMPORT_LIMITS.lineLength) return err(r, line, "line is too long.");
    const m = RANGE_RE.exec(s);
    if (!m) return err(r, line, `no time range found (try "Mon 9:30-11:30 CSC 415").`);
    const daysText = s.slice(0, m.index + m[1].length);
    let title = s.slice(m.index + m[0].length).replace(/^[\s:,·-]+/, "");
    const { days, bad } = parseDays(daysText);
    if (bad) return err(r, line, `"${bad}" isn't a day.`);
    if (!days.length) return err(r, line, "which day? Start the line with a day, e.g. Mon.");
    const range = parseTimeRange(m[2], m[3]);
    if (!range) return err(r, line, `"${m[2].trim()}-${m[3].trim()}" isn't a valid time range.`);
    let kind = "lecture";
    const tag = /\s*\[([a-z]+)\]\s*$/i.exec(title);
    if (tag && kindOf(tag[1])) { kind = kindOf(tag[1]); title = title.slice(0, tag.index); }
    addRows(r, line, days, range, title, kind);
  });
  return finish(r);
}

// ---------- CSV ----------
// With a header row (any order): day, start, end, title/course/subject/name, type
// or a single "time" column like "9:30-11:30". Without a header:
// day,start,end,title[,type]  or  day,time,title[,type].
// Comma, semicolon or tab separated; quotes as in RFC 4180.

function csvRecords(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const count = ch => first.split(ch).length;
  const delim = [",", ";", "\t"].reduce((a, b) => (count(b) > count(a) ? b : a), ",");
  const out = [];
  let row = [], field = "", q = false;
  const pushField = () => { if (row.length < IMPORT_LIMITS.fields) row.push(field.length > 500 ? field.slice(0, 500) : field); field = ""; };
  for (let i = 0; i < text.length && out.length < IMPORT_LIMITS.lines; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"' && field === "") q = true;
    else if (ch === delim) pushField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushField(); out.push(row); row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { pushField(); out.push(row); }
  return out;
}

const HEADERS = new Map([
  ["day", "day"], ["days", "day"], ["weekday", "day"],
  ["start", "start"], ["from", "start"], ["begins", "start"], ["start time", "start"], ["starts", "start"],
  ["end", "end"], ["to", "end"], ["finish", "end"], ["end time", "end"], ["ends", "end"],
  ["time", "time"], ["times", "time"],
  ["title", "title"], ["course", "title"], ["subject", "title"], ["name", "title"], ["module", "title"], ["class", "title"], ["summary", "title"],
  ["type", "type"], ["kind", "type"],
]);

export function parseCSV(text) {
  const r = result();
  if (tooBig(text)) { err(r, 0, "That file is too big (max 256 KB)."); return r; }
  const recs = csvRecords(text);
  if (!recs.length) return r;
  let col = null, startAt = 0;
  const head = recs[0].map(h => h.trim().toLowerCase());
  if (head.some(h => HEADERS.get(h) === "day")) {
    col = new Map();
    head.forEach((h, i) => { const k = HEADERS.get(h); if (k && !col.has(k)) col.set(k, i); });
    startAt = 1;
  }
  for (let i = startAt; i < recs.length; i++) {
    const f = recs[i].map(x => x.trim()), line = i + 1;
    if (f.every(x => !x)) continue;
    let day, a, b, title, type;
    if (col) {
      day = f[col.get("day")];
      title = f[col.get("title")];
      type = col.has("type") ? f[col.get("type")] : "";
      if (col.has("start") && col.has("end")) { a = f[col.get("start")]; b = f[col.get("end")]; }
      else if (col.has("time")) [a, b] = splitRange(f[col.get("time")]);
    } else if (f.length >= 4 && parseClock(f[1] || "") && parseClock(f[2] || "")) {
      [day, a, b, title, type] = f;
    } else if (f.length >= 3) {
      [day, , title, type] = f;
      [a, b] = splitRange(f[1]);
    } else { err(r, line, "expected day, start, end, course."); continue; }

    const { days, bad } = parseDays(day || "");
    if (bad || !days.length) { err(r, line, `"${(bad || day || "").slice(0, 30)}" isn't a day.`); continue; }
    const range = a && b ? parseTimeRange(a, b) : null;
    if (!range) { err(r, line, `"${[a, b].filter(Boolean).join("-").slice(0, 30)}" isn't a valid time range.`); continue; }
    addRows(r, line, days, range, title || "", kindOf(type) || "lecture");
  }
  return finish(r);
}

function splitRange(s) {
  const m = new RegExp("^" + TIME + String.raw`\s*(?:-|–|—|to)\s*` + TIME + "$", "i").exec(String(s || "").trim());
  return m ? [m[1], m[2]] : [null, null];
}

// ---------- .ics ----------
// Reads VEVENTs: SUMMARY, DTSTART, DTEND or DURATION, RRULE (WEEKLY with
// BYDAY, or DAILY). Times ending in Z are UTC and converted to this phone's
// time; times with a TZID or no zone are read as local wall-clock time (we
// carry no timezone database). All-day events are skipped. Events that occur
// once become a weekly class on that weekday (timetable exports often list
// every week separately; the copies are merged).

const ICS_DAYS = new Map([["MO", "MON"], ["TU", "TUE"], ["WE", "WED"], ["TH", "THU"], ["FR", "FRI"], ["SA", "SAT"], ["SU", "SUN"]]);

function icsProp(line) {
  let q = false, i = 0;
  for (; i < line.length; i++) {
    if (line[i] === '"') q = !q;
    else if (line[i] === ":" && !q) break;
  }
  if (i >= line.length) return null;
  const parts = line.slice(0, i).split(";");
  const params = new Map();
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params.set(p.slice(0, eq).toUpperCase(), p.slice(eq + 1).replace(/^"|"$/g, ""));
  }
  return { name: parts[0].toUpperCase(), params, value: line.slice(i + 1) };
}

const icsUnescape = v => v.replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? " " : c));

function icsDate(prop) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
  if (!m) return { bad: true };
  if (!m[4] || prop.params.get("VALUE") === "DATE") return { allDay: true };
  const [y, mo, d, h, mi] = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5]];
  if (mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59) return { bad: true };
  return { date: m[7] ? new Date(Date.UTC(y, mo, d, h, mi)) : new Date(y, mo, d, h, mi) };
}

function icsDuration(v) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(v.trim());
  return m && (m[1] || m[2] || m[3]) ? ((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0)) : null;
}

export function parseICS(text) {
  const r = result();
  if (tooBig(text)) { err(r, 0, "That file is too big (max 256 KB)."); return r; }
  const unfolded = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
  if (!/^\s*BEGIN:VCALENDAR/i.test(unfolded)) { err(r, 1, "this isn't a calendar (.ics) file."); return r; }
  let ev = null, depth = 0, events = 0, allDay = 0, oddRepeat = 0;
  lines(unfolded).forEach((raw, i) => {
    const line = i + 1;
    if (raw.length > IMPORT_LIMITS.lineLength) return;
    const p = icsProp(raw);
    if (!p) return;
    if (p.name === "BEGIN") {
      if (p.value.toUpperCase() === "VEVENT" && !ev) { ev = { line, props: new Map() }; depth = 0; }
      else if (ev) depth++;          // e.g. a VALARM inside the event
      return;
    }
    if (p.name === "END") {
      if (!ev) return;
      if (depth > 0) { depth--; return; }
      if (++events <= IMPORT_LIMITS.events) {
        const c = icsEvent(ev, r);
        if (c === "allday") allDay++;
        if (c === "repeat") oddRepeat++;
      }
      ev = null;
      return;
    }
    if (ev && depth === 0 && !ev.props.has(p.name)) ev.props.set(p.name, p);
  });
  if (events > IMPORT_LIMITS.events) r.notes.push(`Only the first ${IMPORT_LIMITS.events} events were read.`);
  if (allDay) r.notes.push(`${allDay} all-day event${allDay === 1 ? " was" : "s were"} skipped.`);
  if (oddRepeat) r.notes.push(`${oddRepeat} event${oddRepeat === 1 ? " repeats" : "s repeat"} monthly or yearly and ${oddRepeat === 1 ? "was" : "were"} skipped.`);
  return finish(r);
}

function icsEvent(ev, r) {
  const g = n => ev.props.get(n);
  const title = g("SUMMARY") ? icsUnescape(g("SUMMARY").value) : "";
  if (!g("DTSTART")) return err(r, ev.line, "event has no start time.");
  const s = icsDate(g("DTSTART"));
  if (s.allDay) return "allday";
  if (s.bad) return err(r, ev.line, "event has an unreadable start time.");
  let endDate = null;
  if (g("DTEND")) {
    const e = icsDate(g("DTEND"));
    if (e.allDay || e.bad) return err(r, ev.line, "event has an unreadable end time.");
    endDate = e.date;
  } else if (g("DURATION")) {
    const mins = icsDuration(g("DURATION").value);
    if (mins === null) return err(r, ev.line, "event has an unreadable duration.");
    endDate = new Date(s.date.getTime() + mins * 60000);
  } else return err(r, ev.line, "event has no end time.");
  const length = (endDate - s.date) / 60000;
  if (!(length > 0) || length > LIMITS.maxTime) return err(r, ev.line, "event's length isn't a normal class length.");

  let days = [DAYS[(s.date.getDay() + 6) % 7]];
  if (g("RRULE")) {
    const rule = new Map(g("RRULE").value.split(";").map(kv => kv.split("=")).filter(kv => kv.length === 2).map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]));
    const freq = rule.get("FREQ");
    const byday = (rule.get("BYDAY") || "").split(",").map(x => ICS_DAYS.get(x.slice(-2))).filter(Boolean);
    if (freq === "DAILY") days = byday.length ? byday : [...DAYS];
    else if (freq === "WEEKLY") { if (byday.length) days = byday; }
    else return "repeat";
  }
  const t = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
  addRows(r, ev.line, DAYS.filter(d => days.includes(d)), { start: t(s.date), end: t(endDate) }, title, "lecture");
}

// ---------- detection ----------

export function detectFormat(text, filename = "") {
  if (/^\s*BEGIN:VCALENDAR/i.test(text) || /\.ics$/i.test(filename)) return "ics";
  if (/\.csv$/i.test(filename)) return "csv";
  return "text";
}

export function parseTimetable(text, filename = "") {
  const format = detectFormat(text, filename);
  const r = format === "ics" ? parseICS(text) : format === "csv" ? parseCSV(text) : parseQuickAdd(text);
  return { format, ...r };
}

// ---------- review ----------
// choices[i] = { on, kind } overrides per row. Returns the exact outcome of
// applying the selected rows in order: { items: [{ ...row, on, kind, status, error }], state, added }.

export function previewImport(state, rows, choices = []) {
  let s = state, added = 0;
  const items = rows.map((row, i) => {
    const c = choices[i] || {};
    const kind = KINDS.includes(c.kind) ? c.kind : row.kind;
    const on = c.on !== false;
    const item = { ...row, kind, on, status: "skipped", error: null };
    if (!on) return item;
    const res = addRecurring(s, { kind, subject: row.title, days: [row.day], start: row.start, end: row.end });
    if (res.errors.length) {
      item.status = "error";
      item.error = res.errors[0].replace(/^[A-Z]{3}: /, "");
    } else {
      s = res.state;
      item.status = "ok";
      added++;
    }
    return item;
  });
  return { items, state: s, added };
}
