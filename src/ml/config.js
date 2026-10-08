// @ts-check
/** Where the AI models come from. Remote by default; `npm run models` downloads them into
 *  ./models so the app also works offline (it is then used automatically). */
export const VERSIONS = { mediapipe: "0.10.21", transformers: "3.7.6" };

const REMOTE = {
  mediapipe: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSIONS.mediapipe}`,
  mediapipeWasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSIONS.mediapipe}/wasm`,
  faceModel: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  objectModel: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  transformers: `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${VERSIONS.transformers}`,
  clipModel: "Xenova/clip-vit-base-patch32",
  localModelPath: null,
};

let cached = null;
/** Resolves the model locations, preferring files under ./models (see scripts/fetch-models.mjs). */
export function modelConfig() {
  return (cached ||= resolveConfig());
}
async function resolveConfig() {
  const base = new URL("../../models/", import.meta.url).href;
  let local = null;
  try { const r = await fetch(base + "manifest.json", { cache: "no-store" }); if (r.ok) local = await r.json(); } catch {}
  const cfg = { ...REMOTE };
  if (local) {
    if (local.faceModel) cfg.faceModel = base + local.faceModel;
    if (local.objectModel) cfg.objectModel = base + local.objectModel;
    if (local.clip) cfg.localModelPath = base + "hf/";
  }
  return cfg;
}
