// @ts-check
/// <reference lib="webworker" />
/** Image–text model of the chosen AI tier (MobileCLIP or SigLIP, quantised, cached by the browser
 *  after the first run):
 *  - embeddings for grouping similar photos
 *  - zero-shot quality and sharpness (CLIP-IQA antonym prompt pairs)
 *  - a scene label to auto-name groups */
import { SCENE_LABELS } from "../ml/labels.js";

let T, processor, vision, family = "clip", labelKeys = [], labelEmb = null, pairs = null;
const post = (m) => /** @type {any} */ (self).postMessage(m);

const PAIRS = {
  quality: [["Good photo.", "Bad photo."], ["A high quality photograph.", "A low quality photograph."]],
  sharp: [["Sharp photo.", "Blurry photo."], ["This is a good photo because it is sharp.", "This is a bad photo because it is blurred."]],
};
const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, (x) => x / s); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const rows = (t) => { const [n, d] = t.dims; return Array.from({ length: n }, (_, i) => norm(t.data.slice(i * d, (i + 1) * d))); };

async function init({ libUrl, model, family: fam = "clip", localModelPath }) {
  family = fam;
  T = await import(libUrl);
  T.env.allowLocalModels = !!localModelPath;
  if (localModelPath) T.env.localModelPath = localModelPath;
  T.env.allowRemoteModels = true;
  const progress_callback = (p) => { if (p.status === "progress") post({ op: "progress", file: p.file, loaded: p.loaded, total: p.total }); };
  const opts = { dtype: "q8", device: "wasm", progress_callback };
  processor = await T.AutoProcessor.from_pretrained(model, { progress_callback });
  // MobileCLIP and OpenAI CLIP share the CLIP classes; SigLIP has its own and returns the pooled output
  const siglip = family === "siglip";
  // MobileCLIP is convolutional, and its 8-bit image model loses the plot (same-burst frames score below
  // unrelated scenes): its image side runs at full precision
  vision = await (siglip ? T.SiglipVisionModel : T.CLIPVisionModelWithProjection).from_pretrained(model, family === "mobileclip" ? { ...opts, dtype: "fp32" } : opts);
  const tokenizer = await T.AutoTokenizer.from_pretrained(model, { progress_callback });
  const text = await (siglip ? T.SiglipTextModel : T.CLIPTextModelWithProjection).from_pretrained(model, opts);
  const embedTexts = async (list) => {
    // SigLIP and MobileCLIP text encoders expect prompts padded to their fixed length
    const pad = siglip ? { padding: "max_length", truncation: true, max_length: 64 } : family === "mobileclip" ? { padding: "max_length", truncation: true } : { padding: true, truncation: true };
    const out = await text(tokenizer(list, pad));
    return rows(siglip ? out.pooler_output : out.text_embeds);
  };
  pairs = {};
  for (const [k, ps] of Object.entries(PAIRS)) {
    const e = await embedTexts(ps.flat());
    pairs[k] = ps.map((_, i) => [e[2 * i], e[2 * i + 1]]);
  }
  labelKeys = Object.keys(SCENE_LABELS);
  labelEmb = await embedTexts(labelKeys.map((k) => `a photo of ${SCENE_LABELS[k]}`));
  await text.dispose?.();
}

/** Probability the image matches the positive prompt, averaged over prompt pairs (logit scale 100). */
function pairScore(emb, list) {
  let s = 0;
  for (const [pos, neg] of list) {
    const a = 100 * dot(emb, pos), b = 100 * dot(emb, neg);
    s += 1 / (1 + Math.exp(b - a));
  }
  return s / list.length;
}

async function embed(images) {
  const raw = images.map((im) => new T.RawImage(new Uint8ClampedArray(im.data), im.width, im.height, 4).rgb());
  const inputs = await processor(raw);
  const out = await vision(inputs);
  return rows(family === "siglip" ? out.pooler_output : out.image_embeds);
}

self.onmessage = async (e) => {
  const { id, op } = e.data;
  try {
    if (op === "init") { await init(e.data.cfg); post({ id, r: true }); return; }
    if (op === "analyse") {
      const out = [];
      for (const job of e.data.jobs) {
        const ims = [job.clip, ...(job.subject ? [job.subject] : [])];
        const [whole, subj] = await embed(ims);
        let li = 0, lb = -Infinity;
        labelEmb.forEach((t, i) => { const v = dot(whole, t); if (v > lb) { lb = v; li = i; } });
        out.push({
          key: job.key, emb: whole,
          quality: pairScore(whole, pairs.quality), sharp: pairScore(whole, pairs.sharp),
          subjectSharp: subj ? pairScore(subj, pairs.sharp) : null,
          label: labelKeys[li], labelSim: lb,
        });
      }
      post({ id, r: out });
    }
  } catch (err) {
    post({ id, error: String((err && err.message) || err) });
  }
};
