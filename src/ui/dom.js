// @ts-check
import { getLang, t } from "../i18n/index.js";

export const $ = (s, r = document) => /** @type {HTMLElement} */ (r.querySelector(s));
export const $$ = (s, r = document) => /** @type {HTMLElement[]} */ ([...r.querySelectorAll(s)]);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function el(tag, attrs = {}, html = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v; else e.setAttribute(k, v === true ? "" : v);
  }
  if (html) e.innerHTML = html;
  return e;
}

const locale = () => (getLang() === "pt" ? "pt-PT" : "en-GB");
export const fmtNum = (v, d = 1) => v == null || Number.isNaN(v) ? "–" : v.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtPx = (v) => (v == null ? "–" : `${fmtNum(v)} px`);
export const fmtBytes = (b) => b >= 1e9 ? `${fmtNum(b / 1e9)} GB` : b >= 1e6 ? `${fmtNum(b / 1e6, 0)} MB` : `${fmtNum((b || 0) / 1e3, 0)} kB`;
export const fmtPct = (v) => (v == null ? "–" : `${Math.round(v * 100)}%`);
export const fmtShutter = (v) => (!v ? "–" : v < 1 ? `1/${Math.round(1 / v)} s` : `${+v.toFixed(1)} s`);
export const fmtTime = (ms) => ms == null ? "–" : new Date(ms).toLocaleTimeString(locale(), { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtDate = (ms) => ms == null ? "" : new Date(ms).toLocaleDateString(locale(), { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
export function fmtDuration(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return t("time.s", { n: s });
  const m = Math.floor(s / 60), r = s % 60;
  return r ? t("time.ms", { m, s: r }) : t("time.m", { m });
}

let toastTimer;
export function toast(msg, ms = 4800) {
  const n = $("#toast");
  n.textContent = msg;
  n.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.classList.remove("show"), ms);
}

/** Object URL for a cached blob, created once per photo and key. */
export function urlOf(it, key, blob) {
  if (!blob) return "";
  if (!it.urls[key]) it.urls[key] = URL.createObjectURL(blob);
  return it.urls[key];
}
export function revokeAll(items) {
  for (const it of items) for (const u of Object.values(it.urls || {})) URL.revokeObjectURL(/** @type {string} */ (u));
}

/** Box as percentage CSS, relative to the photo. */
export const pctBox = (it, b) => `left:${(b[0] / it.W) * 100}%;top:${(b[1] / it.H) * 100}%;width:${((b[2] - b[0]) / it.W) * 100}%;height:${((b[3] - b[1]) / it.H) * 100}%`;
