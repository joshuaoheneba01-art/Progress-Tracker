import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWeek, freeTime, sessionsFor, subtract, goalFromDraft } from "../js/generator.js";
import { defaultState, validate, DAYS } from "../js/schema.js";
import { findOverlaps, sleepReport, dur } from "../js/schedule.js";
import { parseTemplate } from "../js/storage.js";
import { readFileSync } from "node:fs";

const B = (id, day, start, end, kind = "study", cat = null) => ({ id, day, start, end, title: id, kind, cat });
const G = (id, title, cat, hoursPerWeek, sessionMin = 60, sessionMax = 120) => ({ id, title, cat, hoursPerWeek, sessionMin, sessionMax });

function base({ bedtime = "23:00", wake = "08:00" } = {}) {
  const s = defaultState();
  s.profile.bedtime = bedtime;
  for (const d of DAYS) s.profile.wake[d] = wake;
  s.categories = [{ id: "c1", name: "CSC 401", color: 0 }, { id: "c2", name: "Stats", color: 1 }];
  return s;
}
const student = () => parseTemplate(readFileSync(new URL("../templates/student.json", import.meta.url), "utf8")).data;
const perDay = (blocks, kind = "study") => Object.fromEntries(DAYS.map(d => [d, blocks.filter(b => b.day === d && b.kind === kind).reduce((s, b) => s + dur(b), 0)]));

// ---------- helpers ----------

test("subtract intervals", () => {
  assert.deepEqual(subtract([[0, 100]], 20, 30), [[0, 20], [30, 100]]);
  assert.deepEqual(subtract([[0, 100]], -10, 10), [[10, 100]]);
  assert.deepEqual(subtract([[0, 100]], 0, 100), []);
  assert.deepEqual(subtract([[0, 10], [20, 30]], 5, 25), [[0, 5], [25, 30]]);
});

test("session splitting", () => {
  assert.deepEqual(sessionsFor(300, 45, 90), { lengths: [75, 75, 75, 75], leftover: 0 });
  assert.deepEqual(sessionsFor(360, 60, 120), { lengths: [120, 120, 120], leftover: 0 });
  assert.deepEqual(sessionsFor(390, 60, 120), { lengths: [105, 105, 90, 90], leftover: 0 });
  assert.deepEqual(sessionsFor(60, 60, 120), { lengths: [60], leftover: 0 });
  assert.deepEqual(sessionsFor(20, 60, 120), { lengths: [], leftover: 30 }, "rounded up to 15, below the minimum");
  assert.deepEqual(sessionsFor(105, 60, 90), { lengths: [90], leftover: 15 }, "can't split 105 into 60–90 pieces");
  assert.deepEqual(sessionsFor(0, 60, 120), { lengths: [], leftover: 0 });
  for (const [m, a, b] of [[600, 30, 45], [775, 60, 240], [45, 30, 30]]) {
    const r = sessionsFor(m, a, b);
    for (const l of r.lengths) assert.ok(l >= a && l <= b && l % 15 === 0, `${m} ${a}-${b}: ${l}`);
  }
});

test("free time: wake + 30 min → bedtime, lectures buffered by 30 min", () => {
  const s = base();
  const f = freeTime(s, [B("lec", "MON", 600, 660, "lecture"), B("nap", "MON", 840, 900, "nap")]);
  assert.deepEqual(f.MON, [[510, 570], [690, 840], [900, 1380]]);
  assert.deepEqual(f.TUE, [[510, 1380]]);
});

test("free time keeps 7 h of sleep and respects blocks running past midnight", () => {
  const late = base({ bedtime: "03:30", wake: "08:00" });  // 4 h 30 min nights
  assert.equal(freeTime(late, []).MON.at(-1)[1], 480 + 1440 - 420, "window ends at 1:00am to keep 7 h");
  const s = base({ wake: "05:00" });
  const f = freeTime(s, [B("sun-late", "SUN", 1380, 1800)]); // until 6:00am Monday
  assert.equal(f.MON[0][0], 360, "Monday free time starts when Sunday's block ends");
});

