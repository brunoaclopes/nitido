// Regenerates the README screenshots in docs/ from a folder of real photos, in headless Chrome.
//   node scripts/readme-shots.mjs --photos ~/Pictures/shoot --names DSCF0001,DSCF0002,… [--title "Capri · Sept 2026"]
// Pick photos without people. Needs Node ≥ 22 and Chrome.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf("--" + k); return i < 0 ? d : args[i + 1]; };
const PHOTOS = (opt("photos") || "").replace(/^~(?=\/)/, homedir());
const NAMES = new Set((opt("names") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
const TITLE = opt("title", "Capri · September 2026");
const OUT = join(ROOT, "docs");
if (!PHOTOS || !existsSync(PHOTOS) || !NAMES.size) { console.error("Pass --photos <folder> --names DSCF0001,…"); process.exit(2); }
const files = readdirSync(PHOTOS).filter((f) => /\.(jpe?g|raf)$/i.test(f) && NAMES.has(f.replace(/\.\w+$/, "").toUpperCase())).sort().map((f) => join(PHOTOS, f));
mkdirSync(OUT, { recursive: true });

const port = 4800 + Math.floor(Math.random() * 100);
const server = spawn(process.execPath, [join(ROOT, "server.mjs"), "--port", String(port)], { stdio: "ignore" });
const profile = mkdtempSync(join(tmpdir(), "nitido-shots-"));
const CHROME = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const done = (code) => { chrome.kill(); server.kill(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 300); };

const wsUrl = await new Promise((r) => { let b = ""; chrome.stderr.on("data", (d) => { b += d; const m = b.match(/ws:\/\/\S+/); if (m) r(m[0]); }); });
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const wait = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(String(e.data)); if (wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const id = ++seq; wait.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
const page = async (m, p) => { const r = await send(m, p, sessionId); if (r.error) throw new Error(`${m}: ${r.error.message}`); return r.result; };
const js = async (expression) => { const r = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (expr, ms = 600000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr)) return; await sleep(400); } throw new Error("timeout: " + expr); };
const size = (width, height, mobile = false) => page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 3 : 2, mobile }).then(() => sleep(400));
const key = (k) => js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true })), true`);
async function shot(name) {
  await js(`document.activeElement?.blur(), document.querySelector("#toast").classList.remove("show"), true`);
  const { data } = await page("Page.captureScreenshot", { format: "webp", quality: 82 });
  writeFileSync(join(OUT, name + ".webp"), Buffer.from(data, "base64"));
  console.log("  docs/" + name + ".webp");
}

try {
  await page("Runtime.enable"); await page("Page.enable");
  await size(1440, 900);
  await page("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await until(`document.readyState === "complete" && !!document.querySelector("#picker")`, 20000);
  await js(`localStorage.setItem("nitido-v3", JSON.stringify({ lang: "en" })), location.reload(), true`).catch(() => {});
  await until(`document.readyState === "complete" && !!document.querySelector("#picker")`, 20000);
  await js(`document.querySelector("#picker").removeAttribute("webkitdirectory"), true`);
  const { result: input } = await page("Runtime.evaluate", { expression: `document.querySelector("#picker")` });
  await page("DOM.enable");
  await page("DOM.setFileInputFiles", { objectId: input.objectId, files });
  console.log(`analysing ${files.length} files…`);
  await until(`document.querySelector("#app").dataset.state === "session" && document.querySelector("#progress").hidden`);
  await until(`!/loading/i.test([...document.querySelectorAll("#aiStatus span")].map((s) => s.textContent).join(" "))`);
  await sleep(3000);
  // a folder name, as when the shoot is opened with Choose folder
  await js(`import("./src/app/state.js").then(({ SESSION }) => { SESSION.name = ${JSON.stringify(TITLE)}; document.querySelector("#sessName").textContent = SESSION.name; return true; })`);
  await js(`document.querySelector("#toast").classList.remove("show"), true`);

  // gallery, scrolled to the first group
  await js(`(() => { const s = document.querySelector(".sec .gname")?.closest(".sec"); if (s) document.querySelector("#scroller").scrollTop = s.offsetTop - 70; return true; })()`);
  await sleep(1200); await shot("gallery");

  // loupe on a sharp keeper, with the sharpness map
  await js(`(() => { const c = [...document.querySelectorAll(".card")].find((c) => c.dataset.v === "keep" && c.classList.contains("best")) || document.querySelector(".card[data-v=keep]"); c.click(); return true; })()`);
  await sleep(2500); await key("m"); await sleep(600); await shot("loupe");
  await key("m"); await key("Escape"); await sleep(300);

  // culling mode, on the first group
  await key("t"); await sleep(1200);
  for (let i = 0; i < 12 && !(await js(`/^Group/.test(document.querySelector("#cullPos").textContent)`)); i++) { await key("ArrowDown"); await sleep(500); }
  await sleep(2500); await shot("cull");
  await key("Escape"); await sleep(300);

  // calibration
  await js(`document.querySelector("#calibBtn").click(), true`); await sleep(1500); await shot("calibrate");
  await js(`document.querySelector("#calib [data-a=close]").click(), true`);

  // finish, as it looks with a writable shoot folder and a NAS destination picked
  await js(`Promise.all([import("./src/ui/finish.js"), import("./src/app/state.js")]).then(async ([f, { SESSION }]) => {
    SESSION.dir = SESSION.dir || { name: ${JSON.stringify(TITLE)} }; f.finishState.dest = { name: "photos (NAS)" }; await f.openFinish(); return true; })`);
  await sleep(800); await shot("finish");
  await js(`document.querySelector("#finish [data-a=close]").click(), true`);

  // phone
  await size(390, 844, true);
  await js(`document.querySelector("#scroller").scrollTop = 0, true`); await sleep(800); await shot("phone-gallery");
  await key("t"); await sleep(2500); await shot("phone-cull"); await key("Escape");
  done(0);
} catch (e) { console.error(e.message); done(1); }
