// The self-hosted server: defaults from the environment, profiles in the data folder, the
// Content-Security-Policy, and the static page's own policy.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const servers = [];
// each server on a free port the system picks, read back from its first line
async function start(env = {}, args = []) {
  const p = spawn(process.execPath, [join(ROOT, "server.mjs"), "--port", "0", ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
  servers.push(p);
  let out = "";
  return new Promise((resolve, reject) => {
    p.stdout.on("data", (d) => { out += d; const m = out.match(/running at (http:\/\/\S+)/); if (m) resolve(m[1]); });
    p.on("exit", (code) => reject(new Error(`server exited (${code}): ${out}`)));
  });
}
const config = async (base) => {
  const js = await (await fetch(base + "config.js")).text();
  return JSON.parse(js.match(/window\.NITIDO = (.*);/)[1]);
};
const inlineHashes = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => "'sha256-" + createHash("sha256").update(m[1]).digest("base64") + "'");

let data, withData, plain;
before(async () => {
  data = mkdtempSync(join(tmpdir(), "nitido-data-"));
  withData = await start({ NITIDO_LANG: "pt", NITIDO_THEME: "glass", NITIDO_TIER: "bogus", NITIDO_LAYOUT: "date", NITIDO_XMP: "yes" }, ["--data", data]);
  plain = await start({ NITIDO_DATA: "" });
});
after(() => { for (const p of servers) p.kill(); rmSync(data, { recursive: true, force: true }); });

test("config.js carries the server's defaults, and only valid ones", async () => {
  const c = await config(withData);
  assert.equal(c.sync, true);
  assert.deepEqual(c.defaults, { lang: "pt", theme: "glass", organize: { layout: "date", xmp: true } });
  assert.equal((await config(plain)).sync, false);
});

test("profiles: stored as files, listed, read back", async () => {
  const p = { kind: "nitido-profile", version: 1, at: 123, settings: { lang: "en" }, taste: { samples: {} } };
  const put = await fetch(withData + "api/profiles/Ana%20Silva", { method: "PUT", body: JSON.stringify(p) });
  assert.equal(put.status, 200);
  assert.ok(existsSync(join(data, "profiles", "Ana%20Silva.json")));
  assert.deepEqual(await (await fetch(withData + "api/profiles")).json(), ["Ana Silva"]);
  assert.deepEqual(await (await fetch(withData + "api/profiles/Ana%20Silva")).json(), p);
  assert.equal((await fetch(withData + "api/profiles/nobody")).status, 204);
});

test("each shoot's decisions, under a hashed key", async () => {
  const key = "a".repeat(64), url = withData + `api/sessions/Ana%20Silva/${key}`;
  assert.equal((await fetch(url, { method: "PUT", body: JSON.stringify({ at: 1, manual: { "x.jpg": { flag: "pick" } } }) })).status, 200);
  assert.equal((await (await fetch(url)).json()).manual["x.jpg"].flag, "pick");
  assert.equal((await fetch(withData + "api/sessions/Ana%20Silva/not-a-hash")).status, 404);
});

test("names and bodies are checked; nothing escapes the data folder", async () => {
  for (const bad of ["..%2F..%2Fetc", "%2Fetc", "a".repeat(41), "."])
    assert.equal((await fetch(withData + "api/profiles/" + bad, { method: "PUT", body: "{}" })).status, 400, bad);
  assert.equal((await fetch(withData + "api/profiles/ok", { method: "PUT", body: "[1]" })).status, 400);
  assert.equal((await fetch(withData + "api/profiles/ok", { method: "PUT", body: "not json" })).status, 500);
  assert.equal((await fetch(withData + "api/profiles/ok", { method: "DELETE" })).status, 405);
  assert.equal((await fetch(withData + "data/profiles/Ana%20Silva.json")).status, 403);
});

test("without a data folder, profiles are off", async () => {
  assert.equal((await fetch(plain + "api/profiles")).status, 404);
});

test("the page's Content-Security-Policy: inline script by hash, connections only where allowed", async () => {
  const r = await fetch(plain);
  const csp = r.headers.get("content-security-policy"), html = await r.text();
  for (const h of inlineHashes(html)) assert.ok(csp.includes(h), "header allows the inline script");
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
});

test("the static copy's own policy (GitHub Pages) matches its inline script", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for (const h of inlineHashes(html)) assert.ok(meta.includes(h), "meta policy allows the inline script " + h);
  // connections: this site, the libraries and the model hosts, nothing else
  const connect = meta.match(/connect-src ([^;]+)/)[1].split(" ").filter((s) => s.startsWith("http")).sort();
  assert.deepEqual(connect, ["https://*.hf.co", "https://*.huggingface.co", "https://cdn.jsdelivr.net", "https://huggingface.co", "https://storage.googleapis.com"]);
});
