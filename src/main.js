// @ts-check
import { setLang, applyI18n, t, getLang } from "./i18n/index.js";
import { S, SESSION, UI, saveSettings, resetTuning, loadSession, touchSession, flushSession, on, emit } from "./app/state.js";
import { captureDrop, readDrop, readHandle, readInput, pickFolder, canWrite } from "./app/files.js";
import { buildItems, run, stop, RUN } from "./app/pipeline.js";
import { dropCache, cacheKey, getMeta, putMeta } from "./app/store.js";
import { recompute, setManual, ready } from "./app/model.js";
import { exportXmp, exportCsv, exportJson, exportMoveScripts } from "./app/exporter.js";
import { sharpThreshold } from "./core/scoring.js";
import { hashStr, debounce } from "./core/util.js";
import { visionStatus } from "./ml/vision.js";
import { TIERS, tierOf, suggestTier, machine } from "./ml/tiers.js";
import { clipStatus, onClipStatus } from "./ml/clip.js";
import { $, $$, esc, fmtNum, fmtDuration, toast, revokeAll } from "./ui/dom.js";
import { renderToolbar, layout, refresh, appendLive, visibleOrder, setDensity } from "./ui/gallery.js";
import { drawHist, bindHist } from "./ui/histogram.js";
import { ask } from "./ui/confirm.js";
import { setLiquidGlass } from "./ui/glass.js";
import { setWallpaper } from "./ui/wallpaper.js";
import { openLightbox, closeLightbox, render as renderLb, step, stepGroup, zoomFocus, toggleView, bindLightbox, lbState } from "./ui/lightbox.js";
import { openCompare, closeCompare, bindCompare, cmpState, choose, zoomFocus as cmpZoom } from "./ui/compare.js";
import { openCull, closeCull, cullKey, refreshCull, bindCull, cullState } from "./ui/cull.js";
import { openFinish, closeFinish, bindFinish, finishState } from "./ui/finish.js";
import { openCalibration, closeCalibration, calibKey, bindCalibration, calibState } from "./ui/calibrate.js";
import { loadTaste, record, retrain, maybeAutoEnable, stats as tasteStats, forget as forgetTaste, taste } from "./app/taste.js";

const app = $("#app");
let analysed = 0;

/* ================================================================ rendering */
function renderAll() {
  renderToolbar();
  refresh();
  renderStats();
  drawHist();
  renderBaseline();
  renderPersonal();
  renderCalibInfo();
  if (lbState.open) renderLb();
  refreshCull();
}
function renderCalibInfo() {
  $("#calibInfo").textContent = S.calib ? t("cal.info", { t: fmtNum(S.calib.T), n: S.calib.n }) : t("cal.infoNone");
}
const recomputeSoon = debounce(() => { recompute(); renderAll(); }, 120);
let liveTimer = 0, lastLive = 0;
function liveRecompute() {
  if (liveTimer) return;
  liveTimer = setTimeout(() => { liveTimer = 0; lastLive = performance.now(); recompute(); renderAll(); }, Math.max(0, 450 - (performance.now() - lastLive)));
}

function renderStats() {
  const items = ready();
  const n = { keep: 0, review: 0, reject: 0 };
  for (const it of items) n[it.verdict]++;
  const total = items.length || 1;
  const groups = SESSION.groups.filter((g) => g.members.length > 1).length;
  const faces = items.filter((i) => i.faces?.length).length;
  $("#stats").innerHTML = [["keep", "--good"], ["review", "--doubt"], ["reject", "--bad"]].map(([k, c]) =>
    `<div class="stat" style="--c:var(${c})"><b>${n[k]}</b><span>${esc(t("verdict.tab." + k))} · ${Math.round((n[k] / total) * 100)}%</span></div>`).join("") +
    `<div class="stat wide"><span>${esc(t("stats.groups", { n: groups }))}</span><span>${esc(t("stats.faces", { n: faces }))}</span><span class="num">${items.length}/${SESSION.items.length}</span></div>`;
}
function renderSessionInfo() {
  const items = SESSION.items, rafs = items.filter((i) => i.raf).length, rafOnly = items.filter((i) => i.isRaf).length;
  $("#sessName").textContent = SESSION.name || t("sess.untitled");
  $("#sessInfo").textContent = t("sess.info", { n: items.length, r: rafs }) + (rafOnly ? " · " + t("sess.rafOnly", { n: rafOnly }) : "");
}
function renderBaseline() {
  const b = UI.baseline;
  if (!b) { $("#baselineText").textContent = t("cmp.none"); return; }
  const changed = ready().filter((i) => b.has(i.path) && b.get(i.path) !== i.verdict).length;
  $("#baselineText").textContent = changed ? t("cmp.changed", { n: changed }) : t("cmp.same");
}
function renderPersonal() {
  const st = tasteStats(), m = st.model;
  $("#personalInfo").textContent = (st.n ? t("ai.tasteInfo", { n: st.n, k: st.kept, r: st.n - st.kept, s: st.sessions }) : t("ai.tasteNone")) +
    (m ? " " + t("ai.personalAcc", { acc: Math.round(m.acc * 100), n: m.n }) : st.n ? " " + t("ai.tasteNeed") : "");
  /** @type {HTMLInputElement} */ ($("#f-usePersonal")).disabled = !m;
  $("#forgetBtn").hidden = !st.n;
}
function renderAi() {
  const st = (s, p) => s === "ready" ? `<span class="ok">${esc(t("ai.ready"))}</span>` : s === "loading" ? `<span>${esc(t("ai.loading"))}${p != null ? " " + Math.round(p * 100) + "%" : ""}</span>`
    : s === "error" ? `<span class="err">${esc(t("ai.error"))}</span>` : `<span>${esc(t("ai.off"))}</span>`;
  $("#aiStatus").innerHTML = `<span>${esc(t("ai.facesShort"))}</span>${st(S.ai.faces ? visionStatus.faces : "off")}` +
    `<span>${esc(t("ai.objectsShort"))}</span>${st(S.ai.objects ? visionStatus.objects : "off")}` +
    `<span>${esc(t("ai.clipShort"))}</span>${st(S.ai.clip ? clipStatus.state : "off", clipStatus.state === "loading" ? clipStatus.progress : null)}`;
  const parts = [];
  if (S.ai.clip && clipStatus.state === "loading") parts.push(t("load.clip", { p: Math.round(clipStatus.progress * 100) }));
  if (visionStatus.error && (visionStatus.faces === "error" || visionStatus.objects === "error")) parts.push(t("load.visionErr"));
  $("#ldModels").textContent = parts.join(" · ");
}
onClipStatus(() => renderAi());

