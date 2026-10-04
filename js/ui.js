// Views. Every node is built with createElement and every piece of text goes
// in through textContent, so user text can never become HTML.
// No innerHTML, no inline styles, no inline handlers: actions are declared
// with data-a / data-k and handled by delegation in main.js.

import { DAYS, KINDS, PALETTE_SIZE, LIMITS } from "./schema.js";
import { TEMPLATES } from "./storage.js";
import { previewImport } from "./importers.js";
import { SESSION_CHOICES } from "./generator.js";
import {
  fmtRange, fmtHours, dur, blocksForDay, currentAndNext, dayStats, weekStats,
  planned, sum, streak, weekStart, addDays, isoDate, findOverlaps, sleepReport, fmtDuration, inputToRange,
} from "./schedule.js";

const DAY_NAMES = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };
const KIND_LABEL = { study: "Study", lecture: "Lecture", nap: "Nap", rest: "Rest / wind-down" };

const SVG_NS = "http://www.w3.org/2000/svg";
const FORBIDDEN = /^(on|style$|innerhtml$|outerhtml$|srcdoc$|href$|src$)/i;

function setProps(n, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (FORBIDDEN.test(k)) throw new Error(`el(): "${k}" is not allowed`);
    if (k === "class") n.setAttribute("class", v);
    else if (k === "text") n.textContent = String(v);
    else if (k === "data") for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = String(dv);
    else if (k === "vars") for (const [vk, vv] of Object.entries(v)) n.style.setProperty("--" + vk, String(vv)); // CSSOM, allowed by CSP
    else if (k === "value" || k === "checked" || k === "selected" || k === "disabled") n[k] = v;
    else n.setAttribute(k, v === true ? "" : String(v));
  }
}

function append(n, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    n.append(typeof k === "string" || typeof k === "number" ? document.createTextNode(String(k)) : k);
  }
}

// el("div", { class: "card", data: { a: "x" } }, "text", childNode, [more])
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  setProps(n, props);
  append(n, kids);
  return n;
}

function svg(tag, props = {}, ...kids) {
  const n = document.createElementNS(SVG_NS, tag);
  setProps(n, props);
  append(n, kids);
  return n;
}

const btn = (text, a, k, cls = "btn") => el("button", { type: "button", class: cls, data: k === undefined ? { a } : { a, k } }, text);

// ---------- shared pieces ----------

function catOf(state, id) {
  return id ? state.categories.find(c => c.id === id) || null : null;
}

function colorClass(state, b) {
  if (b.kind !== "study") return "c-rest";
  const c = catOf(state, b.cat);
  return c ? `c-${c.color}` : "c-none";
}

function ring(p) {
  const C = 2 * Math.PI * 26, v = Math.max(0, Math.min(1, p));
  return svg("svg", { class: "ring", width: 68, height: 68, viewBox: "0 0 68 68", "aria-hidden": "true" },
    svg("circle", { class: "ring-bg", cx: 34, cy: 34, r: 26 }),
    svg("circle", { class: "ring-fg", cx: 34, cy: 34, r: 26, "stroke-dasharray": `${(v * C).toFixed(1)} ${C.toFixed(1)}`, transform: "rotate(-90 34 34)" }),
    svg("text", { class: "ring-txt", x: 34, y: 39, "text-anchor": "middle" }, `${Math.round(v * 100)}%`));
}

function hero(state, ctx) {
  const ws = weekStats(state, ctx.wk);
  const done = sum(ws.mins), plan = sum(planned(state)), st = streak(state, ctx.now);
  return el("div", { class: "hero" },
    el("div", { class: "row" },
      ring(ws.tot ? ws.done / ws.tot : 0),
      el("div", { class: "grow" },
        el("div", { class: "big" }, "This week"),
        el("div", { class: "sub" }, `${ws.done} of ${ws.tot} study blocks done`),
        el("div", { class: "chips" },
          el("span", { class: "chip" }, el("b", { text: fmtHours(done) }), ` / ${fmtHours(plan)} hrs`),
          el("span", { class: "chip" }, "Streak ", el("b", { text: st }), st === 1 ? " day" : " days")))));
}

export function tabsBar(tab) {
  const tabs = [["day", "Day"], ["progress", "Progress"], ["plan", "Plan"], ["projects", "Projects"], ["settings", "Settings"]];
  return el("div", { class: "tabs", role: "tablist" },
    tabs.map(([k, label]) => el("button", { type: "button", role: "tab", "aria-selected": String(k === tab), class: k === tab ? "tab on" : "tab", data: { a: "tab", k } }, label)));
}

// ---------- Day ----------

