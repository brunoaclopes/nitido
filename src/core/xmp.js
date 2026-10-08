// @ts-check
/** XMP sidecars: stars, colour label, pick/reject, keywords. Existing sidecars are edited in
 *  place so develop settings and other metadata written by Lightroom are preserved. */
const NS = {
  xmp: "http://ns.adobe.com/xap/1.0/",
  xmpDM: "http://ns.adobe.com/xmp/1.0/DynamicMedia/",
  photoshop: "http://ns.adobe.com/photoshop/1.0/",
  dc: "http://purl.org/dc/elements/1.1/",
};
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
export const KEYWORD_PREFIX = "Nítido|";

function attrs(f) {
  const a = { "xmp:Rating": String(f.rating) };
  if (f.label) { a["xmp:Label"] = f.label; a["photoshop:LabelColor"] = f.label.toLowerCase(); }
  if (f.pick != null) a["xmpDM:good"] = f.pick ? "True" : "False";
  return a;
}
const bag = (kw) => `<dc:subject><rdf:Bag>${kw.map((k) => `<rdf:li>${esc(k)}</rdf:li>`).join("")}</rdf:Bag></dc:subject>`;

/** @param {{rating: number, label?: string, pick?: boolean|null, keywords?: string[]}} f */
export function buildXmp(f) {
  const a = Object.entries(attrs(f)).map(([k, v]) => `\n    ${k}="${esc(v)}"`).join("");
  const kw = f.keywords && f.keywords.length ? `\n   ${bag(f.keywords)}\n  ` : "";
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Nitido">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""${Object.entries(NS).map(([p, u]) => `\n    xmlns:${p}="${u}"`).join("")}${a}${kw ? ">" + kw + "</rdf:Description>" : "/>"}
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;
}

/** Merge our fields into an existing sidecar; falls back to a fresh one if it cannot be parsed. */
export function mergeXmp(existing, f) {
  const open = /<rdf:Description\b[^>]*?(\/?)>/.exec(existing);
  if (!open) return buildXmp(f);
  let tag = open[0];
  const selfClosing = open[1] === "/";
  const ours = attrs(f);
  for (const k of ["xmp:Rating", "xmp:Label", "photoshop:LabelColor", "xmpDM:good"]) {
    tag = tag.replace(new RegExp(`\\s${k.replace(":", "\\:")}="[^"]*"`), "");
  }
  for (const [p, u] of Object.entries(NS)) if (!new RegExp(`xmlns:${p}=`).test(tag)) tag = tag.replace(/\s*\/?>$/, ` xmlns:${p}="${u}"$&`);
  tag = tag.replace(/\s*\/?>$/, Object.entries(ours).map(([k, v]) => ` ${k}="${esc(v)}"`).join("") + (selfClosing ? "/>" : ">"));
  let out = existing.slice(0, open.index) + tag + existing.slice(open.index + open[0].length);
  // Keywords: replace our own, keep everyone else's
  const kw = f.keywords || [];
  const bagRe = /<dc:subject>\s*<rdf:Bag>([\s\S]*?)<\/rdf:Bag>\s*<\/dc:subject>/;
  const m = bagRe.exec(out);
  if (m) {
    const others = [...m[1].matchAll(/<rdf:li>([\s\S]*?)<\/rdf:li>/g)].map((x) => x[1]).filter((k) => !k.startsWith(esc(KEYWORD_PREFIX)));
    out = out.replace(bagRe, bag([...others, ...kw].map((k) => k.replace(/&amp;/g, "&"))));
  } else if (kw.length) {
    if (selfClosing) {
      const at = out.indexOf(tag) + tag.length;
      out = out.slice(0, at - 2) + ">" + bag(kw) + "</rdf:Description>" + out.slice(at);
    } else out = out.replace("</rdf:Description>", bag(kw) + "</rdf:Description>");
  }
  return out;
}
