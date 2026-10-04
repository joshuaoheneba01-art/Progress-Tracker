// Boot, state, routing and event delegation.
// State changes go through commit(): copy → change → validate + save → render.

import { defaultState, uid, isHHMM, isPlainObject, LIMITS, LEADS, SNOOZES, DAYS, KINDS, PALETTE_SIZE } from "./schema.js";
import { studyDayOf, weekKey, toHHMM, isoDate, draftToBlock, addRecurring } from "./schedule.js";
import { arm, isArmed, showAlarm, closeAlarm, currentAlarm } from "./alarm.js";
import { parseTimetable, previewImport, IMPORT_LIMITS } from "./importers.js";
import { generateWeek, goalFromDraft } from "./generator.js";
import { loadState, saveState, TEMPLATES, loadTemplate, exportBackup, parseImport, needsBackup, isPersisted, requestPersist, KEY } from "./storage.js";
import { buildICS } from "./ics.js";
import { tabsBar, dayView, progressView, planView, projectsView, settingsView, wizardView, bannersView, toastNode } from "./ui.js";
import {
  checkReminders, showNote, permission, canNotify, KEY_RE,
  dueAlarms, addSnooze, loadAlarmStore, saveAlarmStore, notifyAlarm, closeAlarmNotification,
} from "./reminders.js";

// Shown in Settings so you can tell which upgrade is live. Bump with each
// release together with VERSION in sw.js (see CHANGELOG.md).
const APP_VERSION = "1.4.0 · Stage 2, step 4 of 7";

const $ = id => document.getElementById(id);
const app = $("app");

let state = null;     // always a validated v1 object, or null before setup
let source = "new";
let tab = "day";
let selDay = null;    // Day tab: null = follow today
let planDay = null;   // Plan tab: null = follow today
let editing = null;   // Plan tab form: { id, isNew, copy, draft, errors }
let imp = null;       // Plan tab timetable import, see importPanel() in ui.js
let goalEd = null;    // Plan tab goal form: { id, isNew, draft, errors }
let genOpen = false;  // Plan tab: generator review showing
let afterImport = false; // Plan tab: nudge to fill study time after an import
let wiz = null;       // setup wizard, see newWizard()
let deferredInstall = null;
let waitingWorker = null;   // a new version that is installed and waiting
let updateRequested = false;
let persisted = false;
let backupLater = false;    // "Later" on the backup nudge, for this session

// ---------- state ----------

function commit(change) {
  const next = structuredClone(state);
  change(next);
  const saved = saveState(next);
  if (!saved) { toast(["Could not save. Your phone's storage may be full."]); return false; }
  state = saved;
  render();
  return true;
}

function start(newState, notes = []) {
  const saved = saveState(newState);
  if (!saved) { toast(["Could not save. Your phone's storage may be full."]); return; }
  state = saved;
  source = "stored";
  tab = "day";
  selDay = planDay = editing = wiz = null;
  render();
  if (notes.length) toast(notes);
}

// ---------- rendering ----------

function context() {
  const now = new Date();
  const today = studyDayOf(now, state.profile.bedtime);
  return {
    now, today,
    wk: weekKey(today.date),
    selDay: selDay || today.day,
    planDay: planDay || today.day,
    editing,
    imp,
    goalEd,
    afterImport,
    gen: genOpen ? generateWeek(state) : null, // always from the current timetable
    perm: permission(),
    installed: (globalThis.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true,
    canInstall: !!deferredInstall,
    version: APP_VERSION,
    persisted,
    armed: isArmed(),
    offline: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
  };
}

function applyTheme() {
  const t = state ? state.settings.theme : "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

const VIEWS = { day: dayView, progress: progressView, plan: planView, projects: projectsView, settings: settingsView };

// Clickjacking guard. GitHub Pages can't send the frame-ancestors header, so
// if another site loads us in a frame we refuse to show anything tappable.
let framed = false;
try { framed = window.top !== window.self; } catch { framed = true; }

function render() {
  if (framed) {
    app.replaceChildren(Object.assign(document.createElement("div"), {
      className: "card",
      textContent: "For your safety, Stick-to-it does not run inside other websites. Open it directly in your browser.",
    }));
    return;
  }
  applyTheme();
  if (!state && !wiz) wiz = newWizard();
  const banners = bannersView({
    update: !!waitingWorker,
    arm: !wiz && !!state && state.settings.alarms && !isArmed(),
    backup: !wiz && !backupLater && needsBackup(state),
  });
  if (wiz) {
    $("dateLine").textContent = "";
    app.replaceChildren(...banners, ...wizardView(wiz, { hasState: !!state, source }));
    return;
  }
  const ctx = context();
  $("dateLine").textContent = ctx.today.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  app.replaceChildren(...banners, tabsBar(tab), ...(VIEWS[tab] || dayView)(state, ctx));
}

let toastTimer = 0;
function toast(lines) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const t = toastNode(lines.slice(0, 6));
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 6000);
}

