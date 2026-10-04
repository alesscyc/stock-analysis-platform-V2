export const DRAWING_TYPES = [
  "line",
  "horizontal",
  "ray",
  "rectangle",
  "range",
];
export function validDrawings(value) {
  return (
    Array.isArray(value) &&
    value.length <= 500 &&
    value.every(
      (d) =>
        d &&
        typeof d.id === "string" &&
        DRAWING_TYPES.includes(d.type) &&
        Array.isArray(d.points) &&
        d.points.length === (d.type === "horizontal" ? 1 : 2) &&
        d.points.every(
          (p) =>
            /^\d{4}-\d{2}-\d{2}$/.test(p.time) &&
            Number.isFinite(p.price) &&
            p.price > 0,
        ),
    )
  );
}
export function readDrawings(symbol, storage = localStorage) {
  const raw = storage.getItem(`northstar.drawings.${symbol}`);
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (!validDrawings(value))
    throw new Error(
      "Saved drawings are invalid. Clear them explicitly to resume drawing. / 儲存的繪圖無效，請明確清除後繼續繪圖。",
    );
  return value;
}
export function saveDrawings(symbol, value, storage = localStorage) {
  if (!validDrawings(value))
    throw new Error("Invalid drawing coordinates. / 繪圖座標無效。");
  storage.setItem(`northstar.drawings.${symbol}`, JSON.stringify(value));
}
export function timeString(time) {
  if (typeof time === "string") return time;
  if (typeof time === "number")
    return new Date(time * 1000).toISOString().slice(0, 10);
  return time
    ? `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`
    : null;
}
export function drawingLogicalIndex(candles, time) {
  if (!candles.length || time < candles[0].time || time > candles.at(-1).time)
    return null;
  let low = 0,
    high = candles.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (candles[mid].time < time) low = mid + 1;
    else high = mid;
  }
  const before = Math.max(0, low - 1),
    start = Date.parse(candles[before].time),
    end = Date.parse(candles[low].time);
  return (
    before + (end === start ? 0 : (Date.parse(time) - start) / (end - start))
  );
}
export function markerTime(candles, time, interval) {
  const index = drawingLogicalIndex(candles, time);
  if (index !== null) {
    const bar = candles[Math.floor(index)];
    return interval !== "1d" || bar.time === time ? bar.time : null;
  }
  const last = candles.at(-1);
  if (!last || time < last.time || interval === "1d") return null;
  const end = new Date(`${last.time}T00:00:00Z`);
  if (interval === "1wk") end.setUTCDate(end.getUTCDate() + 7);
  else end.setUTCMonth(end.getUTCMonth() + 1, 1);
  return time < end.toISOString().slice(0, 10) ? last.time : null;
}
export function rayEnd(a, b, width) {
  if (Math.abs(b.x - a.x) < 1) return { x: a.x, y: b.y > a.y ? 10000 : -10000 };
  const x = b.x > a.x ? width : 0;
  return { x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) };
}
