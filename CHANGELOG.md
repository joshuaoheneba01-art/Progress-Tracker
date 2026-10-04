# Changelog

Live app: https://joshuaoheneba01-art.github.io/Progress-Tracker/
The version is shown at the bottom of **Settings** in the app.

## Stage 2 progress

| Step | What | Status |
|---|---|---|
| 1 | Sleep guard | ✅ done (1.1.0) |
| 2 | Templates: Student, Night owl, Early bird, McJayy's week | ✅ done (1.2.0) |
| 3 | Timetable import: quick-add text, CSV, .ics, with a review screen | ✅ done (1.3.0) |
| 4 | Week generator from saved study goals | ✅ done (1.4.0) |
| 5 | Focus timer | ⏳ next |
| 6 | Catch-up list + one-off make-up blocks | ⬜ |
| 7 | Share a template by link | ⬜ |

## Stage 1 progress

| Step | What | Status |
|---|---|---|
| 1 | Validator for all stored and imported data | ✅ done |
| 2 | Time logic: study day, overlaps, stats, streak | ✅ done |
| 3 | Migration of the old app's data + "McJayy's week" template | ✅ done |
| 4 | Safe `.ics` calendar export | ✅ done |
| 5 | App split into modules, strict CSP, tracker runs off your own data | ✅ done |
| 6 | Setup wizard + Plan tab (timetable editor) | ✅ done |
| 7 | Offline service worker, "Update ready" banner, storage protection, backup nudge | ✅ done |
| 8 | In-app alarm (Snooze / Dismiss) + notification actions | ✅ done |
| 9 | README, SECURITY.md, final hardening pass | ✅ done |

**Stage 1 is code-complete.** What's left is checking it on a real phone: build a week, use it offline, restart the phone, and let an alarm ring.

## 1.4.0: Stage 2, step 4

**Week generator.** Plan → *Study goals*.

- **Save a goal per subject:** hours per week, plus your shortest and longest session (e.g. *CSC 415: 6 h, sessions 1–2 h*). Goals are saved, so you can change one and run the generator again any time.
- **Generate my study week** fills your free time with study sessions:
  - **When:** from 30 minutes after you wake until bedtime. Your bedtime moves earlier if needed to keep 7 h of sleep.
  - **Around what:** lectures (with 30 minutes clear on each side), naps, and blocks you placed yourself.
  - **How much:** never more than your daily study limit (default 10 h, adjustable), with a 15-minute break after each session.
  - **Spread out:** across different days, biggest goals first.
  - **Counting what you have:** study you placed yourself for a subject counts toward its goal.
  - **Optional "3 touches":** study each course the day before its lecture, the day after, and once more later in the week.
- **Review before it's applied:**
  - Every session is listed, day by day.
  - Each goal shows its target, what you had already placed, what was added, and anything that didn't fit, with the reason (e.g. *"no free 1 h slot is left in your week"*).
- **Re-running is safe:** only blocks the generator made before are replaced. Your own blocks are never moved. Edit a generated block in Plan and it becomes yours.
- **Same input, same week:** the same timetable and goals always give the same result.
- **After importing a timetable,** a **Fill my study time** button takes you straight to the generator.
- **Tests:** 123 automated tests.

## 1.3.0: Stage 2, step 3

**Import your class timetable.** Plan → *Import timetable*.

- **Paste lines** like `Mon 9:30-11:30 CSC 415`. Also accepted:
  - several days: `Tue/Thu`, `Mon-Fri`, `weekdays`
  - 12-hour times: `2pm-4pm`, `2-4pm`, `11-1pm`
  - a type at the end: `[study]`, `[nap]` or `[rest]`. Anything else comes in as a lecture.
- **Or choose a file:**
  - **CSV:** with or without a header row, comma, semicolon or tab separated.
  - **Calendar (.ics):** weekly repeats are read, and when a class is listed separately for every week, the copies are merged. All-day events are skipped. Times with a timezone tag are read as your phone's local time.
- **Review before anything is added:**
  - Every class is listed. You can untick it or change its type (lecture, study, nap, rest).
  - Clashes with your timetable are shown, e.g. *Overlaps "Course 1 · lecture" (MON 9:00–11:00am)*, and those classes are skipped.
  - Unreadable lines are listed with their line number, e.g. *Line 3: "funday" isn't a day*.
- **Courses become subjects automatically.** An existing subject is reused, even if you typed it in different capitals.
- **Private and safe:** files are read on your phone only and nothing is uploaded. Size limits apply, and hostile text, CSV and calendar files are tested.
- **Tests:** 109 automated tests.

## 1.2.0: Stage 2, step 2

**Templates.**

- **Four templates to start from:**
  - **Student:** morning lectures, study in the afternoon and evening, in bed by 11:30pm.
  - **Night owl:** late start, study into the night, in bed by 2am.
  - **Early bird:** deep work at 6am, in bed by 10pm.
  - **McJayy's week**, as an example.
- **Where to find them:** the setup screen, or **Settings → Run setup again or load a template**. Loading a template keeps your projects, counters and settings.
- **Offline:** templates are stored on the phone, so you can switch template in airplane mode.
- **Treated like imports:** templates are JSON files in `templates/` that go through the same validator as backups. Only the timetable is taken from a template file. Any personal data in it is ignored.
- **Checked automatically:** every template is tested for clean data, no overlaps and at least 7 h of sleep every night.
- **McJayy's week** now comes from `templates/mcjayy.json` too. Moving data from the old app works exactly as before. If the template can't load (offline on the very first open), the old data waits safely and moves next time.
- **Tests:** 91 automated tests.

