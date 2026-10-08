// End-to-end smoke test: boots the real app with a stub DOM and fake workers, drops a fake folder,
// and checks the session, grouping, verdicts, loupe, language switch and exports run without errors.
// Run: node tests/smoke.dom.mjs
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const errors = [];
const listeners = {};
const downloads = [];

function mkEl(id = "", tag = "div") {
  const kids = [];
  const el = {
    id, tagName: tag.toUpperCase(), children: kids, _l: {}, hidden: false, value: "", checked: false, disabled: false, files: [],
    dataset: {}, style: { setProperty() {}, removeProperty() {} }, textContent: "", _html: "", offsetParent: {}, offsetWidth: 200,
    clientWidth: 300, clientHeight: 120, width: 0, height: 0, scrollLeft: 0, scrollTop: 0, parentElement: null, isConnected: true,
    classList: { s: new Set(), add(...c) { c.forEach((x) => this.s.add(x)); }, remove(...c) { c.forEach((x) => this.s.delete(x)); },
      toggle(c, f) { (f ?? !this.s.has(c)) ? this.s.add(c) : this.s.delete(c); return this.s.has(c); }, contains(c) { return this.s.has(c); } },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    addEventListener(t, f) { (this._l[t] ||= []).push(f); },
    setAttribute(k, v) { this["@" + k] = String(v); }, getAttribute(k) { return this["@" + k] ?? null; }, removeAttribute() {},
    appendChild(c) { kids.push(c); if (c && typeof c === "object") c.parentElement = el; return c; }, prepend(c) { kids.unshift(c); }, remove() {},
    querySelector(s) { return (el._q ||= {})[s] ||= mkEl("q:" + s); }, querySelectorAll() { return []; }, closest() { return null; }, contains() { return false; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 120 }; },
    getContext() { return new Proxy({}, { get: (_, k) => (k === "getImageData" ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : () => {}) }); },
    focus() {}, click() { if (tag === "a") downloads.push(el["@download"] || el.download); }, scrollIntoView() {}, setPointerCapture() {},
  };
  return el;
}
const els = {};
for (const m of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) els[m[2]] = mkEl(m[2], m[1]);
els.app.dataset.state = "empty";
const document = {
  documentElement: mkEl("html"), body: mkEl("body"), activeElement: null,
  querySelector(s) { const m = /^#([\w-]+)$/.exec(s); if (m) return els[m[1]] || null; if (s === "#scroller > .none") return null; return mkEl("q:" + s); },
  querySelectorAll() { return []; }, getElementById: (id) => els[id] || null,
  createElement: (t) => mkEl("", t), createDocumentFragment: () => mkEl("frag"),
  addEventListener(t, f) { (listeners["doc:" + t] ||= []).push(f); },
};

// ---- fake pixel worker: synthetic measurements, two visual "scenes" ----
let decodes = 0;
class FakeWorker {
  constructor(url) { this.url = String(url); }
  postMessage(msg) {
    setTimeout(() => {
      const { id, op, key } = msg;
      let r;
      if (this.url.includes("clip")) { this.onmessage?.({ data: { id, error: "no clip in test" } }); return; }
      if (op === "ping") r = true;
      else if (op === "decode") {
        decodes++;
        const n = parseInt(key.match(/DSCF(\d+)/)[1], 10);
        const scene = n <= 4 ? 0 : 1;
        r = {
          meta: { model: "X-H2", orientation: 1, w: 7728, h: 5152, focusMode: n === 6 ? 1 : 0, focusPixel: [3864, 2576], iso: 640, exposure: 1 / 250, fnumber: 2.8, focal: 56 },
          time: Date.UTC(2026, 9, 5, 14, 0, 0) + n * 700 + scene * 3600e3, W: 7728, H: 5152, thumb: new Blob(["x"]),
          small: { width: 1920, height: 1280, close() {} }, smallScale: 1920 / 7728,
          clip: { data: new Uint8ClampedArray(224 * 224 * 4), width: 224, height: 224 },
          desc: { h: scene ? [0xffff0000, 0xf0f0f0f0] : [1, 2], c: new Uint8Array(48).fill(scene ? 30 : 120), portrait: false },
          exposure: { mean: 118, p50: 118, p01: 5, p99: 240, hiClip: 0, loClip: 0 },
        };
      } else if (op === "measure") {
        const n = parseInt(key.match(/DSCF(\d+)/)[1], 10);
        const s = n === 3 ? 4.8 : n === 6 ? 1.4 : 1.2 + n * 0.05;
        const cells = Array.from({ length: 48 }, (_, i) => ({ s: i < 10 ? 1.3 : 3.5, a: 1.1, n: 300, box: [0, 0, 192, 192] }));
        r = { sigma: 1.4, cells: { cols: 8, rows: 6, cells }, best: { s: 1.3, box: [0, 0, 192, 192] },
          targets: msg.plan.targets.map((t) => ({ id: t.id, kind: t.kind, box: t.box, s, n: 400, probe: t.box, a: 1.1 })),
          loupes: {}, closeups: {}, subject224: null, scale: 1 };
      }
      this.onmessage?.({ data: { id, r } });
    }, 2);
  }
  terminate() {}
}

Object.assign(globalThis, {
  document, window: globalThis, Worker: FakeWorker, localStorage: { getItem: () => JSON.stringify({ ai: { faces: false, objects: false, clip: false } }), setItem() {} },
  getComputedStyle: () => ({ getPropertyValue: () => "#fff" }), requestAnimationFrame: (f) => setTimeout(f, 0), devicePixelRatio: 2,
  location: { protocol: "http:" }, confirm: () => true, Image: class { decode() { return Promise.resolve(); } },
  addEventListener(t, f) { (listeners[t] ||= []).push(f); }, self: globalThis, top: globalThis,
  OffscreenCanvas: class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return { putImageData() {}, drawImage() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) }; } convertToBlob() { return Promise.resolve(new Blob(["j"])); } },
  createImageBitmap: async () => ({ width: 224, height: 224, close() {} }),
});
URL.createObjectURL = () => "blob:x"; URL.revokeObjectURL = () => {};
Object.defineProperty(globalThis, "navigator", { value: { language: "pt-PT", hardwareConcurrency: 8, deviceMemory: 8 }, configurable: true });
process.on("unhandledRejection", (e) => errors.push("unhandled: " + (e?.stack || e)));
const origErr = console.error; console.error = (...a) => { errors.push(a.join(" ")); origErr(...a); };

