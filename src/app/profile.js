// @ts-check
/** A profile: your settings and your personal model in one JSON document. It can be saved to a file
 *  and loaded in another browser, or kept on a self-hosted server (sync.js). Settings that belong to
 *  this computer stay out: the AI tier picked for it, its measured speed, the gallery density and the
 *  NAS folder (a browser can only reach that through its own folder permission). */
import { S, DEFAULTS, saveSettings } from "./state.js";
import { taste, loadTaste, setSamples } from "./taste.js";

const MACHINE_ONLY = new Set(["tier", "rates", "density"]);
export const PROFILE_KIND = "nitido-profile";

/** The settings worth carrying to another browser. */
export function portable(s) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (MACHINE_ONLY.has(k) || !(k in s)) continue;
    const v = s[k], d = DEFAULTS[k];
    if (d !== null && typeof v !== typeof d) continue;
    out[k] = structuredClone(v);
  }
  if (out.organize) delete out.organize.destPath;
  return out;
}

/** Only well-formed training examples: { x: numbers, y: 0 or 1, s: shoot }. */
function cleanSamples(samples) {
  const out = {};
  for (const [k, v] of Object.entries(samples || {}))
    if (v && Array.isArray(v.x) && v.x.every((n) => typeof n === "number" && Number.isFinite(n)) && (v.y === 0 || v.y === 1)) out[k] = { x: v.x, y: v.y, s: String(v.s || "") };
  return out;
}

export async function snapshot(at = Date.now()) {
  await loadTaste();
  return { kind: PROFILE_KIND, version: 1, at, settings: portable(S), taste: { samples: taste.samples } };
}
export const isProfile = (p) => !!p && p.kind === PROFILE_KIND && typeof p.settings === "object" && !!p.settings && typeof p.taste?.samples === "object";
export const decisionsIn = (p) => Object.keys(cleanSamples(p.taste.samples)).length;

/** Applies a profile in this browser. With `add` (a file) its examples join this browser's; without
 *  (the server's copy, which is the reference) they replace them. */
export async function applyProfile(p, { add = false } = {}) {
  for (const [k, v] of Object.entries(portable(p.settings))) {
    S[k] = k === "ai" || k === "organize" ? { ...S[k], ...v } : v;
  }
  saveSettings();
  await setSamples(cleanSamples(p.taste.samples), { add });
}