function download(name, type, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

function focusGoal() {
  const f = document.querySelector(".goal-form");
  if (!f) return;
  f.scrollIntoView({ block: "center" });
  f.querySelector("input")?.focus({ preventScroll: true });
}

function focusForm() {
  const f = document.querySelector(".form");
  if (!f) return;
  f.scrollIntoView({ block: "start" });
  f.querySelector("input")?.focus({ preventScroll: true });
}

// ---------- wizard ----------

function newWizard() {
  return {
    step: 0,
    draft: defaultState(),
    form: { name: state?.profile.name || "", wake: "08:00", bedtime: state?.profile.bedtime || "23:30", subject: "", days: [], start: "", end: "" },
    errors: [],
  };
}

const WZ_KIND = { 3: "nap", 4: "lecture", 5: "study" };

// Keeps projects, counters and settings when setup is re-run.
function finishWizard(draft) {
  const used = new Set(draft.blocks.map(b => b.cat).filter(Boolean));
  draft.categories = draft.categories.filter(c => used.has(c.id));
  if (state) {
    draft.projects = state.projects;
    draft.counters = state.counters;
    draft.settings = state.settings;
  }
  start(draft, ["Your week is ready. Change anything in the Plan tab."]);
}

const wizClicks = {
  "wz-build": () => { wiz.step = 1; },
  "wz-template": k => {
    const meta = TEMPLATES.find(t => t.id === k);
    if (!meta) return true;
    loadTemplate(k).then(r => {
      if (!r.ok) { toast(r.notes); return; }
      const t = r.data;
      t.profile.name = state?.profile.name || "";
      if (state) { t.projects = state.projects; t.counters = state.counters; t.settings = state.settings; }
      start(t, [`${meta.name} loaded. Make it yours in the Plan tab.`]);
    });
    return true; // start() renders once the template has loaded
  },
  "wz-cancel": () => { wiz = null; },
  "wz-back": () => {
    wiz.step = Math.max(0, wiz.step - 1);
    wiz.errors = [];
    Object.assign(wiz.form, { subject: "", days: [], start: "", end: "" });
  },
  "wz-next": () => {
    const f = wiz.form, d = wiz.draft;
    wiz.errors = [];
    if (wiz.step === 1) d.profile.name = f.name.trim();
    if (wiz.step === 2) {
      if (!isHHMM(f.wake) || !isHHMM(f.bedtime)) { wiz.errors = ["Pick a wake time and a bedtime."]; return; }
      for (const day of DAYS) d.profile.wake[day] = f.wake;
      d.profile.bedtime = f.bedtime;
    }
    if (WZ_KIND[wiz.step] && (f.subject.trim() || f.start || f.end)) {
      wiz.errors = ["You filled in a block but didn't add it. Tap Add, or clear the fields."];
      return;
    }
    wiz.step = Math.min(6, wiz.step + 1);
    f.days = [];
  },
  "wz-day": k => {
    const ds = wiz.form.days;
    wiz.form.days = ds.includes(k) ? ds.filter(d => d !== k) : [...ds, k];
  },
  "wz-days": k => { wiz.form.days = k === "all" ? [...DAYS] : k === "weekdays" ? DAYS.slice(0, 5) : []; },
  "wz-add": () => {
    const f = wiz.form;
    const r = addRecurring(wiz.draft, { kind: WZ_KIND[wiz.step], subject: f.subject, days: f.days, start: f.start, end: f.end });
    wiz.errors = r.errors;
    if (!r.errors.length) { wiz.draft = r.state; f.subject = f.start = f.end = ""; }
  },
  "wz-del": k => { wiz.draft.blocks = wiz.draft.blocks.filter(b => b.id !== k); },
  "wz-finish": () => { finishWizard(wiz.draft); return true; },
};

// ---------- actions ----------

const clicks = {
  "tab": k => { tab = k; editing = null; imp = null; goalEd = null; genOpen = false; afterImport = false; render(); },

  // Plan: timetable import (nothing is saved until imp-apply)
  "imp-open": () => { imp = { phase: "input", impText: "", filename: "", parsed: null, choices: [] }; editing = null; render(); focusForm(); },
  "imp-cancel": () => { imp = null; render(); },
  "imp-back": () => { imp.phase = "input"; render(); focusForm(); },
  "imp-preview": () => {
    if (!imp.impText.trim()) { toast(["Type or paste your classes first, one per line."]); return; }
    showImportReview(parseTimetable(imp.impText), "");
  },
  "imp-toggle": k => {
    const i = +k;
    if (!imp || !Number.isInteger(i) || i < 0 || i >= imp.parsed.rows.length) return;
    imp.choices[i] = { ...imp.choices[i], on: imp.choices[i]?.on === false };
    render();
  },
  "imp-apply": () => {
    const p = previewImport(state, imp.parsed.rows, imp.choices);
    if (!p.added) { toast(["Nothing to add. Tick some classes or go back."]); return; }
    imp = null;
    afterImport = true;
    if (commit(s => { s.blocks = p.state.blocks; s.categories = p.state.categories; })) {
      toast([`Added ${p.added} class${p.added === 1 ? "" : "es"} to your timetable.`]);
    }
  },
  "day": k => { selDay = k; render(); },
  "goto-plan": k => { tab = "plan"; planDay = k; render(); },
  "toggle": k => {
    const b = state.blocks.find(x => x.id === k);
    if (!b || b.kind !== "study") return;
    const wk = weekKey(studyDayOf(new Date(), state.profile.bedtime).date);
    commit(s => {
      const w = s.progress[wk] || (s.progress[wk] = {});
      if (w[k]) delete w[k]; else w[k] = true;
    });
  },

  // Plan: blocks
  "plan-day": k => { planDay = k; render(); },
  "blk-new": k => {
    editing = { id: uid(), isNew: true, copy: false, errors: [], draft: { title: "", kind: "study", cat: "", day: k, start: "", end: "" } };
    render(); focusForm();
  },
  "blk-edit": k => openBlock(k, false),
  "blk-dup": k => openBlock(k, true),
  "blk-cancel": () => { editing = null; render(); },
  "blk-save": () => {
    const r = draftToBlock(editing.draft, state, editing.id);
    if (r.errors.length) { editing.errors = r.errors; render(); focusForm(); return; }
    const ed = editing;
    editing = null;
    planDay = r.block.day;
    if (!commit(s => {
      const i = s.blocks.findIndex(b => b.id === r.block.id);
      if (i >= 0) s.blocks[i] = r.block; else s.blocks.push(r.block);
    })) editing = ed;
  },
  "blk-del": k => {
    const b = state.blocks.find(x => x.id === k);
    if (!b || !confirm(`Delete "${b.title}" on ${b.day}?`)) return;
    if (editing && editing.id === k) editing = null;
    commit(s => { s.blocks = s.blocks.filter(x => x.id !== k); });
  },

  // Plan: study goals + week generator
  "goal-new": () => {
    goalEd = { id: uid(), isNew: true, errors: [], draft: { gSubject: "", gHours: "4", gMin: "60", gMax: "120" } };
    genOpen = false; render(); focusGoal();
  },
  "goal-edit": k => {
    const g = state.goals.find(x => x.id === k);
    if (!g) return;
    goalEd = { id: g.id, isNew: false, errors: [], draft: { gSubject: g.title, gHours: String(g.hoursPerWeek), gMin: String(g.sessionMin), gMax: String(g.sessionMax) } };
    render(); focusGoal();
  },
  "goal-cancel": () => { goalEd = null; render(); },
  "goal-save": () => {
    const d = goalEd.draft;
    const r = goalFromDraft({ subject: d.gSubject, hours: d.gHours, smin: d.gMin, smax: d.gMax }, state, goalEd.id);
    if (r.errors.length) { goalEd.errors = r.errors; render(); focusGoal(); return; }
    goalEd = null;
    commit(s => { s.goals = r.state.goals; s.categories = r.state.categories; });
  },
  "goal-del": k => {
    const g = state.goals.find(x => x.id === k);
    if (g && confirm(`Delete the goal for "${g.title}"? Study blocks already in your week stay.`)) commit(s => { s.goals = s.goals.filter(x => x.id !== k); });
  },
  "three-touches": () => commit(s => { s.settings.threeTouches = !s.settings.threeTouches; }),
  "gen-open": () => {
    if (!state.goals.length) { toast(["Add a study goal first."]); return; }
    goalEd = null; genOpen = true; render(); focusForm();
  },
  "gen-cancel": () => { genOpen = false; render(); },
  "gen-apply": () => {
    const r = generateWeek(state); // recomputed now, so it matches the current timetable
    genOpen = false; afterImport = false;
    if (commit(s => { s.blocks = r.blocks; })) {
      const n = r.generated.length, short = r.goals.filter(g => g.missingMin).length;
      toast([`Added ${n} study session${n === 1 ? "" : "s"}.` + (short ? ` ${short} goal${short === 1 ? "" : "s"} didn't fully fit; see the Plan tab.` : "")]);
    }
  },

  // Plan: profile
  "prof-wake-all": k => {
    const t = state.profile.wake[k];
    commit(s => { for (const d of DAYS) s.profile.wake[d] = t; });
    toast([`Wake time set to ${t} every day.`]);
  },

  // Plan: subjects
  "cat-color": k => {
    const [id, i] = k.split("|");
    commit(s => { const c = s.categories.find(x => x.id === id); if (c) c.color = Math.min(PALETTE_SIZE - 1, Math.max(0, +i || 0)); });
  },
  "cat-del": k => {
    const c = state.categories.find(x => x.id === k);
    if (!c) return;
    const n = state.blocks.filter(b => b.cat === k).length;
    if (!confirm(`Delete the subject "${c.name}"?${n ? ` ${n} block${n === 1 ? "" : "s"} will keep their times but lose this subject.` : ""}`)) return;
    commit(s => {
      s.categories = s.categories.filter(x => x.id !== k);
      for (const b of s.blocks) if (b.cat === k) b.cat = null;
    });
  },
  "cat-add": () => {
    const name = $("catn").value.trim();
    if (!name) return;
    if (state.categories.length >= LIMITS.categories) { toast([`You can have up to ${LIMITS.categories} subjects.`]); return; }
    if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) { toast([`"${name}" is already a subject.`]); return; }
    commit(s => { s.categories.push({ id: uid(), name, color: s.categories.length % PALETTE_SIZE }); });
  },

  // Progress: counters
  "ctr-plus": k => commit(s => { const c = s.counters.find(x => x.id === k); if (c) c.count = Math.min(LIMITS.count, c.count + 1); }),
  "ctr-minus": k => commit(s => { const c = s.counters.find(x => x.id === k); if (c) c.count = Math.max(0, c.count - 1); }),
  "ctr-del": k => {
    const c = state.counters.find(x => x.id === k);
    if (c && confirm(`Remove the counter "${c.name}"?`)) commit(s => { s.counters = s.counters.filter(x => x.id !== k); });
  },
  "ctr-add": () => {
    const name = $("cn").value.trim();
    if (!name) return;
    if (state.counters.length >= LIMITS.counters) { toast([`You can have up to ${LIMITS.counters} counters.`]); return; }
    commit(s => { s.counters.push({ id: uid(), name, count: 0 }); });
  },

  // Projects
  "addproj": () => {
    const title = $("pn").value.trim(), note = $("pd").value.trim();
    if (!title) return;
    commit(s => {
      s.projects.unshift({ id: uid(), title, note, date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) });
      s.projects = s.projects.slice(0, LIMITS.projects);
    });
  },
  "delproj": k => commit(s => { s.projects = s.projects.filter(p => p.id !== k); }),

  // Settings
  "remon": () => {
    if (!canNotify()) return;
    Notification.requestPermission().then(r => {
      commit(s => { s.settings.remind = r === "granted"; });
      if (r === "granted") showNote("Reminders are on", "You'll get a nudge before each block.", "welcome");
    });
  },
  "remoff": () => commit(s => { s.settings.remind = false; }),
  "remtest": () => showNote("Test reminder", "If you can see this, reminders work on this device.", "test"),
  "ics": () => download("Study_Timetable.ics", "text/calendar", buildICS(state)),
  "install": () => { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; render(); } },
  "export": () => {
    const b = exportBackup(state);
    download(b.name, "application/json", b.text);
    commit(s => { s.settings.lastBackup = Date.now(); });
  },
  "update": () => {
    if (!waitingWorker) return;
    updateRequested = true;
    waitingWorker.postMessage("SKIP_WAITING"); // page reloads on controllerchange
  },
  "persist": () => requestPersist().then(ok => {
    persisted = ok;
    render();
    toast([ok ? "Storage is now protected." : "The browser said no for now. Installing the app usually makes it say yes; keep exporting backups meanwhile."]);
  }),
  "backup-later": () => { backupLater = true; render(); },

  // Alarms
  "arm": () => arm({ chirp: true }).then(ok => {
    render();
    toast([ok ? "Alarms armed. They will ring while the app is open." : "This browser can't play alarm sounds. Alarms will still show on screen and vibrate."]);
  }),
  "alarms-on": () => commit(s => { s.settings.alarms = true; }),
  "alarms-off": () => commit(s => { s.settings.alarms = false; }),
  "alarm-test": () => {
    const sd = studyDayOf(new Date(), state.profile.bedtime);
    const start = Math.min(sd.minute, LIMITS.maxTime - 30);
    fireAlarm({ key: `${isoDate(sd.date)}@alarm-test`, blockId: "alarm-test", title: "Test alarm", start, end: start + 30, kind: "study" });
  },
  "wz-open": () => {
    if (!confirm("Set up your week again? This replaces your timetable, and ticks on the old blocks are lost. Projects, counters and settings are kept.")) return;
    wiz = newWizard();
    render();
  },
  "theme": () => {
    if (!state) return;
    const dark = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() === "#0b1320";
    commit(s => { s.settings.theme = dark ? "light" : "dark"; });
  },
};

