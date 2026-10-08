// @ts-check
/** Turns raw measurements into a verdict, reasons and a ranking score.
 *  Pure functions: every slider change re-runs this for all photos instantly. */
import { clamp, sigmoid, logit, median } from "./util.js";
import { contains, boxArea } from "./geometry.js";

/** Strictness presets: blur (full-size px) at which focus is 50% likely acceptable.
 *  Calibrated on X-H2 files: sharp frames read 0.7–1.4 px, visibly soft ones 2 px and up. */
export const STRICTNESS = { relaxed: 2.1, normal: 1.7, strict: 1.4 };

export const DEFAULTS = {
  strictness: "normal", sharpPx: null, missRatio: 1.8, blinkThr: 0.5, eyesRule: "key", rejectEyes: true,
  exposureCheck: true, motionAniso: 1.7, bokehPct: 50, softerRatio: 1.5, clipWeight: 0.2,
};
/** Steepness of p(in focus) = σ(SLOPE·(limit − blur)), per pixel of blur. */
export const SLOPE = 3.2;
export const sharpThreshold = (S) => S.sharpPx ?? STRICTNESS[S.strictness] ?? STRICTNESS.normal;

/** Smile at which narrowed eyes are read as laughing, and the blink level that still counts as shut. */
const SMILE = 0.6, SHUT = 0.9;
/** Coarse-blur ratio to a similar neighbouring frame that flags shake. */
const SHAKE_RATIO = 1.6;

/** Order in which focus evidence is trusted. */
const PRIORITY = ["eye", "face", "camEye", "camFace", "af", "camSubject", "subject"];

/** Main faces (ignores small background faces) and the key face. */
export function faceSummary(item, S) {
  const faces = item.faces || [];
  if (!faces.length) return { count: 0, main: [], key: null };
  const imgArea = item.W * item.H;
  const maxA = Math.max(...faces.map((f) => boxArea(f.box)));
  const main = faces.filter((f) => boxArea(f.box) >= maxA * 0.25 && boxArea(f.box) >= imgArea * 0.0012);
  let key = main.reduce((a, f) => (boxArea(f.box) > boxArea(a.box) ? f : a), main[0]);
  if (item.af) { const hit = main.find((f) => contains(f.box, item.af[0], item.af[1])); if (hit) key = hit; }
  const thr = S.blinkThr;
  const state = (f) => {
    const frontal = Math.abs(f.yaw ?? 0) < 0.65;
    const l = f.blinkL ?? 0, r = f.blinkR ?? 0;
    // A broad smile narrows the eyes (Duchenne squint) and the face model reads it as a blink.
    // Laughing eyes count as closed only when both are fully shut.
    const laughing = (f.smile ?? 0) >= SMILE && Math.min(l, r) < SHUT;
    const closed = frontal && l > thr && r > thr && !laughing;
    const squint = frontal && l > thr && r > thr && laughing;
    const partial = !closed && !squint && frontal && Math.max(l, r) > thr;
    const open = 1 - Math.max(l, r) * (frontal ? 1 : 0.5);
    return { closed, partial, squint, open: squint ? Math.max(open, 0.6) : open };
  };
  const st = new Map(main.map((f) => [f, state(f)]));
  return {
    count: faces.length, main, key, st,
    keyClosed: key ? st.get(key).closed : false,
    anyClosed: main.some((f) => st.get(f).closed),
    anyPartial: main.some((f) => st.get(f).partial),
    keySquint: key ? st.get(key).squint : false,
    openScore: key ? (S.eyesRule === "all" ? Math.min(...main.map((f) => st.get(f).open)) : st.get(key).open) : 1,
    smile: key ? key.smile ?? 0 : 0,
  };
}

/** Picks the focus evidence to judge: the key face's eyes first, the AF point, then subjects. */
export function deriveFocus(item, fs) {
  const ts = (item.targets || []).filter((t) => t.s != null);
  for (const kind of PRIORITY) {
    let cand = ts.filter((t) => t.kind === kind);
    if (kind === "eye" || kind === "face") {
      if (!fs.key) continue;
      cand = cand.filter((t) => t.face === fs.key.id);
    }
    if (!cand.length) continue;
    const t = cand.reduce((a, c) => (c.s < a.s ? c : a));
    return { kind, s: t.s, target: t };
  }
  return null;
}

/**
 * @param {any} item analysed photo
 * @param {any} S settings
 * @param {{groupBest?: number|null, personal?: any, coarseRef?: number}} ctx
 */