/* ================================================================ AI tier */
const MACHINE = machine();
const suggested = () => suggestTier({ ...MACHINE, rate: S.rates?.standard });
function renderTier() {
  const sug = suggested(), tier = S.tier || sug;
  $$("#tierSeg button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.v === tier)); b.classList.toggle("suggested", b.dataset.v === sug); });
  $("#tierInfo").textContent = t("tier.desc." + tier, { mb: TIERS[tier].mb });
  const why = [MACHINE.mobile ? t("tier.phone") : null, t("tier.cores", { n: MACHINE.cores }),
    MACHINE.memory != null ? t(MACHINE.memory >= 8 ? "tier.memory" : "tier.memoryLow", { gb: MACHINE.memory }) : null,
    S.rates?.standard ? t("tier.rate", { s: fmtNum(S.rates.standard) }) : null].filter(Boolean).join(", ");
  $("#tierSuggest").innerHTML = sug === tier ? esc(t("tier.isSuggested")) + ` <span class="hint">(${esc(why)})</span>`
    : esc(t("tier.suggest", { tier: "\u0000", why })).replace("\u0000", `<b>${esc(t("tier." + sug))}</b>`);
  $("#emptyFine").textContent = t("empty.fine", { mb: TIERS[tier].mb, tier: t("tier." + tier) });
}
setInterval(() => { if (app.dataset.state !== "empty") renderAi(); }, 1500);

/* ================================================================ loader */
const LD = { phase: null, t0: 0, timer: 0 };
const PHASES = ["read", "prep", "analyse"];
function showLoader(phase, title, text, frac) {
  if (app.dataset.state !== "session") app.dataset.state = "loading";
  if (LD.phase !== phase) { LD.phase = phase; LD.t0 = performance.now(); }
  if (title != null) $("#ldTitle").textContent = title;
  if (text != null) $("#ldText").textContent = text;
  $("#ldBar").classList.toggle("indet", frac == null);
  $("#ldFill").style.width = frac == null ? "" : Math.max(2, frac * 100) + "%";
  const j = PHASES.indexOf(phase);
  $$("#phases li").forEach((li) => { const i = PHASES.indexOf(li.dataset.p); li.className = i < j ? "done" : i === j ? "on" : ""; });
  if (!LD.timer) LD.timer = setInterval(() => { $("#ldElapsed").textContent = t("load.elapsed", { t: fmtDuration((performance.now() - LD.t0) / 1000) }); }, 500);
  renderAi();
}
function hideLoader() { clearInterval(LD.timer); LD.timer = 0; LD.phase = null; }

/* ================================================================ session */
function beginLoading() {
  stop();
  if (lbState.open) closeLightbox();
  if (cmpState.open) closeCompare();
  $("#progress").hidden = true;
  app.dataset.state = "loading";
  showLoader("read", t("load.readTitle"), t("load.searching"));
}
const countFiles = (n) => showLoader("read", t("load.readTitle"), t("load.found", { n }));

async function startSession({ name, list, dir }, { keepDecisions = false } = {}) {
  const prev = { key: SESSION.key, data: SESSION.data };
  const items = buildItems(list);
  if (!items.length) {
    hideLoader();
    app.dataset.state = SESSION.items.length ? "session" : "empty";
    toast(t("load.noPhotos", { n: list.length }));
    return;
  }
  revokeAll(SESSION.items);
  Object.assign(SESSION, { name, dir, items, groups: [], scenes: 0, evals: new Map(), best: new Map() });
  SESSION.key = `${name}|${hashStr(items.slice(0, 40).map((i) => i.path).join("\n"))}`;
  UI.selection.clear(); UI.collapsed.clear(); UI.baseline = null;
  await loadSession(SESSION.key);
  rememberFolder(name, dir, items.length);
  takeView();
  // the same folder again: what is in memory is newer than what was last saved (and the key changes
  // when Finish has moved files out, as it is built from the file list)
  if (keepDecisions && prev.data) { SESSION.data = prev.data; touchSession(); }
  await loadTaste();
  SESSION.data.model = taste.model;
  SESSION.coarseRefs = null;
  analysed = 0;
  $("#gallery").textContent = "";
  $("#session").hidden = false; $("#exportWrap").hidden = false; $("#openBtn").hidden = false; $("#searchWrap").hidden = false; $("#reanalyseBtn").hidden = false;
  $("#cullBtn").hidden = false; $("#finishBtn").hidden = false;
  renderSessionInfo();
  $("#xmpHint").textContent = dir ? t("export.xmpHintDir") : t("export.xmpHintZip");
  const rate = S.rates?.[S.tier];
  showLoader("prep", t("load.prepTitle"), t("load.prepText", { n: items.length }) + (rate ? " · " + t("load.estimate", { t: fmtDuration(rate * items.length) }) : ""));
  for (const it of items) appendLive(it);
  try {
    await run(items, hooks);
  } catch (e) {
    hideLoader();
    app.dataset.state = "empty";
    toast(String(e?.message) === "workers-unavailable" ? t("err.workers") : t("err.generic", { e: e?.message || e }), 9000);
  }
}

const hooks = {
  onPhase(p) { if (p === "analyse") showLoader("analyse", t("load.analyseTitle"), t("load.first")); },
  onProgress({ done, total, busy, t0, cached }) {
    const names = busy.map((i) => i.name).join(", ");
    let eta = "";
    if (done > 2 && done < total) eta = " · " + t("load.eta", { t: fmtDuration(((performance.now() - t0) / done / 1000) * (total - done)) });
    $("#progress").hidden = app.dataset.state !== "session";
    $("#barFill").style.width = (total ? (done / total) * 100 : 0) + "%";
    $("#progText").textContent = `${done}/${total}${eta}${cached ? " · " + t("load.cached", { n: cached }) : ""}${names ? " · " + names : ""}`;
    if (LD.phase) showLoader("analyse", done ? t("load.analyseTitle") : t("load.first"), names ? t("load.opening", { names }) : "", total ? done / total : 0);
  },
  onItem(it, kind) {
    if (kind !== "clip") analysed++;
    if (analysed === 1 && app.dataset.state !== "session") { hideLoader(); app.dataset.state = "session"; $("#progress").hidden = false; requestAnimationFrame(drawHist); }
    if (RUN.running) { liveRecompute(); appendLive(it); }
    else recomputeSoon();
  },
  onDone({ done, total, secs, cached }) {
    $("#progress").hidden = true;
    hideLoader();
    if (!ready().length) { app.dataset.state = "empty"; toast(t("err.none")); return; }
    app.dataset.state = "session";
    recompute({ regroup: true });
    layout();
    renderAll();
    if (!UI.baseline) fixBaseline(false);
    applyView();
    // seconds per photo on this machine, for the estimate shown before the next run
    if (done - cached >= 5 && secs > 0) {
      const r = secs / (done - cached), old = S.rates?.[S.tier];
      S.rates = { ...(S.rates || {}), [S.tier]: old ? 0.6 * old + 0.4 * r : r }; saveSettings(); renderTier();
    }
    let msg = done < total ? t("done.partial", { done, total }) : t("done.full", { n: done, t: fmtDuration(secs) }) + (cached ? " " + t("done.cached", { n: cached }) : "");
    if (!S.calib && !S.calibHinted && ready().length >= 24) { S.calibHinted = true; saveSettings(); msg += " " + t("cal.hint"); }
    toast(msg, 8000);
  },
  onClipDone() {
    if (!S.ai.clip || clipStatus.state !== "ready") return;
    recompute({ regroup: true });
    layout();
    renderAll();
    toast(t("done.clip"));
  },
};

function fixBaseline(show = true) {
  UI.baseline = new Map(ready().map((i) => [i.path, i.verdict]));
  renderAll();
  if (show) toast(t("cmp.fixed"));
}

/* ================================================================ events from views */
on("manual", ({ items, patch }) => {
  // bulk decisions can be undone from the toast
  const before = items.length > 1 ? items.map((it) => [it, SESSION.data.manual[it.path] ? { ...SESSION.data.manual[it.path] } : null]) : null;
  setManual(items, patch);
  recompute();
  if (before && "flag" in patch) {
    const what = patch.flag === "reject" ? "undo.rejected" : patch.flag === "pick" ? "undo.kept" : "undo.auto";
    toast(t(what, { n: items.length }), 7000, { label: t("undo.label"), run: () => {
      for (const [it, m] of before) { if (m) SESSION.data.manual[it.path] = m; else delete SESSION.data.manual[it.path]; }
      touchSession(); recompute(); record(items); renderAll(); toast(t("undo.restored", { n: items.length }));
    } });
  }
  if (record(items) && maybeAutoEnable()) { syncSide(); recompute(); toast(t("ai.tasteOn", { acc: Math.round(taste.model.acc * 100), n: taste.model.n }), 9000); }
  renderAll();
});
on("cull", ({ only }) => { if (lbState.open) closeLightbox(); if (!openCull({ only })) toast(t("cull.none")); });
on("cullDone", () => toast(t("cull.finished"), 7000));
on("calibrated", ({ text }) => { syncSide(); recompute(); renderAll(); toast(text); });
on("organized", ({ result }) => {
  // the moved or deleted photos are no longer in the folder
  const gone = new Set(result.gone);
  revokeAll(result.gone);
  SESSION.items = SESSION.items.filter((i) => !gone.has(i));
  for (const it of gone) it.card?.remove();
  recompute({ regroup: true }); layout(); renderAll(); renderSessionInfo();
});
on("recompute", () => { recompute(); renderAll(); });
on("edit", ({ type, it }) => {
  const e = SESSION.data.edits, g = it.group;
  const without = (arr, p) => arr.filter((x) => x !== p);
  if (type === "makeBest") {
    if (g) setManual(g.members.filter((m) => m.manual?.flag === "pick" && m !== it), { flag: null });
    setManual([it], { flag: "pick", why: null });
    record(g ? g.members : [it]);
    recompute(); renderAll(); return;
  }
  if (type === "compare") { if (g) openCompare(g.members.slice().sort((a, b) => b.ev.score - a.ev.score).slice(0, 4)); return; }
  if (type === "detach") { e.detach = [...without(e.detach, it.path), it.path]; e.join = e.join.filter(([a, b]) => a !== it.path && b !== it.path); }
  if (type === "split") e.split = [...without(e.split, it.path), it.path];
  if (type === "joinPrev") {
    const prev = SESSION.groups.filter((x) => x.members.length > 1 && (x.start ?? 0) <= (it.time ?? 0) && x !== g).pop();
    if (!prev) { toast(t("edit.noPrev")); return; }
    e.detach = without(e.detach, it.path);
    e.join.push([prev.anchor, it.path]);
  }
  touchSession();
  recompute({ regroup: true }); layout(); renderAll();
});

/* ================================================================ side panel */
const sliders = {
  missRatio: (v) => `${fmtNum(v)}×`, softerRatio: (v) => `${fmtNum(v, 2)}×`, motionAniso: (v) => `${fmtNum(v, 2)}×`,
  bokehPct: (v) => `${v}%`, blinkThr: (v) => `${Math.round(v * 100)}%`, groupSim: (v) => `${Math.round(v * 100)}%`, burstGap: (v) => `${fmtNum(v)} s`,
};
const REGROUP = new Set(["groupSim", "burstGap", "groupMode", "sceneGapMin"]);
function syncSide() {
  const T = sharpThreshold(S);
  /** @type {HTMLInputElement} */ ($("#f-sharpPx")).value = String(T);
  $("#o-sharpPx").textContent = `${fmtNum(T)} px`;
  for (const [k, f] of Object.entries(sliders)) {
    const inp = /** @type {HTMLInputElement} */ ($("#f-" + k));
    if (document.activeElement !== inp) inp.value = String(S[k]);
    $("#o-" + k).textContent = f(S[k]);
  }
  $$("#strictSeg button").forEach((b) => b.setAttribute("aria-pressed", String((S.sharpPx != null ? "custom" : S.strictness) === b.dataset.v)));
  $$("#eyesSeg button").forEach((b) => b.setAttribute("aria-pressed", String(S.eyesRule === b.dataset.v)));
  $$("#xmpRejectSeg button").forEach((b) => b.setAttribute("aria-pressed", String(S.xmpReject === b.dataset.v)));
  for (const k of ["rejectEyes", "exposureCheck", "usePersonal", "keywords", "onlyBest"]) /** @type {HTMLInputElement} */ ($("#f-" + k)).checked = !!S[k];
  for (const k of ["faces", "objects", "clip"]) /** @type {HTMLInputElement} */ ($("#ai-" + k)).checked = !!S.ai[k];
  for (const k of ["groupMode", "sceneGapMin", "groupSort"]) /** @type {HTMLSelectElement} */ ($("#f-" + k)).value = String(S[k]);
  $$("[data-for]").forEach((n) => (n.hidden = !n.dataset.for.split(" ").includes(S.groupMode)));
  /** @type {HTMLInputElement} */ ($("#density")).value = String(S.density);
  $$(".lang button").forEach((b) => b.setAttribute("aria-pressed", String(getLang() === b.dataset.lang)));
}
function changed(key) {
  saveSettings(); syncSide();
  if (!SESSION.items.length) return;
  if (REGROUP.has(key)) { recompute({ regroup: true }); layout(); renderAll(); }
  else if (key === "groupSort") { layout(); renderAll(); }
  else recomputeSoon();
}
function bindSide() {
  for (const k of Object.keys(sliders)) {
    const inp = /** @type {HTMLInputElement} */ ($("#f-" + k));
    inp.addEventListener("input", () => { S[k] = +inp.value; $("#o-" + k).textContent = sliders[k](S[k]); if (!REGROUP.has(k)) recomputeSoon(); });
    inp.addEventListener("change", () => changed(k));
  }
  const sp = /** @type {HTMLInputElement} */ ($("#f-sharpPx"));
  sp.addEventListener("input", () => { S.sharpPx = +sp.value; $("#o-sharpPx").textContent = `${fmtNum(S.sharpPx)} px`; recomputeSoon(); });
  sp.addEventListener("change", () => changed("sharpPx"));
  bindHist((v) => { S.sharpPx = Math.min(5, Math.max(0.8, v)); syncSide(); recomputeSoon(); }, () => changed("sharpPx"));
  $("#strictSeg").addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("button"); if (!b) return;
    if (b.dataset.v === "custom") S.sharpPx = sharpThreshold(S); else { S.strictness = b.dataset.v; S.sharpPx = null; }
    changed("strictness");
  });
  $("#eyesSeg").addEventListener("click", (e) => { const b = /** @type {HTMLElement} */ (e.target).closest("button"); if (b) { S.eyesRule = b.dataset.v; changed("eyesRule"); } });
  $("#xmpRejectSeg").addEventListener("click", (e) => { const b = /** @type {HTMLElement} */ (e.target).closest("button"); if (b) { S.xmpReject = b.dataset.v; changed("xmpReject"); } });
  for (const k of ["rejectEyes", "exposureCheck", "usePersonal", "keywords", "onlyBest"]) $("#f-" + k).addEventListener("change", (e) => { S[k] = /** @type {HTMLInputElement} */ (e.target).checked; changed(k); });
  for (const k of ["faces", "objects", "clip"]) $("#ai-" + k).addEventListener("change", (e) => { S.ai[k] = /** @type {HTMLInputElement} */ (e.target).checked; saveSettings(); renderAi(); toast(t("ai.nextRun")); });
  for (const k of ["groupMode", "sceneGapMin", "groupSort"]) $("#f-" + k).addEventListener("change", (e) => {
    const v = /** @type {HTMLSelectElement} */ (e.target).value; S[k] = k === "sceneGapMin" ? +v : v; changed(k);
  });
  $("#collapseAll").addEventListener("click", () => { for (const g of SESSION.groups) if (g.members.length > 1) UI.collapsed.add(g.anchor); refresh(); });
  $("#expandAll").addEventListener("click", () => { UI.collapsed.clear(); refresh(); });
  $("#forgetBtn").addEventListener("click", async () => {
    if (!(await ask({ title: t("ai.forgetConfirm"), body: t("dlg.forgetBody"), ok: t("dlg.forget"), danger: true }))) return;
    await forgetTaste(); syncSide(); recompute(); renderAll(); toast(t("ai.forgotten"));
  });
  $("#calibBtn").addEventListener("click", () => { if (!openCalibration()) toast(t("cal.need")); });
  $("#tierSeg").addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("button"); if (!b || b.dataset.v === S.tier) return;
    S.tier = b.dataset.v; saveSettings(); renderTier(); renderAi();
    if (SESSION.items.length) toast(t("tier.changed", { tier: t("tier." + S.tier) }), 8000);
  });
  $("#baseBtn").addEventListener("click", () => fixBaseline(true));
  $("#resetBtn").addEventListener("click", async () => {
    if (!(await ask({ title: t("dlg.resetTitle"), body: t("dlg.resetBody"), ok: t("dlg.reset") }))) return;
    resetTuning(); syncSide(); if (SESSION.items.length) { recompute({ regroup: true }); layout(); renderAll(); } toast(t("cmp.resetDone")); });
}