function openBlock(k, copy) {
  const b = state.blocks.find(x => x.id === k);
  if (!b) return;
  editing = {
    id: copy ? uid() : b.id, isNew: copy, copy, errors: [],
    draft: { title: b.title, kind: b.kind, cat: b.cat || "", day: b.day, start: toHHMM(b.start), end: toHHMM(b.end) },
  };
  planDay = b.day;
  render();
  focusForm();
}

document.addEventListener("click", ev => {
  const n = ev.target.closest("[data-a]");
  if (framed || !n || n.tagName === "SELECT" || n.tagName === "INPUT") return;
  const a = n.dataset.a, k = n.dataset.k;
  if (wiz && wizClicks[a]) {
    if (!wizClicks[a](k)) render();
    if (a === "wz-next" || a === "wz-back" || a === "wz-build") window.scrollTo(0, 0);
    return;
  }
  const fn = clicks[a];
  if (fn && (state || a === "theme" || a === "update")) fn(k);
});

// Form fields marked data-f keep their value in the wizard or editor draft,
// so a re-render never loses what was typed.
function syncField(n) {
  const f = n.dataset.f;
  if (wiz && f in wiz.form) wiz.form[f] = n.value;
  else if (editing && f in editing.draft) editing.draft[f] = n.value;
  else if (imp && f === "impText") imp.impText = n.value;
  else if (goalEd && f in goalEd.draft) goalEd.draft[f] = n.value;
}
document.addEventListener("input", ev => { if (ev.target.dataset && ev.target.dataset.f) syncField(ev.target); });

