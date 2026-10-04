# Security

Stick-to-it Tracker is a static web app (a PWA) with no backend. This document covers what it protects, the threats it was designed against, how each one is handled, and the limits that remain.

## Reporting a problem

Please report security issues privately through the repository's **Security → Report a vulnerability** page on GitHub, rather than in a public issue. Include steps to reproduce if you can.

## What we protect

| Asset | Where it lives |
|---|---|
| A user's timetable, ticks, projects, counters, settings | `localStorage` on their own device (`stick_v1`, plus `stick_alarms_v1` and `stick_notified_v1`) |
| The integrity of the app code the user runs | GitHub repository → GitHub Pages → the service worker cache on the device |

There are no accounts, passwords, tokens, payment details or server-side data. There are no secrets in the repository.

## Trust boundaries: what we never trust

Everything below is treated as hostile input and validated before use:

- **Stored data** in `localStorage`. It may be old, corrupted, edited by hand, or written by another app on the same origin (see *Known limits*).
- **Backup files** the user imports.
- **Timetable imports:** pasted text, CSV files and `.ics` calendar files.
- **The URL fragment** (`#alarm=…`, opened from notification actions).
- **Messages** arriving from the service worker.
- **Share links** (Stage 2): they will go through the same validator, with a preview and a confirm step, and are never applied automatically.

## Threats and controls