export function dayView(state, ctx) {
  const sel = ctx.selDay, isToday = sel === ctx.today.day;
  const ticks = state.progress[ctx.wk] || {};
  const out = [hero(state, ctx)];

  out.push(el("div", { class: "days" }, DAYS.map(d => {
    const s = dayStats(state, ctx.wk, d), p = s.tot ? Math.round((100 * s.done) / s.tot) : 0;
    const cls = ["day", d === sel && "on", d === ctx.today.day && "today"].filter(Boolean).join(" ");
    return el("button", { type: "button", class: cls, "aria-pressed": String(d === sel), data: { a: "day", k: d } },
      el("div", { class: "n" }, d), el("div", { class: "p" }, `${p}%`));
  })));

  const blocks = blocksForDay(state.blocks, sel);
  let curId = null;
  if (isToday) {
    const { cur, next } = currentAndNext(blocks, ctx.today.minute);
    const b = cur || next;
    if (cur) curId = cur.id;
    out.push(b
      ? el("div", { class: "card now" },
          el("div", { class: "k" }, cur ? "Right now" : "Up next"),
          el("div", { class: "v", text: b.title }),
          el("div", { class: "sub" }, fmtRange(b.start, b.end)))
      : el("div", { class: "card now" },
          el("div", { class: "k" }, "Day finished"),
          el("div", { class: "v" }, "Rest up. Tomorrow you go again.")));
  }

  if (!blocks.length) {
    out.push(el("div", { class: "card" },
      el("div", { class: "sub mb8" }, "Nothing planned for this day."),
      btn("Plan this day", "goto-plan", sel, "btn pri")));
    return out;
  }

  const night = sleepReport(state).find(d => d.day === sel);
  if (!night.ok) {
    out.push(el("div", { class: "card warn-card" },
      el("div", { class: "k" }, "😴 Sleep warning"),
      el("div", { text: night.message }),
      btn("Fix in Plan", "goto-plan", night.late ? night.late.day : sel, "link")));
  }

  const st = dayStats(state, ctx.wk, sel);
  if (st.tot && st.done === st.tot) out.push(el("div", { class: "done-msg" }, "Day complete. Every block ticked. 🔥"));

  for (const b of blocks) {
    const hrs = fmtHours(dur(b));
    const t = `${fmtRange(b.start, b.end)} · ${hrs} hr${hrs === "1" ? "" : "s"}`;
    if (b.kind === "nap" || b.kind === "rest") {
      out.push(el("div", { class: "rest" }, b.kind === "nap" ? "😴" : "🌙", el("span", { text: `${t} · ${b.title}` })));
      continue;
    }
    const body = el("div", { class: "grow" }, el("div", { class: "tm", text: t }), el("div", { class: "lb", text: b.title }));
    const cc = colorClass(state, b);
    if (b.kind === "lecture") {
      out.push(el("div", { class: `blk lecture ${cc}${b.id === curId ? " cur" : ""}` },
        el("span", { class: "chk", "aria-hidden": "true" }), body, el("span", { class: "tag" }, "Lecture")));
      continue;
    }
    const done = !!ticks[b.id];
    const cat = catOf(state, b.cat);
    out.push(el("button", {
      type: "button",
      class: `blk ${cc}${done ? " done" : ""}${b.id === curId ? " cur" : ""}`,
      "aria-pressed": String(done),
      data: { a: "toggle", k: b.id },
    }, el("span", { class: "chk", "aria-hidden": "true" }, "✓"), body, cat && el("span", { class: "tag", text: cat.name })));
  }
  return out;
}

// ---------- Progress ----------

export function progressView(state, ctx) {
  const out = [hero(state, ctx)];

  out.push(el("div", { class: "card" }, el("h3", {}, "Completion by day"),
    el("div", { class: "bars" }, DAYS.map(d => {
      const s = dayStats(state, ctx.wk, d), p = s.tot ? s.done / s.tot : 0;
      return el("div", { class: d === ctx.today.day ? "bar today" : "bar" },
        el("i", { vars: { h: `${Math.max(3, Math.round(p * 100))}%` } }),
        el("span", {}, d[0] + d.slice(1).toLowerCase()));
    }))));

  const ws = weekStats(state, ctx.wk), pl = planned(state);
  const rows = state.categories.filter(c => pl[c.id]).map(c => [c.id, c.name, `c-${c.color}`]);
  if (pl[""]) rows.push(["", "No category", "c-none"]);
  out.push(el("div", { class: "card" }, el("h3", {}, "Hours studied vs planned"),
    rows.length ? rows.map(([id, name, cc]) => {
      const d = ws.mins[id] || 0, p = pl[id];
      return el("div", { class: `cat ${cc}` },
        el("div", { class: "h" }, el("span", { text: name }), el("span", {}, `${fmtHours(d)} / ${fmtHours(p)} hrs`)),
        el("div", { class: "track" }, el("i", { vars: { w: `${Math.min(100, Math.round((100 * d) / p))}%` } })));
    }) : el("div", { class: "sub" }, "No study blocks planned yet.")));

  out.push(countersCard(state));

  const hist = [];
  const mon = weekStart(ctx.today.date);
  const f = d => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  for (let i = 1; i <= 4; i++) {
    const m = addDays(mon, -7 * i), s = weekStats(state, isoDate(m));
    if (s.done > 0) hist.push(el("div", { class: "hist" }, el("span", {}, `${f(m)} – ${f(addDays(m, 6))}`), el("b", {}, `${Math.round((100 * s.done) / s.tot)}%`)));
  }
  if (hist.length) out.push(el("div", { class: "card" }, el("h3", {}, "Previous weeks"), hist));
  out.push(el("div", { class: "foot" }, "Saved on this device only. Use Settings → Export to keep a backup."));
  return out;
}

