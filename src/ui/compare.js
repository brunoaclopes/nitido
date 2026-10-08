// @ts-check
import { $, el, esc, fmtPx, urlOf, pctBox } from "./dom.js";
import { t } from "../i18n/index.js";
import { emit } from "../app/state.js";
import { rafPreview } from "../core/raf.js";

const C = { open: false, items: [], urls: [], zoom: false, syncing: false };
export const cmpState = C;

export function openCompare(items) {
  C.items = items.slice(0, 4);
  if (C.items.length < 2) return;
  C.open = true; C.zoom = false;
  $("#cmp").hidden = false;
  render();
}
export function closeCompare() {
  C.open = false;
  $("#cmp").hidden = true;
  for (const u of C.urls) URL.revokeObjectURL(u);
  C.urls = [];
  $("#cmpGrid").textContent = "";
}

function render() {
  const grid = $("#cmpGrid");
  grid.textContent = "";
  grid.style.setProperty("--n", String(C.items.length));
  grid.classList.toggle("n4", C.items.length === 4);
  C.items.forEach((it, k) => {
    const pane = el("div", { class: "pane", "data-v": it.verdict });
    const box = it.ev.target?.probe || it.ev.target?.box;
    pane.innerHTML = `<div class="view"><div class="lbpic" style="--ar:${it.W / it.H}"><img alt=""><div class="boxes">${box ? `<div class="fb brackets" style="${pctBox(it, box)};--c:var(--ink)"></div>` : ""}</div></div></div>
      <div class="info"><b>${esc(t("verdict." + it.verdict))}</b><span>${esc(it.name)}</span><span class="num">${esc(fmtPx(it.ev.s))} · ${Math.round(it.ev.score)}</span>
      <span>${esc(it.ev.reasons.map((r) => t("reason." + r)).join(", "))}</span><span class="spacer"></span>
      <button class="btn small" data-k="${k}" data-a="choose">${esc(t("cmp.choose"))} <kbd>${k + 1}</kbd></button>
      <button class="btn small quiet" data-k="${k}" data-a="reject">${esc(t("act.reject"))}</button></div>`;
    grid.appendChild(pane);
    const img = /** @type {HTMLImageElement} */ (pane.querySelector("img"));
    img.src = urlOf(it, "thumb", it.thumbBlob);
    (async () => {
      const blob = it.isRaf ? await rafPreview(it.file) : it.file;
      if (!blob || !C.open) return;
      const u = URL.createObjectURL(blob); C.urls.push(u);
      const im = new Image(); im.src = u;
      im.decode().then(() => { if (C.open) img.src = u; }).catch(() => {});
    })();
    const view = /** @type {HTMLElement} */ (pane.querySelector(".view"));
    view.addEventListener("click", (e) => {
      const r = /** @type {HTMLElement} */ (view.querySelector(".lbpic")).getBoundingClientRect();
      toggleZoom((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });
    view.addEventListener("scroll", () => {
      if (C.syncing || !C.zoom) return;
      C.syncing = true;
      const fx = view.scrollLeft / Math.max(1, view.scrollWidth - view.clientWidth), fy = view.scrollTop / Math.max(1, view.scrollHeight - view.clientHeight);
      for (const v of grid.querySelectorAll(".view")) if (v !== view) { v.scrollLeft = fx * (v.scrollWidth - v.clientWidth); v.scrollTop = fy * (v.scrollHeight - v.clientHeight); }
      requestAnimationFrame(() => (C.syncing = false));
    });
  });
}

export function toggleZoom(fx, fy) {
  C.zoom = !C.zoom;
  const views = [...$("#cmpGrid").querySelectorAll(".view")];
  views.forEach((v, k) => {
    const it = C.items[k], pic = /** @type {HTMLElement} */ (v.querySelector(".lbpic"));
    v.classList.toggle("zoom", C.zoom);
    if (!C.zoom) return;
    const w = it.W / (window.devicePixelRatio || 1);
    pic.style.setProperty("--zw", w + "px");
    requestAnimationFrame(() => { C.syncing = true; v.scrollLeft = fx * w - v.clientWidth / 2; v.scrollTop = (fy * w * it.H) / it.W - v.clientHeight / 2; requestAnimationFrame(() => (C.syncing = false)); });
  });
}
/** Zoom all panes on the first photo's focus point. */
export function zoomFocus() {
  const it = C.items[0], b = it?.ev?.target?.probe || it?.ev?.target?.box;
  if (b) toggleZoom((b[0] + b[2]) / 2 / it.W, (b[1] + b[3]) / 2 / it.H); else toggleZoom(0.5, 0.5);
}
export function choose(k) {
  const it = C.items[k];
  if (!it) return;
  emit("manual", { items: [it], patch: { flag: "pick", why: null } });
  emit("manual", { items: C.items.filter((x) => x !== it), patch: { flag: "reject", why: "group" } });
  closeCompare();
}
export function bindCompare() {
  $("#cmpClose").addEventListener("click", closeCompare);
  $("#cmpGrid").addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("button[data-a]");
    if (!b) return;
    e.stopPropagation();
    const k = +b.dataset.k;
    if (b.dataset.a === "choose") choose(k);
    else { emit("manual", { items: [C.items[k]], patch: { flag: "reject" } }); b.closest(".pane").setAttribute("data-v", "reject"); }
  });
}