/* ================================================================ toolbar, selection, gallery clicks */
function bindToolbar() {
  $("#verdictTabs").addEventListener("click", (e) => { const b = /** @type {HTMLElement} */ (e.target).closest(".tab"); if (b) { UI.filter.verdict = b.dataset.v; renderToolbar(); refresh(); } });
  $("#reasonSel").addEventListener("change", (e) => { UI.filter.reason = /** @type {HTMLSelectElement} */ (e.target).value; refresh(); });
  $("#extraSel").addEventListener("change", (e) => { UI.filter.extra = /** @type {HTMLSelectElement} */ (e.target).value; refresh(); });
  $("#sortSel").addEventListener("change", () => layout());
  $("#density").addEventListener("input", (e) => { S.density = +/** @type {HTMLInputElement} */ (e.target).value; setDensity(); });
  $("#search").addEventListener("input", debounce((e) => { UI.filter.search = /** @type {HTMLInputElement} */ (e.target).value.trim(); refresh(); }, 150));
  $("#helpBtn").addEventListener("click", () => ($("#help").hidden = false));
  $("#helpClose").addEventListener("click", () => ($("#help").hidden = true));
  $("#help").addEventListener("click", (e) => { if (e.target === $("#help")) $("#help").hidden = true; });

  let anchor = null;
  $("#gallery").addEventListener("click", (e) => {
    const tgt = /** @type {HTMLElement} */ (e.target);
    const gb = tgt.closest("[data-g]");
    if (gb) {
      const sec = gb.closest(".sec"), g = sec._g;
      if (gb.dataset.g === "toggle") { UI.collapsed.has(g.anchor) ? UI.collapsed.delete(g.anchor) : UI.collapsed.add(g.anchor); refresh(); }
      else if (gb.dataset.g === "compare") openCompare(g.members.slice().sort((a, b) => b.ev.score - a.ev.score).slice(0, 4));
      else if (gb.dataset.g === "rejectRest") emit("manual", { items: g.members.filter((m) => m !== g.best && m.manual?.flag !== "pick"), patch: { flag: "reject", why: "group" } });
      return;
    }
    if (tgt.closest(".gname")) return;
    const card = tgt.closest(".card");
    if (!card) return;
    const it = card._it;
    const toggle = tgt.closest(".tick") || e.metaKey || e.ctrlKey || (UI.selection.size > 0 && !e.shiftKey);
    if (e.shiftKey && anchor) {
      const order = visibleOrder(), a = order.indexOf(anchor), b = order.indexOf(it);
      if (a >= 0 && b >= 0) for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) UI.selection.add(x);
      refresh(); return;
    }
    if (toggle) { UI.selection.has(it) ? UI.selection.delete(it) : UI.selection.add(it); anchor = it; refresh(); return; }
    if (!it.ready) return;
    anchor = it;
    openLightbox(it, visibleOrder().filter((x) => x.ready));
  });
  $("#selbar").addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-act]"); if (!b) return;
    const sel = [...UI.selection].filter((i) => i.ready && !i.error);
    const a = b.dataset.act;
    if (a === "clear") { UI.selection.clear(); refresh(); return; }
    if (a === "compare") { if (sel.length < 2) toast(t("sel.needTwo")); else openCompare(sel.slice(0, 4)); return; }
    if (a === "group") {
      if (sel.length < 2) { toast(t("sel.needTwo")); return; }
      const ed = SESSION.data.edits, first = sel[0].path;
      for (const it of sel) { ed.detach = ed.detach.filter((p) => p !== it.path); if (it.path !== first) ed.join.push([first, it.path]); }
      touchSession(); UI.selection.clear();
      recompute({ regroup: true }); layout(); renderAll(); return;
    }
    emit("manual", { items: sel, patch: { flag: a === "auto" ? null : a } });
  });
}

