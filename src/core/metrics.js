// @ts-check
/** Pixel-level measurements. Pure functions on grayscale Float32 buffers. */
import { median } from "./util.js";

/** @typedef {{g: Float32Array, w: number, h: number}} Gray */

/** @returns {Gray} */
export function toGray(data, w, h) {
  const n = w * h, g = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  return { g, w, h };
}
export function subGray(G, x, y, w, h) {
  const g = new Float32Array(w * h);
  for (let r = 0; r < h; r++) g.set(G.g.subarray((y + r) * G.w + x, (y + r) * G.w + x + w), r * w);
  return { g, w, h };
}

/** Noise standard deviation, Immerkær's fast estimator. */
export function immerkaer(G) {
  const { g, w, h } = G;
  let s = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    let i = y * w + 1;
    for (let x = 1; x < w - 1; x++, i++) {
      s += Math.abs(g[i - w - 1] - 2 * g[i - w] + g[i - w + 1] - 2 * g[i - 1] + 4 * g[i] - 2 * g[i + 1]
        + g[i + w - 1] - 2 * g[i + w] + g[i + w + 1]);
      n++;
    }
  }
  return n ? Math.sqrt(Math.PI / 2) * s / (6 * n) : 0;
}

const GK = (() => { const k = []; let s = 0; for (let i = -3; i <= 3; i++) { const v = Math.exp(-i * i / 2); k.push(v); s += v; } return Float32Array.from(k, (v) => v / s); })();
/** Separable Gaussian blur, σ = 1. */
export function blur1(g, w, h) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let j = -3; j <= 3; j++) { let xx = x + j; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; a += GK[j + 3] * g[row + xx]; }
      tmp[row + x] = a;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let j = -3; j <= 3; j++) { let yy = y + j; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy; a += GK[j + 3] * tmp[yy * w + x]; }
    out[y * w + x] = a;
  }
  return out;
}

const HB = 0.25, HN = 1024;
/**
 * Edge blur radius in pixels (re-blur method, Zhuo & Sim 2011).
 * On the strongest edges, compares the gradient of the image with the gradient of the same
 * image blurred by a known σ: R = |∇I| / |∇(I∗G1)|, σ = 1/√(R² − 1). Independent of contrast and
 * of how much texture there is: one crisp panel line or reflection measures as well as foliage.
 * Also returns the anisotropy of the blur across edge orientations (motion blur is directional).
 * @param {Gray} G @param {number} sig noise σ
 */
export function edgeBlur(G, sig) {
  const { g, w, h } = G, m = 4;
  if (w < 2 * m + 24 || h < 2 * m + 24) return null;
  const b = blur1(g, w, h);
  const g1 = new Float32Array(w * h), hist = new Uint32Array(HN);
  let tot = 0;
  for (let y = m; y < h - m; y++) {
    for (let x = m, i = y * w + m; x < w - m; x++, i++) {
      const gx = (b[i + 1] - b[i - 1]) / 2, gy = (b[i + w] - b[i - w]) / 2;
      const v = Math.sqrt(gx * gx + gy * gy);
      g1[i] = v; hist[Math.min(HN - 1, (v / HB) | 0)]++; tot++;
    }
  }
  let acc = 0, k = 0;
  const target = tot * 0.96;
  for (; k < HN; k++) { acc += hist[k]; if (acc >= target) break; }
  const thr = Math.max(k * HB, 3 * sig + 1.5), s2 = sig * sig;
  // neighbours across the edge for each orientation bin (0°, 45°, 90°, 135°)
  const across = [1, w + 1, w, w - 1];
  const all = [], bins = [[], [], [], []];
  let contrast = 0;
  for (let y = m; y < h - m; y++) {
    for (let x = m, i = y * w + m; x < w - m; x++, i++) {
      const v1 = g1[i];
      if (v1 < thr) continue;
      const ang = (Math.atan2(b[i + w] - b[i - w], b[i + 1] - b[i - 1]) * 180 / Math.PI + 180) % 180;
      const bin = (((ang + 22.5) / 45) | 0) % 4, d = across[bin];
      // Only the centre line of each edge (non-maximum suppression, as in Canny). On its flanks the
      // re-blur ratio tends to 1 and reads as heavy blur, so a lone crisp edge across a flat area
      // (sky, car paint, a wall) would otherwise measure as soft.
      if (v1 < g1[i - d] || v1 <= g1[i + d]) continue;
      const gx0 = (g[i + 1] - g[i - 1]) / 2, gy0 = (g[i + w] - g[i - w]) / 2;
      const r = Math.sqrt(Math.max(gx0 * gx0 + gy0 * gy0 - s2, 1e-6)) / v1;
      all.push(r);
      contrast += v1;
      bins[bin].push(r);
    }
  }
  if (all.length < 12) return null;
  const toS = (r) => Math.min(12, 1 / Math.sqrt(Math.max(r * r - 1, 1e-4)));
  const per = bins.filter((x) => x.length >= 8).map((x) => toS(median(x)));
  return {
    s: toS(median(all)), n: all.length, contrast: contrast / all.length,
    a: per.length >= 2 ? Math.max(...per) / Math.min(...per) : null,
  };
}

