// @ts-check
/** Coordinate mapping between Fujifilm metadata and the decoded (display-oriented) image.
 *  Fujifilm writes FocusPixel and the subject-detection boxes in the JPEG's own unrotated
 *  pixels (PixelXDimension × PixelYDimension), not the sensor's and not the display frame. */

/** @typedef {[number, number, number, number]} Box  x1 y1 x2 y2 */
export function clampBox(x1, y1, x2, y2, W, H, min = 16) {
  const a = Math.max(0, Math.round(Math.min(x1, x2))), b = Math.max(0, Math.round(Math.min(y1, y2)));
  const c = Math.min(W, Math.round(Math.max(x1, x2))), d = Math.min(H, Math.round(Math.max(y1, y2)));
  return c - a < min || d - b < min ? null : /** @type {Box} */ ([a, b, c, d]);
}
export const around = (cx, cy, half, W, H) => clampBox(cx - half, cy - half, cx + half, cy + half, W, H);
export const boxCenter = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
export const boxArea = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
export function iou(a, b) {
  const i = boxArea([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
  return i / (boxArea(a) + boxArea(b) - i || 1);
}
export const contains = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
export function grow(b, f, W, H, minHalf = 0) {
  const [cx, cy] = boxCenter(b);
  const hw = Math.max((b[2] - b[0]) / 2 * f, minHalf), hh = Math.max((b[3] - b[1]) / 2 * f, minHalf);
  return clampBox(cx - hw, cy - hh, cx + hw, cy + hh, W, H);
}

/** Size of the unrotated JPEG, and the orientation still to apply to metadata coordinates. */
export function unrotated(meta, W, H) {
  let o = meta.orientation || 1;
  // If the decoder did not rotate, the decoded size equals the EXIF size.
  if (o >= 5 && meta.w && meta.h && meta.w !== meta.h && W === meta.w && H === meta.h) o = 1;
  const rot = o >= 5;
  return { o, W0: rot ? H : W, H0: rot ? W : H };
}

/** Maps metadata coordinates (JPEG unrotated frame) to the decoded image. */
export function mapper(meta, W, H) {
  const { o, W0, H0 } = unrotated(meta, W, H);
  // A RAF preview can be smaller than the frame the metadata describes.
  const s = meta.w && meta.h ? Math.min(W0 / meta.w, H0 / meta.h) : 1;
  const d = (x, y) => {
    x *= s; y *= s;
    switch (o) {
      case 3: return [W0 - x, H0 - y];
      case 6: return [H0 - y, x];
      case 8: return [y, W0 - x];
      default: return [x, y];
    }
  };
  return {
    pt: d,
    box(x1, y1, x2, y2) {
      const a = d(x1, y1), b = d(x2, y2);
      return clampBox(a[0], a[1], b[0], b[1], W, H, 4);
    },
  };
}

/** AF point in display coordinates, or null for manual focus (Fuji still writes a stale point). */
export function afPoint(meta, W, H) {
  const af = meta.focusPixel || [];
  if (meta.focusMode === 1 || af.length < 2 || (af[0] === 0 && af[1] === 0)) return null;
  const [x, y] = mapper(meta, W, H).pt(af[0], af[1]);
  return x >= 0 && y >= 0 && x <= W && y <= H ? [x, y] : null;
}

const EYES = new Set([2, 3, 17, 18, 21, 22, 27]);
const FACES = new Set([1, 8, 15, 16, 20, 26]);
/** Boxes from the camera's own subject detection, in display coordinates. */
export function cameraElements(meta, W, H) {
  const m = mapper(meta, W, H), out = [];
  const types = meta.elementTypes || [], pos = meta.elementPositions || [];
  if (types.length && pos.length >= types.length * 4) {
    types.forEach((t, i) => {
      if (!t) return;
      const p = pos.slice(i * 4, i * 4 + 4), b = m.box(p[0], p[1], p[2], p[3]);
      if (b) out.push({ kind: EYES.has(t) ? "eye" : FACES.has(t) ? "face" : "subject", type: t, box: b });
    });
  }
  if (!out.some((e) => e.kind === "face")) {
    const fp = meta.facePositions || [];
    for (let i = 0; i + 3 < fp.length; i += 4) {
      const b = m.box(fp[i], fp[i + 1], fp[i + 2], fp[i + 3]);
      if (b) out.push({ kind: "face", type: 1, box: b });
    }
  }
  return out;
}
