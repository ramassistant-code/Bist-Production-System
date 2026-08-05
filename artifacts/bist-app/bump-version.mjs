/**
 * bump-version.mjs
 * Runs automatically before every production build (via "prebuild" script).
 * Increments the build counter and updates src/version.json.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const versionFile = resolve(__dirname, "src/version.json");

const v = JSON.parse(readFileSync(versionFile, "utf8"));
v.build = (v.build ?? 0) + 1;
v.version = `1.0.${v.build}`;
v.builtAt = new Date().toISOString().split("T")[0];

writeFileSync(versionFile, JSON.stringify(v, null, 2) + "\n");
console.log(`✓ Version bumped → ${v.version} (build ${v.build}, ${v.builtAt})`);
