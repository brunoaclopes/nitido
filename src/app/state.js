// @ts-check
/** Global app state. Settings persist in localStorage; the session (manual decisions, group
 *  names, edits, personal model) persists per folder in IndexedDB. */
import { DEFAULTS as SCORING } from "../core/scoring.js";
import { GROUP_DEFAULTS } from "../core/grouping.js";
import { getSession, putSession } from "./store.js";
import { ORGANIZE_DEFAULTS } from "./organize.js";
import { debounce } from "../core/util.js";

const KEY = "nitido-v3";
const browserLang = (navigator.language || "en").toLowerCase().startsWith("pt") ? "pt" : "en";
export const DEFAULTS = {
  lang: browserLang,
  ...SCORING, ...GROUP_DEFAULTS,
  groupSort: "time", inGroupSort: "score", density: 220, showBoxes: true, showFaces: true, showMap: false,
  onlyBest: false, ai: { faces: true, objects: true, clip: true }, usePersonal: false,
  xmpReject: "one", keywords: true,
  organize: { ...ORGANIZE_DEFAULTS, destPath: "" },
};

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
export const S = { ...structuredClone(DEFAULTS), ...load() };
S.ai = { ...DEFAULTS.ai, ...(S.ai || {}) };
S.organize = { ...DEFAULTS.organize, ...(S.organize || {}) };
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {}
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
const persist = debounce(() => { if (SESSION.key) putSession(SESSION.key, SESSION.data); }, 400);
export function touchSession() { persist(); }
export async function loadSession(key) {
  const d = await getSession(key);
  SESSION.data = {
    manual: {}, groupNames: {}, edits: { detach: [], split: [], join: [] }, model: null,
    ...(d || {}),
  };
}

/** Tiny event bus. */
const handlers = new Map();
export const on = (ev, fn) => { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev).add(fn); };
export const emit = (ev, data) => { for (const fn of handlers.get(ev) || []) fn(data); };
