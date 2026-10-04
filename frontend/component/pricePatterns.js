import { detectDoubleBottoms, detectDoubleTops } from "./doubleReversal.js";
import {
  detectHeadShoulders,
  detectInverseHeadShoulders,
} from "./headShoulders.js";
export { detectDoubleBottoms, detectDoubleTops } from "./doubleReversal.js";
export {
  detectHeadShoulders,
  detectInverseHeadShoulders,
} from "./headShoulders.js";
export function movingAverage(candles, period, field = "close") {
  const result = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i][field];
    if (i >= period) sum -= candles[i - period][field];
    if (i >= period - 1)
      result.push({ time: candles[i].time, value: sum / period });
  }
  return result;
}
export function pivots(candles, radius = 4) {
  const result = [];
  for (let i = radius; i < candles.length - radius; i++) {
    const bar = candles[i],
      neighbors = candles.slice(i - radius, i + radius + 1);
    if (neighbors.every((b, j) => j === radius || b.high < bar.high))
      result.push({ index: i, time: bar.time, price: bar.high, kind: "high" });
    if (neighbors.every((b, j) => j === radius || b.low > bar.low))
      result.push({ index: i, time: bar.time, price: bar.low, kind: "low" });
  }
  return result;
}
export function swingZones(candles) {
  const groups = [];
  for (const point of pivots(candles.slice(-300))) {
    const group = groups.find(
      (g) => Math.abs(g.mean / point.price - 1) < 0.012,
    );
    if (group) {
      group.points.push(point);
      group.mean =
        group.points.reduce((sum, p) => sum + p.price, 0) / group.points.length;
    } else groups.push({ mean: point.price, points: [point] });
  }
  return groups
    .filter((g) => g.points.length >= 2)
    .sort((a, b) => b.points.length - a.points.length)
    .slice(0, 5)
    .map((g) => ({
      lower: g.mean * 0.996,
      upper: g.mean * 1.004,
      touches: g.points.length,
    }));
}
const PRICE_PATTERN_DETECTORS = [
  detectDoubleBottoms,
  detectDoubleTops,
  detectHeadShoulders,
  detectInverseHeadShoulders,
];
function patternSpan(p) {
  const pts = p.lines?.find((line) => line.style === "status")?.points;
  if (pts?.length) {
    const idxs = pts.map((pt) => pt.index).filter((i) => Number.isFinite(i));
    if (idxs.length) return { start: Math.min(...idxs), end: Math.max(...idxs) };
  }
  return { start: p.startIndex ?? 0, end: p.startIndex ?? 0 };
}
/** Prefer confirmed, then pending, then failed; then shorter span. */
function patternScore(p) {
  const statusRank =
    p.status === "confirmed" ? 0 : p.status === "pending" ? 1 : 2;
  const { start, end } = patternSpan(p);
  return statusRank * 1e6 + (end - start);
}
/** Cross-type: one winner per overlapping time span. */
export function dedupeOverlappingPatterns(patterns) {
  const ranked = [...patterns].sort((a, b) => {
    const diff = patternScore(a) - patternScore(b);
    return diff !== 0 ? diff : (a.startIndex ?? 0) - (b.startIndex ?? 0);
  });
  const kept = [];
  for (const p of ranked) {
    const span = patternSpan(p);
    if (
      kept.some((k) => {
        const other = patternSpan(k);
        return span.start <= other.end && span.end >= other.start;
      })
    )
      continue;
    kept.push(p);
  }
  return kept.sort((a, b) => (a.startIndex ?? 0) - (b.startIndex ?? 0));
}
export function pricePatterns(candles, options) {
  return dedupeOverlappingPatterns(
    PRICE_PATTERN_DETECTORS.flatMap((detect) => detect(candles, options)),
  );
}
export const patternLabels = {
  patternDoubleTop: ["Double top", "雙頂"],
  patternDoubleBottom: ["Double bottom", "雙底"],
  patternHeadShoulders: ["Head & shoulders", "頭肩頂"],
  patternInverseHeadShoulders: ["Inverse head & shoulders", "頭肩底"],
};