function countersCard(state) {
  return el("div", { class: "card" },
    el("h3", {}, "Counters (all time)"),
    state.counters.length
      ? state.counters.map(c => el("div", { class: "counter" },
          el("div", { class: "name", text: c.name }),
          el("button", { type: "button", class: "btn sq", "aria-label": `Decrease ${c.name}`, data: { a: "ctr-minus", k: c.id } }, "−"),
          el("div", { class: "num", text: c.count }),
          el("button", { type: "button", class: "btn sq pri", "aria-label": `Increase ${c.name}`, data: { a: "ctr-plus", k: c.id } }, "+"),
          el("button", { type: "button", class: "link", data: { a: "ctr-del", k: c.id } }, "remove")))
      : el("div", { class: "sub mb8" }, "Count things you finish, like course modules or past papers."),
    el("div", { class: "row mt8" },
      el("input", { id: "cn", class: "grow", placeholder: "New counter, e.g. Modules finished", maxlength: 40, "aria-label": "New counter name" }),
      btn("Add", "ctr-add")));
}

// ---------- Projects ----------

export function projectsView(state, ctx) {
  return [
    hero(state, ctx),
    el("div", { class: "card" },
      el("h3", {}, "Log a project"),
      el("input", { id: "pn", placeholder: "What did you build?", maxlength: 80, "aria-label": "Project name" }),
      el("textarea", { id: "pd", placeholder: "What did you learn or use? (optional)", maxlength: 300, "aria-label": "Project notes" }),
      btn("Add project", "addproj", undefined, "btn pri")),
    el("div", { class: "card" },
      el("h3", {}, `Built so far: ${state.projects.length}`),
      state.projects.length
        ? state.projects.map(p => el("div", { class: "proj" },
            el("div", { class: "t", text: p.title }),
            p.note && el("div", { class: "n", text: p.note }),
            el("div", { class: "d" }, el("span", { text: p.date }), " · ", btn("remove", "delproj", p.id, "link"))))
        : el("div", { class: "sub" }, "Nothing yet. Your first one can be tiny, like a script that counts failed logins.")),
  ];
}

// ---------- Settings ----------

export function settingsView(state, ctx) {
  const st = state.settings, p = ctx.perm, on = st.remind && p === "granted";
  const out = [];

  out.push(el("div", { class: "card" },
    el("h3", {}, "Alarms"),
    el("div", { class: "sub mb8" }, st.alarms
      ? `On. When a block starts, a full-screen alarm rings until you snooze or dismiss it. Sound is ${ctx.armed ? "armed" : "not armed yet: tap Arm alarms"}.`
      : "Off. Blocks start without an alarm."),
    el("div", { class: "row wrap-row" },
      st.alarms ? btn("Turn alarms off", "alarms-off") : btn("Turn alarms on", "alarms-on", undefined, "btn pri"),
      st.alarms && !ctx.armed && btn("Arm alarms", "arm", undefined, "btn pri"),
      st.alarms && btn("Test alarm", "alarm-test"),
      el("select", { class: "btn", "aria-label": "Snooze length on notifications", data: { a: "snooze-len" } },
        [5, 10].map(m => el("option", { value: String(m), selected: m === st.snooze }, `Notification snooze: ${m} min`)))),
    el("div", { class: "sub mt8" },
      el("b", {}, "Honest limits: "),
      "alarms only ring while this app is open, or was used recently and your phone hasn't paused it. A website cannot ring on a locked phone with the app closed. Real alarms come with the Android app (Stage 3). For now, the calendar file below is the most reliable alert. Turn on reminders too, so you also get a notification with Snooze and Dismiss buttons.")));

  const rem = [el("h3", {}, "Reminders")];
  if (p === "unsupported") {
    rem.push(el("div", { class: "sub" }, "This browser does not support notifications. Use the calendar file below instead."));
  } else {
    rem.push(el("div", { class: "sub mb8" },
      on ? `On. You get a nudge ${st.lead} min before each block.`
        : p === "denied" ? "Blocked. Allow notifications for this site in your browser settings, then come back." : "Off."));
    rem.push(el("div", { class: "row wrap-row" },
      on ? btn("Turn off", "remoff") : p !== "denied" && btn("Turn on reminders", "remon", undefined, "btn pri"),
      p === "granted" && btn("Send test", "remtest"),
      el("select", { class: "btn", "aria-label": "Reminder lead time", data: { a: "lead" } },
        [5, 10, 15, 30].map(m => el("option", { value: String(m), selected: m === st.lead }, `${m} min before`)))));
    rem.push(el("div", { class: "sub mt8" }, "These fire while the app is open or was used recently. Phones pause background apps, so for alerts you can always count on, add the calendar file below."));
  }
  out.push(el("div", { class: "card" }, rem));

  out.push(el("div", { class: "card" },
    el("h3", {}, "Calendar alerts (most reliable)"),
    el("div", { class: "sub mb8" }, `Downloads your whole week as a calendar file. Open it and your phone calendar adds every block with a ${st.lead}-minute alert. These fire even when this app is closed.`),
    btn("Download calendar file", "ics", undefined, "btn pri")));

  const inst = [el("h3", {}, "Install as an app")];
  if (ctx.installed) inst.push(el("div", { class: "sub" }, "Installed. You are using it as an app."));
  else {
    inst.push(el("div", { class: "sub mb8" }, "Android (Chrome): tap Install below, or menu → Install app.", el("br"), "iPhone (Safari): Share → Add to Home Screen."));
    if (ctx.canInstall) inst.push(btn("Install", "install", undefined, "btn pri"));
  }
  out.push(el("div", { class: "card" }, inst));

  const last = st.lastBackup ? new Date(st.lastBackup).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never";
  out.push(el("div", { class: "card" },
    el("h3", {}, "Backup"),
    el("div", { class: "sub mb8" }, `Your timetable and progress live on this device. Export a copy now and then, or to move to a new phone. Last export: ${last}.`),
    el("div", { class: "row wrap-row" },
      btn("Export", "export"),
      el("label", { class: "btn" }, "Import",
        el("input", { type: "file", class: "hidden", accept: "application/json,.json", data: { a: "import" } })))));

  out.push(el("div", { class: "card" },
    el("h3", {}, "Storage and offline"),
    el("div", { class: "row mb8" },
      el("span", { class: ctx.persisted ? "pill ok" : "pill" }, ctx.persisted ? "Storage protected" : "Storage not protected"),
      el("span", { class: ctx.offline ? "pill ok" : "pill" }, ctx.offline ? "Works offline" : "Offline not ready yet")),
    el("div", { class: "sub mb8" }, ctx.persisted
      ? "Your browser has agreed not to clear this app's data when space runs low."
      : "If your phone runs low on space, the browser may clear this app's data. Installing the app helps, and so do regular backups."),
    !ctx.persisted && btn("Protect storage", "persist")));

  out.push(el("div", { class: "card" },
    el("h3", {}, "Timetable"),
    el("div", { class: "sub mb8" }, "Change single blocks in the Plan tab. To start your week over, run the setup again or load a template (Student, Night owl, Early bird, McJayy's week). Your projects, counters and settings are kept."),
    btn("Run setup again or load a template", "wz-open")));

  out.push(el("div", { class: "foot" }, `Version ${ctx.version}`));
  return out;
}

