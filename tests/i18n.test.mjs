import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pt from "../src/i18n/pt.js";
import en from "../src/i18n/en.js";
import { SCENE_LABELS } from "../src/ml/labels.js";

const root = new URL("..", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sources = walk(join(root, "src")).filter((p) => p.endsWith(".js") && !p.includes("/i18n/"));
const html = readFileSync(join(root, "index.html"), "utf8");

test("Portuguese and English have the same keys", () => {
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(en).sort());
});
test("plural forms and placeholders match between languages", () => {
  for (const k of Object.keys(pt)) {
    assert.equal(pt[k].includes("|"), en[k].includes("|"), `plural mismatch: ${k}`);
    const vars = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
    assert.deepEqual(vars(pt[k]), vars(en[k]), `placeholders differ: ${k}`);
  }
});
test("every key used in the markup and code exists", () => {
  const used = new Set();
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(";")) used.add(pair.split(":")[1].trim());
  for (const f of sources) for (const m of readFileSync(f, "utf8").matchAll(/\bt\("([\w.]+)"/g)) if (!m[1].endsWith(".")) used.add(m[1]);
  const dyn = {
    "verdict.": ["keep", "review", "reject", "error"], "verdict.tab.": ["all", "keep", "review", "reject"],
    "reason.": ["blur", "motion", "missed", "eyes", "blink", "softer", "shake", "faceSoft", "over", "under", "nodetail"],
    "why.": ["blur", "motion", "missed", "eyes", "blink", "softer", "shake", "faceSoft", "over", "under", "nodetail"],
    "tag.": ["bokeh", "sharpAll", "smile", "laughing", "camShake", "camFocus", "camExposure", "noise"],
    "focusOn.": ["eye", "face", "camEye", "camFace", "af", "camSubject", "subject", "tile", "none"],
    "extra.": ["all", "best", "faces", "bokeh", "changed", "manual", "starred", "noraf"],
    "bd.": ["sharp", "eyes", "expression", "exposure", "quality", "noise", "relative"],
    "label.": Object.keys(SCENE_LABELS),
  };
  for (const [p, ks] of Object.entries(dyn)) for (const k of ks) used.add(p + k);
  const missing = [...used].filter((k) => !(k in pt) || !(k in en));
  assert.deepEqual(missing, []);
});
