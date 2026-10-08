// @ts-check
/** Learns from the photographer's own picks and rejects (logistic regression, L2).
 *  Features are the same signals the rules use, so the model only re-weights them. */
import { logit, sigmoid } from "./util.js";

export const FEATURE_NAMES = ["focus", "relative", "eyes", "motion", "exposure", "quality", "nodetail"];

export function featuresOf(item, x) {
  return [
    x.s == null ? 0 : logit(x.p),
    Math.log(x.rel || 1),
    x.fs.key ? 1 - x.fs.openScore : 0,
    x.motion ? 1 : 0,
    1 - x.exScore,
    item.clip?.quality != null ? logit(item.clip.quality) : 0,
    x.s == null ? 1 : 0,
  ];
}

/** @param {{x: number[], y: number}[]} data */
export function train(data, { iters = 600, lr = 0.3, l2 = 0.02 } = {}) {
  const pos = data.filter((d) => d.y === 1).length;
  if (data.length < 10 || pos < 3 || data.length - pos < 3) return null;
  const k = data[0].x.length;
  const mu = new Array(k).fill(0), sd = new Array(k).fill(0);
  for (const d of data) d.x.forEach((v, i) => (mu[i] += v / data.length));
  for (const d of data) d.x.forEach((v, i) => (sd[i] += (v - mu[i]) ** 2 / data.length));
  for (let i = 0; i < k; i++) sd[i] = Math.sqrt(sd[i]) || 1;
  const X = data.map((d) => d.x.map((v, i) => (v - mu[i]) / sd[i]));
  // Balance classes so a session with mostly keepers does not learn "always keep"
  const wPos = data.length / (2 * pos), wNeg = data.length / (2 * (data.length - pos));
  let w = new Array(k).fill(0), b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(k).fill(0);
    let gb = 0;
    X.forEach((x, n) => {
      const y = data[n].y, wt = y ? wPos : wNeg;
      const e = (sigmoid(b + x.reduce((a, v, i) => a + v * w[i], 0)) - y) * wt;
      x.forEach((v, i) => (gw[i] += e * v));
      gb += e;
    });
    w = w.map((wi, i) => wi - lr * (gw[i] / X.length + l2 * wi));
    b -= lr * gb / X.length;
  }
  const model = { w, b, mu, sd, n: data.length };
  const acc = data.filter((d) => (predict(model, d.x) >= 0.5 ? 1 : 0) === d.y).length / data.length;
  return { ...model, acc };
}

export function predict(m, x) {
  return sigmoid(m.b + x.reduce((a, v, i) => a + ((v - m.mu[i]) / m.sd[i]) * m.w[i], 0));
}
