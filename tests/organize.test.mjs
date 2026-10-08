import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, execute, filesOf, destPathFor, scriptFor, emptyRejectFolder } from "../src/app/organize.js";

/* An in-memory stand-in for File System Access directory handles. */
class FakeFile extends Blob { constructor(parts, name) { super(parts); this.name = name; } }
class Dir {
  constructor(name) { this.name = name; this.kind = "directory"; this.kids = new Map(); }
  async getDirectoryHandle(n, { create = false } = {}) {
    let d = this.kids.get(n);
    if (!d) { if (!create) throw new DOMException("no " + n, "NotFoundError"); d = new Dir(n); this.kids.set(n, d); }
    if (d.kind !== "directory") throw new DOMException("not a dir", "TypeMismatchError");
    return d;
  }
  async getFileHandle(n, { create = false } = {}) {
    let f = this.kids.get(n);
    if (!f) { if (!create) throw new DOMException("no " + n, "NotFoundError"); f = new FileH(n); this.kids.set(n, f); }
    return f;
  }
  async removeEntry(n, { recursive = false } = {}) {
    const k = this.kids.get(n);
    if (!k) throw new DOMException("no " + n, "NotFoundError");
    if (k.kind === "directory" && k.kids.size && !recursive) throw new DOMException("not empty", "InvalidModificationError");
    this.kids.delete(n);
  }
  async *entries() { yield* this.kids.entries(); }
  put(path, text) { const parts = path.split("/"), name = parts.pop(); let d = this; for (const p of parts) { if (!d.kids.has(p)) d.kids.set(p, new Dir(p)); d = d.kids.get(p); } const f = new FileH(name); f.data = new FakeFile([text], name); d.kids.set(name, f); return f.data; }
  list(prefix = "") { const out = []; for (const [n, k] of this.kids) k.kind === "file" ? out.push(prefix + n) : out.push(...k.list(prefix + n + "/")); return out.sort(); }
}
class FileH {
  constructor(name) { this.name = name; this.kind = "file"; this.data = new FakeFile([], name); }
  async getFile() { return this.data; }
  async createWritable() {
    const chunks = [], h = this;
    return new WritableStream({ write(c) { chunks.push(typeof c === "string" ? c : c instanceof Uint8Array ? c : new Uint8Array(c)); },
      close() { h.data = new FakeFile(chunks, h.name); } });
  }
}
// WritableStream from createWritable also supports .write()/.close() directly
const origCW = FileH.prototype.createWritable;
FileH.prototype.createWritable = async function () {
  const s = await origCW.call(this);
  let w = null;
  const writer = () => (w ||= s.getWriter());
  return Object.assign(s, { write: (c) => writer().write(c), close: () => writer().close(), abort: () => (w ? w.abort() : s.abort()) });
};

function shoot() {
  const src = new Dir("2026-09-capri");
  const items = [];
  const add = (n, verdict, { raf = true, xmp = false, rafOnly = false, time = Date.UTC(2026, 8, 15, 15, 32) } = {}) => {
    const jpg = rafOnly ? null : src.put(`DSCF${n}.JPG`, "j".repeat(10 + +n % 7));
    const r = raf || rafOnly ? src.put(`DSCF${n}.RAF`, "r".repeat(40)) : null;
    if (xmp) src.put(`DSCF${n}.xmp`, "<x/>");
    items.push({ path: rafOnly ? `DSCF${n}.RAF` : `DSCF${n}.JPG`, name: rafOnly ? `DSCF${n}.RAF` : `DSCF${n}.JPG`, file: rafOnly ? r : jpg,
      raf: r ? `DSCF${n}.RAF` : "", rafFile: rafOnly ? null : r, isRaf: rafOnly, verdict, time });
  };
  add("0001", "keep", { xmp: true }); add("0002", "keep", { raf: false }); add("0003", "review"); add("0004", "reject"); add("0005", "reject", { rafOnly: true });
  return { src, items };
}
const O = { dest: "copy", review: "keep", rejects: "move", layout: "folder", xmp: false, folderName: "2026-09-capri", rejectFolder: "_rejects" };