/* ================================================================ export */
function bindExport() {
  const menu = $("#exportMenu"), btn = $("#exportBtn");
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); });
  document.addEventListener("click", (e) => { if (!$("#exportWrap").contains(/** @type {Node} */ (e.target))) close(); });
  menu.addEventListener("click", async (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-export]"); if (!b) return;
    close();
    if (RUN.running) { toast(t("export.wait")); return; }
    try {
      const k = b.dataset.export;
      if (k === "xmp") { const r = await exportXmp(); toast(r.zipped ? t("export.xmpZipped", { n: r.written }) : t("export.xmpWritten", { n: r.written, m: r.merged })); }
      if (k === "csv") exportCsv();
      if (k === "json") exportJson();
      if (k === "scripts") toast(t("export.scriptsDone", { n: exportMoveScripts() }));
    } catch (err) { toast(t("err.generic", { e: err?.message || err })); }
  });
}

/* ================================================================ surviving a refresh */
// The folder is remembered (with its handle, where the browser gives one) and so is the view: filters,
// sort, the photo at the top of the gallery and the one open in the loupe. Measurements are cached per
// photo and decisions are saved as they are made, so a refresh only costs the reopening.
const VIEW_KEY = "nitido-view";
let pendingView = null;
function rememberFolder(name, dir, n) { putMeta("last", { name, dir: dir || null, n, at: Date.now() }).catch(() => {}); }
function saveView() {
  flushSession();
  if (!SESSION.key || app.dataset.state !== "session") return;
  const top = $("#scroller").getBoundingClientRect().top + 8;
  const anchor = visibleOrder().find((it) => it.card.getBoundingClientRect().bottom > top);
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ key: SESSION.key, filter: UI.filter, sort: /** @type {HTMLSelectElement} */ ($("#sortSel")).value,
      anchor: anchor?.path || null, loupe: lbState.open ? lbState.it?.path : null }));
  } catch {}
}
/** At the start of a session: the filters and sort of the same folder before the refresh. */
function takeView() {
  pendingView = null;
  let v = null;
  try { v = JSON.parse(sessionStorage.getItem(VIEW_KEY) || "null"); } catch {}
  if (v?.key !== SESSION.key) return;
  pendingView = v;
  Object.assign(UI.filter, v.filter || {});
  if (v.sort) /** @type {HTMLSelectElement} */ ($("#sortSel")).value = v.sort;
  /** @type {HTMLInputElement} */ ($("#search")).value = UI.filter.search || "";
}
/** Once the photos are in: back to where you were. */
function applyView() {
  const v = pendingView; pendingView = null;
  if (!v) return;
  const find = (p) => p && SESSION.items.find((i) => i.path === p && i.ready && !i.error);
  const a = find(v.anchor);
  if (a?.card && !a.card.hidden) a.card.scrollIntoView({ block: "start" });
  const l = find(v.loupe);
  if (l) openLightbox(l, visibleOrder().filter((x) => x.ready));
}
async function resumeFolder(dir) {
  beginLoading();
  try { await startSession(await readHandle(dir, countFiles)); }
  catch (e) { hideLoader(); app.dataset.state = "empty"; toast(t("err.read", { e: e?.message || e })); }
}
/** On the start screen: continue with the last folder. After a refresh it reopens by itself when the browser still allows it. */
async function offerResume() {
  const last = await getMeta("last").catch(() => null);
  if (!last?.n || app.dataset.state !== "empty") return;
  const reload = /** @type {PerformanceNavigationTiming|undefined} */ (performance.getEntriesByType?.("navigation")[0])?.type === "reload";
  if (last.dir && reload && (await last.dir.queryPermission?.({ mode: "readwrite" }).catch(() => "")) === "granted") return resumeFolder(last.dir);
  const btn = $("#resumeBtn");
  btn.textContent = last.name ? t("resume.btn", { name: last.name }) : t("resume.last");
  $("#resumeInfo").textContent = t(last.dir ? "resume.info" : "resume.infoPick", { n: last.n });
  $("#resume").hidden = false;
  $("#pickBtn").classList.remove("primary");
  btn.onclick = async () => {
    if (!last.dir) return openFolder();
    try {
      if ((await last.dir.requestPermission({ mode: "readwrite" })) !== "granted") return;
      await resumeFolder(last.dir);
    } catch { openFolder(); } // the folder was moved or renamed
  };
}
function bindRefresh() {
  addEventListener("pagehide", saveView);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveView(); });
  // moving files is the one thing a refresh should not cut short
  addEventListener("beforeunload", (e) => { if (finishState.running) { e.preventDefault(); e.returnValue = ""; } });
}

