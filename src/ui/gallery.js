// @ts-check
import { $, el, esc, fmtPx, fmtTime, fmtDate, urlOf, pctBox } from "./dom.js";
import { t } from "../i18n/index.js";
import { S, SESSION, UI, touchSession, emit, saveSettings } from "../app/state.js";
import { cmpNatural } from "../core/util.js";

const gallery = () => $("#gallery");
export const REASONS = ["blur", "motion", "missed", "eyes", "blink", "softer", "shake", "over", "under", "nodetail"];
const BAD = new Set(["blur", "motion", "missed", "eyes"]);
export const LABEL_COLORS = { Red: "--lbl-red", Yellow: "--lbl-yellow", Green: "--lbl-green", Blue: "--lbl-blue", Purple: "--lbl-purple" };

/* ---------- toolbar ---------- */
export function renderToolbar() {
  const items = SESSION.items.filter((i) => i.ready && !i.error && i.ev);
  const n = { all: items.length, keep: 0, review: 0, reject: 0 };
  for (const it of items) n[it.verdict]++;
  const tabs = [["all", null], ["keep", "--good"], ["review", "--doubt"], ["reject", "--bad"]];
  $("#verdictTabs").innerHTML = tabs.map(([k, c]) =>
    `<button class="tab" role="tab" data-v="${k}" aria-selected="${UI.filter.verdict === k}">${c ? `<i style="--c:var(${c})"></i>` : ""}${t("verdict.tab." + k)} <span class="n">${n[k]}</span></button>`).join("");
  const rc = Object.fromEntries(REASONS.map((r) => [r, 0]));
  for (const it of items) for (const r of it.ev.reasons) if (r in rc) rc[r]++;
  const rs = $("#reasonSel");
  rs.innerHTML = `<option value="all">${t("tb.allReasons")}</option>` + REASONS.filter((r) => rc[r]).map((r) => `<option value="${r}">${t("reason." + r)} (${rc[r]})</option>`).join("");
  if (UI.filter.reason !== "all" && !rc[UI.filter.reason]) UI.filter.reason = "all";
  /** @type {HTMLSelectElement} */ (rs).value = UI.filter.reason;
  const extras = ["all", "best", "faces", "bokeh", "changed", "manual", "starred", "noraf"];
  const xs = $("#extraSel");
  xs.innerHTML = extras.map((k) => `<option value="${k}">${t("extra." + k)}</option>`).join("");
  /** @type {HTMLSelectElement} */ (xs).value = UI.filter.extra;
}

/* ---------- visibility ---------- */
export function isVisible(it) {
  if (!it.ready || (!it.error && !it.ev)) return UI.filter.verdict === "all" && UI.filter.reason === "all" && UI.filter.extra === "all" && !UI.filter.search;
  if (it.error) return UI.filter.verdict === "all";
  const f = UI.filter;
  if (f.verdict !== "all" && it.verdict !== f.verdict) return false;
  if (f.reason !== "all" && !it.ev.reasons.includes(f.reason)) return false;
  if (S.onlyBest && it.group && it.group.members.length > 1 && !it.isBest) return false;
  switch (f.extra) {
    case "best": if (!it.isBest) return false; break;
    case "faces": if (!it.faces?.length) return false; break;
    case "bokeh": if (!it.ev.tags.includes("bokeh")) return false; break;
    case "changed": if (!UI.baseline || UI.baseline.get(it.path) === it.verdict) return false; break;
    case "manual": if (!it.manual) return false; break;
    case "starred": if (!(it.manual?.rating > 0)) return false; break;
    case "noraf": if (it.raf) return false; break;
  }
  if (f.search && !it.path.toLowerCase().includes(f.search.toLowerCase())) return false;
  return true;
}

