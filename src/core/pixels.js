// @ts-check
/** Image decoding and full-resolution measurements. Runs inside a Web Worker.
 *  The image is read in horizontal strips (≤ ~11 MP each), so there is never a canvas the size of
 *  the photo (Safari refuses canvases above ~16 MP) and every pixel is copied about once. */
import { parseExif, parseTime } from "./exif.js";
import { rafPreview } from "./raf.js";
import { around, grow } from "./geometry.js";
import { toGray, immerkaer, edgeBlur, coarseBlur, exposureStats, phash } from "./metrics.js";
import { blurScale } from "./cameras.js";

export const SMALL = 1920, THUMB = 720;
const BAND = 1400, BAND_STEP = 700, PROBE = 144;

const mk = (w, h) => new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
const ctx = (c, read = false) => /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext("2d", read ? { willReadFrequently: true } : undefined));
const jpeg = (c, q) => c.convertToBlob({ type: "image/jpeg", quality: q });

function grayFromBand(d, W, y0, [x1, y1, x2, y2]) {
  const w = x2 - x1, h = y2 - y1, g = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    let j = ((y1 - y0 + r) * W + x1) * 4, i = r * w;
    for (let c = 0; c < w; c++, i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  }
  return { g, w, h };
}
/** Reads many boxes at full resolution, grouped by horizontal strip. */
async function readBoxes(bmp, boxes) {
  const W = bmp.width, H = bmp.height, bh = Math.min(H, BAND);
  const starts = [];
  for (let y = 0; ; y += BAND_STEP) { const y0 = Math.min(y, H - bh); starts.push(y0); if (y0 + bh >= H) break; }
  const plan = starts.map(() => []), out = new Array(boxes.length), loose = [];
  boxes.forEach((b, i) => {
    const k = starts.findIndex((y0) => y0 <= b[1] && b[3] <= y0 + bh);
    (k >= 0 ? plan[k] : loose).push(i);
  });
  const band = mk(W, bh), bx = ctx(band, true);
  for (let k = 0; k < starts.length; k++) {
    if (!plan[k].length) continue;
    bx.clearRect(0, 0, W, bh);
    bx.drawImage(bmp, 0, starts[k], W, bh, 0, 0, W, bh);
    const d = bx.getImageData(0, 0, W, bh).data;
    for (const i of plan[k]) out[i] = grayFromBand(d, W, starts[k], boxes[i]);
  }
  band.width = band.height = 0;
  for (const i of loose) {
    const [x1, y1, x2, y2] = boxes[i], c = mk(x2 - x1, y2 - y1), cx = ctx(c, true);
    cx.drawImage(bmp, x1, y1, c.width, c.height, 0, 0, c.width, c.height);
    out[i] = toGray(cx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  }
  return out;
}

/** Probe boxes covering a target: dense for small regions, an even grid for large ones. */
export function probesFor(box, W, H) {
  const w = box[2] - box[0], h = box[3] - box[1];
  const out = [];
  if (Math.max(w, h) <= 560) {
    const b = grow(box, 1, W, H, PROBE / 2) || box;
    const xs = [], ys = [];
    for (let x = b[0]; x + PROBE <= b[2] || !xs.length; x += 96) xs.push(Math.min(x, Math.max(b[0], b[2] - PROBE)));
    for (let y = b[1]; y + PROBE <= b[3] || !ys.length; y += 96) ys.push(Math.min(y, Math.max(b[1], b[3] - PROBE)));
    for (const y of ys) for (const x of xs) { const p = around(x + PROBE / 2, y + PROBE / 2, PROBE / 2, W, H); if (p) out.push(p); }
  } else {
    const kx = Math.max(2, Math.min(7, Math.round(w / 380))), ky = Math.max(2, Math.min(7, Math.round(h / 380)));
    for (let j = 0; j < ky; j++) for (let i = 0; i < kx; i++) {
      const p = around(box[0] + (i + 0.5) * w / kx, box[1] + (j + 0.5) * h / ky, PROBE / 2, W, H);
      if (p) out.push(p);
    }
  }
  return out;
}

/**
 * Decode a JPEG (or a RAF's embedded preview). Keeps the full bitmap for measure().
 * @param {File} file @param {boolean} isRaf
 */
export async function decode(file, isRaf) {
  const src = isRaf ? await rafPreview(file) : file;
  if (!src) throw new Error("no-preview");
  const meta = parseExif(await src.slice(0, 512 * 1024).arrayBuffer());
  const bmp = await createImageBitmap(src);
  const W = bmp.width, H = bmp.height;

  const k = Math.min(1, SMALL / Math.max(W, H));
  const small = mk(W * k, H * k), sx = ctx(small, true);
  sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = "high";
  sx.drawImage(bmp, 0, 0, small.width, small.height);
  const exposure = exposureStats(sx.getImageData(0, 0, small.width, small.height).data);

  const tk = Math.min(1, THUMB / Math.max(small.width, small.height));
  const th = mk(small.width * tk, small.height * tk), tx = ctx(th);
  tx.imageSmoothingQuality = "high"; tx.drawImage(small, 0, 0, th.width, th.height);
  const thumb = await jpeg(th, 0.82);

  const d32 = mk(32, 32), d32x = ctx(d32, true);
  d32x.imageSmoothingQuality = "high"; d32x.drawImage(small, 0, 0, 32, 32);
  const d4 = mk(4, 4), d4x = ctx(d4, true);
  d4x.imageSmoothingQuality = "high"; d4x.drawImage(small, 0, 0, 4, 4);
  const cd = d4x.getImageData(0, 0, 4, 4).data, col = new Uint8Array(48);
  for (let i = 0, j = 0; i < 16; i++, j += 4) { col[i * 3] = cd[j]; col[i * 3 + 1] = cd[j + 1]; col[i * 3 + 2] = cd[j + 2]; }
  const desc = { h: phash(toGray(d32x.getImageData(0, 0, 32, 32).data, 32, 32).g), c: col, portrait: H > W };

  // CLIP input: centre square of the whole frame, 224 px
  const side = Math.min(small.width, small.height);
  const c224 = mk(224, 224), c224x = ctx(c224, true);
  c224x.imageSmoothingQuality = "high";
  c224x.drawImage(small, (small.width - side) / 2, (small.height - side) / 2, side, side, 0, 0, 224, 224);
  const clip = c224x.getImageData(0, 0, 224, 224);

  const smallBitmap = small.transferToImageBitmap();
  return { bmp, meta, time: parseTime(meta), W, H, thumb, small: smallBitmap, smallScale: k, clip, desc, exposure };
}

/**
 * Measure blur at full resolution.
 * @param {ImageBitmap} bmp
 * @param {{targets: {id: string, kind: string, box: number[]}[], closeups: {id: string, box: number[]}[], meta: any}} plan
 */
export async function measure(bmp, plan) {
  const W = bmp.width, H = bmp.height, scale = blurScale(plan.meta, W, H);

  const noiseBoxes = [];
  for (const fy of [0.2, 0.5, 0.8]) for (const fx of [0.2, 0.5, 0.8]) { const b = around(fx * W, fy * H, 80, W, H); if (b) noiseBoxes.push(b); }
  const cols = W >= H ? 8 : 6, rows = W >= H ? 6 : 8, cellBoxes = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cellBoxes.push(around((c + 0.5) * W / cols, (r + 0.5) * H / rows, 96, W, H));
  const probeSets = plan.targets.map((t) => probesFor(t.box, W, H));

  const all = [...noiseBoxes, ...cellBoxes.filter(Boolean), ...probeSets.flat()];
  const grays = await readBoxes(bmp, all);
  let p = 0;
  const sg = grays.slice(p, (p += noiseBoxes.length)).map(immerkaer).sort((a, b) => a - b);
  const sigma = sg[1] ?? sg[0] ?? 0;

  const coarse = [];
  const cells = cellBoxes.map((box) => {
    if (!box) return null;
    const gr = grays[p++], e = edgeBlur(gr, sigma), c = coarseBlur(gr);
    if (c != null) coarse.push(c * scale);
    return e ? { s: e.s * scale, a: e.a, n: e.n, box } : null;
  });
  coarse.sort((a, b) => a - b);

  const targets = plan.targets.map((t, ti) => {
    const res = [];
    for (const box of probeSets[ti]) {
      const e = edgeBlur(grays[p++], sigma);
      if (e) res.push({ s: e.s * scale, a: e.a, n: e.n, c: e.contrast, box });
    }
    if (!res.length) return { id: t.id, kind: t.kind, box: t.box, s: null, n: 0 };
    res.sort((a, b) => a.s - b.s);
    const s = res.length > 1 ? (res[0].s + res[1].s) / 2 : res[0].s;
    const an = res.filter((r) => r.a).slice(0, 3).map((r) => r.a);
    return { id: t.id, kind: t.kind, box: t.box, s, n: res.reduce((a, r) => a + r.n, 0), probe: res[0].box,
      a: an.length ? an.reduce((a, b) => a + b, 0) / an.length : null };
  });

  async function cropBlob(box, half, size) {
    const b = around((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, half, W, H) || box;
    const c = mk(size, size * (b[3] - b[1]) / (b[2] - b[0]));
    const cx = ctx(c); cx.imageSmoothingQuality = "high";
    cx.drawImage(bmp, b[0], b[1], b[2] - b[0], b[3] - b[1], 0, 0, c.width, c.height);
    return jpeg(c, 0.9);
  }
  // 100% loupes for each measured target and the sharpest cell
  const loupes = {};
  for (const t of targets) if (t.probe) loupes[t.id] = await cropBlob(t.probe, 200, 400);
  let bi = -1;
  cells.forEach((c, i) => { if (c && c.n >= 24 && (bi < 0 || c.s < cells[bi].s)) bi = i; });
  if (bi >= 0) loupes.tile = await cropBlob(cells[bi].box, 200, 400);

  const closeups = {};
  for (const f of plan.closeups) {
    const w = f.box[2] - f.box[0], h = f.box[3] - f.box[1];
    closeups[f.id] = await cropBlob(f.box, Math.max(w, h) * 0.7, 256);
  }

  // CLIP input focused on the subject: a region around the sharpest primary probe
  let subject224 = null;
  const prim = targets.find((t) => t.probe);
  if (prim) {
    const [cx0, cy0] = [(prim.probe[0] + prim.probe[2]) / 2, (prim.probe[1] + prim.probe[3]) / 2];
    const b = around(cx0, cy0, 336, W, H);
    if (b) {
      const c = mk(224, 224), cx = ctx(c, true); cx.imageSmoothingQuality = "high";
      cx.drawImage(bmp, b[0], b[1], b[2] - b[0], b[3] - b[1], 0, 0, 224, 224);
      subject224 = cx.getImageData(0, 0, 224, 224);
    }
  }
  // the sharpest sixth of the frame, at the coarse scale: comparable between frames of a burst
  const coarseS = coarse.length >= 6 ? coarse[Math.floor(coarse.length / 6)] : null;
  return { sigma, coarse: coarseS, cells: { cols, rows, cells }, best: bi >= 0 ? { s: cells[bi].s, box: cells[bi].box } : null,
    targets, loupes, closeups, subject224, scale };
}

/** Crop a region at native resolution (capped), for re-running face detection on small people. */
export async function crop(bmp, box, maxSide) {
  const w = box[2] - box[0], h = box[3] - box[1], k = Math.min(1, maxSide / Math.max(w, h));
  const c = mk(w * k, h * k), cx = ctx(c); cx.imageSmoothingQuality = "high";
  cx.drawImage(bmp, box[0], box[1], w, h, 0, 0, c.width, c.height);
  return { bitmap: c.transferToImageBitmap(), scale: k };
}
