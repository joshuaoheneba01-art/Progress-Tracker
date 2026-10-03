# Changelog

Live app: https://joshuaoheneba01-art.github.io/Progress-Tracker/
The version is shown at the bottom of **Settings** in the app.

## Stage 1 progress

| Step | What | Status |
|---|---|---|
| 1 | Validator for all stored and imported data | ✅ done |
| 2 | Time logic: study day, overlaps, stats, streak | ✅ done |
| 3 | Migration of the old app's data + "McJayy's week" template | ✅ done |
| 4 | Safe `.ics` calendar export | ✅ done |
| 5 | App split into modules, strict CSP, tracker runs off your own data | ✅ done |
| 6 | Setup wizard + Plan tab (timetable editor) | ✅ done |
| 7 | Offline service worker, "Update ready" banner, storage protection, backup nudge | ⏳ next |
| 8 | In-app alarm (Snooze / Dismiss) + notification actions | ⬜ |
| 9 | README, SECURITY.md, final hardening pass | ⬜ |

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
