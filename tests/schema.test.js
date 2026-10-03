import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, defaultState, cleanText, hasBadKeys, isWeekKey, uid, isId, LIMITS, DAYS } from "../js/schema.js";

const XSS = '<img src=x onerror=alert(1)>';

function base(over = {}) {
  return {
    v: 1,
    profile: { name: "Ama", bedtime: "03:30", wake: { MON: "08:00" } },
    categories: [{ id: "c1", name: "Uni", color: 2 }],
    blocks: [
      { id: "b1", day: "MON", start: 540, end: 690, title: "CSC 401", kind: "study", cat: "c1" },
      { id: "b2", day: "MON", start: 780, end: 960, title: "Nap", kind: "nap", cat: null },
    ],
    progress: { "2026-09-28": { b1: true } },
    projects: [{ id: "p1", title: "Log parser", note: "line 1\nline 2", date: "Sep 28, 2026" }],
    counters: [{ id: "k1", name: "Modules", count: 4 }],
    settings: { remind: true, lead: 15, snooze: 5, lastBackup: 1700000000000, theme: "dark" },
    ...over,
  };
}

test("a valid object round-trips unchanged", () => {
  const r = validate(base());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.data.blocks.length, 2);
  assert.equal(r.data.profile.wake.MON, "08:00");
  assert.equal(r.data.profile.wake.TUE, "08:00"); // default filled in
  assert.deepEqual(r.data.progress, { "2026-09-28": { b1: true } });
  assert.equal(r.data.projects[0].note, "line 1\nline 2");
  assert.equal(r.data.settings.theme, "dark");
});

