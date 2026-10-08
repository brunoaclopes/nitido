// @ts-check
/** Tiny i18n: t("key", {var}) with {var} interpolation and "one|other" plurals on {n}. */
import pt from "./pt.js";
import en from "./en.js";

export const DICTS = { pt, en };
let lang = "pt";
export const getLang = () => lang;
export function setLang(l) { lang = DICTS[l] ? l : "en"; document.documentElement.lang = lang === "pt" ? "pt-PT" : "en"; }

export function t(key, vars = {}) {
  let s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (s.includes("|") && "n" in vars) { const [one, other] = s.split("|"); s = vars.n === 1 ? one : other; }
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Fills [data-i18n] text, [data-i18n-html] markup and [data-i18n-attr="attr:key;attr:key"]. */
export function applyI18n(root = document) {
  for (const e of root.querySelectorAll("[data-i18n]")) e.textContent = t(e.getAttribute("data-i18n"));
  for (const e of root.querySelectorAll("[data-i18n-html]")) e.innerHTML = t(e.getAttribute("data-i18n-html"));
  for (const e of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of e.getAttribute("data-i18n-attr").split(";")) {
      const [attr, key] = pair.split(":");
      if (attr && key) e.setAttribute(attr.trim(), t(key.trim()));
    }
  }
}