// ---------- the generator ----------

test("deterministic: same input, same week", () => {
  const s = student();
  s.goals = [G("g1", "Course 1", "c1", 8), G("g2", "Maths", null, 5, 45, 90)];
  assert.deepEqual(generateWeek(s), generateWeek(structuredClone(s)));
});

test("never overlaps, keeps lecture buffers, sleep and the daily cap", () => {
  const s = student();
  s.settings.maxStudyPerDay = 300;
  s.goals = [G("g1", "Course 1", "c1", 10), G("g2", "Course 2", "c2", 9), G("g3", "Course 3", "c3", 8, 45, 90)];
  const r = generateWeek(s);
  assert.deepEqual(findOverlaps(r.blocks), []);
  for (const g of r.generated) {
    for (const l of r.blocks.filter(b => b.kind === "lecture" && b.day === g.day)) {
      assert.ok(g.end + 30 <= l.start || g.start >= l.end + 30, `${g.id} too close to ${l.id}`);
    }
    assert.ok(g.start >= 450 + 30 && g.end <= 1410, `${g.id} inside wake+30 → bedtime`);
    assert.ok(g.start % 15 === 0 && g.end % 15 === 0);
  }
  const study = perDay(r.blocks);
  for (const d of DAYS) assert.ok(study[d] <= 300 || perDay(s.blocks)[d] > 300, `${d}: ${study[d]} min`);
  assert.deepEqual(sleepReport({ ...s, blocks: r.blocks }).filter(x => !x.ok), []);
  assert.equal(validate({ ...s, blocks: r.blocks }).ok, true);
});

test("spreads a goal over different days", () => {
  const s = base();
  s.goals = [G("g1", "CSC 401", "c1", 4, 60, 60)];
  const r = generateWeek(s);
  assert.equal(r.generated.length, 4);
  assert.equal(new Set(r.generated.map(b => b.day)).size, 4);
  assert.deepEqual(r.generated.map(b => b.title), Array(4).fill("CSC 401 · study"));
  assert.ok(r.generated.every(b => b.gen === true && b.cat === "c1" && b.kind === "study"));
});

test("study you placed yourself counts toward the goal", () => {
  const s = base();
  s.blocks = [B("mine", "MON", 600, 780, "study", "c1")]; // 3 h by hand
  s.goals = [G("g1", "CSC 401", "c1", 5)];
  const r = generateWeek(s);
  assert.deepEqual(r.goals[0], { id: "g1", title: "CSC 401", targetMin: 300, haveMin: 180, placedMin: 120, missingMin: 0, reason: null });
  assert.ok(!r.generated.some(b => b.day === "MON"), "Monday already has this subject");
  s.goals = [G("g1", "CSC 401", "c1", 3)];
  assert.deepEqual(generateWeek(s).generated, [], "already covered");
});

test("a re-run replaces generated blocks and never touches yours", () => {
  const s = base();
  s.blocks = [B("mine", "TUE", 600, 660, "lecture", "c1")];
  s.goals = [G("g1", "CSC 401", "c1", 3)];
  const first = generateWeek(s);
  s.blocks = first.blocks;
  s.goals = [G("g1", "CSC 401", "c1", 1)];
  const second = generateWeek(s);
  assert.equal(second.generated.length, 1);
  assert.equal(second.blocks.filter(b => b.gen).length, 1);
  assert.ok(second.blocks.some(b => b.id === "mine"));
  assert.equal(second.generated[0].id, first.generated[0].id, "stable ids keep ticks where they can");
});

test("goals that don't fit are reported with a reason", () => {
  const s = base({ bedtime: "23:00", wake: "21:00" }); // 1 h 30 min free per day
  s.goals = [G("g1", "CSC 401", "c1", 20, 60, 120)];
  const r = generateWeek(s);
  assert.equal(r.goals[0].placedMin, 7 * 90);
  assert.equal(r.goals[0].missingMin, 1200 - 630);
  assert.match(r.goals[0].reason, /no free 1 h slot is left/);

  const capped = base();
  capped.settings.maxStudyPerDay = 60;
  capped.goals = [G("g1", "CSC 401", "c1", 10, 60, 60)];
  const rc = generateWeek(capped);
  assert.equal(rc.goals[0].placedMin, 7 * 60);
  assert.match(rc.goals[0].reason, /daily study limit of 1 h/);
});

