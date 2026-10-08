// @ts-check
/** AI tiers: which detection and similarity models run, from fastest to most accurate.
 *  Faces always use the MediaPipe face landmarker (there is one model); the tiers change the subject
 *  detector, the CLIP model and how hard small faces are looked for. */
const MP = "https://storage.googleapis.com/mediapipe-models/object_detector";
const LITE0 = `${MP}/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`, LITE2 = `${MP}/efficientdet_lite2/float16/1/efficientdet_lite2.tflite`;

/* Image–text models picked from the browser-ready (ONNX) conversions:
 * - MobileCLIP (Apple): more accurate than OpenAI CLIP ViT-B/32 and lighter. Its image side runs at full
 *   precision (the 8-bit one is broken);
 * - SigLIP and SigLIP 2 (Google): the Pareto-optimal models in Immich's search benchmark
 *   (recall 81.9% and 84.9% against 69.9% for ViT-B/32 at the same speed).
 * `sim` maps each model's image–image cosine to 0..1 for grouping. Measured on X-H2 shoots: the 90th
 * percentile between unrelated scenes, and the median between frames of one burst.
 * `mb` is the download (once), `s` the measured seconds per photo for the image model. */
export const TIERS = {
  light: { objects: LITE0, clip: { id: "Xenova/mobileclip_s0", family: "mobileclip", sim: [0.54, 0.97] }, people: 2, mb: 100, s: 0.3 },
  standard: { objects: LITE0, clip: { id: "Xenova/mobileclip_s2", family: "mobileclip", sim: [0.56, 0.98] }, people: 3, mb: 220, s: 0.9 },
  heavy: { objects: LITE2, clip: { id: "Xenova/siglip-base-patch16-224", family: "siglip", sim: [0.66, 0.955] }, people: 5, mb: 225, s: 1.5 },
  max: { objects: `${MP}/efficientdet_lite2/float32/1/efficientdet_lite2.tflite`, clip: { id: "onnx-community/siglip2-base-patch16-224-ONNX", family: "siglip", sim: [0.82, 0.97] }, people: 8, mb: 405, s: 1.5 },
};
export const TIER_NAMES = /** @type {(keyof typeof TIERS)[]} */ (Object.keys(TIERS));
export const tierOf = (name) => TIERS[name] || TIERS.standard;

/**
 * Suggests a tier from what the browser tells about the machine. Browsers round and cap these
 * figures (Chrome reports at most 8 GB of memory; Safari and Firefox do not report it), so this is a
 * starting point; the measured speed of earlier runs refines it.
 * @param {{cores?: number, memory?: number, mobile?: boolean, rate?: number}} m
 */
export function suggestTier({ cores = 4, memory, mobile = false, rate } = {}) {
  let tier;
  if (mobile || cores < 4 || (memory != null && memory < 4)) tier = "light";
  else if (cores < 8 || (memory != null && memory < 8)) tier = "standard";
  else if (cores < 12) tier = "heavy";
  else tier = "max";
  // seconds per photo at Standard on this machine, when known: slow machines step down
  if (rate != null && rate > 1.5 && tier !== "light") tier = TIER_NAMES[TIER_NAMES.indexOf(tier) - 1];
  return tier;
}

export function machine() {
  const nav = /** @type {any} */ (navigator);
  const mobile = !!(nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "")) ||
    (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820);
  return { cores: navigator.hardwareConcurrency || 4, memory: nav.deviceMemory, mobile };
}
