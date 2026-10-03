// Views. Every node is built with createElement and every piece of text goes
// in through textContent, so user text can never become HTML.
// No innerHTML, no inline styles, no inline handlers: actions are declared
// with data-a / data-k and handled by delegation in main.js.

import { DAYS, KINDS, PALETTE_SIZE, LIMITS } from "./schema.js";
import {
  fmtRange, fmtHours, dur, blocksForDay, currentAndNext, dayStats, weekStats,
  planned, sum, streak, weekStart, addDays, isoDate, findOverlaps,
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
    el("div", { class: "sub mb8" }, "Change single blocks in the Plan tab. To start your week over, run the setup again; your projects, counters and settings are kept."),
    btn("Run setup again", "wz-open")));

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

  if (ctx.editing) out.push(blockForm(state, ctx.editing));

  const blocks = blocksForDay(state.blocks, day);
  out.push(el("div", { class: "card" },
    el("h3", {}, `${DAY_NAMES[day]} · ${blocks.length} block${blocks.length === 1 ? "" : "s"}`),
    blocks.length ? blocks.map(b => {
      const cat = catOf(state, b.cat);
      return el("div", { class: `prow ${colorClass(state, b)}` },
        el("div", { class: "tm", text: `${fmtRange(b.start, b.end)} · ${KIND_LABEL[b.kind]}${cat ? " · " + cat.name : ""}` }),
        el("div", { class: "lb", text: b.title }),
        el("div", { class: "row wrap-row mt8" },
          btn("Edit", "blk-edit", b.id),
          btn("Copy", "blk-dup", b.id),
          btn("Delete", "blk-del", b.id, "btn danger")));
    }) : el("div", { class: "sub mb8" }, "No blocks yet."),
    el("div", { class: "row mt8" }, btn("+ Add block", "blk-new", day, "btn pri"))));

  out.push(categoriesCard(state));
  return out;
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
        btn("Start from a template: McJayy's week", "wz-template"),
        !hasState && el("label", { class: "btn" }, "Import a backup",
          el("input", { type: "file", class: "hidden", accept: "application/json,.json", data: { a: "import" } })),
        hasState && btn("Cancel", "wz-cancel"))));
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

