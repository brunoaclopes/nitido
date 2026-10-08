import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExif, parseTime } from "../src/core/exif.js";
import { rafPreviewRange } from "../src/core/raf.js";
import { afPoint, cameraElements, mapper } from "../src/core/geometry.js";
import { edgeBlur, perceptualSim } from "../src/core/metrics.js";
import { cluster, buildGroups, bursts, applyEdits } from "../src/core/grouping.js";
import { evaluate, DEFAULTS, pickBest } from "../src/core/scoring.js";
import { train, predict } from "../src/core/learn.js";
import { buildXmp, mergeXmp } from "../src/core/xmp.js";
import { probesFor } from "../src/core/pixels.js";

/* ---------- helpers ---------- */
function ifd(entries, dataOff) {
  const head = [], extra = [];
  let extraLen = 0;
  const base = dataOff + 2 + 12 * entries.length + 4;
  const u16 = (n) => [n & 255, n >> 8], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
  head.push(...u16(entries.length));
  for (const [tag, type, count, bytes] of entries) {
    head.push(...u16(tag), ...u16(type), ...u32(count));
    if (bytes.length <= 4) head.push(...bytes, ...new Array(4 - bytes.length).fill(0));
    else { head.push(...u32(base + extraLen)); extra.push(...bytes); extraLen += bytes.length; }
  }
  head.push(0, 0, 0, 0);
  return [...head, ...extra];
}
const le16 = (...a) => a.flatMap((n) => [n & 255, n >> 8]);
const le32 = (...a) => a.flatMap((n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0)).concat(0);

