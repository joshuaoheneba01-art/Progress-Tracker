// Shared test helpers (not a test file itself: the runner only picks up *.test.js).
import { readFileSync } from "node:fs";
import { parseTemplate, loadTemplate } from "../js/storage.js";

// Reads a repo file the way fetch() would in the browser.
export const readRepoFile = async path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

// McJayy's week from templates/mcjayy.json, validated.
export const templateMcJayy = () => parseTemplate(readFileSync(new URL("../templates/mcjayy.json", import.meta.url), "utf8")).data;

// Drop-in for the app's "load McJayy's week" step, reading from disk.
export const getMcJayy = () => loadTemplate("mcjayy", readRepoFile);
