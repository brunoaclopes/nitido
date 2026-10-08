// End-to-end run in real headless Chrome, with the real models and real photos. Zero dependencies
// (Chrome DevTools Protocol over Node's built-in WebSocket, so Node ≥ 22).
//
//   node tests/browser.e2e.mjs --photos ~/Pictures/shoot [--only DSCF4793,DSCF4240] [--limit 40]
//                              [--shots out-dir] [--keep-cache] [--headed]
//
// Fails on any uncaught page error or console.error (except a missing ./models/manifest.json),
// when analysis does not finish, or when a photo ends in error. Screenshots of the gallery, the
// loupe and the compare view are written at desktop, tablet and phone widths.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf("--" + k); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes("--" + k);
const expand = (p) => p && p.replace(/^~(?=$|\/)/, homedir());

const PHOTOS = expand(opt("photos", process.env.NITIDO_PHOTOS));
if (!PHOTOS || !existsSync(PHOTOS)) { console.error("Pass --photos <folder> (or set NITIDO_PHOTOS)."); process.exit(2); }
const SHOTS = resolve(expand(opt("shots", join(tmpdir(), "nitido-shots"))));
const LIMIT = +opt("limit", 30);
const ONLY = (opt("only", "") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const CHROME = process.env.CHROME || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find(existsSync);
if (!CHROME) { console.error("Chrome not found; set CHROME=/path/to/chrome."); process.exit(2); }
if (typeof WebSocket !== "function") { console.error("Needs Node ≥ 22 (global WebSocket)."); process.exit(2); }

/* ---------- pick the photos: the named ones first, then an even spread, with their RAFs ---------- */
const all = readdirSync(PHOTOS).filter((f) => /\.(jpe?g|raf)$/i.test(f)).sort();
const stem = (f) => f.slice(0, -extname(f).length).toUpperCase();
const stems = [...new Set(all.map(stem))];
const chosen = new Set(ONLY.filter((s) => stems.includes(s)));
const step = Math.max(1, Math.floor(stems.length / Math.max(1, LIMIT - chosen.size)));
for (let i = 0; i < stems.length && chosen.size < LIMIT; i += step) chosen.add(stems[i]);
const files = all.filter((f) => chosen.has(stem(f))).map((f) => join(PHOTOS, f));
mkdirSync(SHOTS, { recursive: true });
console.log(`${chosen.size} photos (${files.length} files) from ${PHOTOS}`);

/* ---------- server and browser ---------- */
// --url tests a deployed copy (e.g. GitHub Pages) instead of a local server
const port = 4300 + Math.floor(Math.random() * 500), BASE = (opt("url") || `http://127.0.0.1:${port}/`).replace(/\/?$/, "/");
const server = opt("url") ? { kill() {} } : spawn(process.execPath, [join(ROOT, "server.mjs"), "--port", String(port)], { stdio: "ignore" });
const profile = mkdtempSync(join(tmpdir(), "nitido-chrome-"));
const chrome = spawn(CHROME, [
  flag("headed") ? "" : "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1440,900", "about:blank",
].filter(Boolean), { stdio: ["ignore", "ignore", "pipe"] });
let cleaned = false;
function cleanup() {
  if (cleaned) return; cleaned = true;
  try { chrome.kill(); } catch {} try { server.kill(); } catch {}
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 300);
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

const wsUrl = await new Promise((res, rej) => {
  let buf = "";
  const t = setTimeout(() => rej(new Error("Chrome did not start")), 20000);
  chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
});

/* ---------- a tiny CDP client ---------- */
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const waiting = new Map(), listeners = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); }
  else if (m.method) for (const l of listeners) l(m);
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq; waiting.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const page = (m, p) => send(m, p, sessionId);

const problems = [], logs = [];
listeners.push((m) => {
  if (m.sessionId !== sessionId) return;
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    problems.push(`uncaught: ${d.exception?.description || d.text}`);
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    logs.push(`[${m.params.type}] ${text}`);
    // MediaPipe writes its INFO lines through console.error; those are not failures
    if (m.params.type === "error" && !/^INFO:|XNNPACK/.test(text)) problems.push(`console.error: ${text}`);
  }
  if (m.method === "Log.entryAdded") {
    const { level, text, url = "" } = m.params.entry;
    if (level === "error" && !/models\/manifest\.json$/.test(url)) problems.push(`${text} ${url}`);
  }
});
await page("Runtime.enable"); await page("Log.enable"); await page("Page.enable"); await page("DOM.enable");

