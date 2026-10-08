// @ts-check
/** Sorting the session on disk once it is classified, without Lightroom:
 *  - keepers (and, by choice, the photos still to review) are copied to a destination such as a NAS
 *    folder, with their RAF and XMP, and every copy is checked by size;
 *  - rejects are moved into a "_rejects" folder inside the shoot, deleted, or left alone.
 *  Works on File System Access handles (Chrome, Edge). Elsewhere, scriptFor() writes a shell or
 *  PowerShell script that does the same. Re-running is safe: files already at the destination with
 *  the same size are skipped. */
import { stem } from "../core/util.js";

/** @typedef {{ dest: "copy"|"leave", review: "keep"|"leave"|"reject", rejects: "move"|"delete"|"leave",
 *   layout: "folder"|"date"|"flat", xmp: boolean, folderName: string, rejectFolder: string }} Options */

export const ORGANIZE_DEFAULTS = { review: "keep", rejects: "move", layout: "folder", xmp: false };

const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
const pad = (n) => String(n).padStart(2, "0");
const safe = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim();

/** Every file that belongs to a photo: the JPEG, the RAF and the XMP sidecar (if there is one). */
export function filesOf(it) {
  const dir = dirOf(it.path), out = [];
  if (!it.isRaf) out.push({ path: it.path, file: it.file, kind: "jpg" });
  if (it.raf) out.push({ path: dir + it.raf, file: it.isRaf ? it.file : it.rafFile || null, kind: "raf" });
  out.push({ path: dir + stem(it.raf || it.name) + ".xmp", file: null, kind: "xmp", optional: true });
  return out;
}

/** Where a kept photo goes inside the destination. */
export function destPathFor(it, rel, layout, folderName) {
  const name = rel.split("/").pop();
  if (layout === "flat") return name;
  if (layout === "date") {
    if (it.time == null) return `${safe(folderName) || "nitido"}/${name}`;
    const d = new Date(it.time);
    return `${d.getUTCFullYear()}/${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}/${name}`;
  }
  return `${safe(folderName) || "nitido"}/${rel}`;
}

/** What will happen to each photo. @param {any[]} items @param {Options} o */
export function plan(items, o) {
  const keep = [], reject = [], leave = [];
  for (const it of items) {
    const v = it.verdict === "review" ? o.review : it.verdict;
    (v === "keep" ? keep : v === "reject" ? reject : leave).push(it);
  }
  const bytes = (list) => list.reduce((a, it) => a + filesOf(it).reduce((b, f) => b + (f.file?.size || 0), 0), 0);
  return { keep, reject, leave, keepBytes: bytes(keep), rejectBytes: bytes(reject) };
}

/* ---------- File System Access helpers ---------- */
async function dirAt(root, parts, create) {
  let d = root;
  for (const p of parts) if (p) d = await d.getDirectoryHandle(p, { create });
  return d;
}
async function fileAt(root, path) {
  const parts = path.split("/"), name = parts.pop();
  const dir = await dirAt(root, parts, false);
  return { dir, name, handle: await dir.getFileHandle(name) };
}
const exists = async (dir, name) => { try { return await (await dir.getFileHandle(name)).getFile(); } catch { return null; } };

/** Copies a File into dir/name and checks the result; an identical file already there is kept. */
async function copyInto(file, dir, name) {
  const there = await exists(dir, name);
  if (there && there.size === file.size) return "skipped";
  let target = name;
  if (there) { // same name, different file (numbering wrapped): keep both
    const dot = name.lastIndexOf("."), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    for (let k = 1; ; k++) { target = `${base}-${k}${ext}`; const o = await exists(dir, target); if (!o) break; if (o.size === file.size) return "skipped"; }
  }
  const fh = await dir.getFileHandle(target, { create: true });
  const w = await fh.createWritable();
  try { await file.stream().pipeTo(w); } catch (e) { try { await w.abort(); } catch {} throw e; }
  const back = await fh.getFile();
  if (back.size !== file.size) throw new Error(`size mismatch on ${target}`);
  return "copied";
}

/** Moves a file, with the native move() where the browser has it, otherwise copy and delete. */
async function moveInto(src, toDir) {
  const { dir, name, handle } = src;
  if (typeof handle.move === "function") {
    try { await handle.move(toDir); return; } catch {}
  }
  const r = await copyInto(await handle.getFile(), toDir, name);
  if (r === "copied" || r === "skipped") await dir.removeEntry(name);
}

/**
 * Carries out the plan.
 * @param {{ src: any, dest: any, plan: ReturnType<typeof plan>, o: Options, ratingXmp?: (it: any) => string,
 *   onProgress?: (p: {done: number, total: number, bytes: number, name: string}) => void, signal?: {stopped: boolean} }} a
 */
