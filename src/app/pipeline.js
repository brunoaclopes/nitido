// @ts-check
/** Orchestrates the analysis of a folder:
 *  decode (worker) → faces + subjects (main thread) → measure focus targets at 100% (worker)
 *  → CLIP embeddings and quality (worker, in the background) → cache. */
import { extOf, cmpNatural } from "../core/util.js";
import { afPoint, cameraElements, around, clampBox, grow, iou, boxArea, contains, boxCenter } from "../core/geometry.js";
import { getCache, putCache, cacheKey } from "./store.js";
import { S, SESSION } from "./state.js";
import { initVision, detectFaces, detectObjects } from "../ml/vision.js";
import { initClip, analyseClip, clipStatus } from "../ml/clip.js";
import { tierOf } from "../ml/tiers.js";

const MEM = /** @type {any} */ (navigator).deviceMemory || 4, HC = navigator.hardwareConcurrency || 4;
const POOL = Math.max(1, Math.min(MEM >= 8 ? 2 : 1, Math.floor(HC / 2)));

class PixelWorker {
  constructor() { this.seq = 0; this.pending = new Map(); this.spawn(); }
  spawn() {
    this.w = new Worker(new URL("../workers/pixel.worker.js", import.meta.url), { type: "module" });
    this.w.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id); clearTimeout(p.t);
      e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.r);
    };
    this.w.onerror = (e) => { e.preventDefault?.(); this.fail("worker-crashed"); };
  }
  fail(msg) {
    for (const p of this.pending.values()) { clearTimeout(p.t); p.rej(new Error(msg)); }
    this.pending.clear();
    this.w.terminate(); this.spawn();
  }
  call(op, data, transfer = [], ms = 120000) {
    return new Promise((res, rej) => {
      const id = ++this.seq;
      const t = setTimeout(() => this.fail("timeout"), ms);
      this.pending.set(id, { res, rej, t });
      this.w.postMessage({ id, op, ...data }, transfer);
    });
  }
}
let POOL_WORKERS = null;
async function pool() {
  if (POOL_WORKERS) return POOL_WORKERS;
  const ws = Array.from({ length: POOL }, () => new PixelWorker());
  const ok = await Promise.all(ws.map((w) => w.call("ping", {}, [], 5000).catch(() => false)));
  if (!ok.some(Boolean)) throw new Error("workers-unavailable");
  POOL_WORKERS = ws.filter((_, i) => ok[i]);
  return POOL_WORKERS;
}

/** Builds the photo list: JPEGs, with their RAF; RAF-only files use the embedded preview. */
export function buildItems(list) {
  const jpgs = [], rafs = new Map();
  for (const e of list) {
    const ext = extOf(e.path), key = e.path.slice(0, e.path.length - ext.length).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") jpgs.push({ ...e, key });
    else if (ext === ".raf") rafs.set(key, e);
  }
  const items = jpgs.map((e) => ({ path: e.path, name: e.file.name, file: e.file, raf: rafs.get(e.key)?.file.name || "", rafFile: rafs.get(e.key)?.file || null, isRaf: false }));
  const jk = new Set(jpgs.map((e) => e.key));
  for (const [k, e] of rafs) if (!jk.has(k)) items.push({ path: e.path, name: e.file.name, file: e.file, raf: e.file.name, isRaf: true });
  items.sort((a, b) => cmpNatural(a.path, b.path));
  return items.map((it, i) => ({ ...it, idx: i, ready: false, error: null, manual: null, urls: {} }));
}

