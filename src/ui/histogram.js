// @ts-check
import { $ } from "./dom.js";
import { S, SESSION } from "../app/state.js";
import { sharpThreshold } from "../core/scoring.js";

const PAD = 8, MIN = 0.5, MAX = 6, BINS = 44;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const xOf = (v, w) => PAD + ((Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN)) * (w - 2 * PAD);
const vOf = (x, w) => MIN + ((x - PAD) / (w - 2 * PAD)) * (MAX - MIN);

export function drawHist() {
  const cv = /** @type {HTMLCanvasElement} */ ($("#hist"));
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext("2d"));
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const top = 14, bottom = h - 16, bw = (w - 2 * PAD) / BINS;
  const bins = Array.from({ length: BINS }, () => ({ reject: 0, review: 0, keep: 0 }));
  for (const it of SESSION.items) {
    if (!it.ready || it.error || it.ev?.s == null) continue;
    const i = Math.min(BINS - 1, Math.max(0, Math.floor(((it.ev.s - MIN) / (MAX - MIN)) * BINS)));
    bins[i][it.verdict]++;
  }
  let peak = 1;
  for (const b of bins) peak = Math.max(peak, b.reject + b.review + b.keep);
  const col = { reject: css("--bad"), review: css("--doubt"), keep: css("--good") };
  bins.forEach((b, i) => {
    let y = bottom;
    for (const k of ["reject", "review", "keep"]) {
      if (!b[k]) continue;
      const bh = (b[k] / peak) * (bottom - top);
      c.fillStyle = col[k];
      c.fillRect(PAD + i * bw + 0.5, y - bh, Math.max(1, bw - 1), bh);
      y -= bh;
    }
  });
  c.fillStyle = css("--line"); c.fillRect(PAD, bottom, w - 2 * PAD, 1);
  c.font = "11px 'Instrument Sans', system-ui, sans-serif"; c.fillStyle = css("--ink-3"); c.textAlign = "center";
  for (let p = 1; p <= MAX; p++) c.fillText(p === MAX ? `${p}+ px` : String(p), xOf(p, w), h - 3);
  const x = Math.round(xOf(sharpThreshold(S), w)) + 0.5;
  c.strokeStyle = css("--ink"); c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x, top - 6); c.lineTo(x, bottom); c.stroke();
  c.fillStyle = css("--ink"); c.beginPath(); c.arc(x, top - 8, 4, 0, Math.PI * 2); c.fill();
}

/** @param {(v: number) => void} onChange @param {() => void} onEnd */
export function bindHist(onChange, onEnd) {
  const cv = /** @type {HTMLCanvasElement} */ ($("#hist"));
  let drag = false;
  const at = (e) => { const r = cv.getBoundingClientRect(); onChange(Math.round(vOf(Math.min(r.width - PAD, Math.max(PAD, e.clientX - r.left)), r.width) * 10) / 10); };
  cv.addEventListener("pointerdown", (e) => { drag = true; cv.setPointerCapture(e.pointerId); at(e); });
  cv.addEventListener("pointermove", (e) => { if (drag) at(e); });
  const end = () => { if (drag) { drag = false; onEnd(); } };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
}
