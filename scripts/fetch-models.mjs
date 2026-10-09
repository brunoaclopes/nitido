#!/usr/bin/env node
// Downloads the AI models and the libraries that run them into ./models, so Nítido needs nothing from
// the model and library hosts (a self-hosted copy then makes no request outside its own server).
// Usage: npm run models                  (the Standard tier)
//        npm run models -- heavy max     (any tiers: light, standard, heavy, max, or all)
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TIERS } from "../src/ml/tiers.js";
import { VERSIONS } from "../src/ml/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "models");
const FACE = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const asked = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const tiers = asked.includes("all") ? Object.keys(TIERS) : asked.length ? asked : ["standard"];
for (const t of tiers) if (!TIERS[t]) { console.error(`Unknown tier "${t}". Use: ${Object.keys(TIERS).join(", ")}, all.`); process.exit(2); }

// keep what an earlier run fetched
let manifest = { files: {}, clip: [], tiers: [], libs: {} };
try {
  const m = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (m.files) manifest = { files: m.files, clip: Array.isArray(m.clip) ? m.clip : [], tiers: m.tiers || [], libs: m.libs || {} };
} catch {}

// the libraries, at the versions the app asks for
const JSD = "https://cdn.jsdelivr.net/npm";
const LIBS = {
  mediapipe: [`lib/tasks-vision@${VERSIONS.mediapipe}/`, `${JSD}/@mediapipe/tasks-vision@${VERSIONS.mediapipe}/`,
    ["vision_bundle.mjs", "wasm/vision_wasm_internal.js", "wasm/vision_wasm_internal.wasm", "wasm/vision_wasm_nosimd_internal.js", "wasm/vision_wasm_nosimd_internal.wasm"]],
  transformers: [`lib/transformers@${VERSIONS.transformers}/`, `${JSD}/@huggingface/transformers@${VERSIONS.transformers}/dist/`,
    ["transformers.min.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]],
};
for (const [lib, [dir, from, files]] of Object.entries(LIBS)) {
  let good = true;
  for (const f of files) {
    const dest = join(root, dir, f);
    if (await stat(dest).then((s) => s.size > 0, () => false)) { console.log(`✓ ${dir}${f} (already here)`); continue; }
    process.stdout.write(`↓ ${dir}${f} … `);
    try {
      const r = await fetch(from + f);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
    } catch (e) { good = false; console.log(`failed (${e.message})`); }
  }
  if (good) manifest.libs[lib] = dir; else delete manifest.libs[lib];
}

const HF = ["config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
  "onnx/vision_model_quantized.onnx", "onnx/text_model_quantized.onnx"];
const jobs = [["face_landmarker.task", FACE, true]];
for (const t of tiers) {
  const { objects, clip } = TIERS[t];
  if (objects) jobs.push([objects.split("/").slice(-4).join("_"), objects, true]);
  // MobileCLIP runs its image model at full precision (see tiers.js)
  const files = clip?.family === "mobileclip" ? HF.map((f) => f.replace("vision_model_quantized", "vision_model")) : HF;
  if (clip) for (const f of files) jobs.push([`hf/${clip.id}/${f}`, `https://huggingface.co/${clip.id}/resolve/main/${f}`, false, clip.id]);
}

let ok = true;
const clipOk = new Map();
for (const [rel, url, single, clipId] of jobs) {
  const dest = join(root, rel);
  let have = await stat(dest).then((s) => s.size > 0, () => false);
  if (have) console.log(`✓ ${rel} (already here)`);
  else {
    process.stdout.write(`↓ ${rel} … `);
    try {
      const r = await fetch(url);
      if (r.status === 404 && !single && !rel.includes("onnx/")) { console.log("not in this model (fine)"); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
      have = true;
    } catch (e) { ok = false; console.log(`failed (${e.message})`); }
  }
  if (single && have) manifest.files[url] = rel;
  if (clipId) clipOk.set(clipId, (clipOk.get(clipId) ?? true) && (have || !rel.includes("onnx/")));
}
for (const [id, good] of clipOk) if (good && !manifest.clip.includes(id)) manifest.clip.push(id);
// a tier is complete here when all of its models are
for (const [t, { objects, clip }] of Object.entries(TIERS)) {
  const done = !!manifest.files[FACE] && (!objects || !!manifest.files[objects]) && (!clip || manifest.clip.includes(clip.id));
  manifest.tiers = manifest.tiers.filter((x) => x !== t);
  if (done) manifest.tiers.push(t);
}
await mkdir(root, { recursive: true });
await writeFile(join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
process.exitCode = ok ? 0 : 1;
console.log(ok ? `\nDone (${tiers.join(", ")}). Nítido will use these files automatically.` : "\nSome files failed; the app falls back to the online copies for those.");