/** Focus targets to measure at full resolution. */
function planFor(it, faces, objects, cam) {
  const { W, H } = it, targets = [], closeups = [];
  const main = faces.slice().sort((a, b) => boxArea(b.box) - boxArea(a.box)).slice(0, 4);
  for (const f of main) {
    const inner = grow(f.box, 0.7, W, H);
    if (inner) targets.push({ id: `face:${f.id}`, kind: "face", face: f.id, box: inner });
    f.eyes.forEach((e, k) => { const b = clampBox(e.box[0], e.box[1], e.box[2], e.box[3], W, H); if (b) targets.push({ id: `eye:${f.id}:${k}`, kind: "eye", face: f.id, box: b }); });
    closeups.push({ id: f.id, box: f.box });
  }
  for (const [k, c] of cam.entries()) {
    if (c.kind !== "subject" && main.some((f) => iou(f.box, c.box) > 0.2 || contains(f.box, ...boxCenter(c.box)))) continue;
    const kind = c.kind === "eye" ? "camEye" : c.kind === "face" ? "camFace" : "camSubject";
    const b = c.kind === "eye" ? grow(c.box, 1.6, W, H, 48) : c.box;
    if (b) targets.push({ id: `cam:${k}`, kind, box: b });
  }
  if (it.af) {
    const b = around(it.af[0], it.af[1], Math.max(110, 0.035 * Math.min(W, H)), W, H);
    if (b) targets.push({ id: "af", kind: "af", box: grow(b, 2, W, H) || b });
  }
  const subj = objects.filter((o) => o.label !== "person" && o.score >= 0.4 && boxArea(o.box) >= W * H * 0.02)
    .sort((a, b) => boxArea(b.box) - boxArea(a.box)).slice(0, 2);
  if (!faces.length) {
    const p = objects.filter((o) => o.label === "person" && o.score >= 0.45).sort((a, b) => boxArea(b.box) - boxArea(a.box))[0];
    if (p) subj.push({ ...p, box: [p.box[0], p.box[1], p.box[2], p.box[1] + (p.box[3] - p.box[1]) * 0.4] });
  }
  subj.forEach((o, k) => { const b = clampBox(o.box[0], o.box[1], o.box[2], o.box[3], W, H); if (b) targets.push({ id: `subj:${k}`, kind: "subject", label: o.label, box: b }); });
  return { targets, closeups };
}

async function imageDataToBlob(im) {
  if (!im) return null;
  const c = new OffscreenCanvas(im.width, im.height);
  /** @type {any} */ (c.getContext("2d")).putImageData(im, 0, 0);
  return c.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}
export async function blobToImageData(b) {
  const bmp = await createImageBitmap(b);
  const c = new OffscreenCanvas(bmp.width, bmp.height), x = /** @type {any} */ (c.getContext("2d"));
  x.drawImage(bmp, 0, 0); bmp.close();
  return x.getImageData(0, 0, c.width, c.height);
}

const CACHED = ["meta", "time", "W", "H", "exposure", "desc", "faces", "objects", "af", "sigma", "coarse", "cells", "best", "targets",
  "thumbBlob", "loupes", "closeups", "clip", "emb", "clipIn", "subjIn"];
const snapshot = (it) => Object.fromEntries(CACHED.map((k) => [k, it[k] ?? null]));

