// @ts-check
/** Client for the CLIP worker. */
import { modelConfig } from "./config.js";

let worker = null, ready = null, seq = 0;
const pending = new Map();
const files = new Map();
export const clipStatus = { state: "off", progress: 0, error: "", ms: 0, n: 0 };
let onChange = () => {};
export const onClipStatus = (fn) => { onChange = fn; };

function call(op, data, transfer = []) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    worker.postMessage({ id, op, ...data }, transfer);
  });
}

let loadedTier = null;
/** Starts the worker with the tier's model; a different tier restarts it with the new one. */
export function initClip(tier = "standard") {
  if (ready && loadedTier === tier) return ready;
  if (worker) { worker.terminate(); worker = null; for (const p of pending.values()) p.rej(new Error("model changed")); pending.clear(); files.clear(); }
  loadedTier = tier;
  ready = (async () => {
    const cfg = await modelConfig(tier);
    if (!cfg.clipModel) { clipStatus.state = "off"; onChange(); throw new Error("no-clip"); }
    worker = new Worker(new URL("../workers/clip.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.op === "progress") {
        files.set(m.file, [m.loaded || 0, m.total || 0]);
        let a = 0, b = 0;
        for (const [l, t] of files.values()) { a += l; b += t; }
        clipStatus.progress = b ? a / b : 0;
        onChange();
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.error ? p.rej(new Error(m.error)) : p.res(m.r);
    };
    worker.onerror = (e) => { clipStatus.state = "error"; clipStatus.error = e.message || "worker"; onChange(); };
    clipStatus.state = "loading"; onChange();
    await call("init", { cfg: { libUrl: cfg.transformers, wasmPaths: cfg.wasmPaths, model: cfg.clipModel, family: cfg.clipFamily, localModelPath: cfg.localModelPath } });
    clipStatus.state = "ready"; clipStatus.progress = 1; onChange();
  })().catch((e) => { const off = e?.message === "no-clip"; clipStatus.state = off ? "off" : "error"; clipStatus.error = off ? "" : String(e?.message || e); onChange(); throw e; });
  return ready;
}

/** @param {{key: string, clip: ImageData, subject: ImageData|null}[]} jobs */
export async function analyseClip(jobs, tier = loadedTier || "standard") {
  await initClip(tier);
  const t0 = performance.now(), r = await call("analyse", { jobs });
  clipStatus.ms += performance.now() - t0; clipStatus.n += jobs.length;
  return r;
}
