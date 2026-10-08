// @ts-check
/** Face and subject detection with MediaPipe Tasks (runs on the main thread: the library
 *  cannot load inside module workers). Each call is short (tens of ms on a 1920 px image). */
import { modelConfig } from "./config.js";
import { clamp } from "../core/util.js";

let faceLm = null, objDet = null, ready = null;
export const visionStatus = { faces: "off", objects: "off", error: "" };

async function create(Task, fileset, options) {
  for (const delegate of ["GPU", "CPU"]) {
    try { return await Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate } }); }
    catch (e) { if (delegate === "CPU") throw e; }
  }
}

/** Loads both models once. Failures leave the feature off; analysis continues without it. */
export function initVision({ faces = true, objects = true } = {}) {
  if (ready) return ready;
  ready = (async () => {
    const cfg = await modelConfig();
    let mp, fileset;
    try {
      mp = await import(/* @vite-ignore */ cfg.mediapipe);
      fileset = await mp.FilesetResolver.forVisionTasks(cfg.mediapipeWasm);
    } catch (e) { visionStatus.error = String(e?.message || e); visionStatus.faces = visionStatus.objects = "error"; return; }
    if (faces) {
      visionStatus.faces = "loading";
      try {
        faceLm = await create(mp.FaceLandmarker, fileset, {
          baseOptions: { modelAssetPath: cfg.faceModel }, runningMode: "IMAGE", numFaces: 10,
          outputFaceBlendshapes: true, minFaceDetectionConfidence: 0.45, minFacePresenceConfidence: 0.45,
        });
        visionStatus.faces = "ready";
      } catch (e) { visionStatus.faces = "error"; visionStatus.error = String(e?.message || e); }
    }
    if (objects) {
      visionStatus.objects = "loading";
      try {
        objDet = await create(mp.ObjectDetector, fileset, {
          baseOptions: { modelAssetPath: cfg.objectModel }, runningMode: "IMAGE", scoreThreshold: 0.35, maxResults: 6,
        });
        visionStatus.objects = "ready";
      } catch (e) { visionStatus.objects = "error"; visionStatus.error = String(e?.message || e); }
    }
  })();
  return ready;
}

// Eye contours (MediaPipe face mesh): p1 outer, p2 p3 upper lid, p4 inner, p5 p6 lower lid
const EYE_R = [33, 160, 158, 133, 153, 144];   // subject's right eye (image left on a frontal face)
const EYE_L = [362, 385, 387, 263, 373, 380];  // subject's left eye
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ear = (p) => (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]) || 1);

/**
 * @param {ImageBitmap} bmp image the detector sees
 * @param {(x: number, y: number) => [number, number]} toFull maps its pixels to full-resolution pixels
 */
export function detectFaces(bmp, toFull, idPrefix = "f") {
  if (!faceLm) return [];
  let res;
  try { res = faceLm.detect(bmp); } catch { return []; }
  const W = bmp.width, H = bmp.height;
  return (res.faceLandmarks || []).map((lm, i) => {
    const P = (k) => { const [x, y] = toFull(lm[k].x * W, lm[k].y * H); return { x, y }; };
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of lm) { const [x, y] = toFull(p.x * W, p.y * H); x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    const bs = Object.fromEntries((res.faceBlendshapes?.[i]?.categories || []).map((c) => [c.categoryName, c.score]));
    const eye = (idx, blend) => {
      const pts = idx.map(P);
      const e = ear(pts);
      const earBlink = clamp((0.27 - e) / 0.13, 0, 1);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const half = Math.max(40, (Math.max(...xs) - Math.min(...xs)) * 0.8);
      return { ear: e, blink: blend != null ? 0.7 * blend + 0.3 * earBlink : earBlink, box: [cx - half, cy - half, cx + half, cy + half] };
    };
    const r = eye(EYE_R, bs.eyeBlinkRight), l = eye(EYE_L, bs.eyeBlinkLeft);
    const a = P(33), b = P(263), nose = P(1);
    const eyeDist = dist(a, b) || 1;
    const yaw = clamp(((nose.x - (a.x + b.x) / 2) / eyeDist) * 2, -1.5, 1.5);
    return {
      id: `${idPrefix}${i}`, box: [x1, y1, x2, y2], eyes: [r, l], blinkR: r.blink, blinkL: l.blink, yaw,
      smile: ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2,
      squint: ((bs.eyeSquintLeft ?? 0) + (bs.eyeSquintRight ?? 0)) / 2,
    };
  });
}

/** Subjects (COCO classes) in full-resolution coordinates. */
export function detectObjects(bmp, toFull) {
  if (!objDet) return [];
  let res;
  try { res = objDet.detect(bmp); } catch { return []; }
  return (res.detections || []).map((d) => {
    const bb = d.boundingBox, c = d.categories?.[0];
    const [x1, y1] = toFull(bb.originX, bb.originY), [x2, y2] = toFull(bb.originX + bb.width, bb.originY + bb.height);
    return { label: c?.categoryName || "object", score: c?.score ?? 0, box: [x1, y1, x2, y2] };
  });
}