async function analyse(it, w) {
  const key = cacheKey(it.path, it.file, S.tier);
  const hit = await getCache(key);
  if (hit) { Object.assign(it, hit); return { cached: true, key }; }
  const d = await w.call("decode", { key, file: it.file, isRaf: it.isRaf });
  Object.assign(it, { meta: d.meta, time: d.time, W: d.W, H: d.H, exposure: d.exposure, desc: d.desc, thumbBlob: d.thumb });
  const toFull = (x, y) => [x / d.smallScale, y / d.smallScale];
  let faces = [], objects = [];
  try {
    if (S.ai.faces || S.ai.objects) await initVision({ ...S.ai, tier: S.tier });
    if (S.ai.faces) faces = detectFaces(d.small, toFull);
    if (S.ai.objects) objects = detectObjects(d.small, toFull);
    // People too small for the face model at 1920 px: look again at full resolution
    if (S.ai.faces) {
      const people = objects.filter((o) => o.label === "person" && o.box[3] - o.box[1] >= 0.1 * d.H
        && !faces.some((f) => contains(o.box, ...boxCenter(f.box)))).slice(0, tierOf(S.tier).people);
      for (const [i, p] of people.entries()) {
        const region = clampBox(p.box[0], p.box[1], p.box[2], p.box[1] + (p.box[3] - p.box[1]) * 0.45, d.W, d.H);
        if (!region) continue;
        const c = await w.call("crop", { key, box: region, maxSide: 1280 }).catch(() => null);
        if (!c) continue;
        faces.push(...detectFaces(c.bitmap, (x, y) => [region[0] + x / c.scale, region[1] + y / c.scale], `p${i}_`));
        c.bitmap.close();
      }
    }
  } finally { d.small.close(); }
  faces = faces.filter((f, i) => !faces.some((g, j) => j !== i && iou(f.box, g.box) > 0.4 && boxArea(g.box) > boxArea(f.box)));
  it.faces = faces.map((f) => ({ ...f, box: clampBox(f.box[0], f.box[1], f.box[2], f.box[3], d.W, d.H, 4) || f.box }));
  it.objects = objects;
  it.af = afPoint(d.meta, d.W, d.H);
  const plan = planFor(it, it.faces, objects, cameraElements(d.meta, d.W, d.H));
  const m = await w.call("measure", { key, plan: { ...plan, meta: d.meta } });
  const byId = new Map(plan.targets.map((t) => [t.id, t]));
  Object.assign(it, {
    sigma: m.sigma, coarse: m.coarse, cells: m.cells, best: m.best, loupes: m.loupes, closeups: m.closeups,
    targets: m.targets.map((t) => ({ ...t, face: byId.get(t.id)?.face, label: byId.get(t.id)?.label })),
  });
  it.clipIn = await imageDataToBlob(d.clip);
  it.subjIn = await imageDataToBlob(m.subject224);
  return { cached: false, key };
}

/* ---------- CLIP, in the background ---------- */
let clipChain = Promise.resolve();
function queueClip(it, key, onUpdate, token) {
  if (!S.ai.clip || it.emb || !it.clipIn || clipStatus.state === "error") { putCache(key, snapshot(it)); return; }
  clipChain = clipChain.then(async () => {
    if (token !== RUN.token) return;
    try {
      const [res] = await analyseClip([{ key, clip: await blobToImageData(it.clipIn), subject: it.subjIn ? await blobToImageData(it.subjIn) : null }], S.tier);
      it.emb = res.emb;
      it.clip = { quality: res.quality, sharp: res.sharp, subjectSharp: res.subjectSharp, label: res.label };
      onUpdate(it, "clip");
    } catch {}
    putCache(key, snapshot(it));
  });
}

export const RUN = { token: 0, running: false };

/**
 * @param {any[]} items
 * @param {{onItem: Function, onProgress: Function, onPhase: Function, onDone: Function}} hooks
 */
export async function run(items, hooks) {
  const token = ++RUN.token;
  RUN.running = true;
  hooks.onPhase("prep");
  const workers = await pool();
  if (S.ai.clip) initClip(S.tier).catch(() => {});
  if (S.ai.faces || S.ai.objects) initVision({ ...S.ai, tier: S.tier }).catch(() => {});
  const todo = items.filter((i) => !i.ready);
  let next = 0, done = 0, cached = 0;
  const t0 = performance.now();
  const busy = new Set();
  hooks.onPhase("analyse");
  await Promise.all(workers.map(async (w) => {
    while (RUN.token === token && next < todo.length) {
      const it = todo[next++];
      busy.add(it); hooks.onProgress({ done, total: todo.length, busy: [...busy], t0, cached });
      let key = null;
      try { const r = await analyse(it, w); key = r.key; if (r.cached) cached++; }
      catch (e) { it.error = String(e?.message || e); }
      busy.delete(it);
      if (RUN.token !== token) return;
      it.ready = true;
      done++;
      hooks.onItem(it);
      hooks.onProgress({ done, total: todo.length, busy: [...busy], t0, cached });
      if (key && !it.error) queueClip(it, key, hooks.onItem, token);
    }
  }));
  if (RUN.token !== token) return;
  RUN.running = false;
  hooks.onDone({ done, total: todo.length, secs: (performance.now() - t0) / 1000, cached });
  clipChain.then(() => { if (RUN.token === token) hooks.onClipDone?.(); });
}
export function stop() { RUN.token++; RUN.running = false; }
