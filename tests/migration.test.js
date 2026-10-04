import { test } from "node:test";
import assert from "node:assert/strict";
import {
  migrateLegacy, loadState, saveState, parseImport, exportBackup,
  KEY, BROKEN_KEY, LEGACY_KEY, LEGACY_SETTINGS_KEY,
} from "../js/storage.js";
import { validate, defaultState } from "../js/schema.js";
import { templateMcJayy, getMcJayy } from "./fixtures.js";
import { findOverlaps, dayStats } from "../js/schedule.js";

// Minimal localStorage stand-in.
function fakeStore(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

// Shaped like the real old app's data.
const OLD = {
  weeks: {
    "2026-09-21": { "MON@16:30": 1, "MON@24:00": 1, "TUE@23:30": 1, "MON@13:00": 1, "FRI@99:99": 1 },
    "2026-09-28": { "SUN@26:00": 1 },
    "garbage": { "MON@16:30": 1 },
  },
  projects: [
    { id: "1727000000000", t: "Failed-login counter", n: "Python + regex", d: "Sep 22, 2026" },
    { id: "<bad id>", t: "<img src=x onerror=alert(1)>", n: "", d: "Sep 23, 2026" },
    "not a project",
  ],
  modules: 7,
};
const OLD_SETTINGS = { remind: true, lead: 15 };

test("the template is valid, has no overlaps and matches the old week", async () => {
  const t = templateMcJayy();
  assert.equal(validate(t).ok, true);
  assert.deepEqual(validate(t).errors, []);
  assert.equal(t.blocks.length, 55);
  assert.deepEqual(findOverlaps(t.blocks), []);
  assert.equal(t.profile.bedtime, "03:30");
  assert.equal(t.profile.wake.TUE, "08:15");
  const kinds = t.blocks.reduce((a, b) => ((a[b.kind] = (a[b.kind] || 0) + 1), a), {});
  assert.deepEqual(kinds, { study: 41, nap: 7, rest: 7 });
  const b = t.blocks.find(x => x.id === "mcj-MON-990");
  assert.deepEqual(b, { id: "mcj-MON-990", day: "MON", start: 990, end: 1170, title: "CSC 415 · review", kind: "study", cat: "uni" });
  assert.equal(t.blocks.find(x => x.id === "mcj-MON-1620").kind, "rest");
  assert.equal(t.blocks.find(x => x.id === "mcj-MON-780").cat, null); // nap has no category
});

test("migration carries progress, projects, counter and settings across", async () => {
  const { data, notes } = migrateLegacy(OLD, OLD_SETTINGS, templateMcJayy());
  assert.equal(validate(data).ok, true);
  assert.equal(data.profile.name, "McJayy");
  assert.deepEqual(data.progress, {
    "2026-09-21": { "mcj-MON-990": true, "mcj-MON-1440": true, "mcj-TUE-1410": true },
    "2026-09-28": { "mcj-SUN-1560": true },
  });
  // MON@13:00 (a nap) and FRI@99:99 had nowhere to go
  assert.ok(notes.some(n => /Moved 4 ticked blocks/.test(n)));
  assert.ok(notes.some(n => /2 old entries did not match/.test(n)));

  assert.equal(data.projects.length, 2);
  assert.deepEqual(data.projects[0], { id: "1727000000000", title: "Failed-login counter", note: "Python + regex", date: "Sep 22, 2026" });
  assert.equal(data.projects[1].title, "<img src=x onerror=alert(1)>"); // kept as plain text
  assert.notEqual(data.projects[1].id, "<bad id>");                  // fresh id

  assert.deepEqual(data.counters, [{ id: "cisco-modules", name: "Cisco JCA modules", count: 7 }]);
  assert.equal(data.settings.remind, true);
  assert.equal(data.settings.lead, 15);

  // the stats engine reads migrated ticks
  assert.equal(dayStats(data, "2026-09-21", "MON").done, 2);
});

test("migration survives garbage", async () => {
  for (const junk of [null, 42, "x", [], { weeks: "nope", projects: {}, modules: -3 }, { weeks: { "2026-09-21": [1, 2] } }]) {
    const { data } = migrateLegacy(junk, { lead: 999, remind: "yes" }, templateMcJayy());
    assert.equal(validate(data).ok, true, JSON.stringify(junk));
    assert.deepEqual(data.progress, {});
    assert.equal(data.settings.lead, 10);
    assert.equal(data.settings.remind, false);
  }
  const hostile = JSON.parse('{"weeks":{"__proto__":{"MON@16:30":1}},"projects":[]}');
  const { data, notes } = migrateLegacy(hostile, null, templateMcJayy());
  assert.deepEqual(data.progress, {});
  assert.ok(notes.some(n => /could not be read/.test(n)));
  assert.equal({}["MON@16:30"], undefined);
});

test("loadState: fresh device", async () => {
  const r = await loadState(fakeStore(), getMcJayy);
  assert.equal(r.source, "new");
  assert.equal(r.state, null);
});

test("loadState: migrates once, saves, and keeps the old keys", async () => {
  const store = fakeStore({ [LEGACY_KEY]: JSON.stringify(OLD), [LEGACY_SETTINGS_KEY]: JSON.stringify(OLD_SETTINGS) });
  const r = await loadState(store, getMcJayy);
  assert.equal(r.source, "migrated");
  assert.equal(r.state.progress["2026-09-21"]["mcj-MON-990"], true);
  assert.ok(store.getItem(KEY));
  assert.ok(store.getItem(LEGACY_KEY));
  // second load reads the new key
  assert.equal((await loadState(store, getMcJayy)).source, "stored");
});

test("loadState: corrupt legacy key still gives a working template", async () => {
  const r = await loadState(fakeStore({ [LEGACY_KEY]: "{not json" }), getMcJayy);
  assert.equal(r.source, "migrated");
  assert.equal(r.state.blocks.length, 55);
  assert.deepEqual(r.state.progress, {});
});

test("loadState: unreadable new data is kept aside, not overwritten", async () => {
  const store = fakeStore({ [KEY]: '{"v":99}' });
  const r = await loadState(store, getMcJayy);
  assert.equal(r.source, "broken");
  assert.equal(r.state, null);
  assert.equal(store.getItem(BROKEN_KEY), '{"v":99}');
});

test("saveState validates before writing", async () => {
  const store = fakeStore();
  const s = defaultState();
  s.blocks.push({ id: "b1", day: "MON", start: 0, end: 60, title: "x".repeat(500), kind: "study", extra: 1 });
  const saved = saveState(s, store);
  assert.equal(saved.blocks[0].title.length, 60);
  assert.equal("extra" in JSON.parse(store.getItem(KEY)).blocks[0], false);
  assert.equal(saveState({ v: 2 }, store), null);
  const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.equal(saveState(defaultState(), full), null);
});

test("backup export → import round-trips", async () => {
  const { data } = migrateLegacy(OLD, OLD_SETTINGS, templateMcJayy());
  const b = exportBackup(data, new Date(2026, 9, 3));
  assert.equal(b.name, "stick-tracker-backup-2026-10-03.json");
  const r = (await parseImport(b.text, getMcJayy));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, data);
});

