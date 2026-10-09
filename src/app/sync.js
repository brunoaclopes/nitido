// @ts-check
/** Profiles kept on a self-hosted server (server.mjs with a data folder), so your settings, your
 *  personal model and each shoot's decisions follow you from browser to browser. Only those JSON
 *  documents travel, to the server this page came from; photos and thumbnails never do.
 *  The newer copy wins: the browser keeps working on its own copy when the server cannot be reached,
 *  and uploads it once it can. */
import { SERVER, remote, on } from "./state.js";
import { snapshot, applyProfile, isProfile } from "./profile.js";
import { debounce } from "../core/util.js";

const NAME_KEY = "nitido-profile", AT_KEY = "nitido-profile-at";
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
export const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

/** state: "off" (no server profiles) | "idle" | "saving" | "saved" | "offline" */
export const sync = { on: SERVER.sync, name: ls.get(NAME_KEY) || "default", state: SERVER.sync ? "idle" : "off", at: 0, names: /** @type {string[]} */ ([]) };
const listeners = new Set();
export const onSync = (fn) => listeners.add(fn);
const set = (state) => { sync.state = state; if (state === "saved") sync.at = Date.now(); for (const fn of listeners) fn(); };

const api = (path) => new URL("api/" + path, location.href).href;
const profileUrl = () => api("profiles/" + encodeURIComponent(sync.name));
const mineAt = () => Number(ls.get(AT_KEY)) || 0;

/** 256-bit FNV-1a, in hex: the shoot's key is not sent as it is (it holds the folder name), and
 *  crypto.subtle is missing on plain HTTP. */
function hashKey(key) {
  let out = "";
  for (let seed = 0; seed < 8; seed++) {
    let h = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= seed; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}
const sessionUrl = (key) => api(`sessions/${encodeURIComponent(sync.name)}/${hashKey(key)}`);

async function put(url, body, keepalive = false) {
  const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive });
  if (!r.ok) throw new Error("HTTP " + r.status);
}

let applying = false;
async function push() {
  if (!sync.on) return;
  set("saving");
  try { await put(profileUrl(), await snapshot(mineAt() || Date.now())); set("saved"); }
  catch { set("offline"); }
}
const pushSoon = debounce(push, 1500);
function changed() {
  if (applying || !sync.on) return;
  ls.set(AT_KEY, String(Date.now()));
  pushSoon();
}

/** Brings the server's copy of the profile here when it is newer, or sends this one when it is not.
 *  Returns true when the server's copy was applied. */
async function pull() {
  let r;
  try { r = await fetch(profileUrl(), { cache: "no-store" }); } catch { set("offline"); return false; }
  if (r.status === 204) { if (!mineAt()) ls.set(AT_KEY, String(Date.now())); await push(); return false; }
  if (!r.ok) { set("offline"); return false; }
  const p = await r.json().catch(() => null);
  if (!isProfile(p)) { await push(); return false; }
  if ((p.at || 0) > mineAt()) {
    applying = true;
    try { await applyProfile(p); ls.set(AT_KEY, String(p.at)); } finally { applying = false; }
    set("saved"); sync.at = p.at;
    return true;
  }
  if ((p.at || 0) < mineAt()) await push(); else { set("saved"); sync.at = p.at; }
  return false;
}

/* each shoot's decisions: one document per shoot, sent shortly after each change */
const pending = new Map();
let sessionTimer = 0;
function flushSessions(keepalive = false) {
  clearTimeout(sessionTimer); sessionTimer = 0;
  for (const [key, data] of pending) {
    const { model, ...rest } = data; // the personal model is part of the profile, not of each shoot
    put(sessionUrl(key), rest, keepalive).catch(() => set("offline"));
  }
  pending.clear();
}

/** At boot, before anything is drawn: connects to the server's profiles. Gives up after a few
 *  seconds so a slow server never holds the app. Returns true when settings came from the server. */
export async function startSync() {
  if (!sync.on) return false;
  remote.getSession = async (key) => {
    const r = await fetch(sessionUrl(key), { cache: "no-store" });
    return r.status === 200 ? r.json() : null; // 204: not on the server yet
  };
  remote.putSession = (key, data) => {
    pending.set(key, structuredClone(data));
    clearTimeout(sessionTimer); sessionTimer = window.setTimeout(() => flushSessions(), 800);
  };
  on("settings", changed); on("taste", changed);
  addEventListener("pagehide", () => flushSessions(true));
  const timeout = new Promise((r) => setTimeout(() => r(false), 4000));
  return Promise.race([pull(), timeout]);
}

/** The profiles on the server (for the name field's suggestions). */
export async function listProfiles() {
  try { const r = await fetch(api("profiles"), { cache: "no-store" }); sync.names = r.ok ? await r.json() : []; } catch { sync.names = []; }
  return sync.names;
}

/** Switches to another profile on the server: its settings and personal model replace this
 *  browser's, or, for a new name, this browser's become that profile. Returns "loaded" or "created". */
export async function switchProfile(name) {
  name = name.trim();
  if (!NAME_RULE.test(name)) throw new Error("name");
  sync.name = name; ls.set(NAME_KEY, name); ls.set(AT_KEY, "0");
  const applied = await pull();
  return applied ? "loaded" : "created";
}