export async function execute({ src, dest, plan: p, o, ratingXmp, onProgress = () => {}, signal = { stopped: false } }) {
  const res = { copied: 0, skipped: 0, moved: 0, deleted: 0, photos: { copied: 0, moved: 0, deleted: 0 }, bytes: 0, errors: /** @type {string[]} */ ([]),
    gone: /** @type {any[]} */ ([]) };
  const total = (dest && o.dest !== "leave" ? p.keep.length : 0) + (o.rejects !== "leave" ? p.reject.length : 0);
  let done = 0;
  const tick = (it) => onProgress({ done: ++done, total, bytes: res.bytes, name: it.name });

  if (dest && o.dest !== "leave") {
    for (const it of p.keep) {
      if (signal.stopped) return { ...res, stopped: true };
      let ok = true;
      for (const f of filesOf(it)) {
        try {
          const file = f.file || (await (await fileAt(src, f.path).catch(() => null))?.handle.getFile().catch(() => null));
          if (!file) { if (!f.optional) throw new Error("missing"); continue; }
          const to = destPathFor(it, f.path, o.layout, o.folderName).split("/"), name = to.pop();
          const r = await copyInto(file, await dirAt(dest, to, true), name);
          r === "copied" ? (res.copied++, res.bytes += file.size) : res.skipped++;
        } catch (e) { ok = false; res.errors.push(`${f.path}: ${e?.message || e}`); }
      }
      if (ok && o.xmp && ratingXmp) {
        try {
          const to = destPathFor(it, dirOf(it.path) + stem(it.raf || it.name) + ".xmp", o.layout, o.folderName).split("/"), name = to.pop();
          const d = await dirAt(dest, to, true);
          if (!(await exists(d, name))) { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(ratingXmp(it)); await w.close(); }
        } catch (e) { res.errors.push(`${it.name} XMP: ${e?.message || e}`); }
      }
      if (ok) res.photos.copied++;
      tick(it);
    }
  }

  if (o.rejects !== "leave") {
    for (const it of p.reject) {
      if (signal.stopped) return { ...res, stopped: true };
      let ok = true;
      for (const f of filesOf(it)) {
        const at = await fileAt(src, f.path).catch(() => null);
        if (!at) { if (f.kind === "jpg") { ok = false; res.errors.push(`${f.path}: missing`); } continue; }
        try {
          if (o.rejects === "delete") { await at.dir.removeEntry(at.name); res.deleted++; }
          else { await moveInto(at, await dirAt(src, [o.rejectFolder, ...f.path.split("/").slice(0, -1)], true)); res.moved++; }
        } catch (e) { ok = false; res.errors.push(`${f.path}: ${e?.message || e}`); }
      }
      if (ok) { res.photos[o.rejects === "delete" ? "deleted" : "moved"]++; res.gone.push(it); }
      tick(it);
    }
  }
  return { ...res, stopped: false };
}

/** Deletes the rejects folder made by an earlier run. Returns the number of files removed. */
export async function emptyRejectFolder(src, folder) {
  let d;
  try { d = await src.getDirectoryHandle(folder); } catch { return 0; }
  let n = 0;
  const count = async (h) => { for await (const [, c] of h.entries()) { if (c.kind === "file") n++; else await count(c); } };
  await count(d);
  await src.removeEntry(folder, { recursive: true });
  return n;
}

/* ---------- scripts, for browsers that cannot write to disk ---------- */
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** A script that does the same as execute(), to run inside the shoot folder. */
export function scriptFor(p, o, kind, note) {
  const keepFiles = p.keep.flatMap((it) => filesOf(it).map((f) => ({ f: f.path, to: destPathFor(it, f.path, o.layout, o.folderName) })));
  const rejFiles = p.reject.flatMap((it) => filesOf(it).map((f) => f.path));
  const destVar = o.destPath || "/Volumes/photos";
  if (kind === "sh") {
    const L = ["#!/bin/sh", `# ${note}`, 'cd "$(dirname "$0")" || exit 1', `DEST=${shq(destVar)}`,
      'copy() { [ -e "$1" ] || return 0; mkdir -p "$DEST/$(dirname "$2")"; if [ -e "$DEST/$2" ] && [ "$(wc -c < "$1")" = "$(wc -c < "$DEST/$2")" ]; then return 0; fi; cp -p "$1" "$DEST/$2" || echo "failed: $1"; }'];
    if (o.dest !== "leave") for (const { f, to } of keepFiles) L.push(`copy ${shq(f)} ${shq(to)}`);
    if (o.rejects === "move") { L.push(`mkdir -p ${shq(o.rejectFolder)}`); for (const f of rejFiles) L.push(`[ -e ${shq(f)} ] && mkdir -p "${o.rejectFolder}/$(dirname ${shq(f)})" && mv -n ${shq(f)} "${o.rejectFolder}/"${shq(f)}`); }
    if (o.rejects === "delete") for (const f of rejFiles) L.push(`[ -e ${shq(f)} ] && rm ${shq(f)}`);
    return L.join("\n") + "\n";
  }
  const L = [`# ${note}`, "Set-Location $PSScriptRoot", `$Dest = ${psq(destVar)}`,
    "function Copy-One($f, $to) { if (-not (Test-Path -LiteralPath $f)) { return }; $t = Join-Path $Dest $to; New-Item -ItemType Directory -Force -Path (Split-Path $t) | Out-Null; if ((Test-Path -LiteralPath $t) -and ((Get-Item -LiteralPath $t).Length -eq (Get-Item -LiteralPath $f).Length)) { return }; Copy-Item -LiteralPath $f -Destination $t }"];
  if (o.dest !== "leave") for (const { f, to } of keepFiles) L.push(`Copy-One ${psq(f)} ${psq(to)}`);
  if (o.rejects === "move") for (const f of rejFiles) L.push(`if (Test-Path -LiteralPath ${psq(f)}) { $t = Join-Path ${psq(o.rejectFolder)} ${psq(f)}; New-Item -ItemType Directory -Force -Path (Split-Path $t) | Out-Null; Move-Item -LiteralPath ${psq(f)} -Destination $t }`);
  if (o.rejects === "delete") for (const f of rejFiles) L.push(`if (Test-Path -LiteralPath ${psq(f)}) { Remove-Item -LiteralPath ${psq(f)} }`);
  return L.join("\r\n") + "\r\n";
}
