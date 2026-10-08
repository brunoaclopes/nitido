#!/usr/bin/env node
// Downloads the AI models into ./models so Nítido can run them without the model hosts.
// Usage: npm run models
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "models");
const CLIP = "Xenova/clip-vit-base-patch32";
const files = [
  ["face_landmarker.task", "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"],
  ["efficientdet_lite0.tflite", "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite"],
  ...["config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
    "onnx/vision_model_quantized.onnx", "onnx/text_model_quantized.onnx"]
    .map((f) => [`hf/${CLIP}/${f}`, `https://huggingface.co/${CLIP}/resolve/main/${f}`]),
];

let ok = true;
const have = new Set();
for (const [rel, url] of files) {
  const dest = join(root, rel);
  if (await stat(dest).then((s) => s.size > 0, () => false)) { console.log(`✓ ${rel} (already here)`); have.add(rel); continue; }
  process.stdout.write(`↓ ${rel} … `);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
    have.add(rel);
  } catch (e) {
    ok = false;
    console.log(`failed (${e.message})`);
  }
}
const manifest = {};
if (have.has("face_landmarker.task")) manifest.faceModel = "face_landmarker.task";
if (have.has("efficientdet_lite0.tflite")) manifest.objectModel = "efficientdet_lite0.tflite";
if (files.filter(([r]) => r.startsWith("hf/")).every(([r]) => have.has(r))) manifest.clip = true;
await mkdir(root, { recursive: true });
await writeFile(join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(ok ? "\nDone. Nítido will use these files automatically." : "\nSome files failed; the app falls back to the online copies for those.");
