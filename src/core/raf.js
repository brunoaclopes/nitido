// @ts-check
/** Fujifilm RAF: locate the embedded JPEG preview (offset at 0x54, length at 0x58, big-endian). */
export function rafPreviewRange(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 92) return null;
  let magic = "";
  for (let i = 0; i < 15; i++) magic += String.fromCharCode(v.getUint8(i));
  if (magic !== "FUJIFILMCCD-RAW") return null;
  const offset = v.getUint32(84, false), length = v.getUint32(88, false);
  return offset > 0 && length > 0 ? { offset, length } : null;
}
/** @param {Blob} file */
export async function rafPreview(file) {
  const r = rafPreviewRange(await file.slice(0, 160).arrayBuffer());
  if (!r || r.offset + r.length > file.size) return null;
  return file.slice(r.offset, r.offset + r.length, "image/jpeg");
}
