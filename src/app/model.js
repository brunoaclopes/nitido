// @ts-check
/** Derived data, recomputed whenever settings or decisions change (milliseconds for 1000 photos). */
import { evaluate, pickBest, finalVerdict } from "../core/scoring.js";
import { buildGroups, similarity } from "../core/grouping.js";
import { featuresOf, train, predict } from "../core/learn.js";
import { S, SESSION, touchSession, emit } from "./state.js";
import { t } from "../i18n/index.js";

export const ready = () => SESSION.items.filter((i) => i.ready && !i.error);

export function manualOf(it) { return SESSION.data.manual[it.path] || null; }
export function setManual(items, patch) {
  for (const it of items) {
    const cur = { ...(SESSION.data.manual[it.path] || {}), ...patch };
    for (const k of Object.keys(cur)) if (cur[k] == null) delete cur[k];
    if (Object.keys(cur).length) SESSION.data.manual[it.path] = cur; else delete SESSION.data.manual[it.path];
    it.manual = SESSION.data.manual[it.path] || null;
  }
  touchSession();
}

function personalPredictor() {
  const m = SESSION.data.model;
  if (!S.usePersonal || !m) return undefined;
  return (item, x) => predict(m, featuresOf(item, x));
}

/** For each photo, the crispest coarse blur among similar frames shot within 20 s (shake check). */
export function coarseRefs(items, windowMs = 20000, minSim = 0.45) {
  const timed = items.filter((i) => i.time != null && i.coarse > 0.3).sort((a, b) => a.time - b.time), out = new Map();
  let lo = 0;
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i];
    while (timed[lo].time < a.time - windowMs) lo++;
    let ref = null;
    for (let j = lo; j < timed.length && timed[j].time <= a.time + windowMs; j++) {
      const b = timed[j];
      if (b === a || (ref != null && b.coarse >= ref)) continue;
      if (similarity(a, b) >= minSim) ref = b.coarse;
    }
    if (ref != null) out.set(a, ref);
  }
  return out;
}

/** Re-evaluates every photo; regroups when asked (similarity settings or edits changed). */
export function recompute({ regroup = false } = {}) {
  const items = ready();
  for (const it of SESSION.items) it.manual = manualOf(it);
  if (regroup || !SESSION.groups.length) {
    const { groups, scenes } = buildGroups(items, S, SESSION.data.edits);
    SESSION.groups = groups; SESSION.scenes = scenes;
  }
  const groupOf = new Map();
  for (const g of SESSION.groups) for (const m of g.members) groupOf.set(m, g);
  const personal = personalPredictor();
  if (regroup || !SESSION.coarseRefs) SESSION.coarseRefs = coarseRefs(items);
  const refs = SESSION.coarseRefs;
  const first = new Map(items.map((it) => [it, evaluate(it, S, { coarseRef: refs.get(it) })]));
  const evals = new Map();
  for (const g of SESSION.groups) {
    const ss = g.members.map((m) => first.get(m)?.s).filter((v) => v != null);
    const groupBest = g.members.length > 1 && ss.length ? Math.min(...ss) : null;
    for (const m of g.members) evals.set(m, evaluate(m, S, { groupBest, personal, coarseRef: refs.get(m) }));
  }
  for (const it of items) if (!evals.has(it)) evals.set(it, first.get(it));
  SESSION.evals = evals;
  SESSION.best = new Map();
  for (const g of SESSION.groups) {
    g.best = g.members.length > 1 ? pickBest(g.members, evals) : g.members[0];
    for (const m of g.members) SESSION.best.set(m, g.members.length > 1 && m === g.best);
    g.name = SESSION.data.groupNames[g.anchor] || autoName(g);
  }
  for (const it of items) {
    it.group = groupOf.get(it) || null;
    it.ev = evals.get(it);
    it.verdict = finalVerdict(it, it.ev);
    it.isBest = !!SESSION.best.get(it);
  }
  emit("computed", { regroup });
}

export function autoName(g) {
  const counts = new Map();
  for (const m of g.members) if (m.clip?.label) counts.set(m.clip.label, (counts.get(m.clip.label) || 0) + 1);
  let label = null, n = 0;
  for (const [k, v] of counts) if (v > n) { label = k; n = v; }
  const time = g.start != null ? new Date(g.start).toISOString().slice(11, 16) : "";
  return label ? `${t("label." + label)}${time ? " · " + time : ""}` : `${t("group.default", { n: g.id })}${time ? " · " + time : ""}`;
}

/** Trains the personal model on photos the user decided by hand. */
export function trainPersonal() {
  const data = [];
  for (const it of ready()) {
    const flag = it.manual?.flag;
    if (flag !== "pick" && flag !== "reject") continue;
    const ev = it.ev;
    data.push({ x: featuresOf(it, { p: ev.p, s: ev.s, fs: ev.faces, rel: ev.rel, motion: ev.motion, exScore: ev.breakdown.exposure / 10 }), y: flag === "pick" ? 1 : 0 });
  }
  const m = train(data);
  SESSION.data.model = m;
  touchSession();
  return { model: m, n: data.length };
}
