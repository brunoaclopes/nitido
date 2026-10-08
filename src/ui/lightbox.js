// @ts-check
import { $, $$, esc, fmtPx, fmtPct, fmtShutter, fmtTime, fmtDate, fmtNum, urlOf, pctBox } from "./dom.js";
import { t } from "../i18n/index.js";
import { S, saveSettings, emit } from "../app/state.js";
import { unrotated } from "../core/geometry.js";
import { rafPreview } from "../core/raf.js";
import { LABEL_COLORS } from "./gallery.js";

const LB = { open: false, it: null, list: [], url: null, fullFor: null };
export const lbState = LB;
const stage = () => $("#stage");

export function openLightbox(it, list) {
  LB.list = list; LB.it = it; LB.open = true;
  $("#lb").hidden = false;
  stage().classList.remove("zoom");
  syncViews();
  render(true);
  $("#lbClose").focus({ preventScroll: true });
}
export function closeLightbox() {
  LB.open = false;
  $("#lb").hidden = true;
  stage().classList.remove("zoom");
  if (LB.url) { URL.revokeObjectURL(LB.url); LB.url = null; }
  /** @type {HTMLImageElement} */ ($("#lbImg")).removeAttribute("src");
  LB.it?.card?.focus({ preventScroll: false });
}
export function step(d) {
  if (!LB.list.length) return;
  let i = LB.list.indexOf(LB.it);
  i = (i + d + LB.list.length) % LB.list.length;
  LB.it = LB.list[i];
  stage().classList.remove("zoom");
  render(true);
}
export function stepGroup(d) {
  const g = LB.it?.group;
  let i = LB.list.indexOf(LB.it);
  while (i >= 0 && i < LB.list.length && LB.list[i].group === g) i += d;
  if (i >= 0 && i < LB.list.length) { LB.it = LB.list[i]; stage().classList.remove("zoom"); render(true); }
}

function syncViews() {
  const s = stage();
  s.classList.toggle("show-boxes", S.showBoxes);
  s.classList.toggle("show-faces", S.showFaces);
  s.classList.toggle("show-map", S.showMap);
  $("#vBoxes").setAttribute("aria-pressed", String(S.showBoxes));
  $("#vFaces").setAttribute("aria-pressed", String(S.showFaces));
  $("#vMap").setAttribute("aria-pressed", String(S.showMap));
}
export function toggleView(k) { S[k] = !S[k]; saveSettings(); syncViews(); }

const VCOL = { keep: "--good", review: "--doubt", reject: "--bad" };
const REASON_CLASS = { blur: "bad", motion: "bad", missed: "bad", eyes: "bad", blink: "warn", softer: "warn", shake: "warn", faceSoft: "warn", over: "warn", under: "warn", nodetail: "warn" };

function explain(it) {
  const ev = it.ev, parts = [];
  if (it.error) return t("why.error");
  const on = t("focusOn." + (ev.kind || "none"));
  if (ev.s != null) parts.push(t("why.measured", { on, px: fmtPx(ev.s), t: fmtPx(ev.T), p: Math.round(ev.p * 100) }));
  for (const r of ev.reasons) {
    const vars = { px: fmtPx(ev.s), best: fmtPx(ev.best), rel: fmtNum(r === "shake" ? ev.shakeRel : ev.rel, 1),
      pct: fmtPct(ev.overWhere === "face" ? ev.subjHi : it.exposure?.satClip ?? it.exposure?.hiClip) };
    parts.push(t(r === "over" && ev.overWhere === "frame" ? "why.overFrame" : "why." + r, vars));
  }
  if (ev.tags.includes("bokeh")) parts.push(t("why.bokeh", { pct: fmtPct(ev.softFrac) }));
  const m = it.meta || {};
  if (ev.tags.includes("camShake")) parts.push(t("why.camShake", { shutter: fmtShutter(m.exposure), focal: m.focal ? `${Math.round(m.focal)} mm` : "–" }));
  if (ev.tags.includes("camFocus")) parts.push(t("why.camFocus"));
  if (ev.tags.includes("camExposure")) parts.push(t("why.camExposure"));
  if (ev.pKeep != null) parts.push(t("why.personal", { p: Math.round(ev.pKeep * 100) }));
  if (it.manual?.flag) parts.push(t("why.manual"));
  return parts.join(" ");
}

