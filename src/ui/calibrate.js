// @ts-check
/** Guided calibration: a dozen photos around the current limit, each shown at 100% on its focus
 *  point, "sharp enough?" for each. The limit that best explains the answers becomes the sharpness
 *  limit (the same logistic curve the verdicts use). */
import { $, esc, fmtPx, fmtNum, urlOf } from "./dom.js";
import { t } from "../i18n/index.js";
import { S, saveSettings, emit } from "../app/state.js";
import { ready } from "../app/model.js";
import { sharpThreshold, SLOPE } from "../core/scoring.js";

const K = { open: false, list: [], i: 0, answers: [] };
export const calibState = K;
const N = 12;

/** Photos spread evenly in blur across [0.55·T, 1.7·T], one per step, judged on a real target. */
export function candidates(items, T, n = N) {
  const pool = items.filter((it) => it.ev?.s != null && it.ev.target && !it.ev.reasons.includes("eyes") && (it.loupes?.[it.ev.target.id] || it.loupes?.tile))
    .sort((a, b) => a.ev.s - b.ev.s);
  if (pool.length < 6) return [];
  const lo = Math.max(pool[0].ev.s, T * 0.55), hi = Math.min(pool[pool.length - 1].ev.s, T * 1.7);
  const used = new Set(), out = [];
  for (let k = 0; k < n; k++) {
    const want = lo + ((hi - lo) * k) / (n - 1);
    let best = null, bd = Infinity;
    for (const it of pool) if (!used.has(it) && Math.abs(it.ev.s - want) < bd) { bd = Math.abs(it.ev.s - want); best = it; }
    if (best) { used.add(best); out.push(best); }
  }
  // shuffle, so the answers are not a run from sharp to soft
  for (let i = out.length - 1; i > 0; i--) { const j = (i * 7 + 3) % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Limit that maximises the likelihood of the answers under p(sharp) = σ(SLOPE·(T − s)). */
export function fitLimit(answers) {
  const a = answers.filter((x) => x.y != null);
  if (a.length < 4 || a.every((x) => x.y) || a.every((x) => !x.y)) return null;
  let bestT = null, bestL = Infinity;
  for (let T = 0.8; T <= 4.0001; T += 0.05) {
    let L = 0;
    for (const { s, y } of a) { const z = SLOPE * (T - s); L += Math.log1p(Math.exp(y ? -z : z)); }
    if (L < bestL - 1e-9) { bestL = L; bestT = T; }
  }
  return Math.round(bestT * 20) / 20;
}

export function openCalibration() {
  K.list = candidates(ready(), sharpThreshold(S));
  if (!K.list.length) return false;
  K.i = 0; K.answers = []; K.open = true;
  $("#calib").hidden = false;
  render();
  return true;
}
export function closeCalibration() { K.open = false; $("#calib").hidden = true; }

function render() {
  const body = $("#calibBody");
  if (K.i >= K.list.length) { body.innerHTML = resultHTML(); return; }
  const it = K.list[K.i], key = it.ev.target.id;
  const src = urlOf(it, "loupe:" + key, it.loupes?.[key] || it.loupes?.tile);
  body.innerHTML = `<p class="hint">${esc(t("cal.lead"))}</p>
    <div class="cal-pic"><img src="${src}" alt=""><img class="cal-thumb" src="${urlOf(it, "thumb", it.thumbBlob)}" alt=""></div>
    <p class="cal-q">${esc(t("cal.q"))}</p>
    <div class="row-btns cal-btns">
      <button class="btn" data-y="0">${esc(t("cal.soft"))} <kbd>←</kbd></button>
      <button class="btn quiet" data-y="skip">${esc(t("cal.skip"))} <kbd>S</kbd></button>
      <button class="btn primary" data-y="1">${esc(t("cal.sharp"))} <kbd>→</kbd></button>
    </div>
    <div class="cal-foot"><div class="bar"><i style="width:${(K.i / K.list.length) * 100}%"></i></div><span class="num">${K.i + 1} / ${K.list.length}</span></div>`;
}

function resultHTML() {
  const T0 = sharpThreshold(S), T = fitLimit(K.answers);
  if (T == null) return `<p>${esc(t("cal.unclear"))}</p><div class="row-btns"><button class="btn" data-a="again">${esc(t("cal.again"))}</button><button class="btn quiet" data-a="close">${esc(t("lb.close"))}</button></div>`;
  K.result = T;
  return `<p class="cal-res">${esc(t("cal.result", { t: fmtPx(T), was: fmtPx(T0) }))}</p>
    <p class="hint">${esc(t("cal.resultHint", { n: K.answers.filter((a) => a.y != null).length }))}</p>
    <div class="row-btns"><button class="btn primary" data-a="apply">${esc(t("cal.apply"))}</button><button class="btn quiet" data-a="close">${esc(t("cal.keepOld"))}</button></div>`;
}

function answer(y) {
  const it = K.list[K.i];
  K.answers.push({ s: it.ev.s, y: y === "skip" ? null : !!y });
  K.i++;
  render();
}

/** @returns {boolean} whether the key was used */
export function calibKey(e) {
  const k = e.key.toLowerCase();
  if (k === "escape") { closeCalibration(); return true; }
  if (K.i >= K.list.length) return false;
  if (k === "arrowright" || k === "k") answer(1);
  else if (k === "arrowleft" || k === "j") answer(0);
  else if (k === "s") answer("skip");
  else return false;
  return true;
}

export function bindCalibration() {
  $("#calib").addEventListener("click", (e) => {
    const tgt = /** @type {HTMLElement} */ (e.target);
    if (tgt === $("#calib")) { closeCalibration(); return; }
    const y = tgt.closest("[data-y]");
    if (y) { const v = y.dataset.y; answer(v === "skip" ? "skip" : +v); return; }
    const a = tgt.closest("[data-a]")?.dataset.a;
    if (a === "close") closeCalibration();
    else if (a === "again") openCalibration();
    else if (a === "apply") {
      S.sharpPx = K.result; S.calib = { T: K.result, n: K.answers.length, at: Date.now() };
      saveSettings(); closeCalibration();
      emit("calibrated", { T: K.result, text: t("cal.applied", { t: fmtNum(K.result) }) });
    }
  });
}