test("defaultState passes its own validator", () => {
  const r = validate(defaultState());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("rejects non-objects and wrong versions", () => {
  for (const x of [null, undefined, 42, "str", [], [base()], new Date()]) {
    assert.equal(validate(x).ok, false);
  }
  assert.equal(validate(base({ v: 2 })).ok, false);
  assert.equal(validate(base({ v: "1" })).ok, false);
});

test("HTML in text fields stays as plain text (escaping is the renderer's job, data is untouched)", () => {
  const r = validate(base({
    profile: { name: XSS },
    categories: [{ id: "c1", name: XSS, color: 0 }],
    blocks: [{ id: "b1", day: "MON", start: 0, end: 60, title: XSS, kind: "study", cat: "c1" }],
    projects: [{ id: "p1", title: XSS, note: XSS, date: XSS }],
    counters: [{ id: "k1", name: XSS, count: 1 }],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.data.blocks[0].title, XSS);
  assert.equal(r.data.profile.name, XSS.slice(0, LIMITS.name));
  assert.equal(r.data.categories[0].name, XSS);
});

test("__proto__ / constructor / prototype keys anywhere reject the whole input", () => {
  const payloads = [
    '{"v":1,"__proto__":{"polluted":true}}',
    '{"v":1,"profile":{"__proto__":{"polluted":true}}}',
    '{"v":1,"blocks":[{"id":"b1","constructor":{"prototype":{"x":1}}}]}',
    '{"v":1,"progress":{"2026-09-28":{"prototype":true}}}',
  ];
  for (const p of payloads) {
    const r = validate(JSON.parse(p));
    assert.equal(r.ok, false, p);
  }
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test("very deep nesting is rejected", () => {
  let x = {};
  const root = x;
  for (let i = 0; i < 50; i++) { x.a = {}; x = x.a; }
  assert.equal(hasBadKeys(root), true);
  assert.equal(validate({ v: 1, settings: root }).ok, false);
});

test("huge strings are cut to the limit, not stored", () => {
  const huge = "A".repeat(1024 * 1024);
  const r = validate(base({
    blocks: [{ id: "b1", day: "MON", start: 0, end: 60, title: huge, kind: "study" }],
    projects: [{ id: "p1", title: huge, note: huge }],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.data.blocks[0].title.length, LIMITS.title);
  assert.equal(r.data.projects[0].title.length, LIMITS.projectTitle);
  assert.equal(r.data.projects[0].note.length, LIMITS.note);
});

test("cleanText strips control chars and never splits an emoji", () => {
  assert.equal(cleanText("a\u0000b\u0007c\u007Fd\u0085e\u{2028}f", 60), "abcdef");
  assert.equal(cleanText("one\r\ntwo", 60), "one two");
  assert.equal(cleanText("one\ntwo", 60, { multiline: true }), "one\ntwo");
  assert.equal(cleanText("  pad  ", 60), "pad");
  assert.equal(cleanText("😀😀😀", 2), "😀😀");
  assert.equal(cleanText(123, 60), null);
  assert.equal(cleanText({ toString: () => "x" }, 60), null);
});

test("bad block times are dropped", () => {
  const bad = [
    { start: NaN, end: 60 }, { start: -5, end: 60 }, { start: 0, end: 2000 },
    { start: 60, end: 60 }, { start: 90, end: 60 }, { start: 1.5, end: 60 },
    { start: "540", end: 600 }, { start: null, end: 60 }, { start: Infinity, end: 60 },
  ];
  for (const t of bad) {
    const r = validate(base({ blocks: [{ id: "b1", day: "MON", title: "x", kind: "study", ...t }] }));
    assert.equal(r.ok, true);
    assert.equal(r.data.blocks.length, 0, JSON.stringify(t));
  }
  // the edges are allowed
  const ok = validate(base({ blocks: [{ id: "b1", day: "SUN", start: 0, end: 1800, title: "x", kind: "study" }] }));
  assert.equal(ok.data.blocks.length, 1);
});

test("bad HH:MM times fall back to defaults", () => {
  const r = validate(base({ profile: { bedtime: "25:99", wake: { MON: "8:00", TUE: "24:00", WED: 800, THU: "07:15" } } }));
  assert.equal(r.ok, true);
  assert.equal(r.data.profile.bedtime, defaultState().profile.bedtime);
  assert.equal(r.data.profile.wake.MON, "08:00");
  assert.equal(r.data.profile.wake.TUE, "08:00");
  assert.equal(r.data.profile.wake.WED, "08:00");
  assert.equal(r.data.profile.wake.THU, "07:15");
  assert.ok(r.errors.length >= 4);
});

test("wrong enums and types are dropped", () => {
  const r = validate(base({
    blocks: [
      { id: "b1", day: "FUNDAY", start: 0, end: 60, title: "x", kind: "study" },
      { id: "b2", day: "MON", start: 0, end: 60, title: "x", kind: "party" },
      { id: "b3", day: "MON", start: 0, end: 60, title: "", kind: "study" },
      { id: "has space", day: "MON", start: 0, end: 60, title: "x", kind: "study" },
      { id: "b5", day: "MON", start: 0, end: 60, title: ["x"], kind: "study" },
      "not an object",
    ],
    settings: { remind: "yes", lead: 7, snooze: 99, lastBackup: -1, theme: "neon" },
  }));
  assert.equal(r.ok, true);
  assert.equal(r.data.blocks.length, 0);
  assert.deepEqual(r.data.settings, defaultState().settings);
});

test("lists that are not arrays are reset, not crashed on", () => {
  const r = validate(base({ blocks: "lots", categories: { a: 1 }, projects: 5, counters: null }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.blocks, []);
  assert.deepEqual(r.data.categories, []);
});

test("unknown keys are stripped at every level", () => {
  const r = validate(base({
    extra: "x",
    profile: { name: "A", isAdmin: true },
    blocks: [{ id: "b1", day: "MON", start: 0, end: 60, title: "x", kind: "study", onclick: "alert(1)" }],
  }));
  assert.equal(r.ok, true);
  assert.equal("extra" in r.data, false);
  assert.equal("isAdmin" in r.data.profile, false);
  assert.deepEqual(Object.keys(r.data.blocks[0]).sort(), ["cat", "day", "end", "id", "kind", "start", "title"]);
});

test("duplicate ids and missing category refs", () => {
  const r = validate(base({
    blocks: [
      { id: "b1", day: "MON", start: 0, end: 60, title: "first", kind: "study", cat: "nope" },
      { id: "b1", day: "TUE", start: 0, end: 60, title: "dupe", kind: "study" },
    ],
  }));
  assert.equal(r.data.blocks.length, 1);
  assert.equal(r.data.blocks[0].title, "first");
  assert.equal(r.data.blocks[0].cat, null);
});

test("progress keeps only valid weeks and ticks on existing study blocks", () => {
  const r = validate(base({
    progress: {
      "2026-09-28": { b1: true, b2: true, ghost: true },  // b2 is a nap → not tickable
      "2026-02-30": { b1: true },                          // impossible date
      "not-a-week": { b1: true },
      "2026-09-21": { b1: "yes" },                         // non-true values dropped
      "2026-09-14": "nope",
    },
  }));
  assert.deepEqual(r.data.progress, { "2026-09-28": { b1: true } });
});

test("count limits are enforced", () => {
  const blocks = [];
  for (let i = 0; i < 400; i++) blocks.push({ id: "b" + i, day: DAYS[i % 7], start: 0, end: 60, title: "x", kind: "study" });
  const progress = {};
  for (let i = 0; i < 100; i++) {
    const d = new Date(2020, 0, 6 + i * 7);
    const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    progress[k] = { b0: true };
  }
  const r = validate(base({ blocks, progress }));
  assert.equal(r.data.blocks.length, LIMITS.blocks);
  assert.equal(Object.keys(r.data.progress).length, LIMITS.weeks);
});

test("counter counts are clamped to safe integers", () => {
  const r = validate(base({ counters: [
    { id: "k1", name: "a", count: -3 }, { id: "k2", name: "b", count: 1e9 }, { id: "k3", name: "c", count: 2.5 },
  ] }));
  assert.deepEqual(r.data.counters.map(c => c.count), [0, 0, 0]);
});

test("helpers", () => {
  assert.equal(isWeekKey("2026-09-28"), true);
  assert.equal(isWeekKey("2026-13-01"), false);
  assert.equal(isWeekKey("2026-9-28"), false);
  const a = uid(), b = uid();
  assert.notEqual(a, b);
  assert.equal(isId(a), true);
  assert.equal(isId(""), false);
  assert.equal(isId("x".repeat(41)), false);
  assert.equal(isId("<b>"), false);
});
