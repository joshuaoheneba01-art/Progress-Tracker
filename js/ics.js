// .ics calendar export (RFC 5545). Floating local times, so a 4:30pm block
// stays at 4:30pm on the phone's clock wherever it is.
// Every text value is cleaned and escaped; UIDs are made in code.

import { DAYS } from "./schema.js";

const pad = n => String(n).padStart(2, "0");
const KIND_LABEL = { study: "Study", lecture: "Lecture", nap: "Nap", rest: "Rest" };

// Strip CR/LF and other control characters, then escape \ ; , as TEXT requires.
export function icsText(s) {
  return String(s)
    .replace(/\r\n|[\r\n]/g, " ")
    .replace(/[\x00-\x1F\x7F-\x9F\u{2028}\u{2029}]/gu, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

// Fold a content line to at most 75 octets per physical line, never
// splitting a multi-byte UTF-8 character. Continuations start with a space.
export function foldLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 75) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

// FNV-1a: turns a block id into a short hex string for the UID.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const floating = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" + pad(d.getHours()) + pad(d.getMinutes()) + "00";
const utcStamp = d => d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

// The whole week as a calendar of weekly-repeating events, starting next
// Monday (or today, if today is Monday). Alerts `lead` minutes before every
// block except rest blocks.
export function buildICS(state, now = new Date()) {
  const t0 = new Date(now);
  t0.setHours(0, 0, 0, 0);
  t0.setDate(t0.getDate() + ((8 - t0.getDay()) % 7));
  const lead = state.settings.lead;
  const catName = new Map(state.categories.map(c => [c.id, c.name]));
  const stamp = utcStamp(now);

  const L = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Stick-to-it Tracker//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Study Timetable",
  ];
  let n = 0;
  for (const b of state.blocks) {
    n++;
    const di = DAYS.indexOf(b.day);
    // Date constructor rolls minutes past 24h onto the next calendar day.
    const start = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + di, 0, b.start);
    const end = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + di, 0, b.end);
    const desc = b.kind === "study" && b.cat ? catName.get(b.cat) : KIND_LABEL[b.kind];
    L.push(
      "BEGIN:VEVENT",
      `UID:${hash(b.id)}-${n}@stick-tracker`,
      "DTSTAMP:" + stamp,
      "DTSTART:" + floating(start),
      "DTEND:" + floating(end),
      "RRULE:FREQ=WEEKLY",
      "SUMMARY:" + icsText(b.title),
      "DESCRIPTION:" + icsText(desc || ""),
    );
    if (b.kind !== "rest") {
      L.push("BEGIN:VALARM", `TRIGGER:-PT${lead}M`, "ACTION:DISPLAY", "DESCRIPTION:" + icsText(`${b.title} in ${lead} minutes`), "END:VALARM");
    }
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(foldLine).join("\r\n") + "\r\n";
}
