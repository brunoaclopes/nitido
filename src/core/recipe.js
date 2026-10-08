// @ts-check
/** The film recipe a Fujifilm camera used, decoded from the MakerNote codes read by exif.js
 *  (code tables after ExifTool's FujiFilm module). Settings the camera did not record are left out. */

const FILMS = {
  0x000: "Provia/Standard", 0x100: "Studio Portrait", 0x110: "Studio Portrait Enhanced Saturation", 0x120: "Astia/Soft",
  0x130: "Studio Portrait Increased Sharpness", 0x200: "Velvia/Vivid", 0x300: "Studio Portrait Ex", 0x400: "Velvia",
  0x500: "Pro Neg. Std", 0x501: "Pro Neg. Hi", 0x600: "Classic Chrome", 0x700: "Eterna/Cinema", 0x800: "Classic Neg.",
  0x900: "Eterna Bleach Bypass", 0xa00: "Nostalgic Neg.", 0xb00: "Reala Ace",
};
const MONO = {
  0x300: "Monochrome", 0x301: "Monochrome + R", 0x302: "Monochrome + Ye", 0x303: "Monochrome + G", 0x310: "Sepia",
  0x500: "Acros", 0x501: "Acros + R", 0x502: "Acros + Ye", 0x503: "Acros + G",
};
const COLOR = { 0x0: 0, 0x80: 1, 0x100: 2, 0xc0: 3, 0xe0: 4, 0x180: -1, 0x200: -2, 0x400: -2, 0x4c0: -3, 0x4e0: -4 };
const SHARP = { 0x0: -4, 0x1: -3, 0x2: -2, 0x82: -1, 0x3: 0, 0x84: 1, 0x4: 2, 0x5: 3, 0x6: 4 };
const NR = { 0x0: 0, 0x180: 1, 0x100: 2, 0x1c0: 3, 0x1e0: 4, 0x280: -1, 0x200: -2, 0x2c0: -3, 0x2e0: -4 };
const WB = {
  0x0: "auto", 0x1: "autoWhite", 0x2: "autoAmbience", 0x100: "daylight", 0x200: "shade", 0x300: "fluorescent1", 0x301: "fluorescent2",
  0x302: "fluorescent3", 0x303: "fluorescent3", 0x304: "fluorescent3", 0x400: "incandescent", 0x500: "flash", 0x600: "underwater",
  0xf00: "custom", 0xf01: "custom", 0xf02: "custom", 0xf03: "custom", 0xf04: "custom", 0xff0: "kelvin",
};
const LEVEL = { 0: "off", 32: "weak", 64: "strong" };

/** @typedef {{ film: string|null, mono: boolean, dr: string|null, drp: string|null, highlight: number|null, shadow: number|null,
 *   color: number|null, sharpness: number|null, nr: number|null, clarity: number|null, grain: string|null, grainSize: string|null,
 *   colorChrome: string|null, fxBlue: string|null, wb: string|null, kelvin: number|null, wbShift: [number, number]|null,
 *   monoWarm: number|null, monoMagenta: number|null }} Recipe */

/** @param {any} r raw codes (meta.recipe) @returns {Recipe|null} */
export function decodeRecipe(r) {
  if (!r || (r.film == null && r.sat == null)) return null;
  const mono = MONO[r.sat] != null;
  const tone = (v) => (v == null ? null : -v / 16);
  const drpOn = r.drp === 1 || r.drp === 0;
  return {
    film: mono ? MONO[r.sat] : FILMS[r.film] ?? null, mono,
    dr: drpOn ? null : r.drSetting === 0 ? "auto" : r.dr ? `DR${r.dr}` : null,
    drp: r.drp === 0 ? "auto" : r.drp === 1 ? (r.drpFixed === 2 ? "strong" : "weak") : null,
    highlight: drpOn ? null : tone(r.highlight), shadow: drpOn ? null : tone(r.shadow),
    color: mono ? null : COLOR[r.sat] ?? null,
    sharpness: SHARP[r.sharp] ?? null, nr: NR[r.nr] ?? null, clarity: r.clarity == null ? null : r.clarity / 1000,
    grain: LEVEL[r.grain] ?? null, grainSize: r.grainSize === 16 ? "small" : r.grainSize === 32 ? "large" : null,
    colorChrome: mono ? null : LEVEL[r.colorChrome] ?? null, fxBlue: mono ? null : LEVEL[r.fxBlue] ?? null,
    wb: WB[r.wb] ?? null, kelvin: r.wb === 0xff0 && r.kelvin ? r.kelvin : null,
    wbShift: Array.isArray(r.wbFine) && r.wbFine.length >= 2 ? [r.wbFine[0] / 20, r.wbFine[1] / 20] : null,
    monoWarm: mono && r.bwWarm != null ? r.bwWarm : null, monoMagenta: mono && r.bwMagenta != null ? r.bwMagenta : null,
  };
}

/** +2, −1.5, 0: as the camera menus write them. */
export const signed = (v) => (v == null ? "" : v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");

/** Two recipes are the same when every setting matches (exposure and ISO are not part of a recipe). */
export const recipeKey = (r) => (r ? JSON.stringify(r) : "");

/** The decoded recipe of a photo, kept on the item once decoded. */
export const recipeOf = (it) => (it._recipe !== undefined ? it._recipe : (it._recipe = decodeRecipe(it.meta?.recipe)));