// ---------- form helpers ----------

const field = (label, input) => el("label", { class: "field" }, el("span", {}, label), input);
const timeInput = (f, value, label) => el("input", { type: "time", class: "time-big", step: 300, value: value || "", "aria-label": label, data: { f } });
const errorList = errs => errs && errs.length ? el("ul", { class: "errs", role: "alert" }, errs.map(e => el("li", { text: e }))) : null;

// ---------- Plan (timetable editor) ----------
// ctx.planDay: the day shown. ctx.editing: null or { id, isNew, copy, draft, errors }.

export function planView(state, ctx) {
  const out = [];
  const day = ctx.planDay;

  const clashes = findOverlaps(state.blocks);
  if (clashes.length) {
    out.push(el("div", { class: "banner warn", role: "alert" },
      el("b", {}, "Some blocks overlap. Edit one of each pair:"),
      el("ul", { class: "errs" }, clashes.slice(0, 5).map(([a, b]) =>
        el("li", { text: `${a.day} ${fmtRange(a.start, a.end)} "${a.title}" and ${b.day} ${fmtRange(b.start, b.end)} "${b.title}"` })))));
  }

  const sleep = sleepReport(state);
  const short = sleep.filter(d => !d.ok);
  if (short.length) {
    out.push(el("div", { class: "banner warn", role: "alert" },
      el("b", {}, "😴 Not enough sleep on some nights (aim for 7 h):"),
      el("ul", { class: "errs" }, short.map(d => el("li", { text: d.message })))));
  }

  out.push(el("div", { class: "card" },
    el("h3", {}, "You"),
    field("Name", el("input", { value: state.profile.name, maxlength: LIMITS.name, placeholder: "Your name", autocomplete: "given-name", data: { a: "prof-name" } })),
    el("div", { class: "grid2" },
      field("Bedtime", el("input", { type: "time", class: "time-big", step: 300, value: state.profile.bedtime, data: { a: "prof-bed" } })),
      field(`Wake on ${DAY_NAMES[day]}`, el("input", { type: "time", class: "time-big", step: 300, value: state.profile.wake[day], data: { a: "prof-wake", k: day } }))),
    el("div", { class: "row wrap-row" }, btn("Use this wake time every day", "prof-wake-all", day)),
    el("div", { class: "sub mt8" }, "Your study day ends at bedtime. A 1:30am block before a 3:30am bedtime counts for the day before.")));

  out.push(el("div", { class: "days" }, DAYS.map(d => {
    const n = state.blocks.filter(b => b.day === d).length;
    const cls = ["day", d === day && "on", d === ctx.today.day && "today"].filter(Boolean).join(" ");
    return el("button", { type: "button", class: cls, "aria-pressed": String(d === day), data: { a: "plan-day", k: d } },
      el("div", { class: "n" }, d), el("div", { class: "p" }, String(n)));
  })));

  if (ctx.imp) out.push(...importPanel(state, ctx.imp));
  else out.push(el("div", { class: "card" },
    el("h3", {}, "Import class timetable"),
    el("div", { class: "sub mb8" }, "Paste lines like \"Mon 9:30-11:30 CSC 415\", or choose a CSV or calendar (.ics) file. You'll review everything before it's added."),
    btn("Import timetable", "imp-open", undefined, "btn")));

  if (ctx.afterImport && !ctx.gen) {
    out.push(el("div", { class: "banner" },
      el("div", { class: "mb8" }, "Classes added. Next: set how many hours a week you want for each subject, and the app fills your free time around them."),
      btn("Fill my study time", state.goals.length ? "gen-open" : "goal-new", undefined, "btn pri")));
  }
  if (ctx.gen) out.push(genPanel(state, ctx.gen));
  else out.push(goalsCard(state, ctx.goalEd));

  if (ctx.editing) out.push(blockForm(state, ctx.editing));

  const blocks = blocksForDay(state.blocks, day);
  out.push(el("div", { class: "card" },
    el("h3", {}, `${DAY_NAMES[day]} · ${blocks.length} block${blocks.length === 1 ? "" : "s"}`),
    blocks.length ? blocks.map(b => {
      const cat = catOf(state, b.cat);
      return el("div", { class: `prow ${colorClass(state, b)}` },
        el("div", { class: "tm", text: `${fmtRange(b.start, b.end)} · ${KIND_LABEL[b.kind]}${cat ? " · " + cat.name : ""}${b.gen ? " · generated" : ""}` }),
        el("div", { class: "lb", text: b.title }),
        el("div", { class: "row wrap-row mt8" },
          btn("Edit", "blk-edit", b.id),
          btn("Copy", "blk-dup", b.id),
          btn("Delete", "blk-del", b.id, "btn danger")));
    }) : el("div", { class: "sub mb8" }, "No blocks yet."),
    el("div", { class: "row mt8" }, btn("+ Add block", "blk-new", day, "btn pri"))));

  out.push(sleepCard(sleep));
  out.push(categoriesCard(state));
  return out;
}