await import("../src/main.js");
console.log("boot ok, state:", els.app.dataset.state);

// drop a folder: 8 JPEG + 8 RAF, two scenes
const names = Array.from({ length: 8 }, (_, i) => `DSCF${String(i + 1).padStart(4, "0")}`).flatMap((b) => [`${b}.JPG`, `${b}.RAF`]);
const fileEntry = (name) => ({ isFile: true, isDirectory: false, name, file: (res) => res(Object.assign(new Blob(["x"]), { name, lastModified: 1 })) });
const dir = { isFile: false, isDirectory: true, name: "sessao-carros", createReader() { let d = false; return { readEntries(res) { if (d) return res([]); d = true; res(names.map(fileEntry)); } }; } };
const ev = { preventDefault() {}, dataTransfer: { types: ["Files"], files: [], items: [{ kind: "file", webkitGetAsEntry: () => dir }] } };
await listeners.drop[0](ev);
await new Promise((r) => setTimeout(r, 1500));

const { SESSION, S } = await import("../src/app/state.js");
const items = SESSION.items;
const summary = items.map((i) => `${i.name.slice(4, 8)}:${i.verdict}${i.isBest ? "*" : ""}${i.ev?.reasons.length ? "(" + i.ev.reasons.join(",") + ")" : ""}`).join(" ");
console.log("toast:", els.toast.textContent); console.log("state:", els.app.dataset.state, "| photos:", items.length, "| decodes:", decodes, "| groups:", SESSION.groups.map((g) => g.members.length).join("+"));
console.log("verdicts:", summary);
console.log("DSCF0006 (manual focus) focus kind:", items[5].ev.kind, "| af:", items[5].af);

// open loupe, switch language, change strictness, export
const { openLightbox, closeLightbox, render } = await import("../src/ui/lightbox.js");
openLightbox(items[2], items); render(); closeLightbox();
for (const b of [{ dataset: { lang: "en" } }]) S.lang = b.dataset.lang;
const { setLang, t } = await import("../src/i18n/index.js");
setLang("en");
const { recompute } = await import("../src/app/model.js");
S.strictness = "strict"; recompute({ regroup: true });
const { layout, refresh } = await import("../src/ui/gallery.js");
layout(); refresh();
const ex = await import("../src/app/exporter.js");
ex.exportCsv(); ex.exportJson(); ex.exportMoveScripts(); await ex.exportXmp();
console.log("downloads:", downloads.join(", "));
console.log("group names:", SESSION.groups.filter((g) => g.members.length > 1).map((g) => g.name).join(" | "), "|", t("verdict.keep"));
const st = await import("../src/app/state.js");
st.emit("manual", { items: [items[1]], patch: { flag: "pick", rating: 5 } });
st.emit("edit", { type: "detach", it: items[2] });
st.emit("edit", { type: "split", it: items[6] });
console.log("after edits — groups:", SESSION.groups.map((g) => g.members.length).join("+"), "| 0002 best:", items[1].isBest, "verdict:", items[1].verdict);
// culling mode: keep the shown frame, reject the rest, move through the queue
const cull = await import("../src/ui/cull.js");
const opened = cull.openCull({ only: "all" });
const before = cull.cullState.units.length;
cull.cullKey({ key: "ArrowRight" }); cull.cullKey({ key: "Enter" }); cull.cullKey({ key: "x" }); cull.cullKey({ key: "Escape" });
console.log("culling:", opened ? `${before} units` : "nothing", "| decided by hand:", items.filter((i) => i.manual?.flag).length);
// calibration: candidates and a fitted limit
const cal = await import("../src/ui/calibrate.js");
console.log("calibration fit (soft above 2.0):", cal.fitLimit([0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.8].map((s) => ({ s, y: s < 2 }))));
// finish: the dialog renders in the no-write fallback and can produce scripts
const fin = await import("../src/ui/finish.js");
await fin.openFinish();
console.log("finish dialog:", els.finishBody.innerHTML.includes("data-a=\"script\"") ? "script fallback" : "write mode");
fin.closeFinish();
// reanalyse: every photo decoded again (no cache), decisions kept
const decodesBefore = decodes, decided = SESSION.items.filter((i) => i.manual?.flag).map((i) => i.path).sort().join();
els.reanalyseBtn._l.click[0]();
await new Promise((r) => setTimeout(r, 1500));
const decidedAfter = SESSION.items.filter((i) => i.manual?.flag).map((i) => i.path).sort().join();
console.log("reanalyse:", `${decodes - decodesBefore} decoded again`, "| decisions kept:", decided === decidedAfter && decided !== "" ? "yes" : `NO (${decided} → ${decidedAfter})`);
if (decodes - decodesBefore !== SESSION.items.length || decided !== decidedAfter) errors.push("reanalyse did not measure everything again or lost decisions");
const { trainPersonal } = await import("../src/app/model.js");
console.log("personal model with 1 decision:", trainPersonal().model === null ? "needs more (ok)" : "trained");
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
process.exit(errors.length ? 1 : 0);