document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.f) {
    syncField(t);
    if (t.dataset.f === "kind") render();
    return;
  }
  const n = t.closest("[data-a]");
  if (!n) return;
  const a = n.dataset.a, k = n.dataset.k;

  if (a === "import" && n.files && n.files[0]) { importFile(n); return; }
  if (a === "imp-file" && n.files && n.files[0]) { importTimetableFile(n); return; }
  if (a === "imp-kind" && imp) {
    const i = +k;
    if (Number.isInteger(i) && i >= 0 && i < imp.parsed.rows.length && KINDS.includes(n.value)) {
      imp.choices[i] = { ...imp.choices[i], kind: n.value };
      render();
    }
    return;
  }
  if (!state) return;
  if (a === "lead") {
    const v = +n.value;
    if (LEADS.includes(v)) commit(s => { s.settings.lead = v; });
  } else if (a === "max-day") {
    const v = +n.value;
    if (Number.isInteger(v) && v >= 60 && v <= 960 && v % 30 === 0) commit(s => { s.settings.maxStudyPerDay = v; });
  } else if (a === "snooze-len") {
    const v = +n.value;
    if (SNOOZES.includes(v)) commit(s => { s.settings.snooze = v; });
  } else if (a === "prof-name") {
    commit(s => { s.profile.name = n.value; });
  } else if (a === "prof-bed") {
    if (isHHMM(n.value)) commit(s => { s.profile.bedtime = n.value; }); else render();
  } else if (a === "prof-wake") {
    if (isHHMM(n.value) && DAYS.includes(k)) commit(s => { s.profile.wake[k] = n.value; }); else render();
  } else if (a === "cat-name") {
    const name = n.value.trim();
    if (name) commit(s => { const c = s.categories.find(x => x.id === k); if (c) c.name = name; }); else render();
  }
});

