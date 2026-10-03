import { test } from "node:test";
import assert from "node:assert/strict";
import { draftToBlock, addRecurring } from "../js/schedule.js";
import { defaultState, validate } from "../js/schema.js";

function base() {
  const s = defaultState();
  s.profile.bedtime = "03:30";
  s.categories = [{ id: "uni", name: "CSC 401", color: 0 }];
  s.blocks = [{ id: "x", day: "MON", start: 600, end: 720, title: "Existing", kind: "study", cat: "uni" }];
  return s;
}
const D = over => ({ title: "Revise", kind: "study", cat: "uni", day: "MON", start: "13:00", end: "15:00", ...over });

test("draftToBlock: a good draft becomes a valid block", () => {
  const r = draftToBlock(D(), base(), "new1");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.block, { id: "new1", day: "MON", start: 780, end: 900, title: "Revise", kind: "study", cat: "uni" });
});

test("draftToBlock: after-midnight times land on the same study day", () => {
  const r = draftToBlock(D({ start: "23:30", end: "01:30" }), base(), "n");
  assert.deepEqual([r.block.start, r.block.end], [1410, 1530]);
  const r2 = draftToBlock(D({ start: "01:00", end: "02:00" }), base(), "n");
  assert.deepEqual([r2.block.start, r2.block.end], [1500, 1560]);
});

test("draftToBlock: overlaps, missing times and missing title are reported", () => {
  assert.match(draftToBlock(D({ start: "11:00", end: "13:00" }), base()).errors[0], /Overlaps "Existing"/);
  assert.match(draftToBlock(D({ start: "", end: "13:00" }), base()).errors[0], /start and an end/);
  assert.match(draftToBlock(D({ start: "25:00", end: "13:00" }), base()).errors[0], /start and an end/);
  assert.match(draftToBlock(D({ title: "   " }), base()).errors[0], /title/);
  assert.match(draftToBlock(D({ day: "FUNDAY" }), base()).errors[0], /day/);
  // editing the existing block in place never clashes with itself
  assert.deepEqual(draftToBlock(D({ start: "10:30", end: "12:30" }), base(), "x").errors, []);
});

test("draftToBlock: naps and rest get default titles and never a category", () => {
  const nap = draftToBlock(D({ kind: "nap", title: "" }), base(), "n");
  assert.equal(nap.block.title, "Nap");
  assert.equal(nap.block.cat, null);
  assert.equal(draftToBlock(D({ kind: "rest", title: "" }), base()).block.title, "Wind down");
  assert.equal(draftToBlock(D({ cat: "ghost" }), base()).block.cat, null);
  assert.equal(draftToBlock(D({ kind: "party" }), base()).block.kind, "study");
});

test("draftToBlock: hostile and huge titles are cleaned, not rejected", () => {
  const r = draftToBlock(D({ title: "<img src=x onerror=alert(1)>\n" + "A".repeat(500) }), base(), "n");
  assert.deepEqual(r.errors, []);
  assert.equal(r.block.title.length, 60);
  assert.ok(r.block.title.startsWith("<img src=x onerror=alert(1)> A"));
});

test("draftToBlock: block limit", () => {
  const s = base();
  for (let i = 0; i < 299; i++) s.blocks.push({ id: "b" + i, day: "SUN", start: i, end: i + 1, title: "t", kind: "study", cat: null });
  assert.match(draftToBlock(D(), s).errors.at(-1), /up to 300/);
  assert.deepEqual(draftToBlock(D({ day: "SUN", start: "10:00", end: "11:00" }), s, "b5").errors.filter(e => /up to/.test(e)), []);
});

test("addRecurring: adds one block per day and creates the subject once", () => {
  const s = base();
  const r = addRecurring(s, { kind: "lecture", subject: "CSC 405", days: ["TUE", "THU", "MON"], start: "08:00", end: "09:30" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.state.blocks.length, 4);
  assert.equal(r.state.categories.length, 2);
  const cat = r.state.categories[1];
  assert.equal(cat.name, "CSC 405");
  assert.equal(cat.color, 1);
  assert.deepEqual(r.state.blocks.slice(1).map(b => [b.day, b.kind, b.cat, b.start]), [
    ["MON", "lecture", cat.id, 480], ["TUE", "lecture", cat.id, 480], ["THU", "lecture", cat.id, 480],
  ]);
  assert.equal(validate(r.state).ok, true);
  assert.equal(s.blocks.length, 1, "input state is not mutated");
});

test("addRecurring: reuses a subject regardless of case", () => {
  const r = addRecurring(base(), { kind: "study", subject: "csc 401", days: ["WED"], start: "18:00", end: "20:00" });
  assert.equal(r.state.categories.length, 1);
  assert.equal(r.state.blocks[1].cat, "uni");
  assert.equal(r.state.blocks[1].title, "CSC 401", "title uses the subject's saved spelling");
});

test("addRecurring: all or nothing on an overlap", () => {
  const s = base();
  const r = addRecurring(s, { kind: "study", subject: "New subject", days: ["SUN", "MON"], start: "11:00", end: "12:30" });
  assert.equal(r.state, s);
  assert.match(r.errors[0], /^MON: Overlaps "Existing"/);
  assert.equal(s.categories.length, 1, "category not created on failure");
});

test("addRecurring: naps need no subject; days and subject are checked", () => {
  const r = addRecurring(base(), { kind: "nap", days: ["MON", "TUE"], start: "14:00", end: "15:00" });
  assert.deepEqual(r.state.blocks.slice(1).map(b => [b.title, b.cat]), [["Nap", null], ["Nap", null]]);
  assert.match(addRecurring(base(), { kind: "nap", days: [], start: "14:00", end: "15:00" }).errors[0], /at least one day/);
  assert.match(addRecurring(base(), { kind: "study", subject: "", days: ["MON"], start: "14:00", end: "15:00" }).errors[0], /subject/);
  assert.match(addRecurring(base(), { kind: "nap", days: ["NOPE"], start: "14:00", end: "15:00" }).errors[0], /at least one day/);
});
