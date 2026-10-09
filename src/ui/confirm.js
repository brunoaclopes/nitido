// @ts-check
/** The app's own confirmation dialog, in place of the browser's confirm(): themed, translated, keyboard
 *  friendly (Enter confirms, Escape cancels) and focus returns to where it was. */
import { el, esc } from "./dom.js";
import { t } from "../i18n/index.js";

let open = null;
/** Tests without a real DOM answer every dialog with this (true or false) instead of showing it. */
export const dialogs = { answer: /** @type {boolean|null} */ (null) };

/**
 * @param {{ title: string, body?: string, ok: string, cancel?: string, danger?: boolean }} o
 * @returns {Promise<boolean>}
 */
export function ask({ title, body = "", ok, cancel = t("dlg.cancel"), danger = false }) {
  if (dialogs.answer !== null) return Promise.resolve(dialogs.answer);
  if (open) open(false);
  const back = /** @type {HTMLElement|null} */ (document.activeElement);
  const m = el("div", { class: "modal confirm", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "dlgTitle", "aria-describedby": "dlgBody" });
  m.innerHTML = `<div class="modal-card confirm-card">
    <h2 id="dlgTitle">${esc(title)}</h2>${body ? `<p id="dlgBody">${esc(body)}</p>` : ""}
    <div class="confirm-actions"><button class="btn" data-a="no">${esc(cancel)}</button><button class="btn primary${danger ? " danger" : ""}" data-a="yes">${esc(ok)}</button></div></div>`;
  document.body.appendChild(m);
  const yes = /** @type {HTMLElement} */ (m.querySelector('[data-a="yes"]')), no = /** @type {HTMLElement} */ (m.querySelector('[data-a="no"]'));
  // a destructive action starts on Cancel, so a stray Enter does not delete anything
  (danger ? no : yes).focus();
  return new Promise((resolve) => {
    const done = (v) => { open = null; m.remove(); back?.focus?.({ preventScroll: true }); resolve(v); };
    open = done;
    m.addEventListener("click", (e) => {
      const a = /** @type {HTMLElement} */ (e.target).closest("[data-a]")?.getAttribute("data-a");
      if (a) done(a === "yes"); else if (e.target === m) done(false);
    });
    m.addEventListener("keydown", (e) => {
      e.stopPropagation(); // the gallery's shortcuts stay quiet while the dialog is open
      if (e.key === "Escape") { e.preventDefault(); done(false); }
      else if (e.key === "Tab") { e.preventDefault(); (document.activeElement === yes ? no : yes).focus(); }
    });
  });
}
