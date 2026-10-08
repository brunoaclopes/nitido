// @ts-check
/** Culling mode: one group (or one photo to review) at a time, full screen, keyboard first.
 *  The suggested best is shown large; the strip holds the other frames; the faces row lines up each
 *  person across the burst so the frame where everyone's eyes are open is found at a glance. */
import { $, esc, fmtPx, urlOf, pctBox } from "./dom.js";
import { t } from "../i18n/index.js";
import { SESSION, emit } from "../app/state.js";
import { ready } from "../app/model.js";
import { rafPreview } from "../core/raf.js";
import { boxArea } from "../core/geometry.js";

const C = { open: false, units: [], ui: 0, ci: 0, only: "all", url: null, zoom: false };
export const cullState = C;
const stage = () => $("#cullStage");

/** The queue: every group of 2+ photos, plus single photos still to review (or every photo). */
export function buildUnits(only = "all") {
  const units = [];
  const list = SESSION.groups.length ? SESSION.groups : ready().map((m, i) => ({ id: i + 1, members: [m] }));
  for (const g of list) {
    const ms = g.members.filter((m) => m.ready && !m.error && m.ev);
    if (!ms.length) continue;
    if (only === "review" && !ms.some((m) => m.verdict === "review")) continue;
    if (ms.length === 1 && only !== "every" && ms[0].verdict !== "review") continue;
    units.push({ g, members: ms });
  }
  return units;
}
const decided = (u) => u.members.every((m) => m.manual?.flag);

export function openCull({ only = "all" } = {}) {
  C.only = only;
  C.units = buildUnits(only);
  if (!C.units.length) return false;
  const first = C.units.findIndex((u) => !decided(u));
  C.ui = first >= 0 ? first : 0;
  pickCandidate();
  C.open = true;
  $("#cull").hidden = false;
  render(true);
  return true;
}
export function closeCull() {
  C.open = false;
  $("#cull").hidden = true;
  if (C.url) { URL.revokeObjectURL(C.url); C.url = null; }
  /** @type {HTMLImageElement} */ ($("#cullImg")).removeAttribute("src");
}
function unit() { return C.units[C.ui]; }
function cur() { return unit()?.members[C.ci]; }
function pickCandidate() {
  const u = unit(); if (!u) return;
  const pick = u.members.findIndex((m) => m.manual?.flag === "pick");
  const best = u.members.indexOf(u.g.best);
  C.ci = pick >= 0 ? pick : best >= 0 ? best : 0;
}

/** Faces of the key photo, matched by position in every other frame of the group. */
function faceRows(u) {
  const ref = u.g.best && u.members.includes(u.g.best) ? u.g.best : u.members[0];
  const people = (ref.ev?.faces?.main || []).slice().sort((a, b) => boxArea(b.box) - boxArea(a.box)).slice(0, 3);
  return people.map((pf) => {
    const cx = (pf.box[0] + pf.box[2]) / 2 / ref.W, cy = (pf.box[1] + pf.box[3]) / 2 / ref.H, size = (pf.box[2] - pf.box[0]) / ref.W;
    return u.members.map((m) => {
      let best = null, bd = Infinity;
      for (const f of m.ev?.faces?.main || []) {
        const d = Math.hypot((f.box[0] + f.box[2]) / 2 / m.W - cx, (f.box[1] + f.box[3]) / 2 / m.H - cy);
        if (d < bd) { bd = d; best = f; }
      }
      return best && bd < Math.max(0.08, size * 1.2) ? { m, f: best, st: m.ev.faces.st.get(best) } : { m, f: null };
    });
  });
}

const VCOL = { keep: "--good", review: "--doubt", reject: "--bad" };
function render(newImage = false) {
  if (!C.open) return;
  const u = unit(), it = cur();
  if (!u || !it) { closeCull(); return; }
  const done = C.units.filter(decided).length;
  $("#cullPos").textContent = t(u.members.length > 1 ? "cull.posGroup" : "cull.posSingle", { i: C.ui + 1, n: C.units.length });
  $("#cullDone").textContent = t("cull.decided", { n: done, total: C.units.length });
  $("#cullBar").style.width = `${(done / C.units.length) * 100}%`;
  $("#cullName").textContent = u.members.length > 1 ? u.g.name || "" : it.name;

  const ev = it.ev, v = it.verdict;
  const pic = $("#cullPic");
  pic.style.setProperty("--ar", String(it.W / it.H));
  pic.style.setProperty("--c", `var(${VCOL[v]})`);
  const box = ev.target?.probe || ev.target?.box;
  $("#cullBoxes").innerHTML = box ? `<div class="fb brackets" style="${pctBox(it, box)}"></div>` : "";
  $("#cullInfo").innerHTML = `<b style="color:var(${VCOL[v]})">${esc(t("verdict." + v))}${it.manual?.flag ? " · " + esc(t("card.manual").trim()) : ""}</b>
    <span>${esc(it.name)}</span><span class="num">${esc(fmtPx(ev.s))} · ${Math.round(ev.score)}</span>
    ${it === u.g.best && u.members.length > 1 ? `<span class="good">${esc(t("card.best"))}</span>` : ""}
    <span>${esc([...ev.reasons.map((r) => t("reason." + r)), ...ev.tags.filter((g) => g === "laughing" || g === "bokeh").map((g) => t("tag." + g))].join(" · "))}</span>`;

  $("#cullStrip").innerHTML = u.members.length > 1 ? u.members.map((m, k) => {
    const fl = m.manual?.flag;
    return `<button class="cs ${k === C.ci ? "on" : ""}" data-k="${k}" data-v="${fl === "pick" ? "keep" : fl === "reject" ? "reject" : m.verdict}" ${fl ? `data-manual` : ""}>
      <img src="${urlOf(m, "thumb", m.thumbBlob)}" alt=""><span>${k + 1}</span>${m === u.g.best ? "<em>★</em>" : ""}</button>`;
  }).join("") : "";

  const rows = u.members.length > 1 ? faceRows(u) : [];
  $("#cullFaces").innerHTML = rows.map((row) => `<div class="cf-row">${row.map(({ m, f, st }, k) => {
    if (!f) return `<div class="cf none" data-k="${k}"></div>`;
    const src = urlOf(m, "face:" + f.id, m.closeups?.[f.id]);
    const open = Math.round((1 - Math.max(f.blinkL, f.blinkR)) * 100);
    const cls = st?.closed ? "closed" : st?.squint ? "squint" : st?.partial ? "part" : "open";
    return `<button class="cf ${cls} ${k === C.ci ? "on" : ""}" data-k="${k}">${src ? `<img src="${src}" alt="">` : ""}<span>${st?.squint ? esc(t("face.squint")) : open + "%"}</span></button>`;
  }).join("")}</div>`).join("");
  $("#cullFaces").hidden = !rows.length;
  if (newImage) loadImage(it);
}

