// @ts-check
/** Global app state. Settings persist in localStorage; the session (manual decisions, group
 *  names, edits, personal model) persists per folder in IndexedDB. */
import { DEFAULTS as SCORING } from "../core/scoring.js";
import { GROUP_DEFAULTS } from "../core/grouping.js";
import { getSession, putSession } from "./store.js";
import { ORGANIZE_DEFAULTS } from "./organize.js";

const KEY = "nitido-v3";
const browserLang = (navigator.language || "en").toLowerCase().startsWith("pt") ? "pt" : "en";
export const DEFAULTS = {
  lang: browserLang, theme: "dark",
  ...SCORING, ...GROUP_DEFAULTS,
  groupSort: "time", inGroupSort: "score", density: 220, showBoxes: true, showFaces: true, showMap: false,
  onlyBest: false, ai: { faces: true, objects: true, clip: true }, tier: null, usePersonal: false,
  xmpReject: "one", keywords: true,
  organize: { ...ORGANIZE_DEFAULTS, destPath: "" },
};

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
/** What the hosting server says (config.js): its defaults for a new browser, whether it keeps profiles,
 *  and which AI models it stores. Empty on GitHub Pages. */
export const SERVER = (() => {
  const c = /** @type {any} */ (globalThis).NITIDO || {};
  const d = c.defaults && typeof c.defaults === "object" ? c.defaults : {};
  // only settings the app knows, of the type it expects
  const defaults = Object.fromEntries(Object.entries(d).filter(([k, v]) => k in DEFAULTS && k !== "organize" && (DEFAULTS[k] === null || typeof v === typeof DEFAULTS[k])));
  if (d.organize && typeof d.organize === "object") defaults.organize = Object.fromEntries(Object.entries(d.organize).filter(([k, v]) => typeof v === typeof DEFAULTS.organize[k]));
  return { sync: !!c.sync, defaults, localTiers: Array.isArray(c.localTiers) ? c.localTiers : [], localOnly: !!c.localOnly };
})();
const saved = load();
export const S = { ...structuredClone(DEFAULTS), ...structuredClone(SERVER.defaults), ...saved };
S.ai = { ...DEFAULTS.ai, ...(S.ai || {}) };
S.organize = { ...DEFAULTS.organize, ...(SERVER.defaults.organize || {}), ...(saved.organize || {}) };
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {}
  emit("settings");
}
export function resetTuning() {
  for (const k of [...Object.keys(SCORING), ...Object.keys(GROUP_DEFAULTS)]) S[k] = structuredClone(DEFAULTS[k]);
  saveSettings();
}

/** Transient UI state. */
export const UI = {
  filter: { verdict: "all", reason: "all", extra: "all", search: "" },
  selection: new Set(),
  collapsed: new Set(),
  baseline: null,
};

/** Current session. */
export const SESSION = {
  key: "", name: "", dir: null, items: [], groups: [], scenes: 0, evals: new Map(), best: new Map(),
  data: { manual: {}, groupNames: {}, edits: { detach: [], split: [], join: [] }, model: null },
};
let saveTimer = 0;
const saveNow = () => {
  saveTimer = 0;
  if (!SESSION.key) return;
  SESSION.data.at = Date.now();
  putSession(SESSION.key, SESSION.data);
  remote.putSession?.(SESSION.key, SESSION.data);
};
/** A copy of each shoot's decisions on the hosting server, when it keeps profiles (sync.js fills this in). */
export const remote = {
  /** @type {null | ((key: string) => Promise<any>)} */ getSession: null,
  /** @type {null | ((key: string, data: any) => void)} */ putSession: null,
};
// saved straight after each change (a burst of changes in one go is one write): a refresh loses nothing
export function touchSession() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 0); }
/** Writes a pending save at once (before the page goes away). */
export function flushSession() { if (saveTimer) { clearTimeout(saveTimer); saveNow(); } }
export async function loadSession(key) {
  const [mine, theirs] = await Promise.all([getSession(key), remote.getSession?.(key).catch(() => null)]);
  // the newer copy wins: decisions made on another computer, or here since the last upload
  const d = theirs?.at > (mine?.at || 0) ? theirs : mine;
  SESSION.data = {
    manual: {}, groupNames: {}, edits: { detach: [], split: [], join: [] }, model: null,
    ...(d || {}),
  };
}

/** Tiny event bus. */
const handlers = new Map();
export const on = (ev, fn) => { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev).add(fn); };
export const emit = (ev, data) => { for (const fn of handlers.get(ev) || []) fn(data); };
