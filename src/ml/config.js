// @ts-check
/** Where the AI models come from, for a tier. Remote by default; `npm run models` downloads them into
 *  ./models so the app also works offline (local copies are then used automatically). */
import { tierOf } from "./tiers.js";

export const VERSIONS = { mediapipe: "0.10.21", transformers: "3.7.6" };

const REMOTE = {
  mediapipe: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSIONS.mediapipe}`,
  mediapipeWasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSIONS.mediapipe}/wasm`,
  faceModel: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  transformers: `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${VERSIONS.transformers}`,
};

let manifest = null;
async function local() {
  if (manifest) return manifest;
  const base = new URL("../../models/", import.meta.url).href;
  let m = null;
  try { const r = await fetch(base + "manifest.json", { cache: "no-store" }); if (r.ok) m = await r.json(); } catch {}
  // manifest: { files: { remoteUrl: localPath }, clip: [model ids] } (older ones: faceModel, objectModel, clip: true)
  const files = { ...(m?.files || {}) };
  if (m?.faceModel) files[REMOTE.faceModel] = m.faceModel;
  if (m?.objectModel) files[tierOf("standard").objects] = m.objectModel;
  const clip = Array.isArray(m?.clip) ? m.clip : m?.clip ? ["Xenova/clip-vit-base-patch32"] : [];
  manifest = { base, files, clip, libs: m?.libs || {} };
  return manifest;
}

/** Model locations for a tier: { mediapipe, mediapipeWasm, faceModel, objectModel|null, transformers, wasmPaths|null, clipModel|null, localModelPath|null } */
export async function modelConfig(tier = "standard") {
  const t = tierOf(tier), m = await local();
  const at = (url) => (url && m.files[url] ? m.base + m.files[url] : url);
  // the libraries too, when npm run models stored them here
  const mp = m.libs.mediapipe ? m.base + m.libs.mediapipe : null, tf = m.libs.transformers ? m.base + m.libs.transformers : null;
  return {
    ...REMOTE, faceModel: at(REMOTE.faceModel), objectModel: t.objects ? at(t.objects) : null,
    ...(mp ? { mediapipe: mp + "vision_bundle.mjs", mediapipeWasm: mp + "wasm" } : {}),
    ...(tf ? { transformers: tf + "transformers.min.js" } : {}), wasmPaths: tf,
    clipModel: t.clip?.id || null, clipFamily: t.clip?.family || "clip",
    localModelPath: t.clip && m.clip.includes(t.clip.id) ? m.base + "hf/" : null,
  };
}
