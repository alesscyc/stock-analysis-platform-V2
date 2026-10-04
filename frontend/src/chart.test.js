import test from "node:test";
import assert from "node:assert/strict";
import {
  movingAverage,
  swingZones,
} from "../component/pricePatterns.js";
import {
  readDrawings,
  saveDrawings,
  rayEnd,
  timeString,
  drawingLogicalIndex,
  markerTime,
} from "../component/drawings.js";

test("moving averages follow bar periods; swing zones found", () => {
  const bars = Array.from({ length: 160 }, (_, i) => {
    const price = 100 + 12 * Math.sin((i * Math.PI) / 20);
    return {
      time: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
      open: price,
      close: price,
      high: price + 1,
      low: price - 1,
      volume: i + 1,
    };
  });
  assert.equal(movingAverage(bars, 20).length, 141);
  assert.equal(movingAverage(bars, 200).length, 0);
  assert.equal(movingAverage(bars, 2, "volume")[0].value, 1.5);
  assert.ok(swingZones(bars).length > 0);
});
test("drawings validate before save; corrupt data is not silently overwritten", () => {
  const data = new Map(),
    storage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    };
  const drawing = [
    {
      id: "x",
      type: "horizontal",
      points: [{ time: "2025-01-01", price: 100 }],
    },
  ];
  saveDrawings("AAPL", drawing, storage);
  assert.deepEqual(readDrawings("AAPL", storage), drawing);
  assert.deepEqual(readDrawings("NVDA", storage), []);
  assert.throws(() =>
    saveDrawings(
      "AAPL",
      [{ ...drawing[0], points: [{ time: "bad", price: -1 }] }],
      storage,
    ),
  );
  data.set("northstar.drawings.AAPL", "{}");
  assert.throws(() => readDrawings("AAPL", storage));
  assert.equal(data.get("northstar.drawings.AAPL"), "{}");
  assert.equal(timeString({ year: 2025, month: 1, day: 2 }), "2025-01-02");
  assert.deepEqual(rayEnd({ x: 10, y: 10 }, { x: 20, y: 20 }, 100), {
    x: 100,
    y: 100,
  });
  const weekly = [
    { time: "2025-01-06" },
    { time: "2025-01-13" },
    { time: "2025-01-20" },
  ];
  assert.equal(drawingLogicalIndex(weekly, "2025-01-13"), 1);
  assert.equal(drawingLogicalIndex(weekly, "2025-01-08"), 2 / 7);
  assert.equal(drawingLogicalIndex(weekly, "2024-01-01"), null);
  assert.equal(markerTime(weekly, "2025-01-09", "1wk"), "2025-01-06");
  assert.equal(markerTime(weekly, "2025-01-24", "1wk"), "2025-01-20");
  assert.equal(markerTime(weekly, "2025-01-27", "1wk"), null);
  assert.equal(markerTime(weekly, "2025-01-09", "1d"), null);
  assert.equal(
    markerTime([{ time: "2025-01-01" }], "2025-01-31", "1mo"),
    "2025-01-01",
  );
});
