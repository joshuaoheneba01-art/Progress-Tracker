// Reminders and alarm scheduling, driven by the user's schedule.
// - "N minutes before" notification nudges (checkReminders)
// - block-start alarms and snoozes (dueAlarms: pure, unit-tested)
// Both only run while the app is open or recently used; see README.

import { isPlainObject, hasBadKeys, isId, cleanText, KINDS, LIMITS } from "./schema.js";
import { studyDayOf, weekKey, blocksForDay, fmtRange, isoDate, addDays } from "./schedule.js";

const NOTIFIED_KEY = "stick_notified_v1";
const ALARM_KEY = "stick_alarms_v1";
export const KEY_RE = /^\d{4}-\d{2}-\d{2}@[A-Za-z0-9_-]{1,40}$/;
const GRACE_MIN = 5;      // an alarm still rings if the app opens up to 5 min late
const MAX_SNOOZES = 20;

// ---------- alarm store: { fired: { key: 1 }, snoozes: [alarm + { at }] } ----------
// An alarm is { key: "2026-10-05@blockId", blockId, title, start, end, kind }.

export function cleanAlarmStore(raw) {
  const out = { fired: {}, snoozes: [] };
  if (!isPlainObject(raw) || hasBadKeys(raw)) return out;
  if (isPlainObject(raw.fired)) {
    for (const k of Object.keys(raw.fired)) if (KEY_RE.test(k)) out.fired[k] = 1;
  }
  if (Array.isArray(raw.snoozes)) {
    for (const s of raw.snoozes.slice(0, MAX_SNOOZES)) {
      const a = cleanAlarm(s);
      if (a && Number.isInteger(s.at) && s.at > 0) out.snoozes.push({ ...a, at: s.at });
    }
  }
  return out;
}

function cleanAlarm(a) {
  if (!isPlainObject(a) || !KEY_RE.test(a.key) || !isId(a.blockId) || !KINDS.includes(a.kind)) return null;
  const okTime = n => Number.isInteger(n) && n >= 0 && n <= LIMITS.maxTime;
  if (!okTime(a.start) || !okTime(a.end)) return null;
  const title = cleanText(a.title, LIMITS.title);
  if (!title) return null;
  return { key: a.key, blockId: a.blockId, title, start: a.start, end: a.end, kind: a.kind };
}

// Which alarms ring now. Pure: returns the alarms and the updated store.
// Ticked study blocks and rest blocks don't ring. Turning alarms off also
// drops pending snoozes.
export function dueAlarms(state, now, store) {
  const t = now.getTime();
  const sd = studyDayOf(now, state.profile.bedtime);
  const dk = isoDate(sd.date);
  const next = { fired: { ...store.fired }, snoozes: [] };
  const fire = [];

  if (state.settings.alarms) {
    for (const s of store.snoozes) {
      if (s.at <= t) fire.push({ ...cleanAlarm(s), snoozed: true });
      else next.snoozes.push(s);
    }
    const ticks = state.progress[weekKey(sd.date)] || {};
    for (const b of blocksForDay(state.blocks, sd.day)) {
      if (b.kind === "rest" || sd.minute < b.start || sd.minute >= b.start + GRACE_MIN) continue;
      const key = `${dk}@${b.id}`;
      if (next.fired[key]) continue;
      next.fired[key] = 1;
      if (b.kind === "study" && ticks[b.id]) continue;
      fire.push({ key, blockId: b.id, title: b.title, start: b.start, end: b.end, kind: b.kind });
    }
  }

  const cut = isoDate(addDays(sd.date, -4));
  for (const k of Object.keys(next.fired)) if (k.slice(0, 10) < cut) delete next.fired[k];
  return { fire, store: next };
}

export function addSnooze(store, alarm, minutes, now = Date.now()) {
  const a = cleanAlarm(alarm);
  if (!a) return store;
  const snoozes = store.snoozes.filter(s => s.key !== a.key).slice(-(MAX_SNOOZES - 1));
  return { fired: store.fired, snoozes: [...snoozes, { ...a, at: now + minutes * 60000 }] };
}

export function loadAlarmStore() {
  try { return cleanAlarmStore(JSON.parse(localStorage.getItem(ALARM_KEY) || "{}")); } catch { return cleanAlarmStore(null); }
}

export function saveAlarmStore(store) {
  try { localStorage.setItem(ALARM_KEY, JSON.stringify(store)); } catch { /* ignore */ }
}

// System notification with Snooze / Dismiss buttons (handled in sw.js).
export async function notifyAlarm(alarm, snoozeMin) {
  if (permission() !== "granted" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    await reg.showNotification(`⏰ ${alarm.title}`, {
      body: `${fmtRange(alarm.start, alarm.end)} · ${alarm.snoozed ? "snoozed alarm" : "starting now"}`,
      tag: alarm.key,
      renotify: true,
      requireInteraction: true,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      vibrate: [500, 200, 500],
      data: { key: alarm.key },
      actions: [{ action: "snooze", title: `Snooze ${snoozeMin} min` }, { action: "dismiss", title: "Dismiss" }],
    });
  } catch { /* notifications unavailable */ }
}

export async function closeAlarmNotification(key) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    for (const n of (await reg?.getNotifications({ tag: key })) || []) n.close();
  } catch { /* ignore */ }
}

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