/* ================================================================ theme */
const THEME_COLOR = { dark: "#222224", light: "#ffffff", glass: "#0e0f13" };
function applyTheme() {
  const th = THEME_COLOR[S.theme] ? S.theme : "dark";
  if (th === "dark") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = th;
  $('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[th]);
  $$("#themeMenu [data-theme]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.theme === th)));
  setLiquidGlass(th === "glass");
  setWallpaper(th === "glass");
  requestAnimationFrame(drawHist);
}
function bindTheme() {
  const menu = $("#themeMenu"), btn = $("#themeBtn");
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); });
  document.addEventListener("click", (e) => { if (!$("#themeWrap").contains(/** @type {Node} */ (e.target))) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { close(); btn.focus(); } });
  menu.addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-theme]"); if (!b) return;
    S.theme = b.dataset.theme; saveSettings(); applyTheme(); close();
  });
}

/** The tuning panel as a drawer (narrow screens): open or close it. */
function setSide(open) {
  app.classList.toggle("side-open", open);
  $("#menuBtn").setAttribute("aria-expanded", String(open));
  if (open) requestAnimationFrame(drawHist);
}

/* ================================================================ reanalyse */
/** Measures the current folder again from scratch. Decisions, stars, labels and group edits are kept
 *  (they belong to the folder, not to the analysis). A folder opened with Choose folder is read again,
 *  so files added, moved or removed since are taken into account. */