/* ---------- cards ---------- */
function makeCard(it) {
  const c = el("article", { class: "card", tabindex: "0", "data-v": "pending" });
  c.innerHTML = `<div class="frame"><div class="pic" style="--ar:1.5"><img alt="" decoding="async" loading="lazy"><div class="ov"></div></div>
    <div class="badges"></div><i class="lbl" hidden></i><span class="stars"></span><button class="tick" tabindex="-1" aria-hidden="true"></button></div>
    <div class="row"><span class="name"></span><span class="score num"></span></div>
    <div class="row sub"><span class="chip"></span><span class="why"></span></div>`;
  c.querySelector(".name").textContent = it.name.replace(/\.[^.]+$/, "");
  c._it = it;
  it.card = c;
  return c;
}
const sortFns = {
  score: (a, b) => (b.ev?.score ?? -1) - (a.ev?.score ?? -1) || (a.time ?? 0) - (b.time ?? 0),
  time: (a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || cmpNatural(a.path, b.path),
  blur: (a, b) => (a.ev?.s ?? 99) - (b.ev?.s ?? 99),
  name: (a, b) => cmpNatural(a.path, b.path),
};

export function updateCard(it) {
  const c = it.card || makeCard(it);
  const ev = it.ev;
  const base = UI.baseline?.get(it.path);
  const sig = [it.ready, it.error, it.verdict, it.isBest, it.notBest, ev?.score?.toFixed(0), ev?.reasons.join(), ev?.tags.join(), it.manual && JSON.stringify(it.manual),
    base, it.clip ? 1 : 0, S.lang, UI.selection.has(it)].join("|");
  if (c._sig === sig) return c;
  c._sig = sig;
  const img = c.querySelector("img");
  if (it.thumbBlob && !img.getAttribute("src")) img.src = urlOf(it, "thumb", it.thumbBlob);
  if (it.W) /** @type {HTMLElement} */ (c.querySelector(".pic")).style.setProperty("--ar", String(it.W / it.H));
  const pending = !it.ready || (!it.error && !it.ev);
  c.classList.toggle("pending", pending);
  c.classList.toggle("sel", UI.selection.has(it));
  if (pending) { c.dataset.v = "pending"; return c; }
  if (it.error) {
    c.dataset.v = "reject";
    c.querySelector(".chip").textContent = t("verdict.error");
    c.querySelector(".why").textContent = "";
    return c;
  }
  c.dataset.v = it.verdict;
  c.classList.toggle("best", it.isBest);
  c.classList.toggle("notbest", !!(it.group && it.group.members.length > 1 && !it.isBest));
  c.classList.toggle("changed", base != null && base !== it.verdict);
  c.querySelector(".score").textContent = ev.s != null ? fmtPx(ev.s) : "–";
  c.querySelector(".chip").textContent = t("verdict." + it.verdict) + (it.manual?.flag ? " ·" + t("card.manual") : "");
  const why = ev.reasons.find((r) => BAD.has(r)) || ev.reasons[0] || ev.tags[0];
  c.querySelector(".why").textContent = why ? t((ev.reasons.includes(why) ? "reason." : "tag.") + why) : t("focusOn." + (ev.kind || "none"));
  const badges = [];
  if (it.isBest) badges.push(`<span class="best">${t("card.best")}</span>`);
  if (it.faces?.length) badges.push(`<span>${t("card.faces", { n: it.faces.length })}</span>`);
  c.querySelector(".badges").innerHTML = badges.join("");
  const r = it.manual?.rating;
  c.querySelector(".stars").textContent = r > 0 ? "★".repeat(r) : "";
  const lbl = /** @type {HTMLElement} */ (c.querySelector(".lbl"));
  const lc = it.manual?.label;
  lbl.hidden = !lc;
  if (lc) lbl.style.setProperty("--lc", `var(${LABEL_COLORS[lc]})`);
  c.querySelector(".ov").innerHTML = overlay(it);
  c.setAttribute("aria-label", `${it.name}, ${t("verdict." + it.verdict)}${ev.s != null ? ", " + fmtPx(ev.s) : ""}`);
  return c;
}

function overlay(it) {
  const ev = it.ev;
  let h = "";
  const box = ev.target?.probe || ev.target?.box || (ev.kind === "tile" && it.best?.box);
  if (box) h += `<div class="fb brackets" style="${pctBox(it, box)}"></div>`;
  for (const f of ev.faces?.main || []) {
    const st = ev.faces.st.get(f);
    for (const e of f.eyes || []) {
      const cx = (e.box[0] + e.box[2]) / 2, cy = (e.box[1] + e.box[3]) / 2;
      h += `<i class="eye ${st.closed ? "closed" : e.blink > S.blinkThr ? "part" : ""}" style="left:${(cx / it.W) * 100}%;top:${(cy / it.H) * 100}%"></i>`;
    }
  }
  return h;
}

/* ---------- layout ---------- */
function sectionFor(g, loose) {
  const sec = el("section", { class: "sec" + (UI.collapsed.has(g?.anchor) ? " collapsed" : "") });
  sec._g = g;
  if (loose) {
    sec.innerHTML = `<header class="sec-head"><span class="loose">${esc(t("sec.loose"))}</span><span class="meta"></span></header><div class="cards"></div>`;
  } else {
    sec.innerHTML = `<header class="sec-head"><input class="gname" spellcheck="false" aria-label="${esc(t("sec.rename"))}"><span class="meta"></span>
      <button class="btn small quiet" data-g="compare">${esc(t("sec.compare"))}</button>
      <button class="btn small quiet" data-g="rejectRest">${esc(t("sec.rejectRest"))}</button>
      <button class="btn small quiet" data-g="toggle"></button></header><div class="cards"></div>`;
    const input = /** @type {HTMLInputElement} */ (sec.querySelector(".gname"));
    input.value = g.name;
    input.addEventListener("change", () => {
      const v = input.value.trim();
      if (v) SESSION.data.groupNames[g.anchor] = v; else delete SESSION.data.groupNames[g.anchor];
      touchSession();
      emit("recompute", {});
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); e.stopPropagation(); });
  }
  return sec;
}