// ---------- timetable import ----------
// imp: { phase: "input" | "review", impText, filename, parsed: { format, rows, errors, notes }, choices: [{ on, kind }] }

const FORMAT_NAME = { text: "text", csv: "CSV file", ics: "calendar file" };

function importPanel(state, imp) {
  if (imp.phase === "input") {
    return [el("div", { class: "card form" },
      el("h3", {}, "Import class timetable"),
      el("div", { class: "sub mb8" }, "One class per line: day(s), time, course. Add [study], [nap] or [rest] at the end to change the type; everything else comes in as a lecture."),
      el("textarea", {
        class: "imp-text", maxlength: 20000, spellcheck: "false", "aria-label": "Timetable text",
        placeholder: "Mon 9:30-11:30 CSC 415\nTue/Thu 2pm-4pm CSC 401 Lab\nWed 14:00-16:00 Stats",
        value: imp.impText, data: { f: "impText" },
      }),
      el("div", { class: "row wrap-row" },
        btn("Preview", "imp-preview", undefined, "btn pri"),
        el("label", { class: "btn" }, "Choose CSV or .ics file",
          el("input", { type: "file", class: "hidden", accept: ".csv,.ics,.txt,text/csv,text/calendar,text/plain", data: { a: "imp-file" } })),
        btn("Cancel", "imp-cancel")),
      el("div", { class: "sub mt8" }, "Read on this phone only. Nothing is uploaded."))];
  }

  const { parsed } = imp;
  const p = previewImport(state, parsed.rows, imp.choices);
  const clashes = p.items.filter(i => i.status === "error").length;
  const out = [el("div", { class: "card form" },
    el("h3", {}, `Review: ${parsed.rows.length} class${parsed.rows.length === 1 ? "" : "es"} found`),
    el("div", { class: "sub mb8", text: `From ${imp.filename ? `"${imp.filename}"` : "your text"} (${FORMAT_NAME[parsed.format]}). ${p.added} will be added${clashes ? `, ${clashes} clash${clashes === 1 ? "es" : ""} with your timetable and will be skipped` : ""}. Untick anything you don't want.` }),
    parsed.errors.length > 0 && el("div", { class: "banner warn" },
      el("b", {}, `${parsed.errors.length} line${parsed.errors.length === 1 ? "" : "s"} couldn't be read:`),
      el("ul", { class: "errs" }, parsed.errors.map(e => el("li", { text: e.line ? `Line ${e.line}: ${e.message}` : e.message })))),
    parsed.notes.length > 0 && el("div", { class: "sub mb8", text: parsed.notes.join(" ") }),
    p.items.map((it, i) => {
      const r = inputToRange(it.start, it.end, state.profile.bedtime);
      return el("div", { class: `imp-row${it.on ? "" : " off"}${it.status === "error" ? " bad" : ""}` },
        el("button", { type: "button", class: "imp-check", role: "checkbox", "aria-checked": String(it.on), "aria-label": `Include ${it.title} on ${it.day}`, data: { a: "imp-toggle", k: i } }, it.on ? "✓" : ""),
        el("div", { class: "grow" },
          el("div", { class: "tm", text: `${it.day} ${fmtRange(r.start, r.end)}` }),
          el("div", { class: "lb", text: it.title }),
          it.status === "error" && el("div", { class: "imp-err", text: it.error })),
        el("select", { class: "btn imp-kind", "aria-label": "Type", data: { a: "imp-kind", k: i } },
          KINDS.map(k => el("option", { value: k, selected: it.kind === k }, KIND_LABEL[k]))));
    }),
    !parsed.rows.length && el("div", { class: "sub" }, "Nothing to add. Go back and check the format."),
    el("div", { class: "row wrap-row mt8" },
      btn(p.added ? `Add ${p.added} class${p.added === 1 ? "" : "es"}` : "Nothing to add", "imp-apply", undefined, "btn pri"),
      btn("Back", "imp-back"),
      btn("Cancel", "imp-cancel")))];
  return out;
}

// ---------- study goals + week generator ----------
// goalEd: null or { id, isNew, draft: { gSubject, gHours, gMin, gMax }, errors }
// gen: the result of generateWeek(state), shown for review before applying.

const sessLabel = m => (m < 60 ? `${m} min` : fmtDuration(m));