function fakeJpeg({ orientation = 1, focusMode = 0, w = 7728, h = 5152, focus = [3864, 2576], elements = null } = {}) {
  const mnEntries = [[0x1021, 3, 1, le16(focusMode)], [0x1022, 3, 1, le16(1)], [0x1023, 3, 2, le16(...focus)], [0x1301, 3, 1, le16(0)]];
  if (elements) {
    mnEntries.push([0x4201, 1, elements.types.length, elements.types]);
    mnEntries.push([0x4203, 3, elements.pos.length, le16(...elements.pos)]);
  }
  const mn = [...ascii("FUJIFILM").slice(0, 8), ...le32(12), ...ifd(mnEntries, 12)];
  const model = ascii("X-H2");
  const build = (exifOff) => ifd([[0x0110, 2, model.length, model], [0x0112, 3, 1, le16(orientation)], [0x8769, 4, 1, le32(exifOff)]], 8);
  let i0 = build(0);
  const exifOff = 8 + i0.length;
  i0 = build(exifOff);
  const ex = ifd([[0x829a, 5, 1, le32(1, 250)], [0x829d, 5, 1, le32(28, 10)], [0x8827, 3, 1, le16(640)],
    [0xa002, 4, 1, le32(w)], [0xa003, 4, 1, le32(h)], [0x9003, 2, 20, ascii("2026:10:05 14:23:11")],
    [0x9291, 2, 3, ascii("45")], [0x927c, 7, mn.length, mn]], exifOff);
  const tiff = [0x49, 0x49, 42, 0, ...le32(8), ...i0, ...ex];
  const app1 = [...ascii("Exif"), 0, ...tiff];
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2]).buffer;
}
function gauss(g, w, h, s) {
  if (s <= 0) return g;
  const r = Math.ceil(3 * s), k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * s * s)); k.push(v); sum += v; }
  const kk = k.map((v) => v / sum), tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let j = -r; j <= r; j++) a += kk[j + r] * g[y * w + Math.min(w - 1, Math.max(0, x + j))]; tmp[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let j = -r; j <= r; j++) a += kk[j + r] * tmp[Math.min(h - 1, Math.max(0, y + j)) * w + x]; out[y * w + x] = a; }
  return out;
}
function scene(w, h, seed = 7) {
  let s = seed;
  const rnd = () => ((s = Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const g = new Float32Array(w * h).fill(120);
  for (let n = 0; n < 60; n++) {
    const x0 = rnd() * w, y0 = rnd() * h, x1 = x0 + 10 + rnd() * 60, y1 = y0 + 10 + rnd() * 60, v = 30 + rnd() * 200;
    for (let y = Math.max(0, y0 | 0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(w, x1); x++) g[y * w + x] = v;
  }
  return g;
}

/* ---------- EXIF / RAF / geometry ---------- */
test("parses EXIF and the Fujifilm MakerNote", () => {
  const m = parseExif(fakeJpeg());
  assert.equal(m.model, "X-H2");
  assert.equal(m.iso, 640);
  assert.equal(m.focusMode, 0);
  assert.deepEqual(m.focusPixel, [3864, 2576]);
  assert.equal(new Date(parseTime(m)).toISOString(), "2026-10-05T14:23:11.450Z");
});
test("AF point is ignored for manual focus", () => {
  const m = parseExif(fakeJpeg({ focusMode: 1 }));
  assert.equal(afPoint(m, 7728, 5152), null);
});
test("AF point uses the JPEG frame and follows rotation", () => {
  const m = parseExif(fakeJpeg({ orientation: 6, focus: [1000, 500] }));
  const [x, y] = afPoint(m, 5152, 7728); // decoded already rotated
  assert.deepEqual([Math.round(x), Math.round(y)], [5152 - 500, 1000]);
  const m169 = parseExif(fakeJpeg({ w: 7728, h: 4344, focus: [3864, 2172] }));
  assert.deepEqual(afPoint(m169, 7728, 4344).map(Math.round), [3864, 2172]);
});
test("camera subject elements map to eyes and faces", () => {
  const m = parseExif(fakeJpeg({ elements: { types: [1, 2, 3], pos: [3000, 1500, 3600, 2200, 3100, 1700, 3250, 1800, 3350, 1700, 3500, 1800] } }));
  const el = cameraElements(m, 7728, 5152);
  assert.deepEqual(el.map((e) => e.kind), ["face", "eye", "eye"]);
});
test("RAF header points at the embedded JPEG", () => {
  const buf = new Uint8Array(160);
  buf.set([..."FUJIFILMCCD-RAW"].map((c) => c.charCodeAt(0)));
  new DataView(buf.buffer).setUint32(84, 2048, false);
  new DataView(buf.buffer).setUint32(88, 9999, false);
  assert.deepEqual(rafPreviewRange(buf.buffer), { offset: 2048, length: 9999 });
});
test("mapper scales a smaller preview", () => {
  const m = { orientation: 1, w: 7728, h: 5152 };
  assert.deepEqual(mapper(m, 1920, 1280).pt(7728, 5152).map(Math.round), [1920, 1280]);
});

/* ---------- metrics ---------- */
test("edge blur estimator recovers the blur radius regardless of contrast", () => {
  const w = 192, h = 192, base = scene(w, h);
  for (const s of [1, 2, 3]) {
    const g = gauss(base, w, h, s);
    const r = edgeBlur({ g, w, h }, 0.5);
    assert.ok(Math.abs(r.s - Math.sqrt(s * s + 0.25)) < 0.45, `σ=${s} → ${r.s}`);
    const low = gauss(base.map((v) => 100 + (v - 120) * 0.15), w, h, s); // low-contrast "paint"
    const r2 = edgeBlur({ g: low, w, h }, 0.2);
    assert.ok(r2 && Math.abs(r2.s - r.s) < 0.5, `low contrast σ=${s}: ${r2?.s} vs ${r.s}`);
  }
});
test("a lone crisp edge across a flat area (sky, paint) measures as sharp", () => {
  const w = 144, h = 144, base = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) base[y * w + x] = y < 60 + 12 * Math.sin(x / 9) ? 150 : 40;
  for (const s of [0.7, 1.5, 3]) {
    const r = edgeBlur({ g: gauss(base, w, h, s), w, h }, 0.5);
    assert.ok(r && Math.abs(r.s - Math.sqrt(s * s + 0.25)) < 0.5, `σ=${s} → ${r?.s}`);
  }
});
test("probes cover small and large targets", () => {
  assert.ok(probesFor([100, 100, 300, 260], 4000, 3000).length >= 1);
  const big = probesFor([0, 0, 3000, 2000], 4000, 3000);
  assert.ok(big.length >= 4 && big.length <= 49);
});

/* ---------- grouping ---------- */
const photo = (path, time, h, c, extra = {}) => ({ path, time, desc: { h, c: new Uint8Array(48).fill(c), portrait: false }, ...extra });
test("clustering separates different scenes and keeps near-duplicates", () => {
  const a = [photo("a1", 0, [1, 2], 100), photo("a2", 1000, [1, 2], 102), photo("a3", 2000, [1, 3], 101)];
  const b = [photo("b1", 3000, [0xffff0000, 0xf0f0f0f0], 20), photo("b2", 4000, [0xffff0000, 0xf0f0f0f0], 22)];
  const sets = cluster([...a, ...b], 0.62);
  assert.equal(sets.length, 2);
  assert.ok(perceptualSim(a[0].desc, a[1].desc) > 0.9);
});
test("bursts, scenes and manual edits", () => {
  const items = [photo("p1", 0, [1, 2], 100), photo("p2", 400, [1, 2], 100), photo("p3", 900, [1, 2], 100), photo("p4", 2 * 3600e3, [9, 9], 30)];
  assert.equal(bursts(items, 1).length, 1);
  const { groups, scenes } = buildGroups(items, { groupMode: "similar", groupSim: 0.62, sceneGapMin: 10, burstGap: 1 }, null);
  assert.equal(scenes, 2);
  assert.equal(groups[0].members.length, 3);
  const edited = applyEdits([items.slice(0, 3), [items[3]]], { detach: ["p2"], split: [], join: [["p1", "p4"]] });
  assert.equal(edited.length, 2);
  assert.deepEqual(edited.map((g) => g.map((m) => m.path)).sort(), [["p1", "p3", "p4"], ["p2"]].sort());
});

/* ---------- scoring ---------- */
const S = { ...DEFAULTS };
const base = (o = {}) => ({ W: 7728, H: 5152, sigma: 1.5, exposure: { mean: 118, p50: 118, hiClip: 0, loClip: 0 },
  cells: { cols: 8, rows: 6, cells: new Array(48).fill(null).map(() => ({ s: 1.4, a: 1.1, n: 300, box: [0, 0, 10, 10] })) },
  best: { s: 1.3, box: [0, 0, 10, 10] }, targets: [], faces: [], ...o });
test("sharp AF target keeps; soft AF with sharp background is missed focus", () => {
  const keep = evaluate(base({ targets: [{ kind: "af", s: 1.5, a: 1.1 }] }), S);
  assert.equal(keep.verdict, "keep");
  const miss = evaluate(base({ targets: [{ kind: "af", s: 4.5, a: 1.1 }], best: { s: 1.4, box: [0, 0, 1, 1] } }), S);
  assert.equal(miss.verdict, "reject");
  assert.deepEqual(miss.reasons, ["missed"]);
});
test("smooth subject without edges falls back to the sharpest region instead of rejecting", () => {
  const ev = evaluate(base({ targets: [{ kind: "af", s: null }] }), S);
  assert.equal(ev.kind, "tile");
  assert.notEqual(ev.verdict, "reject");
});
test("closed eyes on the key face reject; the key face's eyes outrank the AF point", () => {
  const face = { id: "f1", box: [3000, 1500, 3600, 2200], blinkL: 0.9, blinkR: 0.85, yaw: 0, smile: 0 };
  const it = base({ faces: [face], targets: [{ kind: "eye", face: "f1", s: 1.6 }, { kind: "af", s: 1.2 }] });
  const ev = evaluate(it, S);
  assert.equal(ev.kind, "eye");
  assert.ok(ev.reasons.includes("eyes"));
  assert.equal(ev.verdict, "reject");
});
test("eyes narrowed by a broad smile are laughing, not closed; fully shut eyes still are", () => {
  const face = (blink, smile) => ({ id: "f1", box: [3000, 1500, 3600, 2200], blinkL: blink, blinkR: blink - 0.05, yaw: 0, smile });
  const laugh = evaluate(base({ faces: [face(0.75, 0.92)], targets: [{ kind: "eye", face: "f1", s: 1.4 }] }), S);
  assert.ok(!laugh.reasons.includes("eyes") && !laugh.reasons.includes("blink"), laugh.reasons.join());
  assert.ok(laugh.tags.includes("laughing"));
  assert.equal(laugh.verdict, "keep");
  const shut = evaluate(base({ faces: [face(0.97, 0.92)], targets: [{ kind: "eye", face: "f1", s: 1.4 }] }), S);
  assert.equal(shut.verdict, "reject");
  const blink = evaluate(base({ faces: [face(0.75, 0.1)], targets: [{ kind: "eye", face: "f1", s: 1.4 }] }), S);
  assert.ok(blink.reasons.includes("eyes"));
});
test("people are the subject only when the camera focused on them", () => {
  const face = (box, blink = 0.05) => ({ id: "f1", box, blinkL: blink, blinkR: blink, yaw: 0, smile: 0 });
  const small = [6000, 1200, 6200, 1450], big = [2000, 1000, 2900, 2100];   // 0.13% and 2.5% of the frame
  const soft = (id) => [{ kind: "eye", face: id, s: 3.5 }, { kind: "face", face: id, s: 3.6 }];
  // AF sharp on a building, a soft background face with closed eyes: kept
  const bg = evaluate(base({ af: [2000, 3000], faces: [face(small, 0.95)], targets: [...soft("f1"), { kind: "af", s: 1.1 }] }), S);
  assert.equal(bg.verdict, "keep", bg.reasons.join());
  assert.equal(bg.kind, "af");
  // AF sharp elsewhere, a prominent soft face: review, not reject
  const near = evaluate(base({ af: [6000, 3500], faces: [face(big)], targets: [...soft("f1"), { kind: "af", s: 1.1 }] }), S);
  assert.equal(near.verdict, "review");
  assert.deepEqual(near.reasons, ["faceSoft"]);
  // AF on the person's body: the person is the subject again, and a soft face is a reject
  const onBody = evaluate(base({ af: [2450, 3200], faces: [face(big)], targets: [...soft("f1"), { kind: "af", s: 1.1 }] }), S);
  assert.equal(onBody.kind, "eye");
  assert.equal(onBody.verdict, "reject");
  // AF elsewhere but soft too: the faces still decide (a real miss)
  const miss = evaluate(base({ af: [6000, 3500], faces: [face(big)], targets: [...soft("f1"), { kind: "af", s: 3.0 }] }), S);
  assert.equal(miss.verdict, "reject");
});
test("overexposure is judged on the face or a mostly white frame, not on white things elsewhere", () => {
  const face = { id: "f1", box: [2000, 1000, 2900, 2100], blinkL: 0, blinkR: 0, yaw: 0, smile: 0 };
  const shirt = evaluate(base({ exposure: { mean: 140, p50: 120, hiClip: 0.12, satClip: 0.1, loClip: 0 }, faces: [face], targets: [{ kind: "eye", face: "f1", s: 1.1, hi: 0 }] }), S);
  assert.ok(!shirt.reasons.includes("over"));
  const skin = evaluate(base({ exposure: { mean: 140, p50: 120, hiClip: 0.05, satClip: 0.04, loClip: 0 }, faces: [face], targets: [{ kind: "eye", face: "f1", s: 1.1, hi: 0.4 }] }), S);
  assert.equal(skin.overWhere, "face");
  const white = evaluate(base({ exposure: { mean: 215, p50: 255, hiClip: 0.62, satClip: 0.6, loClip: 0 }, targets: [{ kind: "af", s: 1.1, hi: 0 }] }), S);
  assert.equal(white.overWhere, "frame");
});
test("the camera's warnings are named, and its shake warning needs the measurement to agree", () => {
  const sharp = evaluate(base({ meta: { blurWarning: 1, focusWarning: 0 }, targets: [{ kind: "af", s: 1.0 }] }), S);
  assert.ok(!sharp.tags.some((t) => t.startsWith("cam")));
  const soft = evaluate(base({ meta: { blurWarning: 1, focusWarning: 1, exposureWarning: 1 }, targets: [{ kind: "af", s: 2.1 }] }), S);
  assert.deepEqual(soft.tags.filter((t) => t.startsWith("cam")), ["camShake", "camFocus", "camExposure"]);
});
test("bokeh is recognised and not penalised", () => {
  const cells = new Array(48).fill(null).map((_, i) => (i < 6 ? { s: 1.3, a: 1, n: 300, box: [0, 0, 1, 1] } : { s: 5, a: 1, n: 300, box: [0, 0, 1, 1] }));
  const ev = evaluate(base({ cells: { cols: 8, rows: 6, cells }, targets: [{ kind: "af", s: 1.3 }] }), S);
  assert.equal(ev.verdict, "keep");
  assert.ok(ev.tags.includes("bokeh"));
});
test("best of group prefers open eyes over slightly sharper closed eyes", () => {
  const f = (id, blink) => ({ id, box: [3000, 1500, 3600, 2200], blinkL: blink, blinkR: blink, yaw: 0, smile: 0.2 });
  const a = base({ path: "a", faces: [f("a", 0.9)], targets: [{ kind: "eye", face: "a", s: 1.3 }] });
  const b = base({ path: "b", faces: [f("b", 0.05)], targets: [{ kind: "eye", face: "b", s: 1.6 }] });
  const evals = new Map([[a, evaluate(a, S)], [b, evaluate(b, S)]]);
  assert.equal(pickBest([a, b], evals), b);
});

/* ---------- learning ---------- */
test("personal model learns a separable rule", () => {
  const data = [];
  for (let i = 0; i < 40; i++) { const f = (i % 10) / 10; data.push({ x: [f * 4 - 2, 0, 0, 0, 0, 0, 0], y: f > 0.45 ? 1 : 0 }); }
  const m = train(data);
  assert.ok(m && m.acc > 0.9);
  assert.ok(predict(m, [1.5, 0, 0, 0, 0, 0, 0]) > 0.5 && predict(m, [-1.5, 0, 0, 0, 0, 0, 0]) < 0.5);
});

/* ---------- XMP ---------- */
test("XMP build and in-place merge preserve foreign metadata", () => {
  const x = buildXmp({ rating: 4, label: "Green", pick: true, keywords: ["Nítido|keep"] });
  assert.match(x, /xmp:Rating="4"/);
  assert.match(x, /<rdf:li>Nítido\|keep<\/rdf:li>/);
  const lr = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" crs:Exposure2012="+0.35" xmp:Rating="2"><dc:subject><rdf:Bag><rdf:li>wedding</rdf:li><rdf:li>Nítido|reject</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`;
  const merged = mergeXmp(lr, { rating: 5, label: "Green", keywords: ["Nítido|keep"] });
  assert.match(merged, /crs:Exposure2012="\+0.35"/);
  assert.match(merged, /xmp:Rating="5"/);
  assert.doesNotMatch(merged, /xmp:Rating="2"/);
  assert.match(merged, /<rdf:li>wedding<\/rdf:li><rdf:li>Nítido\|keep<\/rdf:li>/);
  assert.doesNotMatch(merged, /Nítido\|reject/);
  const sc = mergeXmp(`<x:xmpmeta><rdf:RDF><rdf:Description rdf:about="" xmp:Rating="1"/></rdf:RDF></x:xmpmeta>`, { rating: 3, keywords: ["k"] });
  assert.match(sc, /xmp:Rating="3"[^>]*><dc:subject>/);
});
