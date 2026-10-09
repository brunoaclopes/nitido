#!/usr/bin/env node
// Zero-dependency server for Nítido: the static app, and on a self-hosted copy its two extras.
//   node server.mjs [--port 4173] [--open] [--data ./data]
//
// - With a data folder (--data or NITIDO_DATA; the Docker image uses /data) it keeps profiles: the
//   settings and personal model of each person, and the decisions of each shoot, so they follow you
//   from browser to browser. They are JSON files in that folder. Photos are never sent here: the app
//   has no code that could.
// - NITIDO_* variables set the defaults a new browser starts with (see README, "Run it on your server").
// - The Content-Security-Policy header lets the page talk to this server only, plus the model and
//   library hosts while those are not stored here (npm run models).
import { createServer } from "node:http";
import { readFile, writeFile, stat, mkdir, readdir, rename } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { exec } from "node:child_process";
import { VERSION } from "./src/version.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const arg = (k) => (args.includes("--" + k) ? args[args.indexOf("--" + k) + 1] : undefined);
// --port 0 lets the system pick a free port (the tests use it); the first line printed says which
const argPort = arg("port") != null ? Number(arg("port")) : NaN;
let port = Number.isFinite(argPort) ? argPort : Number(process.env.PORT) || 4173;
const host = process.env.HOST || "127.0.0.1";
const dataDir = arg("data") || process.env.NITIDO_DATA || "";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".wasm": "application/wasm", ".onnx": "application/octet-stream",
  ".task": "application/octet-stream", ".tflite": "application/octet-stream", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
};

/* ---------- defaults for new browsers, from the environment ---------- */
const env = process.env;
const pick = (v, ok) => (v && ok.includes(v) ? v : undefined);
const bool = (v) => (v == null || v === "" ? undefined : /^(1|true|yes|on)$/i.test(v));
function defaults() {
  let extra = {};
  try { extra = env.NITIDO_DEFAULTS ? JSON.parse(env.NITIDO_DEFAULTS) : {}; } catch { console.warn("NITIDO_DEFAULTS is not valid JSON; ignored"); }
  const d = {
    lang: pick(env.NITIDO_LANG, ["en", "pt"]),
    theme: pick(env.NITIDO_THEME, ["dark", "light", "glass"]),
    tier: pick(env.NITIDO_TIER, ["light", "standard", "heavy", "max"]),
    strictness: pick(env.NITIDO_STRICTNESS, ["relaxed", "normal", "strict"]),
  };
  const org = {
    layout: pick(env.NITIDO_LAYOUT, ["folder", "date", "flat"]),
    review: pick(env.NITIDO_REVIEW, ["keep", "leave", "reject"]),
    rejects: pick(env.NITIDO_REJECTS, ["move", "delete", "leave"]),
    xmp: bool(env.NITIDO_XMP),
  };
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const out = { ...extra, ...clean(d) };
  if (Object.keys(clean(org)).length) out.organize = { ...(extra.organize || {}), ...clean(org) };
  return out;
}

/* ---------- what is stored here (models/manifest.json, written by npm run models) ---------- */
let localCache = { at: 0, v: null };
async function local() {
  if (Date.now() - localCache.at < 10000) return localCache.v;
  let m = null;
  try { m = JSON.parse(await readFile(join(root, "models", "manifest.json"), "utf8")); } catch {}
  const v = { libs: !!(m?.libs?.mediapipe && m?.libs?.transformers), tiers: m?.tiers || [] };
  v.all = v.libs && ["light", "standard", "heavy", "max"].every((t) => v.tiers.includes(t));
  v.only = v.all || bool(env.NITIDO_LOCAL_ONLY) === true;
  localCache = { at: Date.now(), v };
  return v;
}

/* ---------- Content-Security-Policy ---------- */
let inlineHash = "";
async function csp() {
  if (!inlineHash) {
    const html = await readFile(join(root, "index.html"), "utf8");
    inlineHash = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`).join(" ");
  }
  const l = await local();
  const libs = l.libs ? "" : " https://cdn.jsdelivr.net";
  const models = l.only ? "" : " https://storage.googleapis.com https://huggingface.co https://*.huggingface.co https://*.hf.co";
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineHash} 'wasm-unsafe-eval'${libs}`,
    "worker-src 'self' blob:",
    `connect-src 'self' blob: data:${libs}${models}`,
    "img-src 'self' blob: data:", "media-src 'self' blob:", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'",
  ].join("; ");
}

