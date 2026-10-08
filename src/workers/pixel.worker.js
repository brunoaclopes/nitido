// @ts-check
/// <reference lib="webworker" />
import { decode, measure, crop } from "../core/pixels.js";

/** Decoded full-resolution bitmaps waiting for measure(), by photo key. */
const held = new Map();
const post = (msg, transfer = []) => /** @type {any} */ (self).postMessage(msg, transfer);

self.onmessage = async (e) => {
  const { id, op, key } = e.data;
  try {
    if (op === "ping") {
      post({ id, r: typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap === "function" });
    } else if (op === "decode") {
      const r = await decode(e.data.file, e.data.isRaf);
      held.set(key, r.bmp);
      delete r.bmp;
      post({ id, r }, [r.small]);
    } else if (op === "crop") {
      const bmp = held.get(key);
      if (!bmp) throw new Error("not-decoded");
      const r = await crop(bmp, e.data.box, e.data.maxSide);
      post({ id, r }, [r.bitmap]);
    } else if (op === "measure") {
      const bmp = held.get(key);
      if (!bmp) throw new Error("not-decoded");
      try { post({ id, r: await measure(bmp, e.data.plan) }); }
      finally { bmp.close(); held.delete(key); }
    } else if (op === "release") {
      held.get(key)?.close(); held.delete(key);
      post({ id, r: true });
    }
  } catch (err) {
    post({ id, error: String((err && err.message) || err) });
  }
};
