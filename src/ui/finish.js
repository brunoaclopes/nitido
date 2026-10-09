// @ts-check
/** "Finish": puts the classified session in order on disk, without Lightroom.
 *  Keepers go to a destination folder (a NAS share, an archive disk), rejects to a folder or the bin. */
import { $, esc, fmtBytes, toast } from "./dom.js";
import { ask } from "./confirm.js";
import { t } from "../i18n/index.js";
import { S, SESSION, SERVER, saveSettings, emit } from "../app/state.js";
import { ready } from "../app/model.js";
import { plan, execute, scriptFor, emptyRejectFolder } from "../app/organize.js";
import { getMeta, putMeta } from "../app/store.js";
import { buildXmp } from "../core/xmp.js";
import { ratingFor, download, exportJson } from "../app/exporter.js";

const F = { open: false, dest: null, running: false, signal: { stopped: false }, result: null };
export const finishState = F;
const canWrite = () => typeof window.showDirectoryPicker === "function";
const opts = () => ({ dest: "copy", ...S.organize, folderName: SESSION.name || "nitido", rejectFolder: "_" + t("export.rejectFolder") });

export async function openFinish() {
  F.open = true; F.result = null;
  $("#finish").hidden = false;
  if (!F.dest && canWrite()) F.dest = await getMeta("dest").catch(() => null) || null;
  render();
}
export function closeFinish() {
  if (F.running) return;
  F.open = false;
  $("#finish").hidden = true;
}

function seg(name, value, choices) {
  return `<div class="seg wide" data-opt="${name}">${choices.map(([v, k]) => `<button data-v="${v}" aria-pressed="${value === v}">${esc(t(k))}</button>`).join("")}</div>`;
}