/** Rebuilds sections: groups in timeline order (or the chosen group sort), loose photos between them. */
export function layout() {
  const root = gallery();
  // keep the photo at the top of the view in place when groups are rebuilt (e.g. once CLIP is done)
  const sc = $("#scroller"), top = sc.getBoundingClientRect().top;
  let anchor = null, offset = 0;
  if (sc.scrollTop > 0) for (const c of root.querySelectorAll(".card")) {
    const r = c.getBoundingClientRect();
    if (r.bottom > top) { anchor = c; offset = r.top - top; break; }
  }
  root.textContent = "";
  const items = SESSION.items;
  const inner = sortFns[$("#sortSel") ? /** @type {HTMLSelectElement} */ ($("#sortSel")).value : "score"] || sortFns.score;
  const frag = document.createDocumentFragment();
  const pending = items.filter((i) => !i.ready || i.error || !i.ev);
  if (S.groupMode === "none" || !SESSION.groups.length) {
    const wrap = el("div", { class: "cards" });
    items.filter((i) => i.ready && !i.error && i.ev).sort(inner).concat(pending).forEach((it) => wrap.appendChild(updateCard(it)));
    frag.appendChild(wrap);
  } else {
    const gs = SESSION.groups.slice();
    const gsort = {
      time: (a, b) => (a.start ?? Infinity) - (b.start ?? Infinity),
      timeDesc: (a, b) => (b.start ?? -Infinity) - (a.start ?? -Infinity),
      size: (a, b) => b.members.length - a.members.length,
      score: (a, b) => (b.best?.ev?.score ?? 0) - (a.best?.ev?.score ?? 0),
      name: (a, b) => cmpNatural(a.name || "", b.name || ""),
    }[S.groupSort] || ((a, b) => 0);
    gs.sort(gsort);
    const chrono = S.groupSort === "time" || S.groupSort === "timeDesc";
    // in time order, each scene gets a header (the first one too) once there is more than one
    const sceneHeads = chrono && new Set(gs.map((g) => g.scene)).size > 1;
    let run = [], lastScene = null;
    const flush = () => {
      if (!run.length) return;
      const sec = sectionFor({ anchor: "loose:" + run[0].path, members: run }, true);
      const cards = sec.querySelector(".cards");
      run.sort(inner).forEach((it) => cards.appendChild(updateCard(it)));
      frag.appendChild(sec);
      run = [];
    };
    for (const g of gs) {
      if (sceneHeads && g.scene !== lastScene) {
        flush();
        frag.appendChild(el("div", { class: "scene-break" }, esc(`${t("sec.scene", { n: g.scene + 1 })}${g.start != null ? " · " + fmtDate(g.start) + " " + fmtTime(g.start) : ""}`)));
      }
      lastScene = g.scene;
      if (g.members.length < 2) { run.push(g.members[0]); continue; }
      if (chrono) flush();
      const sec = sectionFor(g, false);
      const cards = sec.querySelector(".cards");
      g.members.slice().sort(inner).forEach((it) => cards.appendChild(updateCard(it)));
      frag.appendChild(sec);
    }
    flush();
    if (pending.length) {
      const sec = sectionFor({ anchor: "pending", members: pending }, true);
      pending.forEach((it) => sec.querySelector(".cards").appendChild(updateCard(it)));
      frag.appendChild(sec);
    }
  }
  root.appendChild(frag);
  refresh();
  if (anchor?.isConnected && !anchor.hidden) sc.scrollTop += anchor.getBoundingClientRect().top - top - offset;
}