test("import accepts the old app's export and rejects hostile files", async () => {
  const old = (await parseImport(JSON.stringify(OLD), getMcJayy));
  assert.equal(old.ok, true);
  assert.equal(old.data.counters[0].count, 7);
  assert.ok(old.notes[0].includes("old app"));

  assert.equal((await parseImport("{nope", getMcJayy)).ok, false);
  assert.equal((await parseImport("null", getMcJayy)).ok, false);
  assert.equal((await parseImport('{"v":1,"__proto__":{"x":1}}', getMcJayy)).ok, false);
  assert.equal((await parseImport('{"weeks":{},"constructor":{"prototype":{"x":1}}}', getMcJayy)).ok, false);
  assert.equal((await parseImport(" ".repeat(300 * 1024) + "{}", getMcJayy)).ok, false); // over 256 KB
  assert.match((await parseImport("x".repeat(300 * 1024), getMcJayy)).notes[0], /too big/);
});

test("backup nudge: 7 days after the last export, or a week into use if never exported", async () => {
  const { needsBackup } = await import("../js/storage.js");
  const day = 86400000, now = new Date(2026, 9, 20, 12).getTime();
  const s = templateMcJayy();
  assert.equal(needsBackup(null, now), false);
  assert.equal(needsBackup(defaultState(), now), false, "nothing to back up yet");
  assert.equal(needsBackup(s, now), false, "never exported, no ticks yet");
  s.progress["2026-10-19"] = { "mcj-MON-990": true };
  assert.equal(needsBackup(s, now), false, "never exported, only a day of use");
  s.progress["2026-10-05"] = { "mcj-MON-990": true };
  assert.equal(needsBackup(s, now), true, "never exported, two weeks of use");
  s.settings.lastBackup = now - 6 * day;
  assert.equal(needsBackup(s, now), false);
  s.settings.lastBackup = now - 8 * day;
  assert.equal(needsBackup(s, now), true);
});
