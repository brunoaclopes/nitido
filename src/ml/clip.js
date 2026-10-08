// @ts-check
/** Client for the CLIP worker. */
import { modelConfig } from "./config.js";

let worker = null, ready = null, seq = 0;
const pending = new Map();
const files = new Map();
export const clipStatus = { state: "off", progress: 0, error: "" };
let onChange = () => {};
export const onClipStatus = (fn) => { onChange = fn; };

function call(op, data, transfer = []) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    worker.postMessage({ id, op, ...data }, transfer);
  });
}

export function initClip() {
  if (ready) return ready;
  ready = (async () => {
    const cfg = await modelConfig();
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
    await call("init", { cfg: { libUrl: cfg.transformers, model: cfg.clipModel, localModelPath: cfg.localModelPath } });
    clipStatus.state = "ready"; clipStatus.progress = 1; onChange();
  })().catch((e) => { clipStatus.state = "error"; clipStatus.error = String(e?.message || e); onChange(); throw e; });
  return ready;
}

/** @param {{key: string, clip: ImageData, subject: ImageData|null}[]} jobs */
export async function analyseClip(jobs) {
  await initClip();
  return call("analyse", { jobs });
}