/** Appends a newly analysed photo without rebuilding everything (during analysis). */
export function appendLive(it) {
  if (it.card?.isConnected) { updateCard(it); return; }
  let wrap = gallery().querySelector(".live");
  if (!wrap) { wrap = el("div", { class: "cards live" }); gallery().appendChild(wrap); }
  wrap.appendChild(updateCard(it));
}

/** Updates cards, section headers and visibility after a recompute or filter change. */
export function refresh() {
  for (const it of SESSION.items) if (it.card) { updateCard(it); it.card.hidden = !isVisible(it); }
  for (const sec of gallery().querySelectorAll(".sec")) {
    const g = sec._g;
    const vis = g.members.filter((m) => m.card && !m.card.hidden).length;
    sec.hidden = vis === 0;
    const meta = sec.querySelector(".meta");
    if (!meta) continue;
    if (sec.querySelector(".loose")) { meta.textContent = t("sec.count", { n: g.members.length }); continue; }
    const rej = g.members.filter((m) => m.verdict === "reject").length;
    const span = g.start != null ? `${fmtTime(g.start)}${g.end !== g.start ? "–" + fmtTime(g.end) : ""}` : "";
    meta.textContent = [t("sec.count", { n: g.members.length }), span, g.best ? t("sec.best", { name: g.best.name.replace(/\.[^.]+$/, "") }) : "", rej ? t("sec.rejects", { n: rej }) : ""].filter(Boolean).join(" · ");
    const tg = sec.querySelector('[data-g="toggle"]');
    if (tg) tg.textContent = UI.collapsed.has(g.anchor) ? t("sec.expand", { n: g.members.length }) : t("sec.collapse");
    sec.classList.toggle("collapsed", UI.collapsed.has(g.anchor));
    const name = /** @type {HTMLInputElement} */ (sec.querySelector(".gname"));
    if (name && document.activeElement !== name) name.value = g.name;
  }
  // a scene header shows only when one of its sections (up to the next header) is visible
  let brk = null, seen = false;
  for (const node of gallery().children) {
    if (node.classList.contains("scene-break")) { if (brk) brk.hidden = !seen; brk = node; seen = false; }
    else if (!node.hidden) seen = true;
  }
  if (brk) brk.hidden = !seen;
  let none = $("#scroller > .no-results");
  const any = SESSION.items.some((i) => i.card && !i.card.hidden);
  if (!any && SESSION.items.some((i) => i.ready)) {
    if (!none) { none = el("p", { class: "no-results" }); $("#scroller").prepend(none); }
    none.textContent = t("tb.none");
  } else none?.remove();
  gallery().classList.toggle("selecting", UI.selection.size > 0);
  const sb = $("#selbar");
  sb.hidden = UI.selection.size === 0;
  $("#selCount").textContent = t("sel.count", { n: UI.selection.size });
}

/** Photos in on-screen order (for the loupe and keyboard navigation). */
export const visibleOrder = () => [...gallery().querySelectorAll(".card")].filter((c) => !c.hidden && c.offsetParent !== null).map((c) => c._it);

export function setDensity() { $("#scroller").style.setProperty("--card", S.density + "px"); saveSettings(); }