async function reanalyse() {
  if (!SESSION.items.length) return;
  if (RUN.running) { toast(t("export.wait")); return; }
  if (!(await ask({ title: t("dlg.reanalyseTitle", { n: SESSION.items.length }), body: t("dlg.reanalyseBody"), ok: t("top.reanalyse") }))) return;
  const old = SESSION.items;
  await dropCache(old.flatMap((it) => [cacheKey(it.path, it.file, S.tier)]));
  let src = null;
  if (SESSION.dir) {
    try {
      let perm = await SESSION.dir.queryPermission({ mode: "read" });
      if (perm !== "granted") perm = await SESSION.dir.requestPermission({ mode: "read" });
      if (perm === "granted") { beginLoading(); src = await readHandle(SESSION.dir, countFiles); }
    } catch {}
  }
  if (!src) {
    // the files the browser already holds: each photo's JPEG (or RAF) and its paired RAF
    const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
    const list = old.flatMap((it) => [{ file: it.file, path: it.path }, ...(it.rafFile ? [{ file: it.rafFile, path: dirOf(it.path) + it.raf }] : [])]);
    beginLoading();
    src = { name: SESSION.name, list, dir: SESSION.dir };
  }
  await dropCache(buildItems(src.list).map((it) => cacheKey(it.path, it.file, S.tier)));
  toast(t("re.started"));
  await startSession(src, { keepDecisions: true });
}

