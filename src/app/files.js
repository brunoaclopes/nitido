// @ts-check
/** Reads a folder from drag and drop, the File System Access picker, or <input webkitdirectory>.
 *  Folders whose names start with "_" or "." are skipped. */
import { pause } from "../core/util.js";

const skip = (name) => /^[._]/.test(name);
export const canWrite = () => { try { return window.self === window.top && typeof window.showDirectoryPicker === "function"; } catch { return false; } };

/** Must be called synchronously inside the drop handler. */
export function captureDrop(dt) {
  const items = [...(dt.items || [])].filter((i) => i.kind === "file");
  return {
    entries: items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean),
    handles: canWrite() ? items.filter((i) => i.getAsFileSystemHandle).map((i) => i.getAsFileSystemHandle()) : [],
    files: [...(dt.files || [])],
  };
}

export async function readDrop({ entries, handles, files }, onCount) {
  if (handles.length === 1) {
    const h = await handles[0].catch(() => null);
    if (h && h.kind === "directory") return readHandle(h, onCount);
  }
  if (entries.length) return readEntries(entries, onCount);
  return readInput(files);
}

async function readEntries(entries, onCount) {
  const out = [];
  const readAll = (reader) => new Promise((res, rej) => {
    const all = [];
    const step = () => reader.readEntries((b) => { if (!b.length) res(all); else { all.push(...b); step(); } }, rej);
    step();
  });
  async function walk(entry, path) {
    if (entry.isFile) {
      out.push({ file: await new Promise((res, rej) => entry.file(res, rej)), path });
      if (out.length % 50 === 0) { onCount(out.length); await pause(); }
    } else if (entry.isDirectory) {
      for (const e of await readAll(entry.createReader())) if (!(e.isDirectory && skip(e.name))) await walk(e, path ? `${path}/${e.name}` : e.name);
    }
  }
  let name;
  if (entries.length === 1 && entries[0].isDirectory) {
    name = entries[0].name;
    for (const e of await readAll(entries[0].createReader())) if (!(e.isDirectory && skip(e.name))) await walk(e, e.name);
  } else {
    for (const e of entries) await walk(e, e.name);
    name = entries.length === 1 ? entries[0].name : `${entries.length}`;
  }
  onCount(out.length);
  return { name, list: out, dir: null };
}

export async function readHandle(dir, onCount) {
  const out = [];
  async function walk(d, path) {
    for await (const [name, h] of d.entries()) {
      const p = path ? `${path}/${name}` : name;
      if (h.kind === "directory") { if (!skip(name)) await walk(h, p); }
      else {
        out.push({ file: await h.getFile(), path: p });
        if (out.length % 50 === 0) { onCount(out.length); await pause(); }
      }
    }
  }
  await walk(dir, "");
  onCount(out.length);
  return { name: dir.name, list: out, dir };
}

export function readInput(files) {
  const list = [];
  let name = "";
  for (const f of files) {
    const parts = (f.webkitRelativePath || f.name).split("/");
    if (parts.length > 1) { name = name || parts[0]; parts.shift(); }
    if (parts.slice(0, -1).some(skip)) continue;
    list.push({ file: f, path: parts.join("/") });
  }
  return { name, list, dir: null };
}

export async function pickFolder() {
  if (!canWrite()) return null;
  return window.showDirectoryPicker({ id: "nitido", mode: "readwrite" });
}
