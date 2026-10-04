#!/usr/bin/env node
/**
 * Print the CHANGELOG.md section of one version (used for GitHub releases).
 *
 *   node scripts/release-notes.mjs 3.0.0 > release-notes.md
 */
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/release-notes.mjs <version>");
  process.exit(2);
}
const lines = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start < 0) {
  console.error(`No CHANGELOG section for ${version}`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
console.log(
  lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim()
);