function boxesHTML(it) {
  const ev = it.ev;
  let h = "";
  for (const tg of it.targets || []) {
    if (tg.kind === "eye" || tg.s == null) continue;
    if (tg === ev.target) continue;
    if (tg.kind === "af") h += `<div class="fb brackets af" style="${pctBox(it, tg.box)}"></div>`;
  }
  if (ev.target) {
    h += `<div class="fb brackets" style="${pctBox(it, ev.target.box)}"></div>`;
    if (ev.target.probe) h += `<div class="fb brackets probe" style="${pctBox(it, ev.target.probe)}"></div>`;
  }
  if (it.best && (ev.kind === "tile" || ev.reasons.includes("missed"))) h += `<div class="fb brackets alt" style="${pctBox(it, it.best.box)}"></div>`;
  return h;
}
function facesHTML(it) {
  const fs = it.ev.faces;
  return (fs.main || []).map((f) => {
    const st = fs.st.get(f), key = f === fs.key;
    const label = st.closed ? t("face.closed") : st.squint ? t("face.squint") : st.partial ? t("face.partial") : t("face.open");
    return `<div class="face ${key ? "key" : ""} ${st.closed ? "closed" : ""}" style="${pctBox(it, f.box)}"><b>${esc(label)}</b></div>`;
  }).join("");
}
function mapHTML(it) {
  if (!it.cells) return "";
  const { cols, rows, cells } = it.cells, T = it.ev.T;
  return cells.map((c, i) => {
    const x = i % cols, y = (i / cols) | 0;
    const cls = !c ? "none" : c.s <= T ? "sharp" : c.s <= T * 1.5 ? "mid" : "soft";
    return `<div class="cell ${cls}" style="left:${(x / cols) * 100}%;top:${(y / rows) * 100}%;width:${100 / cols}%;height:${100 / rows}%">${c ? fmtNum(c.s) : ""}</div>`;
  }).join("");
}

