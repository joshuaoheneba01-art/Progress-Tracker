// "N minutes before" notification nudges, driven by the user's schedule.
// They only fire while the app is open or recently used; see README.

import { isPlainObject } from "./schema.js";
import { studyDayOf, weekKey, blocksForDay, fmtRange, isoDate, addDays } from "./schedule.js";

const NOTIFIED_KEY = "stick_notified_v1";
const KEY_RE = /^\d{4}-\d{2}-\d{2}@[A-Za-z0-9_-]{1,40}$/;

export const canNotify = () => "Notification" in globalThis;
export const permission = () => (canNotify() ? Notification.permission : "unsupported");

export async function showNote(title, body, tag) {
  const opts = { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: tag || undefined };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return true; }
    new Notification(title, opts);
    return true;
  } catch {
    return false;
  }
}

function loadNotified() {
  try {
    const o = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "{}");
    const out = {};
    if (isPlainObject(o)) for (const k of Object.keys(o)) if (KEY_RE.test(k)) out[k] = 1;
    return out;
  } catch {
    return {};
  }
}

export function checkReminders(state, now = new Date()) {
  if (!state || !state.settings.remind || permission() !== "granted") return;
  const sd = studyDayOf(now, state.profile.bedtime);
  const dk = isoDate(sd.date), ticks = state.progress[weekKey(sd.date)] || {}, lead = state.settings.lead;
  const notified = loadNotified();

  for (const b of blocksForDay(state.blocks, sd.day)) {
    if (b.kind === "rest") continue;
    const diff = b.start - sd.minute, key = `${dk}@${b.id}`;
    if (diff <= lead && diff > -5 && !notified[key]) {
      notified[key] = 1;
      if (b.kind === "study" && ticks[b.id]) continue;
      const soon = diff > 1 ? `in ${diff} min` : "now";
      if (b.kind === "nap") showNote(`Nap time ${soon}`, `${fmtRange(b.start, b.end)} · protect your sleep`, key);
      else showNote(`${b.title} ${soon}`, `${fmtRange(b.start, b.end)} · tap to open your tracker`, key);
    }
  }

  const cut = isoDate(addDays(sd.date, -4));
  for (const k of Object.keys(notified)) if (k.slice(0, 10) < cut) delete notified[k];
  try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified)); } catch { /* ignore */ }
}