const evaluate = async (expression) => {
  const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expr, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evaluate(expr)) return; await sleep(400); }
  throw new Error(`timed out waiting for ${what}`);
}
async function viewport(width, height, mobile = false) {
  await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await sleep(350);
}
async function shot(name) {
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, name + ".png"), Buffer.from(data, "base64"));
}
const click = (sel) => evaluate(`(() => { const s = ${JSON.stringify(sel)}, n = document.querySelector(s); if (!n) throw new Error("no element " + s); n.click(); return true; })()`);
/** Elements that stick out of their scroll container, or overlap text — the "out of place" class of bug. */
const overflowReport = (scope) => evaluate(`(() => {
  const out = [];
  for (const root of document.querySelectorAll(${JSON.stringify(scope)})) {
    if (root.closest("[hidden]") || !root.offsetParent && root !== document.body) continue;
    const r = root.getBoundingClientRect();
    for (const n of root.querySelectorAll("*")) {
      if (n.closest("[hidden]") || !n.getClientRects().length) continue;
      const b = n.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.right > r.right + 1 || b.left < r.left - 1) out.push((n.id ? "#" + n.id : n.className || n.tagName) + " " + Math.round(b.left) + "→" + Math.round(b.right) + " (box " + Math.round(r.left) + "→" + Math.round(r.right) + ")");
    }
    if (root.scrollWidth > root.clientWidth + 1) out.push(${JSON.stringify(scope)} + " scrolls sideways: " + root.scrollWidth + " > " + root.clientWidth);
  }
  return [...new Set(out)].slice(0, 15);
})()`);

let failed = false;
const fail = (msg) => { failed = true; console.log("  ✗ " + msg); };
const ok = (msg) => console.log("  ✓ " + msg);