| Threat | Control |
|---|---|
| **XSS through user text** (a block title such as `<img src=x onerror=…>`) | No HTML is ever built from data. Every node is made with `createElement` and every string goes in through `textContent` (`js/ui.js`). The `el()` helper refuses `on*`, `style`, `href`, `src` and `srcdoc` props outright. There is no `innerHTML`, `eval`, `new Function`, `document.write` or `javascript:` URL anywhere, and `tests/security.test.js` fails the build if one appears. |
| **Script injection in general** | Strict Content Security Policy (below): only the app's own scripts and styles can run, there is no inline code, and no other site can be contacted. |
| **Hostile or corrupted data** (stored, imported or linked) | `validate()` in `js/schema.js` rebuilds a fresh object from an allow-list. It never copies input wholesale, drops unknown keys, and checks types, enum values, times (0–1800, end after start), `HH:MM` formats and id formats. It caps sizes: titles 60 characters, 300 blocks, 30 subjects, 200 projects, 60 weeks of history, 8 levels of nesting. Imports over 256 KB are rejected before reading. Unreadable saved data is set aside (`stick_v1_broken`), never silently overwritten. |
| **Prototype pollution** (`__proto__`, `constructor`, `prototype` keys) | Any such key at any depth rejects the whole input. Tests feed real `JSON.parse` payloads and confirm `Object.prototype` stays clean. |
| **Denial of service by huge input** | Size caps above. Strings are trimmed to the limit cheaply before any further processing. |
| **Hostile timetable imports** (pasted text, CSV, `.ics`) | Parsed on the device by our own code in `js/importers.js`, never uploaded. Limits: 256 KB, 5,000 lines, 2,000 characters per line, 20 CSV fields, 3,000 calendar events and 300 classes. Words from the file are looked up in `Map`s, so names like `constructor` or `__proto__` are just unknown words. Calendar alarms nested inside events can't overwrite the event. Every row goes through the same rules as the editor (times, overlaps, title cleaning), and the user reviews the exact result before anything is saved. Tests feed hostile text, CSV and `.ics` files. |
| **Calendar (.ics) injection** (a title containing a line break plus `END:VEVENT`) | Every text field has CR/LF and control characters stripped and `\ ; ,` escaped. Lines are folded at 75 bytes without splitting a character. Event UIDs are generated in code from a hash of the block id, never from user text. Tested with hostile titles. |
| **Service-worker cache poisoning or stale code** | The service worker handles only same-origin `GET` requests inside the app's own scope. It caches only complete `200` responses of type `basic` (never opaque or error responses). The precache uses `cache: "reload"` to bypass stale HTTP caches. |
| **Silent code swaps** | A new version installs in the background and waits. The page only switches when the user taps *Update ready*, so code never changes mid-use. |
| **Damage to other apps on the shared origin** | All of the owner's GitHub Pages projects share one origin. The service worker only ever deletes caches whose names start with `stick-`. |
| **Clickjacking** (the app loaded invisibly in another site's frame) | `frame-ancestors` cannot be set from a meta tag, so the app checks `window.top` itself. If it is inside a frame it shows only a warning: no buttons, no alarms. |
| **Spoofed notification actions** | The `#alarm=` fragment and service-worker messages are matched against a strict pattern (`YYYY-MM-DD@id`, only `snooze` or `dismiss`). Anything else is ignored, and the fragment is cleared after reading. |
| **Supply-chain attacks** | Zero runtime dependencies: no npm packages, no CDN scripts, no web fonts. Tests use only Node's built-in `node:test`. A test fails if any third-party URL appears in the app's code. |
| **Data loss** | `navigator.storage.persist()` is requested, and its status is shown in Settings. The user is nudged to export a backup after 7 days. Migration from the old app keeps the old data in place. |
| **Account takeover of the publisher** | The GitHub account that publishes this site uses two-factor authentication. Only that account can push to `main`. |

### Content Security Policy

Set in `index.html` (a test checks it is exactly this):

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
media-src 'self'; manifest-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'
```

There are no inline `<script>` or `<style>` blocks and no `style="…"` attributes. The few per-element values (bar heights, colours) are set as CSS custom properties through the CSSOM (`element.style.setProperty`), which the policy allows.

## Known limits

1. **GitHub Pages cannot set HTTP headers.**
   - **CSP from a meta tag only:** the policy is applied by the meta tag. Meta CSP does not support `frame-ancestors`, `sandbox` or `report-uri`/`report-to`, so violations are not reported anywhere.
   - **Missing headers:** the site is served without a CSP header, `X-Frame-Options`, `X-Content-Type-Options` or `Permissions-Policy`. GitHub Pages does enforce HTTPS (301 redirect plus HSTS).
   - **Clickjacking defence is script-based:** a framing page that disables scripts gets a blank, inert page, which is safe. A browser-enforced `frame-ancestors 'none'` would still be stronger.
2. **Shared origin.** Every GitHub Pages project of the same owner shares the origin `https://joshuaoheneba01-art.github.io`. Another project on that origin could read or change this app's `localStorage`.
   - **What still holds:** stored data is validated on every read, so tampered data cannot run code here.
   - **What doesn't:** it could still be read or altered.
   - **Mitigation:** don't host untrusted code under the same account's Pages, or move this app to its own domain.
3. **Data at rest is not encrypted.** Anyone with access to the unlocked phone and browser can see the timetable. That is acceptable for this data, but it is worth knowing.
4. **Alarms are best-effort.** A web page cannot ring when it is closed or the phone is locked, and browsers may pause background pages. The app says this plainly. Reliable alarms are planned for the Android app (Stage 3).
5. **`confirm()` dialogs** are used for destructive actions. They are plain but safe; a custom dialog may replace them later.

## Recommended: real security headers

For full protection, host the same files on a platform that lets you set headers, such as **Netlify** or **Cloudflare Pages**. Both read a `_headers` file at the site root:

```
/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; manifest-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
/sw.js
  Cache-Control: no-cache
```

A custom domain there also gives the app its own origin, which removes limit 2.

## Later stages

- **Stage 2, share links:** template links (base64url JSON in the fragment, about 4 KB max) go through the same validator. The user always sees a preview and must confirm, and links never apply automatically. QR codes only with a vendored, reviewed library.
- **Stage 4, accounts and sync (Supabase):** Row Level Security on every table, only the public anon key in the client, and never the service-role key.