function showImportReview(parsed, filename) {
  imp = { ...imp, phase: "review", filename, parsed, choices: [] };
  render();
  focusForm();
}

function importTimetableFile(n) {
  const file = n.files[0];
  n.value = "";
  if (file.size > IMPORT_LIMITS.bytes) { toast(["That file is too big for a timetable (max 256 KB)."]); return; }
  file.text().then(
    text => showImportReview(parseTimetable(text, file.name), file.name.slice(0, 80)),
    () => toast(["That file could not be read."]),
  );
}

function importFile(n) {
  const file = n.files[0];
  n.value = "";
  if (file.size > LIMITS.importBytes) { toast(["That file is too big to be a tracker backup (max 256 KB)."]); return; }
  file.text().then(text => parseImport(text)).then(r => {
    if (!r.ok) { toast(r.notes); return; }
    if (state && !confirm("Replace everything on this device with the backup?")) return;
    start(r.data, ["Backup imported.", ...r.notes]);
  }, () => toast(["That file could not be read."]));
}

// ---------- alarms ----------

function fireAlarm(a) {
  showAlarm(a, { onSnooze: m => snoozeAlarm(a, m), onDismiss: () => closeAlarmNotification(a.key) }, SNOOZES);
  notifyAlarm(a, state.settings.snooze);
}