try {
  await viewport(1440, 900);
  await page("Page.navigate", { url: BASE });
  await until(`document.readyState === "complete" && !!document.querySelector("#picker")`, 20000, "page load");
  await evaluate(`localStorage.setItem("nitido-v3", JSON.stringify({ lang: "en", tier: ${JSON.stringify(opt("tier", "standard"))} })), location.reload(), true`).catch(() => {});
  await until(`document.readyState === "complete" && document.querySelector("[data-lang=en]")?.getAttribute("aria-pressed") === "true"`, 20000, "English UI");
  if (!flag("keep-cache")) await evaluate(`new Promise((r) => { const q = indexedDB.deleteDatabase("nitido"); q.onsuccess = q.onerror = q.onblocked = () => r(true); })`);
  await shot("01-empty-1440");
  ok("empty screen");

  /* ---------- analyse ---------- */
  const { result: input } = await page("Runtime.evaluate", { expression: `document.querySelector("#picker")` });
  const t0 = Date.now();
  // a webkitdirectory input only accepts a folder over CDP; hand it the files instead
  await evaluate(`document.querySelector("#picker").removeAttribute("webkitdirectory"), true`);
  await page("DOM.setFileInputFiles", { objectId: input.objectId, files });
  await until(`document.querySelector("#app").dataset.state !== "empty"`, 20000, "analysis to start");
  await sleep(1500);
  await shot("02-loading");
  await until(`document.querySelector("#app").dataset.state === "session" && document.querySelector("#progress").hidden`, 30 * 60000, "analysis to finish");
  const secs = (Date.now() - t0) / 1000;
  const tClip0 = Date.now();
  // CLIP finishes in the background after the pixel pass
  await until(`(() => { const s = document.querySelector("#aiStatus")?.textContent || ""; return !/loading|a carregar/i.test(s); })()`, 10 * 60000, "CLIP");
  // then every photo through it
  await until(`import(new URL("src/app/state.js", location.href).href).then(({ SESSION }) => { const r = SESSION.items.filter((i) => i.ready && !i.error); return /unavailable|off|indispon|deslig/i.test(document.querySelector("#aiStatus").textContent) || r.every((i) => i.clip); })`, 30 * 60000, "the similarity model on every photo");
  const cs = await evaluate(`import(new URL("src/ml/clip.js", location.href).href).then(({ clipStatus: c }) => ({ ms: c.ms, n: c.n, state: c.state, error: c.error }))`);
  console.log(`similarity model: ${cs.state}${cs.error ? " (" + cs.error + ")" : ""}, done ${((Date.now() - tClip0) / 1000).toFixed(0)} s after the pixel pass, ${cs.n ? (cs.ms / cs.n).toFixed(0) + " ms per photo" : "no photo"}`);
  await sleep(2500);
  const sum = await evaluate(`(() => {
    const cards = [...document.querySelectorAll(".card")];
    return { cards: cards.length, errors: cards.filter((c) => c.classList.contains("error") || /error|erro/i.test(c.querySelector(".chip")?.textContent || "")).map((c) => c.querySelector(".name")?.textContent),
      stats: [...document.querySelectorAll("#stats .stat b")].map((b) => +b.textContent), ai: [...document.querySelectorAll("#aiStatus span")].map((s) => s.textContent).join(" "),
      groups: [...document.querySelectorAll(".sec .gname")].map((g) => g.value) };
  })()`);
  console.log(`analysis: ${sum.cards} cards in ${secs.toFixed(0)} s (${(secs / chosen.size).toFixed(2)} s/photo) · keep/review/reject ${sum.stats.slice(0, 3).join("/")}`);
  console.log(`models: ${sum.ai}`);
  console.log(`groups: ${sum.groups.join(" | ") || "none"}`);
  if (opt("dump")) {
    // per-photo measurements, for calibrating the defaults in src/core/scoring.js
    const rows = await evaluate(`import(new URL("src/app/state.js", location.href).href).then(({ SESSION }) => SESSION.items.map((it) => ({
      name: it.name, verdict: it.verdict, reasons: it.ev?.reasons, coarse: it.coarse, rel: it.ev?.rel, a: it.ev?.target?.a, objects: (it.objects || []).map((o) => o.label), tags: it.ev?.tags, score: it.ev && Math.round(it.ev.score),
      s: it.ev?.s, kind: it.ev?.kind, best: it.best?.s, p: it.ev && +it.ev.p.toFixed(2), af: it.af, afMode: it.meta?.afMode, focusMode: it.meta?.focusMode,
      warn: { blur: it.meta?.blurWarning, focus: it.meta?.focusWarning, exposure: it.meta?.exposureWarning },
      faces: (it.faces || []).map((f) => ({ box: f.box.map(Math.round), blinkL: +f.blinkL.toFixed(2), blinkR: +f.blinkR.toFixed(2), smile: +f.smile.toFixed(2), squint: +(f.squint ?? 0).toFixed(2), yaw: +f.yaw.toFixed(2) })),
      group: it.group?.name, best_of_group: it.isBest, clip: it.clip })))`);
    writeFileSync(resolve(expand(opt("dump"))), JSON.stringify(rows, null, 1));
    console.log(`measurements: ${resolve(expand(opt("dump")))}`);
  }
  if (opt("dump-full")) {
    const json = await evaluate(`import(new URL("src/app/state.js", location.href).href).then(({ SESSION }) => JSON.stringify(SESSION.items.map((it) => {
      const o = {};
      for (const k of ["path", "name", "raf", "isRaf", "meta", "time", "W", "H", "exposure", "faces", "objects", "af", "sigma", "coarse", "cells", "best", "targets", "clip", "desc"]) o[k] = it[k];
      if (it.emb) o.emb = Array.from(it.emb, (v) => +v.toFixed(5));
      o.group = it.group?.id ?? null;
      if (o.desc) o.desc = { ...o.desc, c: Array.from(o.desc.c || []) };
      o.verdict = it.verdict; o.reasons = it.ev?.reasons;
      return o;
    })))`);
    writeFileSync(resolve(expand(opt("dump-full"))), json);
    console.log(`full measurements: ${resolve(expand(opt("dump-full")))}`);
  }
  sum.cards >= chosen.size ? ok("every photo has a card") : fail(`${sum.cards} cards for ${chosen.size} photos`);
  sum.errors.length ? fail("photos in error: " + sum.errors.join(", ")) : ok("no photo in error");
  /ready|pronto/i.test(sum.ai) ? ok("models ready") : fail("models: " + sum.ai);

  /* ---------- reanalyse: measured again from scratch, decisions kept ---------- */
  await evaluate(`import(new URL("src/app/state.js", location.href).href).then(({ SESSION, emit }) => { emit("manual", { items: [SESSION.items.find((i) => i.ready && !i.error)], patch: { flag: "reject" } }); return true; })`);
  await sleep(600);
  const flagged = await evaluate(`import(new URL("src/app/state.js", location.href).href).then(({ SESSION }) => SESSION.items.filter((i) => i.manual?.flag === "reject").map((i) => i.path).join())`);
  await click("#reanalyseBtn");
  await until(`document.querySelector("#app").dataset.state !== "session" || !document.querySelector("#progress").hidden`, 20000, "reanalysis to start");
  await until(`document.querySelector("#app").dataset.state === "session" && document.querySelector("#progress").hidden && /\d/.test(document.querySelector("#toast").textContent)`, 30 * 60000, "reanalysis");
  await sleep(800);
  const after = await evaluate(`import(new URL("src/app/state.js", location.href).href).then(({ SESSION }) => ({ flagged: SESSION.items.filter((i) => i.manual?.flag === "reject").map((i) => i.path).join(), toast: document.querySelector("#toast").textContent, n: SESSION.items.filter((i) => i.ready).length }))`);
  flagged && after.flagged === flagged && !/cache/i.test(after.toast) && after.n >= chosen.size
    ? ok(`reanalyse measured ${after.n} photos again and kept the decision (${flagged})`) : fail("reanalyse: " + JSON.stringify({ flagged, ...after }));
  await until(`!/loading/i.test([...document.querySelectorAll("#aiStatus span")].map((s) => s.textContent).join(" "))`, 10 * 60000, "CLIP after reanalyse");
  await sleep(1500);

  // the AI tier selector, with this machine's suggestion
  await evaluate(`document.querySelector("#tierSeg").scrollIntoView({ block: "center" }), true`); await sleep(300);
  await shot("03-ai-tier");
  console.log("  tier: " + await evaluate(`document.querySelector("#tierInfo").textContent + " | " + document.querySelector("#tierSuggest").textContent`));

  /* ---------- gallery at several widths ---------- */
  for (const [w, h, mobile] of [[1440, 900], [1100, 800], [820, 1000], [390, 844, true]]) {
    await viewport(w, h, mobile);
    await shot(`03-gallery-${w}`);
    const o = await overflowReport(".main");
    o.length ? fail(`gallery overflows at ${w}px: ${o.join("; ")}`) : ok(`gallery fits at ${w}px`);
  }
  // the tuning panel opens as a drawer on a phone and can be closed again
  await viewport(390, 844, true);
  await click("#menuBtn"); await sleep(400);
  await shot("03-drawer-390");
  const drawerOpen = await evaluate(`document.querySelector("#app").classList.contains("side-open")`);
  await click("#sideClose"); await sleep(400);
  const closedByButton = !(await evaluate(`document.querySelector("#app").classList.contains("side-open")`));
  await click("#menuBtn"); await sleep(300);
  await evaluate(`(() => { const r = document.querySelector("#side").getBoundingClientRect(); document.elementFromPoint(r.right + 20, 400)?.click(); return true; })()`); await sleep(300);
  const closedByBackdrop = !(await evaluate(`document.querySelector("#app").classList.contains("side-open")`));
  drawerOpen && closedByButton && closedByBackdrop ? ok("phone drawer opens and closes (button and backdrop)") : fail(`phone drawer: open ${drawerOpen}, close button ${closedByButton}, backdrop ${closedByBackdrop}`);
  await viewport(1440, 900);
  for (const v of ["review", "reject"]) {
    await click(`#verdictTabs [data-v=${v}]`); await sleep(300);
    await shot(`04-filter-${v}`);
    const empties = await evaluate(`[...document.querySelectorAll(".scene-break")].filter((b) => !b.hidden && (() => { let n = b.nextElementSibling; while (n && !n.classList.contains("scene-break")) { if (!n.hidden) return false; n = n.nextElementSibling; } return true; })()).length`);
    empties ? fail(`${empties} empty scene headers under ${v}`) : ok(`no empty scene headers under ${v}`);
  }
  await click(`#verdictTabs [data-v=all]`);

  /* ---------- loupe ---------- */
  const targets = ONLY.length ? ONLY : [];
  const names = await evaluate(`[...document.querySelectorAll(".card")].map((c) => c.querySelector(".name")?.textContent || "")`);
  const open = [...new Set([...targets.map((s) => names.find((n) => n.toUpperCase().startsWith(s))).filter(Boolean), names[0]])].slice(0, 8);
  for (const n of open) {
    await evaluate(`[...document.querySelectorAll(".card")].find((c) => c.querySelector(".name")?.textContent === ${JSON.stringify(n)}).click(), true`);
    await until(`!document.querySelector("#lb").hidden`, 5000, "loupe");
    await sleep(1200);
    const info = await evaluate(`({ verdict: document.querySelector("#lbVerdict").textContent, why: document.querySelector("#lbWhy").textContent, tags: [...document.querySelectorAll("#lbTags span")].map((s) => s.textContent) })`);
    console.log(`  ${n}: ${info.verdict} — ${info.tags.join(", ")}\n      ${info.why}`);
    for (const [w, h, mobile] of [[1440, 900], [820, 1000], [390, 844, true]]) {
      await viewport(w, h, mobile);
      await shot(`05-loupe-${n.replace(/\.\w+$/, "")}-${w}`);
      const o = await overflowReport("#lbPanel");
      o.length ? fail(`loupe panel overflows at ${w}px: ${o.join("; ")}`) : ok(`loupe panel fits at ${w}px`);
      // controls blown out of shape by a stray rule (a 98 px tall "no label" dot, once)
      const odd = await evaluate(`[...document.querySelectorAll("#lbPanel button")].filter((b) => b.getClientRects().length && b.getBoundingClientRect().height > 56).map((b) => (b.className || b.textContent) + " " + Math.round(b.getBoundingClientRect().height) + "px")`);
      if (odd.length) fail(`oversized buttons at ${w}px: ${odd.join(", ")}`);
    }
    await viewport(1440, 900);
    // the film recipe, further down the panel
    if (await evaluate(`!!document.querySelector("#lbRecipe .recipe-head")`)) {
      await evaluate(`document.querySelector("#lbRecipe").scrollIntoView({ block: "center" }), true`); await sleep(300);
      await shot(`05-recipe-${n.replace(/\.\w+$/, "")}`);
    } else console.log(`  (${n}: no film recipe in the file)`);
    await evaluate(`document.querySelector("#vZoom").click(), true`); await sleep(1500);
    await shot(`06-zoom-${n.replace(/\.\w+$/, "")}`);
    await click("#lbClose"); await sleep(200);
  }

  /* ---------- culling mode ---------- */
  await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true })), true`);
  await sleep(1200);
  if (await evaluate(`!document.querySelector("#cull").hidden`)) {
    for (const [w, h, mobile] of [[1440, 900], [390, 844, true]]) {
      await viewport(w, h, mobile); await sleep(500);
      await shot(`11-cull-${w}`);
      const o = await overflowReport("#cull");
      o.length ? fail(`culling mode overflows at ${w}px: ${o.join("; ")}`) : ok(`culling mode fits at ${w}px`);
    }
    await viewport(1440, 900);
    const key = (k) => evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true })), true`);
    const pos0 = await evaluate(`document.querySelector("#cullPos").textContent`);
    await key("ArrowRight"); await sleep(300); await key("Enter"); await sleep(800);
    const pos1 = await evaluate(`document.querySelector("#cullPos").textContent`);
    const single = / 1 of 1$/.test(pos0), closed = await evaluate(`document.querySelector("#cull").hidden`);
    single ? (closed ? ok("culling finishes after its only group") : fail("culling did not finish after its only group"))
      : pos0 !== pos1 ? ok(`culling advances (${pos0} → ${pos1})`) : fail(`culling did not advance from ${pos0}`);
    await shot("12-cull-next");
    await key("Escape"); await sleep(300);
  } else console.log("  (culling mode: nothing to cull in this sample)");

  /* ---------- calibration ---------- */
  await click("#calibBtn"); await sleep(600);
  if (await evaluate(`!document.querySelector("#calib").hidden`)) {
    await shot("13-calibration");
    const n = await evaluate(`(async () => { let n = 0; while (document.querySelector("#calibBody [data-y]") && n < 20) {
      const s = document.querySelector("#calibBody .cal-foot .num").textContent; document.querySelector(n % 3 ? "#calibBody [data-y='1']" : "#calibBody [data-y='0']").click(); n++; await new Promise((r) => setTimeout(r, 60)); } return n; })()`);
    await shot("14-calibration-result");
    const res = await evaluate(`document.querySelector("#calibBody").innerText`);
    n >= 6 ? ok(`calibration asked ${n} photos → ${res.split("\n")[0]}`) : fail(`calibration asked only ${n}`);
    await evaluate(`document.querySelector("#calibBody [data-a='close']")?.click(), true`);
  } else if (chosen.size >= 12) fail("calibration did not open");
  else console.log("  (calibration: too few photos in this sample)");

  /* ---------- finish ---------- */
  await click("#finishBtn"); await sleep(600);
  await shot("15-finish");
  const fo = await overflowReport("#finish .modal-card");
  fo.length ? fail(`finish dialog overflows: ${fo.join("; ")}`) : ok("finish dialog fits");
  await viewport(390, 844, true); await sleep(300); await shot("15-finish-390"); await viewport(1440, 900);
  await evaluate(`document.querySelector("#finish [data-a='close']").click(), true`);
  // the real copy and move code, on the browser's private file system (same API as a real folder)
  const fs = await evaluate(`(async () => {
    const { plan, execute } = await import(new URL("src/app/organize.js", location.href).href);
    const root = await navigator.storage.getDirectory();
    for await (const [n] of root.entries()) await root.removeEntry(n, { recursive: true });
    const src = await root.getDirectoryHandle("shoot", { create: true }), dest = await root.getDirectoryHandle("nas", { create: true });
    const put = async (d, n, size) => { const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(new Uint8Array(size).fill(7)); await w.close(); return (await d.getFileHandle(n)).getFile(); };
    const items = [];
    for (const [n, v] of [["0001", "keep"], ["0002", "review"], ["0003", "reject"]]) {
      const jpg = await put(src, "DSCF" + n + ".JPG", 300000 + +n), raf = await put(src, "DSCF" + n + ".RAF", 900000);
      items.push({ path: "DSCF" + n + ".JPG", name: "DSCF" + n + ".JPG", file: jpg, raf: "DSCF" + n + ".RAF", rafFile: raf, isRaf: false, verdict: v, time: Date.UTC(2026, 8, 15) });
    }
    const o = { dest: "copy", review: "keep", rejects: "move", layout: "date", xmp: false, folderName: "shoot", rejectFolder: "_rejects" };
    const r = await execute({ src, dest, plan: plan(items, o), o });
    const list = async (d, p = "") => { const out = []; for await (const [n, h] of d.entries()) h.kind === "file" ? out.push(p + n) : out.push(...await list(h, p + n + "/")); return out.sort(); };
    return { errors: r.errors, copied: r.photos.copied, moved: r.photos.moved, nas: await list(dest), shoot: await list(src) };
  })()`);
  const want = ["2026/2026-09-15/DSCF0001.JPG", "2026/2026-09-15/DSCF0001.RAF", "2026/2026-09-15/DSCF0002.JPG", "2026/2026-09-15/DSCF0002.RAF"];
  JSON.stringify(fs.nas) === JSON.stringify(want) && fs.shoot.includes("_rejects/DSCF0003.RAF") && !fs.shoot.includes("DSCF0003.JPG") && !fs.errors.length
    ? ok(`sorting on a real file system: ${fs.copied} copied, ${fs.moved} moved`) : fail("sorting on OPFS: " + JSON.stringify(fs));

  /* ---------- compare and help ---------- */
  const hasGroup = await evaluate(`!!document.querySelector('.sec [data-g="compare"]')`);
  if (hasGroup) {
    await click('.sec [data-g="compare"]'); await sleep(1500);
    await shot("07-compare");
    await evaluate(`document.querySelector("#cmpClose").click(), true`);
    ok("compare opens");
  }
  await click("#helpBtn"); await sleep(200); await shot("08-help");
  await click("#helpClose");

  /* ---------- export (the menu, without writing into the photo folder) ---------- */
  await page("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: SHOTS }, undefined).catch(() => {});
  await click("#exportBtn"); await sleep(200); await shot("09-export-menu");
  await click('[data-export="csv"]'); await sleep(800);
  ok("CSV export ran");

  /* ---------- language ---------- */
  await click('[data-lang="pt"]'); await sleep(500); await shot("10-gallery-pt");
  const leftovers = await evaluate(`[...document.querySelectorAll("body *")].filter((n) => !n.children.length && /^[a-z]+(\\.[a-zA-Z]+)+$/.test(n.textContent.trim())).map((n) => n.textContent.trim()).slice(0, 10)`);
  leftovers.length ? fail("untranslated keys on screen: " + leftovers.join(", ")) : ok("no raw i18n keys on screen");
} catch (e) {
  fail(String(e?.message || e));
  await shot("99-failure").catch(() => {});
}

if (problems.length) for (const p of [...new Set(problems)]) fail(p);
else ok("no page errors");
console.log(`screenshots: ${SHOTS}`);
if (flag("verbose")) console.log(logs.join("\n"));
cleanup();
process.exit(failed ? 1 : 0);
