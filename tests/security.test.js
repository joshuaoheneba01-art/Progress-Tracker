// Guards the security rules in SECURITY.md so a later change can't quietly
// break them: no HTML injection sinks, strict CSP, no inline code or styles,
// no third-party URLs, relative paths only, every file precached.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const JS = readdirSync(new URL("../js/", import.meta.url)).filter(f => f.endsWith(".js")).map(f => "js/" + f);
const SOURCES = [...JS, "sw.js", "index.html", "css/app.css"];
// Comments may mention the forbidden words; code may not.
const code = p => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("no HTML injection sinks or dynamic code anywhere", () => {
  const banned = [
    /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/,
    /new\s+Function\b/, /javascript:/i, /setTimeout\s*\(\s*["'`]/, /setInterval\s*\(\s*["'`]/,
    /createContextualFragment/, /DOMParser/, /\.srcdoc\b|srcdoc\s*=/,
  ];
  for (const f of SOURCES) for (const re of banned) assert.equal(re.test(code(f)), false, `${f} matches ${re}`);
});

test("index.html: exact strict CSP, no inline script, style or handlers", () => {
  const html = read("index.html");
  assert.ok(html.includes(
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; manifest-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'">`,
  ));
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, "inline <script>");
  assert.equal(/<style/i.test(html), false, "inline <style>");
  assert.equal(/\sstyle\s*=/i.test(html), false, "style= attribute");
  assert.equal(/\son[a-z]+\s*=/i.test(html), false, "inline event handler");
  assert.match(html, /<script type="module" src="js\/main\.js"><\/script>/);
});

test("no inline styles or handlers set from JS", () => {
  for (const f of JS) {
    const c = code(f);
    assert.equal(/setAttribute\(\s*["'](style|on[a-z]+)["']/.test(c), false, `${f}: setAttribute style/on*`);
    assert.equal(/\.on(click|load|error|change|input|submit)\s*=/.test(c), false, `${f}: on* property handler`);
    assert.equal(/\.style\.cssText\s*=/.test(c), false, `${f}: cssText`);
  }
});

test("no third-party URLs: zero runtime dependencies, no CDNs", () => {
  for (const f of SOURCES) {
    const urls = code(f).match(/https?:\/\/[^\s"'`)]+/g) || [];
    // The SVG namespace is an identifier, not a request.
    const external = urls.filter(u => u !== "http://www.w3.org/2000/svg");
    assert.deepEqual(external, [], f);
  }
  assert.equal(/@import|url\(\s*["']?https?:/i.test(read("css/app.css")), false);
});

test("every path is relative (GitHub Pages serves from a sub-folder)", () => {
  const html = read("index.html");
  for (const [, v] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) assert.ok(!v.startsWith("/") && !/^[a-z]+:/i.test(v), v);
  const man = JSON.parse(read("manifest.webmanifest"));
  for (const v of [man.start_url, man.scope, ...man.icons.map(i => i.src)]) assert.ok(!v.startsWith("/"), v);
});

test("the service worker precaches every app file, and versions match", () => {
  const sw = read("sw.js");
  const listed = new Set([...sw.matchAll(/"\.\/([^"]*)"/g)].map(m => m[1]));
  const needed = ["", "index.html", "manifest.webmanifest", "css/app.css", ...JS,
    ...readdirSync(new URL("../icons/", import.meta.url)).map(f => "icons/" + f)];
  for (const f of needed) assert.ok(listed.has(f), `sw.js does not precache ${f || "./"}`);
  const swVer = /const VERSION = "([^"]+)"/.exec(sw)[1];
  const appVer = /const APP_VERSION = "([^ "]+)/.exec(read("js/main.js"))[1];
  assert.equal(swVer, appVer, "bump VERSION in sw.js and APP_VERSION in main.js together");
});

test("service worker: same-origin GET only, never caches bad responses, only deletes its own caches", () => {
  const sw = code("sw.js");
  assert.match(sw, /req\.method !== "GET"/);
  assert.match(sw, /origin !== self\.location\.origin/);
  assert.match(sw, /res\.ok && res\.status === 200 && res\.type === "basic"/);
  assert.match(sw, /k\.startsWith\(PREFIX\) && k !== CACHE/);
  assert.equal(/skipWaiting\(\)/.test(sw.replace(/if \(e\.data === "SKIP_WAITING"\) self\.skipWaiting\(\);/, "")), false, "skipWaiting only on request");
});
