// In-app alarm: full-screen overlay + Web Audio beeps + vibration, repeating
// every 30 s until Snooze or Dismiss.
//
// Honest limits: this only works while the app is open (or the phone has not
// paused it yet). A website cannot ring on a locked phone with the app
// closed. Real alarms come with the Android app (Stage 3).
//
// Browsers block sound until the user has tapped the page, so audio has to be
// "armed" by a tap: any tap does it, and there is an explicit button too.

import { el } from "./ui.js";
import { fmtRange } from "./schedule.js";

const REPEAT_MS = 30000;
let ctx = null;            // AudioContext, created on the first tap
let current = null;        // { alarm, handlers, node, timer }
const queue = [];
const baseTitle = document.title;

export const isArmed = () => !!ctx && ctx.state === "running";

// Must run inside a tap/click handler. Returns true once sound is unlocked.
export async function arm({ chirp = false } = {}) {
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    // Only during a real tap; otherwise the browser refuses and logs a warning.
    if (navigator.userActivation && !navigator.userActivation.isActive) return isArmed();
    if (!ctx) ctx = new AC();
    if (ctx.state !== "running") await ctx.resume();
    if (chirp) tone(0, 1320, 0.12, 0.15);
    return isArmed();
  } catch {
    return false;
  }
}

function tone(when, freq, len, vol) {
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + len + 0.05);
}

function ring() {
  if (isArmed()) {
    // two bursts of three beeps, about 2.5 s in all
    for (let burst = 0; burst < 2; burst++) {
      for (let i = 0; i < 3; i++) tone(burst * 1.3 + i * 0.3, i % 2 ? 660 : 880, 0.2, 0.35);
    }
  }
  // Vibration, like sound, is only allowed after the user has tapped the page.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.([500, 200, 500, 200, 500]); } catch { /* not supported */ }
}

// A short, friendly three-note chime (focus timer finished).
export function chime() {
  if (isArmed()) [523, 659, 784].forEach((f, i) => tone(i * 0.18, f, 0.35, 0.25));
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ }
}

function overlay(alarm, snoozeOptions) {
  const late = Math.max(0, Math.round((Date.now() - alarm.firedAt) / 60000));
  return el("div", { class: "alarm", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "alarm-title" },
    el("div", { class: "alarm-box" },
      el("div", { class: "alarm-bell", "aria-hidden": "true" }, "⏰"),
      el("div", { class: "alarm-k" }, alarm.snoozed ? "Snoozed alarm" : late ? `Started ${late} min ago` : "Starting now"),
      el("div", { class: "alarm-title", id: "alarm-title", text: alarm.title }),
      el("div", { class: "alarm-time" }, fmtRange(alarm.start, alarm.end)),
      !isArmed() && el("div", { class: "alarm-note" }, "Sound is off: tap any button to turn it on for next time."),
      el("div", { class: "alarm-actions" },
        snoozeOptions.map(m => el("button", { type: "button", class: "btn", data: { act: "snooze", min: m } }, `Snooze ${m} min`)),
        el("button", { type: "button", class: "btn pri", data: { act: "dismiss" } }, "Dismiss"))));
}

// Show an alarm now (or after the current one). handlers: { onSnooze(min), onDismiss() }
export function showAlarm(alarm, handlers, snoozeOptions = [5, 10]) {
  const item = { alarm: { ...alarm, firedAt: Date.now() }, handlers, snoozeOptions };
  if (current) {
    if (current.alarm.key === alarm.key || queue.some(q => q.alarm.key === alarm.key)) return;
    queue.push(item);
    return;
  }
  open(item);
}

function open(item) {
  const node = overlay(item.alarm, item.snoozeOptions);
  node.addEventListener("click", ev => {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    arm(); // the tap also unlocks sound for later alarms
    const key = item.alarm.key;
    closeAlarm(key);
    if (b.dataset.act === "snooze") item.handlers.onSnooze(+b.dataset.min);
    else item.handlers.onDismiss();
  });
  document.body.append(node);
  document.body.classList.add("alarm-open");
  document.title = `⏰ ${item.alarm.title}`;
  node.querySelector('[data-act="dismiss"]')?.focus();
  ring();
  current = { ...item, node, timer: setInterval(ring, REPEAT_MS) };
}

// Stop ringing and remove the overlay for this alarm (also if it was queued).
export function closeAlarm(key) {
  const i = queue.findIndex(q => q.alarm.key === key);
  if (i >= 0) queue.splice(i, 1);
  if (!current || current.alarm.key !== key) return;
  clearInterval(current.timer);
  current.node.remove();
  current = null;
  try { navigator.vibrate?.(0); } catch { /* ignore */ }
  document.body.classList.remove("alarm-open");
  document.title = baseTitle;
  if (queue.length) open(queue.shift());
}

export const currentAlarm = () => (current ? current.alarm : null);
