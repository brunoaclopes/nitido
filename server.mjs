#!/usr/bin/env node
// Zero-dependency static server for Nítido. Usage: node server.mjs [--port 4173] [--open]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const root = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const argPort = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : NaN;
let port = argPort || Number(process.env.PORT) || 4173;
const host = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".wasm": "application/wasm", ".onnx": "application/octet-stream",
  ".task": "application/octet-stream", ".tflite": "application/octet-stream", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://x");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (!path || path.endsWith(sep)) path = join(path, "index.html");
    const file = join(root, path);
    if (!file.startsWith(root) || /(^|[/\\])(node_modules|\.git)([/\\]|$)/.test(path)) { res.writeHead(403).end(); return; }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
    const big = info.size > 5e6;
    res.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "content-length": info.size,
      "cache-control": big || path.startsWith("models") ? "public, max-age=604800" : "no-cache",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") { res.end(); return; }
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

server.on("error", (e) => {
  if (/** @type {any} */ (e).code === "EADDRINUSE" && !argPort && port < 4200) { port++; server.listen(port, host); return; }
  console.error(e.message); process.exit(1);
});
server.listen(port, host, () => {
  const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}/`;
  console.log(`\n  Nítido is running at ${url}\n  (Ctrl+C to stop)\n`);
  if (args.includes("--open")) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
    exec(`${cmd} ${url}`);
  }
});