function render() {
  if (!F.open) return;
  const o = opts(), p = plan(ready(), o);
  const nReview = ready().filter((i) => i.verdict === "review").length;
  const write = canWrite() && !!SESSION.dir;
  const body = $("#finishBody");
  if (F.result) { body.innerHTML = resultHTML(F.result, o); return; }
  // a phone or tablet browser cannot copy into other folders, and a shell script is no use there:
  // the decisions go to the computer instead, which finishes the job
  const handheld = !write && !!globalThis.matchMedia?.("(hover: none) and (pointer: coarse)").matches;
  const lead = $("#finLead"); if (lead) lead.hidden = handheld;
  if (handheld) {
    body.innerHTML = `
      <p>${esc(t("fin.handheldLead", { keep: p.keep.length, reject: p.reject.length }))}</p>
      <ol class="fin-steps">${(SERVER.sync ? ["fin.handheldSync1", "fin.handheldSync2"] : ["fin.handheld1", "fin.handheld2", "fin.handheld3"]).map((k) => `<li>${esc(t(k))}</li>`).join("")}</ol>
      <div class="row-btns fin-actions">
        ${SERVER.sync ? "" : `<button class="btn primary" data-a="decisions">${esc(t("fin.saveDecisions"))}</button>`}
        <button class="btn${SERVER.sync ? " primary" : " quiet"}" data-a="close">${esc(t("lb.close"))}</button>
      </div>`;
    return;
  }
  body.innerHTML = `
    <section class="fin-row keep">
      <div class="fin-head"><i></i><b>${esc(t("fin.keep", { n: p.keep.length }))}</b><span class="num">${esc(fmtBytes(p.keepBytes))}</span></div>
      ${write ? `<div class="fin-dest"><button class="btn small" data-a="pickDest">${esc(F.dest ? t("fin.changeDest") : t("fin.pickDest"))}</button>
          <span class="${F.dest ? "" : "hint"}">${esc(F.dest ? F.dest.name : t("fin.noDest"))}</span></div>`
        : `<label class="field col"><span class="label">${esc(t("fin.destPath"))}</span><input class="text" id="finDestPath" value="${esc(S.organize.destPath)}" placeholder="/Volumes/photos"></label>`}
      <label class="field col"><span class="label">${esc(t("fin.layout"))}</span>
        <select class="select" data-opt="layout">${[["folder", "fin.layoutFolder"], ["date", "fin.layoutDate"], ["flat", "fin.layoutFlat"]]
          .map(([v, k]) => `<option value="${v}" ${o.layout === v ? "selected" : ""}>${esc(t(k, { name: o.folderName }))}</option>`).join("")}</select></label>
      <label class="check"><input type="checkbox" data-opt="xmp" ${o.xmp ? "checked" : ""}> <span>${esc(t("fin.xmp"))}</span></label>
    </section>
    ${nReview ? `<section class="fin-row review">
      <div class="fin-head"><i></i><b>${esc(t("fin.review", { n: nReview }))}</b><button class="btn small quiet" data-a="cull">${esc(t("fin.decideNow"))}</button></div>
      ${seg("review", o.review, [["keep", "fin.reviewKeep"], ["leave", "fin.reviewLeave"], ["reject", "fin.reviewReject"]])}
    </section>` : ""}
    <section class="fin-row reject">
      <div class="fin-head"><i></i><b>${esc(t("fin.reject", { n: p.reject.length }))}</b><span class="num">${esc(fmtBytes(p.rejectBytes))}</span></div>
      ${seg("rejects", o.rejects, [["move", "fin.rejMove"], ["delete", "fin.rejDelete"], ["leave", "fin.rejLeave"]])}
      <p class="hint">${esc(o.rejects === "move" ? t("fin.rejMoveHint", { folder: o.rejectFolder }) : o.rejects === "delete" ? t("fin.rejDeleteHint") : t("fin.rejLeaveHint"))}</p>
    </section>
    ${p.leave.length ? `<p class="hint">${esc(t("fin.leaveCount", { n: p.leave.length }))}</p>` : ""}
    <div class="fin-progress" id="finProgress" hidden><div class="bar"><i id="finBar"></i></div><span class="num" id="finText"></span></div>
    <div class="row-btns fin-actions">
      ${write ? `<button class="btn primary" data-a="start" ${F.dest || o.rejects !== "leave" ? "" : "disabled"}>${esc(t("fin.start"))}</button>`
        : `<button class="btn primary" data-a="script" data-k="sh">${esc(t("fin.scriptSh"))}</button><button class="btn" data-a="script" data-k="ps1">${esc(t("fin.scriptPs"))}</button>`}
      <button class="btn quiet" data-a="close">${esc(t("lb.close"))}</button>
    </div>
    ${write ? "" : `<p class="hint">${esc(t(canWrite() ? "fin.noWriteReopen" : "fin.noWriteBrowser"))}</p>`}`;
}

function resultHTML(r, o) {
  const lines = [];
  if (r.photos.copied) lines.push(t("fin.doneCopied", { n: r.photos.copied, size: fmtBytes(r.bytes), dest: F.dest?.name || "" }));
  if (r.skipped) lines.push(t("fin.doneSkipped", { n: r.skipped }));
  if (r.photos.moved) lines.push(t("fin.doneMoved", { n: r.photos.moved, folder: o.rejectFolder }));
  if (r.photos.deleted) lines.push(t("fin.doneDeleted", { n: r.photos.deleted }));
  if (r.stopped) lines.push(t("fin.doneStopped"));
  if (!lines.length) lines.push(t("fin.doneNothing"));
  return `<div class="fin-done">
    <h3>${esc(r.errors.length ? t("fin.doneWithErrors", { n: r.errors.length }) : t("fin.doneOk"))}</h3>
    <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    ${r.errors.length ? `<details><summary>${esc(t("fin.errors"))}</summary><pre>${esc(r.errors.slice(0, 50).join("\n"))}</pre></details>` : ""}
    <div class="row-btns">
      ${r.photos.moved ? `<button class="btn" data-a="empty">${esc(t("fin.empty", { folder: o.rejectFolder }))}</button>` : ""}
      <button class="btn primary" data-a="close">${esc(t("lb.close"))}</button>
    </div></div>`;
}

async function pickDest() {
  try {
    const h = await window.showDirectoryPicker({ id: "nitido-dest", mode: "readwrite" });
    F.dest = h; putMeta("dest", h).catch(() => {});
    render();
  } catch (e) { if (e?.name !== "AbortError") toast(t("err.generic", { e: e?.message || e })); }
}