/* ================================================================ folder input */
async function openFolder() {
  if (canWrite()) {
    try { const dir = await pickFolder(); if (!dir) return; beginLoading(); await startSession(await readHandle(dir, countFiles)); }
    catch (e) { if (e?.name !== "AbortError") /** @type {HTMLInputElement} */ ($("#picker")).click(); }
  } else /** @type {HTMLInputElement} */ ($("#picker")).click();
}
function bindInput() {
  $("#pickBtn").addEventListener("click", openFolder);
  $("#openBtn").addEventListener("click", openFolder);
  $("#reanalyseBtn").addEventListener("click", reanalyse);
  $("#sideOpen").addEventListener("click", () => { setSide(false); openFolder(); });
  $("#sideReanalyse").addEventListener("click", () => { setSide(false); reanalyse(); });
  $("#reanalyseSide").addEventListener("click", reanalyse);
  const picker = /** @type {HTMLInputElement} */ ($("#picker"));
  picker.addEventListener("change", () => {
    const files = [...(picker.files || [])]; picker.value = "";
    if (!files.length) return;
    beginLoading(); countFiles(files.length);
    setTimeout(() => startSession(readInput(files)), 30);
  });
  let depth = 0;
  const armed = (on) => { $("#drop").classList.toggle("armed", on); $("#veil").hidden = !(on && app.dataset.state === "session"); };
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (e) => { if (hasFiles(e)) { e.preventDefault(); depth++; armed(true); } });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) armed(false); });
  window.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; armed(false);
    const cap = captureDrop(e.dataTransfer);
    if (!cap.entries.length && !cap.files.length) return;
    beginLoading();
    try { await startSession(await readDrop(cap, countFiles)); }
    catch (err) { hideLoader(); app.dataset.state = SESSION.items.length ? "session" : "empty"; toast(t("err.read", { e: err?.message || err })); }
  });
  $("#stopBtn").addEventListener("click", () => { stop(); $("#progress").hidden = true; hooks.onDone({ done: ready().length, total: SESSION.items.length, secs: 0, cached: 0 }); });
  $("#menuBtn").addEventListener("click", () => setSide(!app.classList.contains("side-open")));
  $("#backdrop").addEventListener("click", () => setSide(false));
  $("#sideClose").addEventListener("click", () => setSide(false));
}

/* ================================================================ language */
function bindLang() {
  $$(".lang button").forEach((b) => b.addEventListener("click", () => {
    S.lang = b.dataset.lang; saveSettings(); setLang(S.lang); applyI18n(); syncSide(); renderTier();
    if (SESSION.items.length) { recompute(); layout(); renderAll(); }
    if (SESSION.items.length) renderSessionInfo();
    renderAi();
  }));
}