function goalsCard(state, goalEd) {
  const st = state.settings;
  const sessSelect = (f, value, label) => el("select", { class: "btn", "aria-label": label, data: { f } },
    SESSION_CHOICES.map(m => el("option", { value: String(m), selected: String(m) === String(value) }, sessLabel(m))));
  const form = goalEd && el("div", { class: "goal-form" },
    field("Course or subject", el("input", { value: goalEd.draft.gSubject, maxlength: LIMITS.name, placeholder: "e.g. CSC 415", list: "goal-subjects", data: { f: "gSubject" } })),
    el("datalist", { id: "goal-subjects" }, state.categories.map(c => el("option", { value: c.name }))),
    field("Hours per week", el("input", { type: "number", inputmode: "decimal", min: "0.5", max: "60", step: "0.5", value: goalEd.draft.gHours, data: { f: "gHours" } })),
    el("div", { class: "grid2" },
      field("Shortest session", sessSelect("gMin", goalEd.draft.gMin, "Shortest session")),
      field("Longest session", sessSelect("gMax", goalEd.draft.gMax, "Longest session"))),
    errorList(goalEd.errors),
    el("div", { class: "row wrap-row mt8" }, btn("Save goal", "goal-save", undefined, "btn pri"), btn("Cancel", "goal-cancel")));

  return el("div", { class: goalEd ? "card form" : "card" },
    el("h3", {}, "Study goals"),
    el("div", { class: "sub mb8" }, "How many hours a week you want for each subject. The generator fills your free time around lectures, naps and the blocks you placed yourself."),
    state.goals.map(g => el("div", { class: "goal-row" },
      el("div", { class: "grow" },
        el("div", { class: "lb", text: g.title }),
        el("div", { class: "tm", text: `${fmtDuration(Math.round(g.hoursPerWeek * 60))} a week · sessions ${sessLabel(g.sessionMin)}–${sessLabel(g.sessionMax)}` })),
      btn("Edit", "goal-edit", g.id),
      btn("Delete", "goal-del", g.id, "btn danger"))),
    form || btn("+ Add goal", "goal-new", undefined, "btn"),
    el("div", { class: "row wrap-row mt8" },
      el("select", { class: "btn", "aria-label": "Most study per day", data: { a: "max-day" } },
        [120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 840, 960].map(m => el("option", { value: String(m), selected: m === st.maxStudyPerDay }, `Max ${m / 60} h a day`))),
      el("button", { type: "button", class: st.threeTouches ? "btn toggle on" : "btn toggle", "aria-pressed": String(st.threeTouches), data: { a: "three-touches" } },
        st.threeTouches ? "3 touches: on" : "3 touches: off")),
    el("div", { class: "sub mt8" }, "3 touches: study each course the day before its lecture, the day after, and once more later in the week."),
    el("div", { class: "row mt8" },
      state.goals.length
        ? btn("Generate my study week", "gen-open", undefined, "btn pri")
        : el("div", { class: "sub" }, "Add a goal to generate your study week.")));
}

function genPanel(state, gen) {
  const removed = state.blocks.filter(b => b.gen).length;
  const total = gen.generated.reduce((s, b) => s + dur(b), 0);
  const short = gen.goals.filter(g => g.missingMin > 0);
  return el("div", { class: "card form" },
    el("h3", {}, "Your generated study week"),
    el("div", { class: "sub mb8" },
      `${gen.generated.length} session${gen.generated.length === 1 ? "" : "s"}, ${fmtDuration(total)} in all.`
      + (removed ? ` Replaces the ${removed} block${removed === 1 ? "" : "s"} generated last time.` : "")
      + " Blocks you placed yourself are not changed."),
    gen.goals.map(g => el("div", { class: g.missingMin ? "srow warn" : "srow" },
      el("span", { text: g.title }),
      el("span", { text: [
        `goal ${fmtDuration(g.targetMin)}`,
        g.haveMin && `${fmtDuration(g.haveMin)} placed by you`,
        g.placedMin && `${fmtDuration(g.placedMin)} added`,
        g.missingMin && `${fmtDuration(g.missingMin)} didn't fit`,
      ].filter(Boolean).join(" · ") }))),
    short.length > 0 && el("div", { class: "banner warn mt8" },
      el("b", {}, "Not everything fit:"),
      el("ul", { class: "errs" }, short.map(g => el("li", { text: `${g.title}: ${fmtDuration(g.missingMin)} short, because ${g.reason}.` })))),
    gen.notes.length > 0 && el("ul", { class: "notes" }, gen.notes.map(n => el("li", { text: n }))),
    DAYS.map(d => {
      const bs = blocksForDay(gen.generated, d);
      return bs.length ? el("div", { class: "wz-day" }, el("b", {}, DAY_NAMES[d]),
        bs.map(b => el("div", { class: "sub", text: `${fmtRange(b.start, b.end)} · ${b.title}` }))) : null;
    }),
    el("div", { class: "row wrap-row mt8" },
      btn(gen.generated.length || removed ? "Apply to my week" : "Nothing to change", "gen-apply", undefined, "btn pri"),
      btn("Cancel", "gen-cancel")));
}

function sleepCard(sleep) {
  return el("div", { class: "card" },
    el("h3", {}, "Sleep before each day"),
    sleep.map(d => el("div", { class: d.ok ? "srow" : "srow warn" },
      el("span", {}, DAY_NAMES[d.day]),
      el("span", {}, fmtDuration(d.totalMin) + (d.napMin ? ` (${fmtDuration(d.nightMin)} + ${fmtDuration(d.napMin)} nap)` : "")))),
    el("div", { class: "sub mt8" }, "From bedtime (or your last block, if later) to wake time (or your first block, if earlier), plus that day's naps."));
}

