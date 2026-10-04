# Stick-to-it Tracker

A study timetable you build yourself: tick off study blocks, keep a streak and get an alarm when each block starts. It works offline and installs like an app. **Your data stays on your phone.** There's no account and no server.

**Open it:** https://joshuaoheneba01-art.github.io/Progress-Tracker/

## What it does

- **Build your week** with a 2-minute setup (wake time, bedtime, naps, lectures, study sessions), or start from a template: Student, Night owl, Early bird or "McJayy's week".
- **Plan tab:** add, edit, copy and delete blocks. It catches overlaps and impossible times. Courses get their own colours.
- **Sleep guard:** warns when a night has under 7 h of sleep (naps count) and names the block cutting into it.
- **Import your class timetable** (Plan tab): paste lines like `Mon 9:30-11:30 CSC 415`, or choose a CSV or calendar (.ics) file. You review every class, with clashes and unreadable lines flagged, before anything is added. It is all read on your phone; nothing is uploaded.
- **Day tab:** what's on right now and what's next. Tap a study block to tick it off. Lectures show greyed (fixed, not ticked). Naps and wind-down are rest blocks.
- **Progress:** completion by day, hours studied vs planned per course, streak, the previous 4 weeks, and counters (e.g. "modules finished").
- **Projects:** a log of things you've built.
- **Alarms:** a full-screen alarm when a block starts, with Snooze 5 / Snooze 10 / Dismiss. It repeats every 30 s until you act. *See the limits below.*
- **Calendar file (.ics):** adds your whole week to your phone's calendar with alerts.
- **Backups:** export and import a file. The app reminds you if you haven't exported for a week.

### Night owls
Your **study day ends at your bedtime, not at midnight.** With a 03:30 bedtime, a 1:30am block still counts as part of the day before. Times are always your phone's local time.

## Install on your phone

- **Android (Chrome):** open the link, then menu → *Install app* (or the Install button in Settings).
- **iPhone (Safari):** open the link, then Share → *Add to Home Screen*.

After the first visit it works with no connection, including editing your timetable.

## Alarms: the honest limits

A website **cannot** ring on a locked phone when the app is closed. Alarms here ring only while the app is open, or was used recently and the phone hasn't paused it yet. Also:

- **Sound needs a tap first.** Browsers block sound until you tap the page once, so tap anywhere (or *Arm alarms*) each time you open the app.
- **For alerts you can always count on**, use *Settings → Download calendar file*. Your phone's calendar fires those even when this app is closed.
- **Real alarms** that ring with the app closed are planned for the Android app (Stage 3).

## Your data and privacy

- Everything is stored in your browser's storage on this device. Nothing is uploaded.
- **Clearing your browser data deletes it,** and so can the browser itself when the phone is very low on space. *Settings → Storage* shows whether the browser has promised to keep it ("Storage protected"). Installing the app usually gets that promise.
- **Export a backup now and then** (Settings → Backup). It's also how you move to a new phone.
- Moving from the original single-user app is automatic: the first time you open this version, your old ticks, projects and settings are carried across, and the old copy is kept as a safety net.

## Updates

When a new version is published, the app downloads it in the background and shows **"Update ready · tap to refresh"**. It never switches versions while you're using it. The current version is shown at the bottom of Settings, and [CHANGELOG.md](CHANGELOG.md) lists what changed.

---

## For developers

Plain HTML, CSS and JavaScript ES modules. There's no build step and there are **no dependencies**.

```
index.html            app shell + strict Content Security Policy
sw.js                 service worker: offline cache, update flow, notification actions
manifest.webmanifest  install metadata
css/app.css           all styles (no inline styles anywhere)
js/main.js            boot, state, event handling, updates, alarms wiring
js/schema.js          data model + validator (everything stored/imported goes through it)
js/schedule.js        time logic: study day, overlaps, stats, streak, editor rules
js/storage.js         load/save, migration from the old app, template, backups
js/ui.js              all screens, built with createElement/textContent only
js/alarm.js           alarm overlay, sound, vibration
js/reminders.js       reminder nudges + alarm scheduling
js/ics.js             calendar export
js/importers.js       timetable import: quick-add text, CSV, .ics (+ review preview)
templates/*.json      built-in timetables (validated like any import)
tests/*.test.js       node:test, no dependencies
```

**Run the tests** (Node 22+):

```
node --test "tests/*.test.js"
```

They cover:
- the validator, against hostile input like `<img onerror>`, `__proto__` keys, huge strings and bad times,
- migration, overlap detection, the `.ics` output and the alarm scheduling,
- the security rules, checked automatically.

**Run it locally:** serve the folder with any static server and open `http://localhost:…/`. Service workers need `http://localhost` or HTTPS. Opening the file directly won't work.

**Release a new version:**
1. Bump `VERSION` in `sw.js` **and** `APP_VERSION` in `js/main.js`. They must match, and a test checks it.
2. Add any new file to the `ASSETS` list in `sw.js`. A test checks this too.
3. Update `CHANGELOG.md`, commit and push to `main`. GitHub Pages serves the repo root, so keep every path relative.

**Data model (v1),** stored in `localStorage` under `stick_v1`:

```
{ v: 1,
  profile:    { name, bedtime: "03:30", wake: { MON: "08:00", … } },
  categories: [{ id, name, color }],          // color = palette index 0–11
  blocks:     [{ id, day: "MON", start: 990, end: 1170, title, kind: "study|lecture|nap|rest", cat }],
  progress:   { "2026-09-28": { "<blockId>": true } },   // week (Monday) → ticked study blocks
  projects:   [{ id, title, note, date }],
  counters:   [{ id, name, count }],
  settings:   { remind, alarms, lead, snooze, lastBackup, theme } }
```

Times are minutes from midnight of the study day, from 0 to 1800 (30 hours), so 1:30am is 1530.

Security design and known limits: see [SECURITY.md](SECURITY.md).

## Roadmap

1. **Stage 1:** anyone can build and track their own week, offline, with in-app alarms. *(this version)*
2. **Stage 2:** sleep guard, more templates, a week generator, a focus timer, a catch-up list, and sharing templates by link.
3. **Stage 3:** Android app (Capacitor) with real alarms that ring when the app is closed.
4. **Stage 4:** optional accounts, sync and friend streaks.
