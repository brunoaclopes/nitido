// @ts-check
/** The personal model, across every shoot: each Keep or Reject made by hand becomes a training
 *  example (the same signals the rules use), and the model is retrained after each change.
 *  "Reject the rest of the group" decisions are left out: those frames are redundant, not bad. */
import { featuresOf, train } from "../core/learn.js";
import { getMeta, putMeta } from "./store.js";
import { S, SESSION, saveSettings, emit } from "./state.js";
import { debounce } from "../core/util.js";

const T = { samples: /** @type {Record<string, {x: number[], y: number, s: string}>} */ ({}), model: null, loaded: false };
export const taste = T;
const AUTO_N = 30, AUTO_ACC = 0.85;

export async function loadTaste() {
  if (T.loaded) return;
  const d = await getMeta("taste").catch(() => null);
  T.samples = d?.samples || {};
  T.loaded = true;
  retrain();
}
const save = debounce(() => { putMeta("taste", { samples: T.samples }).catch(() => {}); emit("taste"); }, 800);

/** Replaces the examples (a profile loaded from a file or from the server), or adds to them. */
export async function setSamples(samples, { add = false } = {}) {
  await loadTaste();
  T.samples = add ? { ...T.samples, ...samples } : { ...samples };
  await putMeta("taste", { samples: T.samples }).catch(() => {});
  retrain();
}

export function featuresFor(it) {
  const ev = it.ev;
  return featuresOf(it, { p: ev.p, s: ev.s, fs: ev.faces, rel: ev.rel, motion: ev.motion, exScore: ev.breakdown.exposure / 10 });
}

/** Records (or forgets) the hand decisions on these photos. Returns true when the model changed. */
export function record(items) {
  let changed = false;
  for (const it of items) {
    if (!it.ev) continue;
    const key = `${SESSION.key}|${it.path}`, flag = it.manual?.flag;
    if ((flag === "pick" || flag === "reject") && it.manual?.why !== "group") { T.samples[key] = { x: featuresFor(it), y: flag === "pick" ? 1 : 0, s: SESSION.key }; changed = true; }
    else if (T.samples[key]) { delete T.samples[key]; changed = true; }
  }
  if (changed) { save(); retrain(); }
  return changed;
}

export function retrain() {
  const data = Object.values(T.samples).map(({ x, y }) => ({ x: x.slice(), y }));
  T.model = train(data);
  SESSION.data.model = T.model;
  return T.model;
}

/** Turns the model on by itself once it has enough examples and agrees with them; once only. */
export function maybeAutoEnable() {
  const m = T.model;
  if (S.tasteAuto || S.usePersonal || !m || m.n < AUTO_N || m.acc < AUTO_ACC) return false;
  S.usePersonal = true; S.tasteAuto = true; saveSettings();
  return true;
}

export function stats() {
  const v = Object.values(T.samples);
  return { n: v.length, kept: v.filter((s) => s.y).length, sessions: new Set(v.map((s) => s.s)).size, model: T.model };
}

export async function forget() {
  T.samples = {}; T.model = null; SESSION.data.model = null;
  S.usePersonal = false; saveSettings();
  await putMeta("taste", { samples: {} }).catch(() => {});
  emit("taste");
}