function blockForm(state, ed) {
  const d = ed.draft;
  const hasCat = d.kind === "study" || d.kind === "lecture";
  return el("div", { class: "card form" },
    el("h3", {}, ed.isNew ? (ed.copy ? "Copy block" : "New block") : "Edit block"),
    ed.copy && el("div", { class: "sub mb8" }, "Change the day or time of the copy, then save."),
    field("Title", el("input", { value: d.title, maxlength: LIMITS.title, placeholder: "e.g. CSC 401 · revise", data: { f: "title" } })),
    el("div", { class: "grid2" },
      field("Type", el("select", { class: "btn", data: { f: "kind" } }, KINDS.map(k => el("option", { value: k, selected: d.kind === k }, KIND_LABEL[k])))),
      field("Day", el("select", { class: "btn", data: { f: "day" } }, DAYS.map(x => el("option", { value: x, selected: d.day === x }, DAY_NAMES[x]))))),
    hasCat && field("Course / subject", el("select", { class: "btn", data: { f: "cat" } },
      el("option", { value: "", selected: !d.cat }, "None"),
      state.categories.map(c => el("option", { value: c.id, selected: d.cat === c.id, text: c.name })))),
    el("div", { class: "grid2" }, field("Starts", timeInput("start", d.start, "Start time")), field("Ends", timeInput("end", d.end, "End time"))),
    el("div", { class: "sub" }, d.kind === "study" ? "Study blocks can be ticked off and count toward your hours." : d.kind === "lecture" ? "Lectures are fixed: shown greyed, not ticked, not counted as study." : "Rest blocks are shown but never ticked."),
    errorList(ed.errors),
    el("div", { class: "row wrap-row mt8" }, btn("Save", "blk-save", undefined, "btn pri"), btn("Cancel", "blk-cancel")));
}

function categoriesCard(state) {
  const swatches = c => el("div", { class: "swatches", role: "radiogroup", "aria-label": "Colour" },
    Array.from({ length: PALETTE_SIZE }, (_, i) => el("button", {
      type: "button", role: "radio", class: `swatch c-${i}${i === c.color ? " on" : ""}`,
      "aria-checked": String(i === c.color), "aria-label": `Colour ${i + 1}`, data: { a: "cat-color", k: `${c.id}|${i}` },
    })));
  return el("div", { class: "card" },
    el("h3", {}, "Courses and subjects"),
    state.categories.length
      ? state.categories.map(c => el("div", { class: `catrow c-${c.color}` },
          el("div", { class: "row" },
            el("span", { class: "dot", "aria-hidden": "true" }),
            el("input", { class: "grow nomb", value: c.name, maxlength: LIMITS.name, "aria-label": "Subject name", data: { a: "cat-name", k: c.id } }),
            btn("Delete", "cat-del", c.id, "btn danger")),
          swatches(c)))
      : el("div", { class: "sub mb8" }, "Subjects group your study blocks and give them a colour."),
    el("div", { class: "row mt8" },
      el("input", { id: "catn", class: "grow nomb", maxlength: LIMITS.name, placeholder: "New subject, e.g. CSC 401", "aria-label": "New subject name" }),
      btn("Add", "cat-add")));
}

// ---------- setup wizard ----------
// wiz: { step 0–6, draft (state being built), form: {name, wake, bedtime, subject, days[], start, end}, errors }

const WZ_TITLES = ["Welcome", "Your name", "Sleep", "Naps", "Lectures", "Study time", "Review"];
const WZ_KIND = { 3: "nap", 4: "lecture", 5: "study" };
const WZ_INTRO = {
  3: "Add any regular naps. They protect your sleep and get a reminder too. Skip if you don't nap.",
  4: "Add your fixed lectures and classes. They show on your day but are not ticked or counted as study.",
  5: "Add the study sessions you want to keep each week. These are the blocks you tick off.",
};

