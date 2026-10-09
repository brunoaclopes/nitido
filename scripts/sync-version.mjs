#!/usr/bin/env node
// Run by `npm version`: copies package.json's version into src/version.js, so the app, the server
// and the release all carry the same number.
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("..", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const file = new URL("src/version.js", root);
writeFileSync(file, readFileSync(file, "utf8").replace(/VERSION = "[^"]*"/, `VERSION = "${version}"`));
console.log(`src/version.js → ${version}`);