async function writable(h) {
  if (!h) return false;
  let p = await h.queryPermission({ mode: "readwrite" });
  if (p !== "granted") p = await h.requestPermission({ mode: "readwrite" });
  return p === "granted";
}

async function start() {
  const o = opts(), p = plan(ready(), o);
  if (o.rejects === "delete" && p.reject.length && !(await ask({ title: t("fin.confirmDelete", { n: p.reject.length }), body: t("dlg.noUndo"), ok: t("dlg.delete"), danger: true }))) return;
  const destOk = F.dest ? await writable(F.dest) : false;
  const srcOk = o.rejects === "leave" || await writable(SESSION.dir);
  if ((F.dest && !destOk) || !srcOk) { toast(t("fin.noPermission")); return; }
  F.running = true; F.signal = { stopped: false };
  $("#finProgress").hidden = false;
  const btn = /** @type {HTMLButtonElement} */ ($('#finishBody [data-a="start"]'));
  btn.textContent = t("fin.stop"); btn.dataset.a = "stop";
  try {
    F.result = await execute({
      src: SESSION.dir, dest: destOk ? F.dest : null, plan: p, o: { ...o, dest: destOk ? "copy" : "leave" }, signal: F.signal,
      ratingXmp: (it) => buildXmp(ratingFor(it)),
      onProgress: ({ done, total, bytes, name }) => {
        $("#finBar").style.width = `${(done / Math.max(1, total)) * 100}%`;
        $("#finText").textContent = t("fin.progress", { done, total, size: fmtBytes(bytes), name });
      },
    });
  } catch (e) {
    F.result = { photos: { copied: 0, moved: 0, deleted: 0 }, copied: 0, skipped: 0, bytes: 0, errors: [String(e?.message || e)], stopped: true };
  }
  F.running = false;
  if (F.result.photos.moved || F.result.photos.deleted) emit("organized", { result: F.result });
  render();
}

export function bindFinish() {
  $("#finish").addEventListener("click", async (e) => {
    const tgt = /** @type {HTMLElement} */ (e.target);
    if (tgt === $("#finish")) { closeFinish(); return; }
    const sb = tgt.closest(".seg[data-opt] button");
    if (sb) { const k = sb.parentElement.dataset.opt; S.organize[k] = sb.dataset.v; saveSettings(); render(); return; }
    const b = tgt.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a;
    if (a === "close") closeFinish();
    else if (a === "pickDest") pickDest();
    else if (a === "start") start();
    else if (a === "stop") F.signal.stopped = true;
    else if (a === "cull") { closeFinish(); emit("cull", { only: "review" }); }
    else if (a === "decisions") { exportJson(); toast(t("fin.decisionsSaved"), 9000); }
    else if (a === "script") {
      const o = { ...opts(), destPath: S.organize.destPath || "/Volumes/photos" }, p = plan(ready(), o), k = b.dataset.k;
      const note = t("fin.scriptNote", { keep: p.keep.length, reject: p.reject.length });
      download(k === "sh" ? "nitido-organize.sh" : "nitido-organize.ps1", scriptFor(p, o, k, note), "text/plain");
      toast(t("fin.scriptDone"), 9000);
    } else if (a === "empty") {
      const folder = opts().rejectFolder;
      if (!(await ask({ title: t("fin.confirmEmpty", { folder }), body: t("dlg.noUndo"), ok: t("dlg.delete"), danger: true }))) return;
      try { const n = await emptyRejectFolder(SESSION.dir, folder); toast(t("fin.emptied", { n })); b.remove(); }
      catch (err) { toast(t("err.generic", { e: err?.message || err })); }
    }
  });
  $("#finish").addEventListener("change", (e) => {
    const tgt = /** @type {HTMLInputElement} */ (e.target);
    if (tgt.id === "finDestPath") { S.organize.destPath = tgt.value.trim(); saveSettings(); return; }
    const k = tgt.dataset.opt; if (!k) return;
    S.organize[k] = tgt.type === "checkbox" ? tgt.checked : tgt.value; saveSettings(); render();
  });
}