/* ---------- profiles: JSON files in the data folder ---------- */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u, KEY = /^[0-9a-f]{64}$/;
const fileName = (name) => encodeURIComponent(name.normalize("NFC")) + ".json";
const MAX_BODY = 32 << 20;
async function body(req) {
  const parts = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw Object.assign(new Error("too large"), { status: 413 }); parts.push(c); }
  const v = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Object.assign(new Error("expected a JSON object"), { status: 400 });
  return v;
}
async function writeJson(file, v) {
  await mkdir(join(file, ".."), { recursive: true });
  const tmp = file + ".tmp";
  await writeFile(tmp, JSON.stringify(v));
  await rename(tmp, file); // whole or nothing
}
const json = (res, status, v) => res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify(v));

async function api(req, res, parts) {
  if (!dataDir) return json(res, 404, { error: "profiles are off: start the server with a data folder" });
  const [what, name, key] = parts.map(decodeURIComponent);
  const profiles = join(dataDir, "profiles"), sessions = join(dataDir, "sessions");
  if (what === "profiles" && !name && req.method === "GET") {
    const files = await readdir(profiles).catch(() => []);
    return json(res, 200, files.filter((f) => f.endsWith(".json")).map((f) => decodeURIComponent(f.slice(0, -5))).sort());
  }
  if (!name || !NAME.test(name)) return json(res, 400, { error: "a profile name is 1 to 40 letters, digits, spaces, dots, dashes or underscores" });
  const file = what === "profiles" && !key ? join(profiles, fileName(name))
    : what === "sessions" && key && KEY.test(key) ? join(sessions, fileName(name).slice(0, -5), key + ".json") : null;
  if (!file) return json(res, 404, { error: "not found" });
  if (req.method === "GET") {
    const text = await readFile(file, "utf8").catch(() => null);
    // nothing stored under this name yet: an empty answer, not an error
    return text == null ? res.writeHead(204, { "cache-control": "no-store" }).end() : res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(text);
  }
  if (req.method === "PUT") { await writeJson(file, await body(req)); return json(res, 200, { ok: true }); }
  return json(res, 405, { error: "GET or PUT" });
}

/* ---------- requests ---------- */
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://x");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname.slice(5).split("/").filter(Boolean));
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (!path || path.endsWith(sep)) path = join(path, "index.html");
    if (path === "config.js") {
      const l = await local();
      const cfg = { version: VERSION, sync: !!dataDir, defaults: defaults(), localTiers: l.tiers, localOnly: l.only };
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
      return res.end(`// Settings from the server that hosts this copy of Nítido.\nwindow.NITIDO = ${JSON.stringify(cfg)};\n`);
    }
    const file = join(root, path);
    if (!file.startsWith(root) || /(^|[/\\])(node_modules|\.git|data)([/\\]|$)/.test(path)) { res.writeHead(403).end(); return; }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
    const big = info.size > 5e6;
    const head = {
      "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "content-length": info.size,
      "cache-control": big || path.startsWith("models") || path.startsWith("fonts") ? "public, max-age=604800" : "no-cache",
    };
    if (extname(file) === ".html") head["content-security-policy"] = await csp();
    res.writeHead(200, head);
    if (req.method === "HEAD") { res.end(); return; }
    res.end(await readFile(file));
  } catch (e) {
    if (!res.headersSent) json(res, e?.status || 500, { error: String(e?.message || e) });
  }
});

server.on("error", (e) => {
  if (/** @type {any} */ (e).code === "EADDRINUSE" && !Number.isFinite(argPort) && port < 4200) { port++; server.listen(port, host); return; }
  console.error(e.message); process.exit(1);
});
server.listen(port, host, async () => {
  const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${/** @type {any} */ (server.address()).port}/`;
  const l = await local();
  console.log(`\n  Nítido ${VERSION} is running at ${url}`);
  let writable = true;
  if (dataDir) try { await mkdir(join(dataDir, "profiles"), { recursive: true }); await writeFile(join(dataDir, ".write-test"), ""); } catch { writable = false; }
  console.log(`  profiles: ${dataDir ? "kept in " + dataDir : "off (add --data <folder> to keep them on this server)"}`);
  if (!writable) console.log(`  WARNING: ${dataDir} cannot be written by this user (uid ${process.getuid?.()}): profiles will not be saved. Make the folder writable, or set PUID/PGID to its owner.`);
  console.log(`  stored here: ${l.libs ? "libraries" : "no libraries"}, ${l.tiers.length ? "models for " + l.tiers.join(", ") : "no models"}${l.only ? " (nothing is fetched from elsewhere)" : ""}`);
  console.log(`  (Ctrl+C to stop)\n`);
  if (args.includes("--open")) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
    exec(`${cmd} ${url}`);
  }
});