export function wizardView(wiz, { hasState, source }) {
  const out = [];
  if (wiz.step === 0) {
    if (source === "broken") out.push(el("div", { class: "banner warn" },
      "Your saved data could not be read. A copy was kept on this device. You can import a backup or start again."));
    out.push(el("div", { class: "card" },
      el("h3", {}, hasState ? "Set up your week again" : "Welcome to Stick-to-it"),
      el("div", { class: "sub mb8" }, "Build your weekly timetable, tick off study blocks and keep your streak. Everything stays on this phone."),
      el("div", { class: "stack" },
        btn("Build my week (about 2 minutes)", "wz-build", undefined, "btn pri"),
        !hasState && el("label", { class: "btn" }, "Import a backup",
          el("input", { type: "file", class: "hidden", accept: "application/json,.json", data: { a: "import" } })),
        hasState && btn("Cancel", "wz-cancel"))));
    out.push(el("div", { class: "card" },
      el("h3", {}, "Or start from a template"),
      el("div", { class: "sub mb8" }, "Pick one that's close, then rename courses and move blocks in the Plan tab."),
      TEMPLATES.map(t => el("button", { type: "button", class: "tpl", data: { a: "wz-template", k: t.id } },
        el("b", {}, t.name),
        el("span", { class: "sub" }, t.desc)))));
    return out;
  }

  const f = wiz.form;
  out.push(el("div", { class: "card" },
    el("div", { class: "sub" }, `Step ${wiz.step} of 6`),
    el("div", { class: "wz-dots", "aria-hidden": "true" }, [1, 2, 3, 4, 5, 6].map(i => el("i", { class: i <= wiz.step ? "on" : "" }))),
    el("h3", { class: "mt8" }, WZ_TITLES[wiz.step])));

  const body = [];
  if (wiz.step === 1) {
    body.push(field("What should we call you?", el("input", { value: f.name, maxlength: LIMITS.name, placeholder: "Your name (optional)", autocomplete: "given-name", data: { f: "name" } })));
  } else if (wiz.step === 2) {
    body.push(el("div", { class: "grid2" },
      field("Usual wake time", timeInput("wake", f.wake, "Wake time")),
      field("Bedtime", timeInput("bedtime", f.bedtime, "Bedtime"))));
    body.push(el("div", { class: "sub" }, "Sleep after midnight? Pick e.g. 01:30. Your study day runs until bedtime. You can set a different wake time for each day later in Plan."));
  } else if (WZ_KIND[wiz.step]) {
    const kind = WZ_KIND[wiz.step];
    body.push(el("div", { class: "sub mb8" }, WZ_INTRO[wiz.step]));
    if (kind !== "nap") {
      body.push(field(kind === "lecture" ? "Course" : "Course or subject",
        el("input", { value: f.subject, maxlength: LIMITS.name, placeholder: "e.g. CSC 401", list: "wz-subjects", data: { f: "subject" } })));
      body.push(el("datalist", { id: "wz-subjects" }, wiz.draft.categories.map(c => el("option", { value: c.name }))));
    }
    body.push(el("div", { class: "field" }, el("span", {}, "Days"),
      el("div", { class: "chiprow" }, DAYS.map(d => el("button", {
        type: "button", class: f.days.includes(d) ? "chipbtn on" : "chipbtn", "aria-pressed": String(f.days.includes(d)), data: { a: "wz-day", k: d },
      }, d))),
      el("div", { class: "row wrap-row mt8" }, btn("Mon–Fri", "wz-days", "weekdays", "btn"), btn("Every day", "wz-days", "all", "btn"), btn("Clear", "wz-days", "none", "btn"))));
    body.push(el("div", { class: "grid2" }, field("Starts", timeInput("start", f.start, "Start time")), field("Ends", timeInput("end", f.end, "End time"))));
    body.push(errorList(wiz.errors));
    body.push(el("div", { class: "row" }, btn(kind === "nap" ? "Add nap" : kind === "lecture" ? "Add lecture" : "Add study block", "wz-add", undefined, "btn pri")));

    const added = wiz.draft.blocks.filter(b => b.kind === kind)
      .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start - b.start);
    if (added.length) {
      body.push(el("div", { class: "mt8" }, added.map(b => el("div", { class: "wz-item" },
        el("span", { class: "grow", text: `${b.day} ${fmtRange(b.start, b.end)} · ${b.title}` }),
        btn("Remove", "wz-del", b.id, "link")))));
    }
  } else if (wiz.step === 6) {
    const d = wiz.draft, studyMin = sum(planned(d));
    body.push(el("div", { class: "sub mb8" },
      `${d.blocks.length} blocks, ${fmtHours(studyMin)} hours of study a week. Bedtime ${d.profile.bedtime}.`));
    for (const day of DAYS) {
      const bs = blocksForDay(d.blocks, day);
      body.push(el("div", { class: "wz-day" }, el("b", {}, DAY_NAMES[day]),
        bs.length ? bs.map(b => el("div", { class: "sub", text: `${fmtRange(b.start, b.end)} · ${KIND_LABEL[b.kind]} · ${b.title}` }))
          : el("div", { class: "sub" }, "Free")));
    }
    const short = sleepReport(d).filter(x => !x.ok);
    if (short.length) {
      body.push(el("div", { class: "banner warn mt8" },
        el("b", {}, "😴 Not enough sleep on some nights:"),
        el("ul", { class: "errs" }, short.map(x => el("li", { text: x.message }))),
        el("div", { class: "sub mt8" }, "Go Back to change times, or finish now and fix them in the Plan tab.")));
    }
    body.push(el("div", { class: "sub mt8" }, "You can change any block later in the Plan tab."));
    body.push(errorList(wiz.errors));
  }
  out.push(el("div", { class: "card" }, body));

  out.push(el("div", { class: "row wrap-row" },
    btn("Back", "wz-back"),
    el("div", { class: "grow" }),
    hasState && btn("Cancel", "wz-cancel"),
    wiz.step === 6 ? btn("Finish", "wz-finish", undefined, "btn pri") : btn("Next", "wz-next", undefined, "btn pri")));
  return out;
}

// Banners above every view. b: { update, backup }
export function bannersView(b) {
  const out = [];
  if (b.update) {
    out.push(el("button", { type: "button", class: "banner update", data: { a: "update" } },
      el("b", {}, "Update ready"), " · tap to refresh"));
  }
  if (b.arm) {
    out.push(el("button", { type: "button", class: "banner", data: { a: "arm" } },
      el("b", {}, "🔔 Tap to arm alarms"), " · lets block alarms make sound while the app is open"));
  }
  if (b.backup) {
    out.push(el("div", { class: "banner" },
      el("div", { class: "mb8" }, "It has been over a week since your last backup. Your data lives only on this phone."),
      el("div", { class: "row wrap-row" }, btn("Export now", "export", undefined, "btn pri"), btn("Later", "backup-later"))));
  }
  return out;
}

export function toastNode(lines) {
  return el("div", { class: "toast", role: "status" }, lines.join("\n"));
}

