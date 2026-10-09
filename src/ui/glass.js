// @ts-check
/** Liquid glass that bends light: each glass control gets an SVG filter that pulls the backdrop
 *  inward near its rim and leaves the flat middle straight, as the curved edge of a lens does (the rim
 *  highlight is the CSS ::before). After kube.io's "Liquid Glass in
 *  the browser" and rdev/liquid-glass-react. Only Chromium renders SVG filters as a backdrop-filter;
 *  elsewhere the CSS frosted glass stays. */

const TARGETS = [
  ".top .btn:not(.quiet)", ".top .seg", ".top .search", ".top .icon-btn",
  ".toolbar .tabs", ".toolbar .select", ".toolbar .icon-btn", ".selbar",
  ".menu", ".toast", ".nav-btn", ".modal-card", ".help-card", ".drop",
].join(",");
const NS = "http://www.w3.org/2000/svg";

const chromium = () => {
  const ua = navigator.userAgent;
  return !!(/** @type {any} */ (navigator).userAgentData?.brands?.some((b) => /Chromium/.test(b.brand))
    || (/Chrome\/|Edg\//.test(ua) && !/Firefox|FxiOS|CriOS|EdgiOS/.test(ua)));
};
const lessGlass = () => matchMedia("(prefers-reduced-transparency: reduce)").matches;

let svg = null, seq = 0;
const filters = new Map(); // "w×h r" → filter: controls of the same size and radius share one
function filterFor(w, h, r) {
  const key = `${w}x${h}r${r}`;
  if (filters.has(key)) return filters.get(key);
  // pills bend across most of their height, panels only near the rim
  const bezel = Math.max(8, Math.min(r > 0 ? r * 1.2 : 18, h * 0.42, w * 0.42, 28));
  const scale = Math.round(Math.min(44, bezel * 1.25));
  const id = `lg${++seq}`;
  const box = `x="0" y="0" width="${w}" height="${h}"`;
  const inset = Math.round(bezel * 0.3), sigma = (bezel * 0.5).toFixed(1), k = (bezel * 0.55).toFixed(2);
  const f = document.createElementNS(NS, "filter");
  f.setAttribute("id", id);
  for (const [a, v] of Object.entries({ x: 0, y: 0, width: w, height: h, filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" })) f.setAttribute(a, String(v));
  // The lens is built from filter primitives only (Chrome ignores feImage maps in a backdrop-filter):
  // the shape, inset and blurred, is a height field that falls off towards the rim; its slope, taken
  // with a small convolution, is the sideways shift (R = x, G = y, 0.5 = none). Flat in the middle,
  // steepest at the rim, so the edge pulls in what lies under the glass, as a curved edge would.
  // Chrome keeps the rounded clip only for some chains: every primitive spans the whole box (else the
  // result shrinks to the inset shape), and neither feBlend (colour fringing) nor a blur of the backdrop
  // is in the filter; the frost is a CSS blur after it.
  f.innerHTML = `<feFlood flood-color="#fff" x="${inset}" y="${inset}" width="${Math.max(1, w - 2 * inset)}" height="${Math.max(1, h - 2 * inset)}" result="core"/>
    <feGaussianBlur in="core" stdDeviation="${sigma}" ${box} result="soft"/>
    <feColorMatrix in="soft" type="matrix" values="0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1" ${box} result="height"/>
    <feConvolveMatrix in="height" order="3 1" kernelMatrix="-${k} 0 ${k}" divisor="1" bias="0.5" preserveAlpha="true" ${box} result="gx"/>
    <feConvolveMatrix in="height" order="1 3" kernelMatrix="-${k} 0 ${k}" divisor="1" bias="0.5" preserveAlpha="true" ${box} result="gy"/>
    <feColorMatrix in="gx" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" ${box} result="rx"/>
    <feColorMatrix in="gy" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1" ${box} result="ry"/>
    <feComposite in="rx" in2="ry" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" ${box} result="map"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" ${box} result="bent"/>
    <feColorMatrix in="bent" type="saturate" values="1.6" ${box}/>`;
  svg.appendChild(f);
  filters.set(key, { id });
  return filters.get(key);
}

let ro = null, mo = null, on = false;
const applied = new Map(); // element → filter id
function fit(el) {
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (!w || !h || w * h > 1.2e6) { el.style.removeProperty("backdrop-filter"); applied.delete(el); return; }
  const r = Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0);
  // menus, dialogs and the toast are frosted (text sits on them); controls stay clear
  const frost = el.matches(".menu,.modal-card,.help-card,.toast,.selbar,.drop") ? 14 : el.matches(".toolbar *") ? 4 : 0;
  const rr = Math.min(r, Math.floor(Math.min(w, h) / 2));
  const { id } = filterFor(w, h, rr);
  applied.set(el, id);
  if (scrolling && overScroll(el)) return;
  el.style.setProperty("backdrop-filter", `url(#${id})` + (frost ? ` blur(${frost}px)` : ""));
  // sizes change (a window resize, a longer label): drop the filters no control uses any more
  if (filters.size > applied.size + 24) {
    const used = new Set(applied.values());
    for (const [key, f] of filters) if (!used.has(f.id)) { filters.delete(key); svg.querySelector("#" + f.id)?.remove(); }
  }
}
// While the gallery scrolls, the controls over it would re-run their filter every frame (Chrome runs
// SVG filters on the CPU) and photos coming into view would wait for paint: they turn to plain frosted
// glass until the scrolling stops.
let scrollTimer = 0, scrolling = false;
const overScroll = (el) => el.matches(".toolbar *,.selbar");
function onScroll(e) {
  if (!(/** @type {Element} */ (e.target)).matches?.("#scroller")) return;
  if (!scrolling) {
    scrolling = true;
    for (const [el, id] of applied) if (overScroll(el)) el.style.setProperty("backdrop-filter", "blur(6px) saturate(160%)");
  }
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    scrolling = false;
    for (const el of applied.keys()) if (overScroll(el)) fit(el);
  }, 180);
}

function attach() {
  for (const el of document.querySelectorAll(TARGETS)) if (!applied.has(el)) { ro.observe(el); fit(el); }
}

/** Turns the bending glass on or off (on only with the glass theme, in Chromium, without reduced transparency). */
export function setLiquidGlass(want) {
  const next = want && chromium() && !lessGlass();
  if (next === on) return;
  on = next;
  if (on) {
    if (!svg) { svg = document.createElementNS(NS, "svg"); svg.setAttribute("aria-hidden", "true"); svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden"; document.body.appendChild(svg); }
    ro = new ResizeObserver((es) => { for (const e of es) fit(/** @type {HTMLElement} */ (e.target)); });
    // menus and tabs come and go: pick up new glass controls as they appear
    let queued = 0;
    mo = new MutationObserver(() => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; if (on) attach(); }); });
    mo.observe(document.body, { childList: true, subtree: true });
    attach();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.documentElement.classList.add("lg-refract");
  } else {
    ro?.disconnect(); mo?.disconnect(); ro = mo = null;
    document.removeEventListener("scroll", onScroll, { capture: true });
    clearTimeout(scrollTimer); scrolling = false;
    for (const el of applied.keys()) el.style.removeProperty("backdrop-filter");
    applied.clear();
    document.documentElement.classList.remove("lg-refract");
  }
}
export const liquidGlassOn = () => on;