/** Luminance histogram statistics from RGBA data. */
export function exposureStats(data) {
  const hist = new Uint32Array(256);
  let hi = 0, sat = 0, lo = 0, n = 0;
  for (let j = 0; j < data.length; j += 4) {
    const r = data[j], g = data[j + 1], b = data[j + 2];
    hist[(0.299 * r + 0.587 * g + 0.114 * b) | 0]++;
    // blown = white with no detail left; one saturated channel (a red dress, a blue sky) is not
    if (r >= 250 && g >= 250 && b >= 250) { hi++; if (r >= 254 && g >= 254 && b >= 254) sat++; }
    if (r <= 3 && g <= 3 && b <= 3) lo++;
    n++;
  }
  let acc = 0, p01 = 0, p50 = 0, p99 = 255, sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * hist[i];
    const prev = acc; acc += hist[i];
    if (prev < n * 0.01 && acc >= n * 0.01) p01 = i;
    if (prev < n * 0.5 && acc >= n * 0.5) p50 = i;
    if (prev < n * 0.99 && acc >= n * 0.99) p99 = i;
  }
  return { mean: n ? sum / n : 0, p01, p50, p99, hiClip: n ? hi / n : 0, satClip: n ? sat / n : 0, loClip: n ? lo / n : 0 };
}

const DCT = (() => { const c = []; for (let u = 0; u < 8; u++) { const r = new Float32Array(32); for (let x = 0; x < 32; x++) r[x] = Math.cos((2 * x + 1) * u * Math.PI / 64); c.push(r); } return c; })();
/** 64-bit perceptual hash from a 32×32 grayscale buffer. */
export function phash(gray32) {
  const A = new Float32Array(32 * 8);
  for (let y = 0; y < 32; y++) for (let u = 0; u < 8; u++) {
    let s = 0; for (let x = 0; x < 32; x++) s += gray32[y * 32 + x] * DCT[u][x];
    A[y * 8 + u] = s;
  }
  const C = new Float32Array(64);
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let s = 0; for (let y = 0; y < 32; y++) s += A[y * 8 + u] * DCT[v][y];
    C[v * 8 + u] = s;
  }
  const med = median(Array.from(C).slice(1));
  let h0 = 0, h1 = 0;
  for (let i = 0; i < 64; i++) if (C[i] > med) { if (i < 32) h0 |= 1 << i; else h1 |= 1 << (i - 32); }
  return [h0 >>> 0, h1 >>> 0];
}
export function popcnt(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }

/** Perceptual similarity 0..1 from hash + 4×4 colour grid. */
export function perceptualSim(a, b) {
  if (!a || !b) return 0;
  const ham = popcnt(a.h[0] ^ b.h[0]) + popcnt(a.h[1] ^ b.h[1]);
  const hs = Math.max(0, 1 - ham / 32);
  let d = 0;
  for (let i = 0; i < a.c.length; i++) d += Math.abs(a.c[i] - b.c[i]);
  const cs = Math.max(0, 1 - d / a.c.length / 60);
  return 0.65 * hs + 0.35 * cs;
}

function gaussKernel(s) {
  const r = Math.ceil(3 * s), k = [];
  let t = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * s * s)); k.push(v); t += v; }
  return { r, k: Float32Array.from(k, (v) => v / t) };
}
function gblur(g, w, h, s) {
  const { r, k } = gaussKernel(s), tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let j = -r; j <= r; j++) { let xx = x + j; xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx; a += k[j + r] * g[y * w + xx]; }
    tmp[y * w + x] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let j = -r; j <= r; j++) { let yy = y + j; yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy; a += k[j + r] * tmp[yy * w + x]; }
    out[y * w + x] = a;
  }
  return out;
}

/**
 * Coarse blur: the same re-blur idea between σ=2 and σ=4 (full-resolution px), on edges picked at
 * σ=4, computed at half resolution. Film grain and noise vanish at that scale, so a frame blurred by
 * shake reads as blurred even when its grain still looks crisp. Its absolute value is biased; it is
 * only compared between frames of the same burst.
 * @param {Gray} G
 */
export function coarseBlur(G) {
  const w = G.w >> 1, h = G.h >> 1, A = 1, B = 2, m = 3 * B + 1;
  if (w < 2 * m + 16 || h < 2 * m + 16) return null;
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 2 * y * G.w + 2 * x;
    g[y * w + x] = (G.g[i] + G.g[i + 1] + G.g[i + G.w] + G.g[i + G.w + 1]) / 4;
  }
  const ba = gblur(g, w, h, A), bb = gblur(g, w, h, B);
  const va = new Float32Array(w * h), vb = new Float32Array(w * h), vals = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1, i = y * w + 1; x < w - 1; x++, i++) {
    va[i] = Math.hypot((ba[i + 1] - ba[i - 1]) / 2, (ba[i + w] - ba[i - w]) / 2);
    vb[i] = Math.hypot((bb[i + 1] - bb[i - 1]) / 2, (bb[i + w] - bb[i - w]) / 2);
    if (y >= m && y < h - m && x >= m && x < w - m) vals.push(vb[i]);
  }
  vals.sort((a, b) => a - b);
  const thr = Math.max(vals[Math.floor(vals.length * 0.96)] || 0, 0.3);
  const across = [1, w + 1, w, w - 1], ss = [];
  for (let y = m; y < h - m; y++) for (let x = m, i = y * w + m; x < w - m; x++, i++) {
    const v = vb[i];
    if (v < thr) continue;
    const ang = (Math.atan2(bb[i + w] - bb[i - w], bb[i + 1] - bb[i - 1]) * 180 / Math.PI + 180) % 180;
    const d = across[(((ang + 22.5) / 45) | 0) % 4];
    if (v < vb[i - d] || v <= vb[i + d]) continue;
    const R2 = (va[i] / v) ** 2;
    const s2 = R2 <= 1.0001 ? 36 : (B * B - A * A * R2) / (R2 - 1);
    ss.push(Math.min(6, Math.sqrt(Math.max(0, s2))));
  }
  if (ss.length < 8) return null;
  return 2 * median(ss);
}