test("files of a photo: JPEG, RAF and sidecar", () => {
  const { items } = shoot();
  assert.deepEqual(filesOf(items[0]).map((f) => f.path), ["DSCF0001.JPG", "DSCF0001.RAF", "DSCF0001.xmp"]);
  assert.deepEqual(filesOf(items[4]).map((f) => f.path), ["DSCF0005.RAF", "DSCF0005.xmp"]);
  assert.equal(destPathFor(items[0], "DSCF0001.JPG", "date", "x"), "2026/2026-09-15/DSCF0001.JPG");
  assert.equal(destPathFor(items[0], "sub/DSCF0001.JPG", "folder", "a/b"), "a-b/sub/DSCF0001.JPG");
});

test("plan sends review photos where the option says", () => {
  const { items } = shoot();
  assert.equal(plan(items, O).keep.length, 3);
  assert.equal(plan(items, { ...O, review: "leave" }).leave.length, 1);
  assert.equal(plan(items, { ...O, review: "reject" }).reject.length, 3);
});

test("copies keepers with RAF and XMP, moves rejects, and a second run changes nothing", async () => {
  const { src, items } = shoot(), dest = new Dir("nas");
  const p = plan(items, O);
  const r = await execute({ src, dest, plan: p, o: O });
  assert.deepEqual(r.errors, []);
  assert.equal(r.photos.copied, 3); assert.equal(r.photos.moved, 2);
  assert.deepEqual(dest.list(), ["2026-09-capri/DSCF0001.JPG", "2026-09-capri/DSCF0001.RAF", "2026-09-capri/DSCF0001.xmp",
    "2026-09-capri/DSCF0002.JPG", "2026-09-capri/DSCF0003.JPG", "2026-09-capri/DSCF0003.RAF"]);
  assert.deepEqual(src.list().filter((f) => f.startsWith("_rejects/")), ["_rejects/DSCF0004.JPG", "_rejects/DSCF0004.RAF", "_rejects/DSCF0005.RAF"]);
  assert.ok(!src.list().includes("DSCF0004.JPG"));
  const again = await execute({ src, dest, plan: plan(items.slice(0, 3), O), o: O });
  assert.equal(again.copied, 0); assert.equal(again.skipped, 6);
  assert.equal(await emptyRejectFolder(src, "_rejects"), 3);
  assert.ok(!src.list().some((f) => f.startsWith("_rejects")));
});

test("a different file with the same name at the destination is kept, not overwritten", async () => {
  const { src, items } = shoot(), dest = new Dir("nas");
  dest.put("2026-09-capri/DSCF0002.JPG", "an older, different photo");
  await execute({ src, dest, plan: plan([items[1]], O), o: O });
  assert.deepEqual(dest.list(), ["2026-09-capri/DSCF0002-1.JPG", "2026-09-capri/DSCF0002.JPG"]);
  assert.equal(await (await (await (await dest.getDirectoryHandle("2026-09-capri")).getFileHandle("DSCF0002.JPG")).getFile()).text(), "an older, different photo");
});

test("delete mode removes rejects; leave mode touches nothing", async () => {
  const { src, items } = shoot();
  const r = await execute({ src, dest: null, plan: plan(items, O), o: { ...O, dest: "leave", rejects: "delete" } });
  assert.equal(r.photos.deleted, 2);
  assert.ok(!src.list().some((f) => f.includes("0004") || f.includes("0005")));
  const s2 = shoot(), before = s2.src.list();
  await execute({ src: s2.src, dest: null, plan: plan(s2.items, O), o: { ...O, dest: "leave", rejects: "leave" } });
  assert.deepEqual(s2.src.list(), before);
});

test("scripts quote odd file names and copy only what the plan says", () => {
  const { items } = shoot();
  items[0].path = items[0].name = "it's DSCF0001.JPG";
  const p = plan(items, O);
  const sh = scriptFor(p, { ...O, destPath: "/Volumes/fotos" }, "sh", "note");
  assert.match(sh, /DEST='\/Volumes\/fotos'/);
  assert.match(sh, /copy 'it'\\''s DSCF0001.JPG'/);
  assert.match(sh, /mv -n 'DSCF0004.JPG'/);
  assert.ok(!/DSCF0004.*\$DEST/.test(sh));
  const ps = scriptFor(p, { ...O, rejects: "delete" }, "ps1", "note");
  assert.match(ps, /Copy-One 'it''s DSCF0001.JPG'/);
  assert.match(ps, /Remove-Item -LiteralPath 'DSCF0005.RAF'/);
});