test("biggest goal goes first and gets the best days", () => {
  const s = base({ bedtime: "23:00", wake: "20:30" }); // one 2 h slot per day
  s.goals = [G("small", "Stats", "c2", 2, 120, 120), G("big", "CSC 401", "c1", 12, 120, 120)];
  const r = generateWeek(s);
  assert.deepEqual(r.goals.map(g => [g.title, g.placedMin]), [["CSC 401", 720], ["Stats", 120]]);
});

test("3 touches: the day before and the day after the first lecture", () => {
  const s = base();
  s.blocks = [B("lec", "WED", 600, 720, "lecture", "c1")];
  s.goals = [G("g1", "CSC 401", "c1", 3, 60, 60)];
  s.settings.threeTouches = true;
  const days = generateWeek(s).generated.map(b => b.day);
  assert.deepEqual(days.slice(0, 2), ["TUE", "THU"]);
  assert.equal(days.length, 3);
  s.settings.threeTouches = false;
  assert.notDeepEqual(generateWeek(s).generated.map(b => b.day).slice(0, 2), ["TUE", "THU"]);
});

test("validator keeps gen only on study blocks, and goals are checked", () => {
  const s = base();
  s.blocks = [{ ...B("a", "MON", 600, 660), gen: true }, { ...B("b", "MON", 700, 760, "lecture"), gen: true }, { ...B("c", "MON", 800, 860), gen: "yes" }];
  s.goals = [G("ok", "CSC 401", "c1", 2.5), G("bad1", "x", "c1", 0.3), G("bad2", "x", "c1", 2, 90, 60), G("bad3", "", "c1", 2), G("ghostcat", "Y", "nope", 1), G("bad4", "z", null, 2, 20, 60)];
  s.settings.maxStudyPerDay = 999;
  const r = validate(s);
  assert.deepEqual(r.data.blocks.map(b => b.gen), [true, undefined, undefined]);
  assert.deepEqual(r.data.goals.map(g => [g.id, g.cat]), [["ok", "c1"], ["ghostcat", null]]);
  assert.equal(r.data.settings.maxStudyPerDay, 600);
});

// ---------- goals editor ----------

test("goalFromDraft creates or reuses the subject and checks the form", () => {
  const s = base();
  let r = goalFromDraft({ subject: "csc 401", hours: "4.5", smin: "60", smax: "90" }, s, "g1");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.state.goals, [{ id: "g1", title: "CSC 401", cat: "c1", hoursPerWeek: 4.5, sessionMin: 60, sessionMax: 90 }]);
  assert.equal(r.state.categories.length, 2, "existing subject reused");
  r = goalFromDraft({ subject: "Physics", hours: "3", smin: "45", smax: "120" }, r.state, "g2");
  assert.equal(r.state.categories.at(-1).name, "Physics");
  assert.equal(r.state.goals[1].cat, r.state.categories.at(-1).id);
  assert.equal(s.goals.length, 0, "input not mutated");

  const errs = d => goalFromDraft({ subject: "A", hours: "2", smin: "60", smax: "120", ...d }, r.state).errors;
  assert.match(errs({ subject: "" })[0], /subject/);
  assert.match(errs({ hours: "0" })[0], /0.5 and 60/);
  assert.match(errs({ hours: "abc" })[0], /0.5 and 60/);
  assert.match(errs({ smin: "120", smax: "60" })[0], /shortest/);
  assert.match(errs({ smin: "7" })[0], /session lengths/);
  assert.match(errs({ subject: "physics" })[0], /already a goal/);
  assert.equal(goalFromDraft({ subject: "<img src=x onerror=alert(1)>", hours: 1, smin: 60, smax: 60 }, s).state.goals[0].title, "<img src=x onerror=alert(1)>");
});
