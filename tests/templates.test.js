import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { TEMPLATES, parseTemplate, loadTemplate, loadState, LEGACY_KEY, KEY } from "../js/storage.js";
import { validate, defaultState } from "../js/schema.js";
import { findOverlaps, sleepReport, planned, sum } from "../js/schedule.js";
import { readRepoFile } from "./fixtures.js";

test("every template file is listed, and every listed template has a file", () => {
  const files = readdirSync(new URL("../templates/", import.meta.url)).sort();
  assert.deepEqual(TEMPLATES.map(t => t.file.replace("templates/", "")).sort(), files);
});

for (const t of TEMPLATES) {
  test(`template "${t.name}" is clean: valid, no overlaps, enough sleep`, async () => {
    const r = await loadTemplate(t.id, readRepoFile);
    assert.equal(r.ok, true);
    assert.deepEqual(r.notes, [], "no validator complaints");
    const s = r.data;
    assert.deepEqual(findOverlaps(s.blocks), []);
    assert.deepEqual(sleepReport(s).filter(d => !d.ok).map(d => d.message), []);
    assert.ok(sum(planned(s)) > 0, "has study time");
    const cats = new Set(s.categories.map(c => c.id));
    for (const b of s.blocks.filter(b => b.kind === "study")) assert.ok(cats.has(b.cat), `${b.id} has a real subject`);
    assert.equal(s.profile.name, "");
    assert.deepEqual([s.progress, s.projects, s.counters], [{}, [], []]);
    assert.deepEqual(s.settings, defaultState().settings);
  });
}

test("a template only carries the timetable: personal data in the file is ignored", () => {
  const s = defaultState();
  s.profile.name = "Someone";
  s.blocks = [{ id: "b1", day: "MON", start: 600, end: 660, title: "x", kind: "study", cat: null }];
  s.progress = { "2026-09-28": { b1: true } };
  s.projects = [{ id: "p1", title: "secret", note: "", date: "" }];
  s.settings.remind = true;
  const r = parseTemplate(JSON.stringify(s));
  assert.equal(r.ok, true);
  assert.equal(r.data.profile.name, "");
  assert.deepEqual(r.data.progress, {});
  assert.deepEqual(r.data.projects, []);
  assert.equal(r.data.settings.remind, false);
  assert.equal(r.data.blocks.length, 1);
});

test("hostile or broken template files are rejected", () => {
  assert.equal(parseTemplate('{"v":1,"__proto__":{"x":1}}').ok, false);
  assert.equal(parseTemplate("{nope").ok, false);
  assert.equal(parseTemplate('{"v":2}').ok, false);
  assert.equal(parseTemplate(null).ok, false);
  assert.match(parseTemplate(" ".repeat(300 * 1024)).notes[0], /too big/);
  const xss = parseTemplate(JSON.stringify({ v: 1, blocks: [{ id: "b", day: "MON", start: 0, end: 60, title: "<img src=x onerror=alert(1)>", kind: "study" }] }));
  assert.equal(xss.data.blocks[0].title, "<img src=x onerror=alert(1)>"); // stays plain text
  assert.equal(validate(xss.data).ok, true);
});

test("loadTemplate: unknown ids and network failures give a friendly error", async () => {
  assert.deepEqual((await loadTemplate("nope", readRepoFile)).notes, ["Unknown template."]);
  const offline = await loadTemplate("student", async () => { throw new Error("offline"); });
  assert.equal(offline.ok, false);
  assert.match(offline.notes[0], /connection/);
});

test("old-app data waits safely if McJayy's week can't be loaded", async () => {
  const m = new Map([[LEGACY_KEY, JSON.stringify({ weeks: {}, projects: [], modules: 2 })]]);
  const store = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  const r = await loadState(store, async () => ({ ok: false, data: null, notes: [] }));
  assert.equal(r.source, "new");
  assert.match(r.notes[0], /could not be moved yet/);
  assert.equal(m.has(KEY), false, "nothing written");
  assert.ok(m.has(LEGACY_KEY), "old data untouched");
});
