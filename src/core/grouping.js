// @ts-check
/** Groups similar photos.
 *  1. Split the timeline into scenes at long gaps.
 *  2. Inside each scene, average-linkage agglomerative clustering on a combined similarity:
 *     semantic (CLIP embeddings, when available), perceptual (hash + colour) and time proximity.
 *  3. Apply the user's manual edits (detach, join, split). */
import { clamp, cmpNatural } from "./util.js";
import { perceptualSim } from "./metrics.js";

export const GROUP_DEFAULTS = { groupMode: "similar", groupSim: 0.62, sceneGapMin: 10, burstGap: 1 };

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Image–image cosine of the current model at "different scenes" and at "same burst" (models differ). */
let SIM = [0.72, 0.98];
export const setEmbeddingScale = (range) => { SIM = range || [0.72, 0.98]; };

export function similarity(a, b) {
  const ps = perceptualSim(a.desc, b.desc);
  const dt = a.time != null && b.time != null ? Math.abs(a.time - b.time) / 1000 : 600;
  const ts = Math.exp(-dt / 90);
  let s;
  if (a.emb && b.emb) s = 0.55 * clamp((dot(a.emb, b.emb) - SIM[0]) / (SIM[1] - SIM[0]), 0, 1) + 0.25 * ps + 0.2 * ts;
  else s = 0.75 * ps + 0.25 * ts;
  if (a.desc && b.desc && a.desc.portrait !== b.desc.portrait) s *= 0.75;
  return s;
}

const byTime = (a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || cmpNatural(a.path, b.path);

/** Timeline scenes split at gaps longer than gapMs. */
export function scenes(items, gapMs) {
  const timed = items.filter((i) => i.time != null).sort(byTime);
  const out = [];
  let cur = [];
  for (const it of timed) {
    if (cur.length && it.time - cur[cur.length - 1].time > gapMs) { out.push(cur); cur = []; }
    cur.push(it);
  }
  if (cur.length) out.push(cur);
  const untimed = items.filter((i) => i.time == null).sort((a, b) => cmpNatural(a.path, b.path));
  if (untimed.length) out.push(untimed);
  return out;
}

/** Average-linkage agglomerative clustering (Lance–Williams update). */
export function cluster(members, threshold, sim = similarity) {
  const n = members.length;
  if (n < 2) return members.map((m) => [m]);
  const S = Array.from({ length: n }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) S[i][j] = S[j][i] = sim(members[i], members[j]);
  const size = new Array(n).fill(1), alive = new Array(n).fill(true);
  const sets = members.map((m) => [m]);
  for (;;) {
    let bi = -1, bj = -1, bs = threshold;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const row = S[i];
      for (let j = i + 1; j < n; j++) if (alive[j] && row[j] >= bs) { bs = row[j]; bi = i; bj = j; }
    }
    if (bi < 0) break;
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === bi || k === bj) continue;
      const v = (size[bi] * S[bi][k] + size[bj] * S[bj][k]) / (size[bi] + size[bj]);
      S[bi][k] = S[k][bi] = v;
    }
    size[bi] += size[bj]; alive[bj] = false;
    sets[bi] = sets[bi].concat(sets[bj]);
  }
  return sets.filter((_, i) => alive[i]);
}

/** Consecutive frames within gap seconds. */
export function bursts(items, gapS) {
  const timed = items.filter((i) => i.time != null).sort(byTime);
  const out = [];
  let cur = [];
  for (const it of timed) {
    if (cur.length && it.time - cur[cur.length - 1].time > gapS * 1000) { if (cur.length > 1) out.push(cur); cur = []; }
    cur.push(it);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Applies manual edits keyed by photo path. */
export function applyEdits(groups, edits) {
  if (!edits) return groups;
  const of = new Map();
  groups.forEach((g, i) => g.forEach((m) => of.set(m.path, i)));
  let sets = groups.map((g) => g.slice());
  for (const [a, b] of edits.join || []) {
    const ia = of.get(a), ib = of.get(b);
    if (ia == null || ib == null || ia === ib) continue;
    sets[ia] = sets[ia].concat(sets[ib]); sets[ib] = [];
    sets[ia].forEach((m) => of.set(m.path, ia));
  }
  const out = [];
  for (const g of sets) {
    if (!g.length) continue;
    g.sort(byTime);
    let cur = [];
    for (const m of g) {
      if ((edits.detach || []).includes(m.path)) { out.push([m]); continue; }
      if (cur.length && (edits.split || []).includes(m.path)) { out.push(cur); cur = []; }
      cur.push(m);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

/**
 * @param {any[]} items analysed photos (with desc, emb, time, path)
 * @param {any} S settings
 * @param {any} edits manual edits
 */
export function buildGroups(items, S, edits) {
  const sc = scenes(items, S.sceneGapMin * 60000);
  let groups = [];
  if (S.groupMode === "none") groups = items.map((i) => [i]);
  else if (S.groupMode === "scene") groups = sc;
  else if (S.groupMode === "burst") {
    const b = bursts(items, S.burstGap), inB = new Set(b.flat());
    groups = b.concat(items.filter((i) => !inB.has(i)).map((i) => [i]));
  } else {
    for (const scene of sc) {
      for (let k = 0; k < scene.length; k += 300) groups.push(...cluster(scene.slice(k, k + 300), S.groupSim));
    }
  }
  if (S.groupMode !== "none") groups = applyEdits(groups, edits);
  groups.forEach((g) => g.sort(byTime));
  groups.sort((a, b) => byTime(a[0], b[0]));
  const sceneOf = new Map();
  sc.forEach((s, i) => s.forEach((m) => sceneOf.set(m, i)));
  return {
    groups: groups.map((members, i) => ({
      id: i + 1, members, anchor: members[0].path, scene: sceneOf.get(members[0]) ?? 0,
      start: members[0].time, end: members[members.length - 1].time,
    })),
    scenes: sc.length,
  };
}
