/**
 * bump-version.mjs
 * Runs only for a production publish.
 * Uses a millisecond release ID so every publish gets a newer version even when
 * the deployment starts from a clean copy of the repository.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const versionFile = process.env.VERSION_FILE ?? resolve(__dirname, "src/version.json");
const v = JSON.parse(readFileSync(versionFile, "utf8"));
const publishedAt = new Date();

v.build = publishedAt.getTime();
v.version = `1.0.${v.build}`;
v.builtAt = publishedAt.toISOString();

writeFileSync(versionFile, JSON.stringify(v, null, 2) + "\n");
console.log(`✓ Version bumped → ${v.version} (build ${v.build}, ${v.builtAt})`);
