// @ts-check
/** Small shared helpers (no DOM). */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const logit = (p) => { const q = clamp(p, 1e-4, 1 - 1e-4); return Math.log(q / (1 - q)); };
export const stem = (name) => name.replace(/\.[^.]+$/, "");
export const extOf = (name) => (name.match(/\.[^./]+$/) || [""])[0].toLowerCase();

export function median(a) {
  if (!a.length) return NaN;
  const b = Float64Array.from(a).sort();
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
export function mean(a) { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : NaN; }

/** FNV-1a 32-bit, as hex. */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
export const pause = () => new Promise((r) => setTimeout(r, 0));
export const cmpNatural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