function snoozeAlarm(a, minutes) {
  closeAlarm(a.key);
  saveAlarmStore(addSnooze(loadAlarmStore(), a, minutes));
  closeAlarmNotification(a.key);
  toast([`Snoozed for ${minutes} min. Keep the app open so it can ring again.`]);
}

function tickAlarms() {
  if (!state || framed) return;
  const r = dueAlarms(state, new Date(), loadAlarmStore());
  saveAlarmStore(r.store);
  r.fire.forEach(fireAlarm);
}

// Snooze / Dismiss tapped on a system notification (sent by sw.js, or via
// the #alarm=… link it opens when the app was closed).
function alarmAction(action, key) {
  if (!state || !KEY_RE.test(key) || (action !== "snooze" && action !== "dismiss")) return;
  if (action === "dismiss") { closeAlarm(key); closeAlarmNotification(key); return; }
  const cur = currentAlarm();
  let a = cur && cur.key === key ? cur : null;
  if (!a) {
    const b = state.blocks.find(x => x.id === key.slice(11));
    if (b) a = { key, blockId: b.id, title: b.title, start: b.start, end: b.end, kind: b.kind };
  }
  if (a) snoozeAlarm(a, state.settings.snooze);
  else closeAlarm(key);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", e => {
    const d = e.data;
    if (isPlainObject(d) && d.type === "alarm" && typeof d.action === "string" && typeof d.key === "string") alarmAction(d.action, d.key);
  });
}