async function loadImage(it) {
  stage().classList.remove("zoom"); C.zoom = false;
  const img = /** @type {HTMLImageElement} */ ($("#cullImg"));
  img.src = urlOf(it, "thumb", it.thumbBlob);
  const blob = it.isRaf ? await rafPreview(it.file) : it.file;
  if (!blob || cur() !== it) return;
  const url = URL.createObjectURL(blob);
  const full = new Image(); full.src = url;
  full.decode().then(() => {
    if (cur() !== it) { URL.revokeObjectURL(url); return; }
    if (C.url) URL.revokeObjectURL(C.url);
    C.url = url; img.src = url;
  }).catch(() => URL.revokeObjectURL(url));
}

function zoom() {
  const it = cur(); if (!it) return;
  const s = stage();
  if (C.zoom) { s.classList.remove("zoom"); C.zoom = false; return; }
  const b = it.ev?.target?.probe || it.ev?.target?.box || it.best?.box || [0, 0, it.W, it.H];
  const w = it.W / (window.devicePixelRatio || 1);
  $("#cullPic").style.setProperty("--zw", w + "px");
  s.classList.add("zoom"); C.zoom = true;
  requestAnimationFrame(() => { s.scrollLeft = ((b[0] + b[2]) / 2 / it.W) * w - s.clientWidth / 2; s.scrollTop = ((b[1] + b[3]) / 2 / it.H) * (w * it.H / it.W) - s.clientHeight / 2; });
}

function select(k) { const u = unit(); if (!u || k < 0 || k >= u.members.length) return; C.ci = k; render(true); }
function goUnit(d) {
  const n = C.ui + d;
  if (n < 0) return;
  if (n >= C.units.length) { closeCull(); emit("cullDone", {}); return; }
  C.ui = n; pickCandidate(); render(true);
}
function decide(flag) {
  const u = unit(), it = cur(); if (!it) return;
  emit("manual", { items: [it], patch: { flag, why: null } });
  if (u.members.length === 1) goUnit(1); else render();
}
/** Keep this frame, reject the rest of the group, move on. */
function keepThis() {
  const u = unit(), it = cur(); if (!it) return;
  emit("manual", { items: [it], patch: { flag: "pick", why: null } });
  const rest = u.members.filter((m) => m !== it && m.manual?.flag !== "pick");
  if (rest.length) emit("manual", { items: rest, patch: { flag: "reject", why: "group" } });
  goUnit(1);
}

/** @returns {boolean} whether the key was used */
export function cullKey(e) {
  const k = e.key.toLowerCase();
  if (k === "escape") closeCull();
  else if (k === "arrowright") select(C.ci + 1);
  else if (k === "arrowleft") select(C.ci - 1);
  else if (k === "arrowdown" || k === "n" || k === "pagedown") goUnit(1);
  else if (k === "arrowup" || k === "pageup") goUnit(-1);
  else if (k === "enter") keepThis();
  else if (k === "p" || k === " ") decide("pick");
  else if (k === "x" || k === "delete" || k === "backspace") decide("reject");
  else if (k === "u") { emit("manual", { items: [cur()], patch: { flag: null, why: null } }); render(); }
  else if (k === "z") zoom();
  else if (/^[1-9]$/.test(k)) select(+k - 1);
  else return false;
  return true;
}
/** Re-render after a decision made elsewhere. */
export function refreshCull() { if (C.open) render(); }

export function bindCull() {
  $("#cullClose").addEventListener("click", closeCull);
  $("#cullStrip").addEventListener("click", (e) => { const b = /** @type {HTMLElement} */ (e.target).closest("[data-k]"); if (b) select(+b.dataset.k); });
  $("#cullFaces").addEventListener("click", (e) => { const b = /** @type {HTMLElement} */ (e.target).closest("[data-k]"); if (b) select(+b.dataset.k); });
  stage().addEventListener("click", zoom);
  $("#cullActions").addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-a]"); if (!b) return;
    ({ keep: () => decide("pick"), reject: () => decide("reject"), keepThis, next: () => goUnit(1), prev: () => goUnit(-1) })[b.dataset.a]?.();
  });
  // swipe between frames, like the loupe
  let sx = 0, sy = 0;
  stage().addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage().addEventListener("touchend", (e) => {
    if (C.zoom) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) select(C.ci + (dx < 0 ? 1 : -1));
  });
}