## 1.1.0: Stage 2, step 1

**Sleep guard.**

- **How sleep is counted:** for every night, the app works out your sleep from bedtime to wake time, plus that day's naps. If a block runs past bedtime or starts before you wake, that block's time is used instead.
- **Warnings under 7 h name the block to move,** for example *"Tue: only 5 h of sleep. 'Cisco · revise' (Mon) runs until 2:00am, past your 11:30pm bedtime. Move it earlier."*
- **Where warnings show:**
  - **Plan tab:** a warning banner, plus a new **"Sleep before each day"** card listing every night.
  - **Day tab:** a warning card for the selected day. Its **Fix in Plan** link opens the day of the block causing the problem.
  - **Setup wizard:** the review screen warns before you finish.
- **Tests:** 82 automated tests.

## 1.0.0: Stage 1 complete

Stage 1 is released: anyone can build their own week, track it offline and get in-app alarms. There are no code changes since 0.9.0. The next work is Stage 2.

## 0.9.0: Stage 1, step 9

**Documentation and a final security pass.**

- **README.md** replaces README.txt. It covers what the app does, how to install it, the honest limits on alarms, privacy, and notes for developers.
- **SECURITY.md** sets out what's protected, the threats and how each is handled, and the known limits of GitHub Pages. It also has a ready-made `_headers` file for moving to Netlify or Cloudflare Pages.
- **Clickjacking guard:** if another website tries to show the app inside a frame, the app refuses to run and shows a warning instead.
- **Security rules checked automatically:** new tests fail if anyone adds any of these:
  - `innerHTML` or `eval`,
  - inline styles or scripts,
  - a CDN or third-party URL,
  - a file that isn't saved for offline use,
  - mismatched version numbers.
- **Tests:** 73 automated tests.

## 0.8.1

- Alarm sound is now only switched on by a real tap, which removes a browser warning.

## 0.8.0: Stage 1, step 8

**Block alarms with Snooze and Dismiss.**

- **Full-screen alarm when a block starts:** lectures, naps and study blocks get one; wind-down and already-ticked study blocks don't. It shows the title and time, with **Snooze 5 min**, **Snooze 10 min** and **Dismiss**. It beeps and vibrates, and repeats every 30 seconds until you act.
- **Late opening:** if you open the app up to 5 minutes after a block started, it still rings ("Started 3 min ago").
- **Arming the sound:** browsers block sound until you tap the page. Your first tap arms alarms for the session, and there's also a "🔔 Tap to arm alarms" banner.
- **System notification** with **Snooze / Dismiss** buttons, if reminders are on. If the app was closed, Snooze opens it to save the snooze.
- **Snoozes survive a reload.**
- **Settings → Alarms:** turn them on or off, run **Test alarm**, and choose how long the notification's Snooze lasts.
- **Honest limits:** alarms only ring while the app is open or recently used. A website can't ring on a locked phone with the app closed. Real alarms come with the Android app in Stage 3. The calendar file stays the most reliable alert for now.

## 0.7.0: Stage 1, step 7

**Works fully offline, and updates never happen behind your back.**

- **"Update ready · tap to refresh":** when a new version is published, it downloads in the background and waits. The app only switches when you tap the banner, so code never changes while you're using it.
- **Offline:** the whole app is stored on the phone, including editing your timetable. Tested in airplane mode.
- **Settings → Storage and offline** shows "Storage protected / not protected" and "Works offline". There's a **Protect storage** button. The app also asks the browser for protection by itself on start.
- **Backup reminder:** a banner appears after 7 days without an export (or a week into using the app if you've never exported). "Export now" or "Later".
- **Two tabs open?** A change in one shows up in the other instead of being overwritten.
- **Safety:**
  - The service worker only handles this app's own requests.
  - It never stores error or third-party responses.
  - It only removes its own old caches, so other apps on the same github.io address are untouched.

## 0.6.0: Stage 1, steps 1–6

**Anyone can build their own week now.**

- **Setup wizard** on first run: name → wake/bedtime → naps → lectures → study time → review. Or start from the "McJayy's week" template, or import a backup.
- **Plan tab:** add, edit, copy and delete blocks. Overlaps and bad times are caught with plain-language errors. Rename subjects and pick their colours.
- **Your old data moves across automatically** the first time you open the new version: ticks, projects, the Cisco module count and reminder settings. The old data is left in place as a safety net.
- **Lectures** show greyed and can't be ticked. **Naps and wind-down** are rest blocks. Only study blocks count toward hours and streaks.
- **Streaks** no longer break on days with nothing planned.
- **Counters:** the Cisco card is now general counters you can add and remove.
- **Security:**
  - All text is shown as plain text (no HTML from data, ever).
  - A strict Content Security Policy is in place, with no inline scripts or styles.
  - Every backup and saved file is checked before use (types, limits, hostile keys).
- **Calendar export:** uses your reminder lead time. Titles with commas, semicolons or new lines can't break the file.
- **Files:** icons moved to `icons/`, code split into `js/` modules, styles in `css/app.css`.
- **Tests:** 56 automated tests (`node --test "tests/*.test.js"`).