// Any tap unlocks alarm sound (browsers require a tap before audio plays).
document.addEventListener("click", () => {
  if (isArmed() || !state || !state.settings.alarms) return;
  arm().then(ok => { if (ok) setTimeout(() => { if (!typing()) render(); }, 0); });
}, true);

setInterval(tickAlarms, 10000);

// ---------- browser events ----------

window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; if (state && !wiz && tab === "settings") render(); });
window.addEventListener("appinstalled", () => { deferredInstall = null; if (state && !wiz && tab === "settings") render(); });

const typing = () => app.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  checkForUpdate();
  if (!state) return;
  checkReminders(state);
  tickAlarms();
  if (!wiz && (tab === "day" || tab === "progress") && !typing()) render();
});

// Another tab of the app saved: pick up its data instead of overwriting it later.
window.addEventListener("storage", e => {
  if (e.key !== KEY) return;
  loadState().then(r => { if (r.state) { state = r.state; if (!typing()) render(); } });
});
setInterval(() => {
  if (!state) return;
  checkReminders(state);
  if (!wiz && tab === "day" && !document.hidden && !typing()) render(); // keeps "Right now" current
}, 30000);

// ---------- service worker and updates ----------
// A new version installs in the background, then waits. We show
// "Update ready" and only switch when the user taps it.

let swReg = null, lastUpdateCheck = 0;

function onWaiting(w) {
  if (!w || !navigator.serviceWorker.controller) return; // first install: nothing to replace
  waitingWorker = w;
  render();
}

function checkForUpdate() {
  if (!swReg || Date.now() - lastUpdateCheck < 30 * 60000) return;
  lastUpdateCheck = Date.now();
  swReg.update().catch(() => {});
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then(reg => {
    swReg = reg;
    lastUpdateCheck = Date.now();
    if (reg.waiting) onWaiting(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (w) w.addEventListener("statechange", () => { if (w.state === "installed") onWaiting(w); });
    });
  }).catch(() => {});

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateRequested && !reloading) { reloading = true; location.reload(); }
    else render(); // first install took control: "Works offline" can turn on
  });
}

// ---------- boot ----------

const loaded = await loadState();
state = loaded.state;
source = loaded.source;
render();
if (source === "migrated") toast(["Your old timetable and progress were moved into the new app.", ...loaded.notes]);
else if (loaded.notes.length) toast(loaded.notes);
if (state) checkReminders(state);

function readAlarmHash() {
  if (!location.hash) return;
  const m = /^#alarm=(snooze|dismiss):(\d{4}-\d{2}-\d{2}@[A-Za-z0-9_-]{1,40})$/.exec(location.hash);
  history.replaceState(null, "", location.pathname + location.search); // never leave a link half-handled
  if (m) alarmAction(m[1], m[2]);
}
readAlarmHash();
window.addEventListener("hashchange", readAlarmHash);
tickAlarms();

// Ask the browser to keep our data even when space runs low. Chrome decides
// quietly (yes for installed apps); some browsers ask the user.
isPersisted().then(p => {
  persisted = p;
  if (p || !state) return render();
  return requestPersist().then(ok => { persisted = ok; render(); });
});
