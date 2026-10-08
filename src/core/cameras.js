// @ts-check
/** Full-resolution long side per Fujifilm model, used to express blur in full-size pixels
 *  (so M/S JPEGs and RAF previews are judged on the same scale as L files). */
const LONG_SIDE = {
  "X-H2": 7728, "X-T5": 7728, "X100VI": 7728, "X-T50": 7728, "X-E5": 7728,
  "X-H2S": 6240, "X-T4": 6240, "X-T3": 6240, "X-S10": 6240, "X-S20": 6240, "X-E4": 6240,
  "X100V": 6240, "X-T30": 6240, "X-T30 II": 6240, "X-M5": 6240, "X-Pro3": 6240,
  "GFX100S": 11648, "GFX100S II": 11648, "GFX100 II": 11648, "GFX50S II": 8256,
};
/** Factor that converts blur measured on this image into blur at full resolution. */
export function blurScale(meta, W, H) {
  const ref = LONG_SIDE[(meta.model || "").trim()];
  const long = Math.max(W, H);
  return ref && ref > long * 1.05 ? ref / long : 1;
}