export function render(newImage = false) {
  const it = LB.it;
  if (!it || !LB.open) return;
  const ev = it.ev, m = it.meta || {};
  $("#lbName").textContent = it.name;
  const i = LB.list.indexOf(it);
  $("#lbPos").textContent = i >= 0 ? `${i + 1} / ${LB.list.length}` : "";
  const v = it.error ? "reject" : it.verdict;
  $("#verdict").style.setProperty("--c", `var(${VCOL[v]})`);
  $("#lbVerdict").textContent = it.error ? t("verdict.error") : t("verdict." + v) + (it.isBest ? " · " + t("card.best") : "");
  $("#lbWhy").textContent = explain(it);
  if (it.error) { $("#lbTags").innerHTML = ""; }
  else $("#lbTags").innerHTML = [...ev.reasons.map((r) => `<span class="${REASON_CLASS[r] || ""}">${esc(t("reason." + r))}</span>`),
    ...ev.tags.map((g) => `<span class="${g === "noise" || g.startsWith("cam") ? "warn" : "good"}">${esc(t("tag." + g))}</span>`)].join("");
  $$("#flagSeg button").forEach((b) => b.setAttribute("aria-pressed", String((it.manual?.flag || "") === b.dataset.flag)));
  const r = it.manual?.rating || 0;
  $("#starsIn").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" class="${n <= r ? "on" : ""}" aria-label="${n}">★</button>`).join("");
  const lc = it.manual?.label;
  $("#labelsIn").innerHTML = `<button class="none" data-label="" aria-label="${esc(t("lb.noLabel"))}"></button>` +
    Object.entries(LABEL_COLORS).map(([k, c]) => `<button data-label="${k}" class="${lc === k ? "on" : ""}" style="--lc:var(${c})" aria-label="${k}"></button>`).join("");

  const pic = $("#lbPic");
  pic.style.setProperty("--ar", it.W && it.H ? String(it.W / it.H) : "1.5");
  pic.style.setProperty("--c", `var(${VCOL[v]})`);
  $("#lbBoxes").innerHTML = it.ready && !it.error ? boxesHTML(it) : "";
  $("#lbFaces").innerHTML = it.ready && !it.error ? facesHTML(it) : "";
  $("#lbMap").innerHTML = it.ready && !it.error ? mapHTML(it) : "";

  // faces close-ups
  const fs = ev?.faces;
  $("#facesStrip").innerHTML = fs?.main?.length ? fs.main.map((f) => {
    const st = fs.st.get(f), src = urlOf(it, "face:" + f.id, it.closeups?.[f.id]);
    const cls = [f === fs.key ? "key" : "", st.closed ? "closed" : st.partial ? "part" : ""].join(" ");
    const open = Math.round((1 - Math.max(f.blinkL, f.blinkR)) * 100);
    return `<figure class="${cls}">${src ? `<img src="${src}" alt="">` : ""}<figcaption>${esc(st.closed ? t("face.closed") : st.squint ? t("face.squint") : t("face.openPct", { n: open }))}</figcaption></figure>`;
  }).join("") : "";

  const loupeKey = ev?.target?.id || "tile";
  const lsrc = urlOf(it, "loupe:" + loupeKey, it.loupes?.[loupeKey] || it.loupes?.tile);
  /** @type {HTMLImageElement} */ ($("#lbLoupe")).src = lsrc || "";
  $("#lbLoupeCap").textContent = ev ? t("lb.loupeCap", { on: t("focusOn." + (ev.kind || "none")) }) : "";

  // score breakdown
  if (ev) {
    const rows = [["sharp", 45], ["eyes", 20], ["expression", 8], ["exposure", 10], ["quality", 12], ["noise", 5]];
    $("#breakdown").innerHTML = `<div class="total"><span>${esc(t("bd.title"))}</span><span class="num">${Math.round(ev.score)}</span></div>` +
      rows.map(([k, max]) => `<div class="br"><span>${esc(t("bd." + k))}</span><i style="--w:${Math.max(0, (ev.breakdown[k] / max) * 100)}%"></i><span>${fmtNum(ev.breakdown[k], 0)}/${max}</span></div>`).join("") +
      (ev.breakdown.relative < -0.5 ? `<div class="br"><span>${esc(t("bd.relative"))}</span><i style="--w:${(-ev.breakdown.relative / 15) * 100}%;--bc:var(--bad)"></i><span>${fmtNum(ev.breakdown.relative, 0)}</span></div>` : "");
  } else $("#breakdown").innerHTML = "";

  // group
  const g = it.group;
  if (g && g.members.length > 1) {
    const pos = g.members.indexOf(it) + 1;
    $("#groupBox").innerHTML = `<div><b>${esc(g.name)}</b><br><span class="hint">${esc(t("lb.groupPos", { i: pos, n: g.members.length }))}${it.isBest ? " · " + esc(t("card.best")) : ""}</span></div>
      <div class="row-btns">${it.isBest ? "" : `<button class="btn small" data-edit="makeBest">${esc(t("lb.makeBest"))}</button>`}
      <button class="btn small" data-edit="compare">${esc(t("sec.compare"))}</button>
      <button class="btn small quiet" data-edit="detach">${esc(t("lb.detach"))}</button>
      ${pos > 1 ? `<button class="btn small quiet" data-edit="split">${esc(t("lb.split"))}</button>` : ""}</div>`;
  } else {
    $("#groupBox").innerHTML = `<div class="hint">${esc(t("lb.noGroup"))}</div><div class="row-btns"><button class="btn small quiet" data-edit="joinPrev">${esc(t("lb.joinPrev"))}</button></div>`;
  }

  // facts
  const { W0, H0 } = it.W ? unrotated(m, it.W, it.H) : { W0: 0, H0: 0 };
  const f35 = m.focal35 || (m.focal ? Math.round(m.focal * 1.5) : 0);
  const afMode = m.focusMode === 1 ? t("fact.mf") : m.afMode === 1 ? t("fact.single") : m.afMode === 256 ? t("fact.zone") : m.afMode === 512 ? t("fact.wide") : "–";
  const facts = [
    [t("fact.blur"), ev?.s != null ? fmtPx(ev.s) : "–"], [t("fact.focusOn"), t("focusOn." + (ev?.kind || "none"))],
    [t("fact.bestRegion"), fmtPx(ev?.best)], [t("fact.sharpArea"), fmtPct(ev?.sharpFrac)],
    [t("fact.noise"), it.sigma != null ? `σ ${fmtNum(it.sigma, 2)}` : "–"],
    [t("fact.exposure"), it.exposure ? t("fact.clipping", { hi: fmtPct(it.exposure.hiClip), lo: fmtPct(it.exposure.loClip) }) : "–"],
    [t("fact.clip"), it.clip ? t("fact.clipVal", { q: Math.round(it.clip.quality * 100), s: Math.round((it.clip.subjectSharp ?? it.clip.sharp) * 100) }) : t("fact.clipNone")],
    [t("fact.time"), it.time != null ? `${fmtDate(it.time)} ${fmtTime(it.time)}` : "–"],
    [t("fact.shutter"), fmtShutter(m.exposure)], [t("fact.aperture"), m.fnumber ? `f/${+m.fnumber.toFixed(1)}` : "–"],
    [t("fact.iso"), m.iso || "–"], [t("fact.focal"), m.focal ? `${Math.round(m.focal)} mm${f35 ? ` (${f35} mm eq.)` : ""}` : "–"],
    [t("fact.af"), afMode], [t("fact.size"), W0 ? `${W0}×${H0}` : "–"], [t("fact.camera"), [m.model, m.lens].filter(Boolean).join(" · ") || "–"],
    [t("fact.raf"), it.isRaf ? t("fact.rafOnly") : it.raf ? t("fact.rafYes") : t("fact.rafNo")],
  ];
  const camFlags = [m.blurWarning === 1 && t("fact.warnShake"), m.focusWarning === 1 && t("fact.warnFocus"), m.exposureWarning === 1 && t("fact.warnExposure")].filter(Boolean);
  if (camFlags.length) facts.push([t("fact.camWarn"), camFlags.join(", "), true]);
  $("#facts").innerHTML = facts.map(([k, val, warn]) => `<dt>${esc(k)}</dt><dd class="${warn ? "warn" : ""}">${esc(val)}</dd>`).join("");

  if (newImage) loadImage(it);
}