export function evaluate(item, S, ctx = {}) {
  const T = sharpThreshold(S);
  const fs = faceSummary(item, S);
  const focus = deriveFocus(item, fs);
  const best = item.best ? item.best.s : null;
  const s = focus ? focus.s : best;
  const reasons = [], tags = [];
  const cells = item.cells ? item.cells.cells : [];
  const softFrac = cells.length ? cells.filter((c) => !c || c.s > T).length / cells.length : 0;
  const sharpFrac = cells.length ? cells.filter((c) => c && c.s <= T).length / cells.length : 0;

  let pA = s == null ? 0.5 : sigmoid(SLOPE * (T - s));
  const clipS = item.clip ? item.clip.subjectSharp ?? item.clip.sharp : null;
  let p = clipS == null || s == null ? pA : sigmoid((1 - S.clipWeight) * logit(pA) + S.clipWeight * logit(clipS));

  const an = focus?.target?.a ?? null;
  const cellAn = cells.filter((c) => c && c.a).map((c) => c.a);
  const motion = (an != null && an >= S.motionAniso) || (cellAn.length >= 6 && median(cellAn) >= S.motionAniso);

  if (s == null) reasons.push("nodetail");
  else if (p < 0.3) {
    if (focus && best != null && best <= T * 0.9 && s / best >= S.missRatio) reasons.push("missed");
    else if (motion) reasons.push("motion");
    else reasons.push("blur");
  }
  if (fs.key) {
    if (S.eyesRule === "all" ? fs.anyClosed : fs.keyClosed) reasons.push("eyes");
    else if (fs.anyPartial) reasons.push("blink");
  }
  const ex = item.exposure;
  let exScore = 1;
  if (ex && S.exposureCheck) {
    if (ex.hiClip > 0.04) reasons.push("over");
    else if (ex.loClip > 0.18 || ex.mean < 32) reasons.push("under");
    exScore = clamp(1 - ex.hiClip * 10 - Math.max(0, ex.loClip - 0.05) * 3 - Math.abs(ex.p50 - 118) / 340, 0, 1);
  }
  let rel = 1;
  if (ctx.groupBest && s != null) {
    rel = s / ctx.groupBest;
    if (rel >= S.softerRatio && s > T * 0.75 && !reasons.some((r) => r === "blur" || r === "missed" || r === "motion")) reasons.push("softer");
  }
  // Shake that grain hides: much softer at the coarse scale than a similar frame shot moments apart
  const shakeRel = ctx.coarseRef && item.coarse ? item.coarse / ctx.coarseRef : 1;
  if (shakeRel >= SHAKE_RATIO && item.coarse >= 1.8 && !reasons.some((r) => r === "blur" || r === "missed" || r === "motion" || r === "softer")) reasons.push("shake");
  if (item.sigma > 5.5) tags.push("noise");
  if (p >= 0.6 && focus && softFrac * 100 >= S.bokehPct) tags.push("bokeh");
  else if (p >= 0.6 && sharpFrac >= 0.6) tags.push("sharpAll");
  if (fs.key && fs.smile > 0.45) tags.push(fs.keySquint ? "laughing" : "smile");
  // The X-H2 sets its shake warning on many sharp frames, so it is shown only when the measurement agrees
  if (item.meta?.focusWarning === 1 || (item.meta?.blurWarning === 1 && p < 0.6)) tags.push("camWarn");

  const breakdown = {
    sharp: 45 * p,
    eyes: 20 * (fs.key ? fs.openScore : 1),
    expression: 8 * (fs.key ? 0.5 + 0.5 * clamp(fs.smile, 0, 1) : 0.6),
    exposure: 10 * exScore,
    quality: 12 * (item.clip?.quality ?? 0.5),
    noise: 5 * (1 - clamp((item.sigma - 1.5) / 5, 0, 1)),
    relative: -15 * clamp((rel - 1) / 0.8, 0, 1),
  };
  let score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (reasons.includes("eyes")) score *= 0.5;
  score = clamp(score, 0, 100);

  const hard = ["blur", "motion", "missed"].some((r) => reasons.includes(r)) || (S.rejectEyes && reasons.includes("eyes"));
  let verdict = hard ? "reject" : p < 0.6 || reasons.some((r) => ["blink", "over", "under", "softer", "shake", "nodetail", "eyes"].includes(r)) ? "review" : "keep";
  let pKeep = null;
  if (ctx.personal) {
    pKeep = ctx.personal(item, { p, s, fs, rel, motion, exScore });
    verdict = pKeep < 0.35 ? "reject" : pKeep < 0.6 ? "review" : "keep";
  }
  return { p, pA, s, T, kind: focus ? focus.kind : best != null ? "tile" : null, target: focus?.target ?? null,
    best, rel, shakeRel, motion, softFrac, sharpFrac, reasons, tags, verdict, score, breakdown, faces: fs, pKeep };
}

/** Best photo of a group: highest score among non-rejects; a manual pick always wins. */
export function pickBest(members, evals) {
  const picks = members.filter((m) => m.manual?.flag === "pick");
  if (picks.length) return picks.reduce((a, m) => (evals.get(m).score > evals.get(a).score ? m : a));
  const ok = members.filter((m) => m.manual?.flag !== "reject" && evals.get(m).verdict !== "reject");
  const pool = ok.length ? ok : members;
  return pool.reduce((a, m) => (evals.get(m).score > evals.get(a).score ? m : a));
}

/** Final verdict after manual flags. */
export const finalVerdict = (item, ev) => item.manual?.flag === "pick" ? "keep" : item.manual?.flag === "reject" ? "reject" : ev.verdict;