/* ================================================================ keyboard */
const LABEL_KEYS = { 6: "Red", 7: "Yellow", 8: "Green", 9: "Blue" };
function applyKey(items, k, shift) {
  if (!items.length) return false;
  if (k === "p") emit("manual", { items, patch: { flag: "pick", why: null } });
  else if (k === "x" && shift && items.length === 1 && items[0].group) { const g = items[0].group; emit("manual", { items: g.members.filter((m) => m !== items[0]), patch: { flag: "reject", why: "group" } }); emit("manual", { items, patch: { flag: "pick", why: null } }); }
  else if (k === "x") emit("manual", { items, patch: { flag: "reject", why: null } });
  else if (k === "u") emit("manual", { items, patch: { flag: null, why: null } });
  else if (/^[0-5]$/.test(k)) emit("manual", { items, patch: { rating: +k || null } });
  else if (/^[6-9]$/.test(k)) { const l = LABEL_KEYS[k]; emit("manual", { items, patch: { label: items[0].manual?.label === l ? null : l } }); }
  else return false;
  return true;
}
function bindKeys() {
  document.addEventListener("keydown", (e) => {
    const tag = /** @type {HTMLElement} */ (e.target).tagName;
    if ((tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") && e.key !== "Escape") return;
    const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
    if (k === "escape" && app.classList.contains("side-open")) { setSide(false); return; }
    if (calibState.open) { if (calibKey(e)) e.preventDefault(); return; }
    if (finishState.open) { if (k === "escape") closeFinish(); return; }
    if (cullState.open) { if (!mod && cullKey(e)) e.preventDefault(); return; }
    if (e.key === "?") { $("#help").hidden = !$("#help").hidden; e.preventDefault(); return; }
    if (!$("#help").hidden && k === "escape") { $("#help").hidden = true; return; }
    if (cmpState.open) {
      if (k === "escape") closeCompare(); else if (/^[1-4]$/.test(k)) choose(+k - 1); else if (k === "z") cmpZoom(); else return;
      e.preventDefault(); return;
    }
    if (lbState.open) {
      const it = lbState.it;
      if (k === "escape") closeLightbox();
      else if (k === "arrowright") step(1); else if (k === "arrowleft") step(-1);
      else if (k === "arrowdown") stepGroup(1); else if (k === "arrowup") stepGroup(-1);
      else if (k === "z") zoomFocus(); else if (k === "m") toggleView("showMap"); else if (k === "f") toggleView("showFaces"); else if (k === "b") toggleView("showBoxes");
      else if (k === "c") emit("edit", { type: "compare", it });
      else if (!mod && applyKey([it], k, e.shiftKey)) {}
      else return;
      e.preventDefault(); return;
    }
    if (app.dataset.state !== "session") return;
    if (k === "t" && !mod) { emit("cull", { only: "all" }); e.preventDefault(); return; }
    const focused = /** @type {HTMLElement} */ (document.activeElement)?.closest?.(".card");
    const cur = focused?._it;
    if (mod && k === "a") { for (const it of visibleOrder()) UI.selection.add(it); refresh(); e.preventDefault(); return; }
    if (k === "escape") { UI.selection.clear(); refresh(); return; }
    if (k === "c" && UI.selection.size >= 2) { openCompare([...UI.selection].slice(0, 4)); return; }
    const order = visibleOrder();
    if (["arrowright", "arrowleft", "arrowdown", "arrowup"].includes(k)) {
      let i = cur ? order.indexOf(cur) : -1;
      const cols = cur ? Math.max(1, Math.round(focused.parentElement.clientWidth / focused.offsetWidth)) : 1;
      i = k === "arrowright" ? i + 1 : k === "arrowleft" ? i - 1 : k === "arrowdown" ? i + cols : i - cols;
      const nx = order[Math.max(0, Math.min(order.length - 1, i))];
      nx?.card?.focus(); nx?.card?.scrollIntoView({ block: "nearest" });
      e.preventDefault(); return;
    }
    if ((k === "enter" || k === " ") && cur?.ready) { openLightbox(cur, order.filter((x) => x.ready)); e.preventDefault(); return; }
    if (k === "g" && cur?.group) { const a = cur.group.anchor; UI.collapsed.has(a) ? UI.collapsed.delete(a) : UI.collapsed.add(a); refresh(); return; }
    const targets = UI.selection.size ? [...UI.selection] : cur ? [cur] : [];
    if (!mod && applyKey(targets.filter((i) => i.ready && !i.error), k, e.shiftKey)) e.preventDefault();
  });
}

/* ================================================================ boot */
function boot() {
  setLang(S.lang);
  applyI18n();
  applyTheme();
  bindSide(); bindToolbar(); bindExport(); bindTheme(); bindRefresh(); bindInput(); bindLang(); bindKeys(); bindLightbox(); bindCompare(); bindCull(); bindFinish(); bindCalibration();
  $("#cullBtn").addEventListener("click", () => emit("cull", { only: "all" }));
  $("#finishBtn").addEventListener("click", () => { if (RUN.running) toast(t("export.wait")); else openFinish(); });
  loadTaste().then(renderPersonal);
  // installable and usable offline once the models have been fetched
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1"))
    navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!S.tier || !TIERS[S.tier]) { S.tier = suggested(); saveSettings(); }
  syncSide(); setDensity(); renderAi(); renderTier();
  offerResume();
  window.addEventListener("resize", debounce(drawHist, 100));
  // the glass theme floats the toolbar over the photos: the gallery starts below it
  const main = $("#main"), tb = $(".toolbar"), sb = $("#selbar");
  const measure = () => { main.style.setProperty("--tbh", tb.offsetHeight + "px"); main.style.setProperty("--sbh", (sb.hidden ? 0 : sb.offsetHeight + 8) + "px"); };
  if ("ResizeObserver" in window) { const ro = new ResizeObserver(measure); ro.observe(tb); ro.observe(sb); }
  if (location.protocol === "file:") toast(t("err.fileProtocol"), 15000);
}
boot();