async function loadImage(it) {
  const img = /** @type {HTMLImageElement} */ ($("#lbImg"));
  img.src = urlOf(it, "thumb", it.thumbBlob);
  if (LB.url) { URL.revokeObjectURL(LB.url); LB.url = null; }
  const blob = it.isRaf ? await rafPreview(it.file) : it.file;
  if (!blob || LB.it !== it) return;
  const url = URL.createObjectURL(blob);
  LB.url = url;
  const full = new Image();
  full.decoding = "async";
  full.src = url;
  full.decode().then(() => { if (LB.url === url) img.src = url; }).catch(() => {});
}

/** Zoom to 100% around a point (fractions of the photo), or toggle back. */
export function zoomAt(fx, fy) {
  const it = LB.it, s = stage();
  if (!it?.W) return;
  if (s.classList.contains("zoom")) { s.classList.remove("zoom"); return; }
  const w = it.W / (window.devicePixelRatio || 1);
  $("#lbPic").style.setProperty("--zw", w + "px");
  s.classList.add("zoom");
  requestAnimationFrame(() => { s.scrollLeft = fx * w - s.clientWidth / 2; s.scrollTop = (fy * w * it.H) / it.W - s.clientHeight / 2; });
}
export function zoomFocus() {
  const it = LB.it;
  if (!it?.W) return;
  const b = it.ev?.target?.probe || it.ev?.target?.box || it.best?.box || [0, 0, it.W, it.H];
  zoomAt((b[0] + b[2]) / 2 / it.W, (b[1] + b[3]) / 2 / it.H);
}

export function bindLightbox() {
  $("#lbClose").addEventListener("click", closeLightbox);
  $("#lbPrev").addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
  $("#lbNext").addEventListener("click", (e) => { e.stopPropagation(); step(1); });
  $("#vBoxes").addEventListener("click", () => toggleView("showBoxes"));
  $("#vFaces").addEventListener("click", () => toggleView("showFaces"));
  $("#vMap").addEventListener("click", () => toggleView("showMap"));
  $("#vZoom").addEventListener("click", zoomFocus);
  stage().addEventListener("click", (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest(".nav-btn")) return;
    const r = $("#lbPic").getBoundingClientRect();
    zoomAt(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  });
  // swipe on touch screens
  let sx = 0, sy = 0;
  stage().addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage().addEventListener("touchend", (e) => {
    if (stage().classList.contains("zoom")) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });
  $("#flagSeg").addEventListener("click", (e) => { const b = /** @type {HTMLElement} */ (e.target).closest("button"); if (b) emit("manual", { items: [LB.it], patch: { flag: b.dataset.flag || null } }); });
  $("#starsIn").addEventListener("click", (e) => { const b = /** @type {HTMLElement} */ (e.target).closest("button"); if (b) { const n = +b.dataset.star; emit("manual", { items: [LB.it], patch: { rating: LB.it.manual?.rating === n ? null : n } }); } });
  $("#labelsIn").addEventListener("click", (e) => { const b = /** @type {HTMLElement} */ (e.target).closest("button"); if (b) emit("manual", { items: [LB.it], patch: { label: b.dataset.label || null } }); });
  $("#groupBox").addEventListener("click", (e) => { const b = /** @type {HTMLElement} */ (e.target).closest("[data-edit]"); if (b) emit("edit", { type: b.dataset.edit, it: LB.it }); });
}
