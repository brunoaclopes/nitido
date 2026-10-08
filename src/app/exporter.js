// @ts-check
/** Exports. With a writable folder (Chrome/Edge, self-hosted) sidecars are written next to the
 *  photos and existing ones are merged; otherwise everything is downloaded as a ZIP. */
import { buildXmp, mergeXmp, KEYWORD_PREFIX } from "../core/xmp.js";
import { zip } from "../core/zip.js";
import { stem } from "../core/util.js";
import { S, SESSION } from "./state.js";
import { ready } from "./model.js";
import { t } from "../i18n/index.js";

/** Rating policy: manual values win; otherwise best of group 4★ green, keep 3★, review 2★ yellow, reject 1★ red. */
export function ratingFor(it) {
  const m = it.manual || {};
  const v = it.verdict;
  let rating = v === "reject" ? (S.xmpReject === "minus" ? -1 : 1) : v === "review" ? 2 : it.isBest || !it.group || it.group.members.length < 2 ? 4 : 3;
  let label = v === "reject" ? "Red" : v === "review" ? "Yellow" : it.isBest ? "Green" : "";
  if (m.flag === "pick") rating = Math.max(rating, 5);
  if (m.rating != null) rating = m.rating;
  if (m.label !== undefined) label = m.label || "";
  const pick = m.flag === "pick" ? true : v === "reject" ? false : null;
  const keywords = S.keywords ? [
    `${KEYWORD_PREFIX}${t("verdict." + v)}`,
    ...it.ev.reasons.map((r) => `${KEYWORD_PREFIX}${t("reason." + r)}`),
    ...(it.group && it.group.members.length > 1 ? [`${KEYWORD_PREFIX}${it.group.name}`] : []),
  ] : [];
  return { rating, label, pick, keywords };
}
const sidecarPath = (it) => {
  const dir = it.path.includes("/") ? it.path.slice(0, it.path.lastIndexOf("/") + 1) : "";
  return dir + stem(it.raf || it.name) + ".xmp";
};

/** Folder name made safe for a file name; "nitido" when the photos came without a folder. */
const base = () => (SESSION.name || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim() || "nitido";

export function download(name, data, type = "application/octet-stream") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 15000);
}

async function dirFor(root, path, cache) {
  const parts = path.split("/").slice(0, -1), key = parts.join("/");
  if (!cache.has(key)) { let d = root; for (const p of parts) d = await d.getDirectoryHandle(p); cache.set(key, d); }
  return cache.get(key);
}

/** @returns {Promise<{written: number, merged: number, zipped: boolean}>} */
export async function exportXmp() {
  const items = ready();
  const dir = SESSION.dir;
  if (dir) {
    let perm = await dir.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") perm = await dir.requestPermission({ mode: "readwrite" });
    if (perm === "granted") {
      const cache = new Map();
      let written = 0, merged = 0;
      for (const it of items) {
        const p = sidecarPath(it), d = await dirFor(dir, p, cache), name = p.split("/").pop();
        let existing = null;
        try { existing = await (await (await d.getFileHandle(name)).getFile()).text(); } catch {}
        const f = ratingFor(it);
        const fh = await d.getFileHandle(name, { create: true }), w = await fh.createWritable();
        await w.write(existing ? mergeXmp(existing, f) : buildXmp(f)); await w.close();
        existing ? merged++ : written++;
      }
      return { written, merged, zipped: false };
    }
  }
  download(`${base()}-xmp.zip`, zip(items.map((it) => ({ name: sidecarPath(it), data: buildXmp(ratingFor(it)) }))), "application/zip");
  return { written: items.length, merged: 0, zipped: true };
}

const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? "" : (+v).toFixed(d));
export function exportCsv() {
  const head = ["file", "raf", "verdict", "manual", "score", "blur_px", "focus_on", "best_region_px", "sharp_area", "reasons", "tags",
    "faces", "eyes_closed", "group", "group_name", "best_in_group", "rating", "label", "time", "shutter", "aperture", "iso", "focal"];
  const q = (v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = ready().map((it) => {
    const ev = it.ev, m = it.meta || {}, r = ratingFor(it);
    return [it.path, it.raf, it.verdict, it.manual?.flag || "", fmt(ev.score, 1), fmt(ev.s), ev.kind || "", fmt(ev.best), fmt(ev.sharpFrac),
      ev.reasons.join(" "), ev.tags.join(" "), it.faces?.length || 0, ev.faces.keyClosed ? 1 : 0, it.group?.id || "", it.group?.name || "",
      it.isBest ? 1 : 0, r.rating, r.label, it.time != null ? new Date(it.time).toISOString().replace("Z", "") : "",
      m.exposure ?? "", m.fnumber ?? "", m.iso ?? "", m.focal ?? ""].map(q).join(",");
  });
  download(`${base()}-nitido.csv`, [head.join(","), ...rows].join("\n"), "text/csv");
}

export function exportJson() {
  const out = {
    app: "Nítido", folder: SESSION.name, created: new Date().toISOString(), settings: S,
    groups: SESSION.groups.map((g) => ({ id: g.id, name: g.name, best: g.best?.path, members: g.members.map((m) => m.path) })),
    photos: ready().map((it) => ({ path: it.path, raf: it.raf, verdict: it.verdict, score: it.ev.score, blur: it.ev.s, focusOn: it.ev.kind,
      reasons: it.ev.reasons, tags: it.ev.tags, breakdown: it.ev.breakdown, faces: (it.faces || []).map((f) => ({ blinkL: f.blinkL, blinkR: f.blinkR, smile: f.smile })),
      group: it.group?.id, best: it.isBest, manual: it.manual })),
  };
  download(`${base()}-nitido.json`, JSON.stringify(out, null, 1), "application/json");
}

/** Scripts that move rejects (JPEG, RAF and sidecar) into _rejeitadas, for macOS/Linux and Windows. */
export function exportMoveScripts() {
  const rej = ready().filter((it) => it.verdict === "reject");
  const files = rej.flatMap((it) => {
    const dir = it.path.includes("/") ? it.path.slice(0, it.path.lastIndexOf("/") + 1) : "";
    return [it.isRaf ? null : it.path, it.raf ? dir + it.raf : null, sidecarPath(it)].filter(Boolean);
  });
  const folder = "_" + t("export.rejectFolder");
  const sh = `#!/bin/sh\n# ${t("export.scriptNote", { n: rej.length })}\ncd "$(dirname "$0")"\nmkdir -p "${folder}"\n` +
    files.map((f) => `[ -e "${f}" ] && mv -n "${f}" "${folder}/"`).join("\n") + "\n";
  const ps = `# ${t("export.scriptNote", { n: rej.length })}\nSet-Location $PSScriptRoot\nNew-Item -ItemType Directory -Force -Path "${folder}" | Out-Null\n` +
    files.map((f) => `if (Test-Path -LiteralPath "${f}") { Move-Item -LiteralPath "${f}" -Destination "${folder}" }`).join("\n") + "\n";
  download(`${base()}-scripts.zip`, zip([{ name: "move-rejects.sh", data: sh }, { name: "move-rejects.ps1", data: ps }]), "application/zip");
  return rej.length;
}
