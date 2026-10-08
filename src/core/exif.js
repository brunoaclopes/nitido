// @ts-check
/** EXIF + Fujifilm MakerNote reader for JPEG files (and the JPEG embedded in RAF). */
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 };

function readIFD(v, off, base, le) {
  const tags = new Map();
  if (off < 0 || off + 2 > v.byteLength) return tags;
  const n = v.getUint16(off, le);
  for (let i = 0; i < n; i++) {
    const e = off + 2 + i * 12;
    if (e + 12 > v.byteLength) break;
    const tag = v.getUint16(e, le), type = v.getUint16(e + 2, le), count = v.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] || 1) * count;
    tags.set(tag, { type, count, off: size <= 4 ? e + 8 : base + v.getUint32(e + 8, le) });
  }
  return tags;
}
function values(v, t, le) {
  if (!t) return [];
  const { type, count, off } = t, size = TYPE_SIZE[type] || 1;
  if (off < 0 || off + size * count > v.byteLength || count > 100000) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = off + i * size;
    switch (type) {
      case 1: case 7: out.push(v.getUint8(o)); break;
      case 6: out.push(v.getInt8(o)); break;
      case 3: out.push(v.getUint16(o, le)); break;
      case 8: out.push(v.getInt16(o, le)); break;
      case 4: out.push(v.getUint32(o, le)); break;
      case 9: out.push(v.getInt32(o, le)); break;
      case 5: { const d = v.getUint32(o + 4, le); out.push(d ? v.getUint32(o, le) / d : 0); break; }
      case 10: { const d = v.getInt32(o + 4, le); out.push(d ? v.getInt32(o, le) / d : 0); break; }
      default: return out;
    }
  }
  return out;
}
const num = (v, t, le) => values(v, t, le)[0];
function str(v, t) {
  if (!t || t.off < 0 || t.off + t.count > v.byteLength) return "";
  let s = "";
  for (let i = 0; i < t.count; i++) { const c = v.getUint8(t.off + i); if (!c) break; s += String.fromCharCode(c); }
  return s.trim();
}

/** Fujifilm MakerNote: always little-endian, offsets relative to the start of the note. */
function parseFuji(v, off) {
  if (off + 12 > v.byteLength) return {};
  let sig = "";
  for (let i = 0; i < 8; i++) sig += String.fromCharCode(v.getUint8(off + i));
  if (sig !== "FUJIFILM") return {};
  const ifd = readIFD(v, off + v.getUint32(off + 8, true), off, true);
  return {
    sharpnessSetting: num(v, ifd.get(0x1001), true),
    focusMode: num(v, ifd.get(0x1021), true),        // 0 auto, 1 manual
    afMode: num(v, ifd.get(0x1022), true),           // 1 single point, 256 zone, 512 wide/tracking
    focusPixel: values(v, ifd.get(0x1023), true),    // x y in the JPEG's own unrotated pixels
    blurWarning: num(v, ifd.get(0x1300), true),
    focusWarning: num(v, ifd.get(0x1301), true),
    exposureWarning: num(v, ifd.get(0x1302), true),
    // the film recipe, as raw codes (decoded in recipe.js)
    recipe: Object.fromEntries(Object.entries({
      film: 0x1401, sat: 0x1003, sharp: 0x1001, wb: 0x1002, kelvin: 0x1005, wbFine: 0x100a, nr: 0x100b, clarity: 0x100f,
      shadow: 0x1040, highlight: 0x1041, grain: 0x1047, colorChrome: 0x1048, bwWarm: 0x1049, bwMagenta: 0x104b, grainSize: 0x104c,
      fxBlue: 0x104e, drSetting: 0x1402, dr: 0x1403, drp: 0x1443, drpAuto: 0x1444, drpFixed: 0x1445,
    }).map(([k, tag]) => { const val = values(v, ifd.get(tag), true); return [k, val.length > 1 ? val : val[0]]; }).filter(([, x]) => x !== undefined)),
    facePositions: values(v, ifd.get(0x4103), true),
    elementTypes: values(v, ifd.get(0x4201), true),
    elementPositions: values(v, ifd.get(0x4203), true),
  };
}

function parseTiff(v, base) {
  const le = v.getUint16(base) === 0x4949;
  const ifd0 = readIFD(v, base + v.getUint32(base + 4, le), base, le);
  const out = {
    make: str(v, ifd0.get(0x010f)), model: str(v, ifd0.get(0x0110)),
    orientation: num(v, ifd0.get(0x0112), le) || 1,
  };
  const exifPtr = num(v, ifd0.get(0x8769), le);
  if (exifPtr) {
    const ex = readIFD(v, base + exifPtr, base, le);
    Object.assign(out, {
      exposure: num(v, ex.get(0x829a), le), fnumber: num(v, ex.get(0x829d), le),
      iso: num(v, ex.get(0x8827), le), focal: num(v, ex.get(0x920a), le),
      focal35: num(v, ex.get(0xa405), le), expComp: num(v, ex.get(0x9204), le),
      w: num(v, ex.get(0xa002), le), h: num(v, ex.get(0xa003), le),
      dto: str(v, ex.get(0x9003)), subsec: str(v, ex.get(0x9291)),
      lens: str(v, ex.get(0xa434)),
    });
    const mn = ex.get(0x927c);
    if (mn) Object.assign(out, parseFuji(v, mn.off));
  }
  return out;
}

/** @param {ArrayBuffer} buf first ~512 KB of a JPEG */
export function parseExif(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {};
  let p = 2;
  while (p + 4 <= v.byteLength) {
    if (v.getUint8(p) !== 0xff) { p++; continue; }
    const m = v.getUint8(p + 1);
    if (m === 0xff) { p++; continue; }
    if (m === 0xda || m === 0xd9) break;
    const len = v.getUint16(p + 2);
    if (m === 0xe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10);
    p += 2 + len;
  }
  return {};
}

/** Capture time in ms (local clock read as UTC), with sub-seconds. */
export function parseTime(m) {
  const r = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(m.dto || "");
  if (!r) return null;
  const t = Date.UTC(+r[1], +r[2] - 1, +r[3], +r[4], +r[5], +r[6]);
  const ss = (m.subsec || "").trim();
  return t + (/^\d+$/.test(ss) ? Number("0." + ss) * 1000 : 0);
}
