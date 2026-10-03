// Boot, state, routing and event delegation.
// State changes go through commit(): copy → change → validate + save → render.

import { defaultState, uid, isHHMM, LIMITS, LEADS, DAYS, PALETTE_SIZE } from "./schema.js";
import { studyDayOf, weekKey, toHHMM, draftToBlock, addRecurring } from "./schedule.js";
import { loadState, saveState, templateMcJayy, exportBackup, parseImport } from "./storage.js";
import { buildICS } from "./ics.js";
import { tabsBar, dayView, progressView, planView, projectsView, settingsView, wizardView, toastNode } from "./ui.js";
import { checkReminders, showNote, permission, canNotify } from "./reminders.js";

// Shown in Settings so you can tell which upgrade is live. Bump with each release (see CHANGELOG.md).
const APP_VERSION = "0.6.0 · Stage 1, step 6 of 9";

const $ = id => document.getElementById(id);
const app = $("app");

let state = null;     // always a validated v1 object, or null before setup
let source = "new";
let tab = "day";
let selDay = null;    // Day tab: null = follow today
let planDay = null;   // Plan tab: null = follow today
let editing = null;   // Plan tab form: { id, isNew, copy, draft, errors }
let wiz = null;       // setup wizard, see newWizard()
let deferredInstall = null;

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
    perm: permission(),
    installed: (globalThis.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true,
    canInstall: !!deferredInstall,
    version: APP_VERSION,
  };
}

function applyTheme() {
  const t = state ? state.settings.theme : "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

const VIEWS = { day: dayView, progress: progressView, plan: planView, projects: projectsView, settings: settingsView };

function render() {
  applyTheme();
  if (!state && !wiz) wiz = newWizard();
  if (wiz) {
    $("dateLine").textContent = "";
    app.replaceChildren(...wizardView(wiz, { hasState: !!state, source }));
    return;
  }
  const ctx = context();
  $("dateLine").textContent = ctx.today.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  app.replaceChildren(tabsBar(tab), ...(VIEWS[tab] || dayView)(state, ctx));
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
  "wz-template": () => {
    const t = templateMcJayy({ name: state?.profile.name || "" });
    if (state) { t.projects = state.projects; t.counters = state.counters; t.settings = state.settings; }
    start(t, ["McJayy's week loaded. Make it yours in the Plan tab."]);
    return true;
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
  "tab": k => { tab = k; editing = null; render(); },
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
  if (!n || n.tagName === "SELECT" || n.tagName === "INPUT") return;
  const a = n.dataset.a, k = n.dataset.k;
  if (wiz && wizClicks[a]) {
    if (!wizClicks[a](k)) render();
    if (a === "wz-next" || a === "wz-back" || a === "wz-build") window.scrollTo(0, 0);
    return;
  }
  const fn = clicks[a];
  if (fn && (state || a === "theme")) fn(k);
});

// Form fields marked data-f keep their value in the wizard or editor draft,
// so a re-render never loses what was typed.
function syncField(n) {
  const f = n.dataset.f;
  if (wiz && f in wiz.form) wiz.form[f] = n.value;
  else if (editing && f in editing.draft) editing.draft[f] = n.value;
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
  if (!state) return;
  if (a === "lead") {
    const v = +n.value;
    if (LEADS.includes(v)) commit(s => { s.settings.lead = v; });
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

function importFile(n) {
  const file = n.files[0];
  n.value = "";
  if (file.size > LIMITS.importBytes) { toast(["That file is too big to be a tracker backup (max 256 KB)."]); return; }
  file.text().then(text => {
    const r = parseImport(text);
    if (!r.ok) { toast(r.notes); return; }
    if (state && !confirm("Replace everything on this device with the backup?")) return;
    start(r.data, ["Backup imported.", ...r.notes]);
  }, () => toast(["That file could not be read."]));
}

// ---------- browser events ----------

window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; if (state && !wiz && tab === "settings") render(); });
window.addEventListener("appinstalled", () => { deferredInstall = null; if (state && !wiz && tab === "settings") render(); });

const typing = () => app.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !state) return;
  checkReminders(state);
  if (!wiz && (tab === "day" || tab === "progress") && !typing()) render();
});
setInterval(() => {
  if (!state) return;
  checkReminders(state);
  if (!wiz && tab === "day" && !document.hidden && !typing()) render(); // keeps "Right now" current
}, 30000);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- boot ----------

const loaded = loadState();
state = loaded.state;
source = loaded.source;
render();
if (source === "migrated") toast(["Your old timetable and progress were moved into the new app.", ...loaded.notes]);
if (state) checkReminders(state);
