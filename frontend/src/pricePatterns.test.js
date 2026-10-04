import test from "node:test";
import assert from "node:assert/strict";
import {
  detectDoubleBottoms,
  detectDoubleTops,
  detectHeadShoulders,
  detectInverseHeadShoulders,
  pricePatterns,
  dedupeOverlappingPatterns,
} from "../component/pricePatterns.js";

const candle = (time, high, low, close = high - 1) => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 100,
});
const options = {
  leftBars: 1,
  rightBars: 1,
  minBarsBetweenBottoms: 4,
  maxBarsBetweenBottoms: 8,
};
const topOptions = {
  leftBars: 1,
  rightBars: 1,
  minBarsBetweenTops: 4,
  maxBarsBetweenTops: 8,
};
const downtrend = [
  candle(0, 110, 100),
  candle(1, 135, 125),
  candle(2, 112, 108),
  candle(3, 125, 118),
  candle(4, 112, 104),
  candle(5, 108, 100),
  candle(6, 112, 104),
  candle(7, 120, 110),
  candle(8, 114, 106),
  candle(9, 111, 103),
  candle(10, 108, 101),
  candle(11, 114, 105),
  candle(12, 121, 111, 121),
  candle(13, 119, 112),
];
const failedBottom = downtrend.map((bar) =>
  bar.time === 12 ? candle(12, 105, 95, 99) : bar,
);
const mirror = (data) =>
  data.map((bar) => ({
    ...bar,
    open: 10000 / bar.open,
    high: 10000 / bar.low,
    low: 10000 / bar.high,
    close: 10000 / bar.close,
  }));
const hsOptions = {
  leftBars: 1,
  rightBars: 1,
  minBarsLeg: 3,
  maxBarsLeg: 20,
  minHeadClearance: 0.03,
  shoulderTolerance: 0.05,
};
/** Classic H&S: LS@1 → N1@3 → Head@5 → N2@7 → RS@9, breakout@12 */
const headShoulders = [
  candle(0, 100, 90, 95),
  candle(1, 120, 105, 115),
  candle(2, 110, 100, 105),
  candle(3, 105, 85, 90),
  candle(4, 115, 95, 110),
  candle(5, 145, 125, 140),
  candle(6, 130, 110, 120),
  candle(7, 115, 88, 95),
  candle(8, 118, 100, 112),
  candle(9, 122, 108, 118),
  candle(10, 112, 100, 105),
  candle(11, 108, 95, 100),
  candle(12, 100, 80, 82),
];

test("double bottom needs prior downtrend; failure keeps invalidating candle", () => {
  const uptrend = downtrend.map((bar, index) =>
    index === 1 ? { ...bar, high: 115 } : index === 2 ? { ...bar, low: 90 } : bar,
  );
  assert.deepEqual(detectDoubleBottoms(uptrend, options), []);
  const found = detectDoubleBottoms(downtrend, options);
  assert.equal(found.length, 1);
  assert.equal(found[0].nameKey, "patternDoubleBottom");
  const [failed] = detectDoubleBottoms(failedBottom, options);
  assert.equal(failed.status, "failed");
  assert.equal(failed.invalidated.time, 12);
});

test("double top mirrors bottom rules", () => {
  const [top] = detectDoubleTops(mirror(downtrend), topOptions);
  assert.equal(top.type, "double-top");
  assert.equal(top.status, "confirmed");
  assert.equal(top.breakout.time, 12);
  assert.equal(top.lines.length, 2);
  assert.equal(top.nameKey, "patternDoubleTop");
  const [failed] = detectDoubleTops(mirror(failedBottom), topOptions);
  assert.equal(failed.status, "failed");
  assert.equal(failed.invalidated.time, 12);
});

test("head and shoulders confirms, fails, stays pending, and mirrors", () => {
  const [hs] = detectHeadShoulders(headShoulders, hsOptions);
  assert.equal(hs.type, "head-shoulders");
  assert.equal(hs.nameKey, "patternHeadShoulders");
  assert.equal(hs.status, "confirmed");
  assert.equal(hs.color, "#ef5350");
  assert.equal(hs.breakout.time, 12);
  assert.equal(hs.lines[0].points.length, 5);

  const failed = headShoulders.map((bar) =>
    bar.time === 12 ? candle(12, 150, 140, 148) : bar,
  );
  const [fail] = detectHeadShoulders(failed, hsOptions);
  assert.equal(fail.status, "failed");
  assert.equal(fail.invalidated.time, 12);

  const [pending] = detectHeadShoulders(headShoulders.slice(0, 12), hsOptions);
  assert.equal(pending.status, "pending");
  assert.equal(pending.breakout, undefined);
  assert.equal(pending.invalidated, undefined);

  const [inverse] = detectInverseHeadShoulders(mirror(headShoulders), hsOptions);
  assert.equal(inverse.type, "inverse-head-shoulders");
  assert.equal(inverse.nameKey, "patternInverseHeadShoulders");
  assert.equal(inverse.status, "confirmed");
  assert.equal(inverse.color, "#26a69a");
});

test("head and shoulders rejects skewed neckline, lopsided legs, skipped shoulder", () => {
  const skewed = headShoulders.map((bar) =>
    bar.time === 7 ? candle(7, 115, 70, 80) : bar,
  );
  assert.deepEqual(detectHeadShoulders(skewed, hsOptions), []);

  const stretched = [
    candle(0, 100, 90, 95),
    candle(1, 120, 105, 115),
    candle(2, 110, 100, 105),
    candle(3, 105, 85, 90),
    candle(4, 115, 95, 110),
    candle(5, 145, 125, 140),
    candle(6, 130, 110, 120),
    candle(7, 115, 88, 95),
    candle(8, 108, 100, 104),
    candle(9, 110, 98, 102),
    candle(10, 109, 99, 103),
    candle(11, 111, 97, 101),
    candle(12, 110, 98, 102),
    candle(13, 112, 100, 104),
    candle(14, 111, 99, 103),
    candle(15, 113, 101, 106),
    candle(16, 112, 100, 105),
    candle(17, 122, 108, 118),
    candle(18, 112, 100, 105),
    candle(19, 100, 80, 82),
  ];
  assert.deepEqual(
    detectHeadShoulders(stretched, { ...hsOptions, maxLegAsymmetry: 2 }),
    [],
  );

  const skipped = [
    candle(0, 100, 90, 95),
    candle(1, 122, 105, 115),
    candle(2, 115, 100, 108),
    candle(3, 112, 98, 105),
    candle(4, 114, 100, 108),
    candle(5, 118, 105, 112),
    candle(6, 110, 95, 100),
    candle(7, 105, 85, 90),
    candle(8, 120, 100, 115),
    candle(9, 145, 125, 140),
    candle(10, 125, 105, 115),
    candle(11, 112, 88, 95),
    candle(12, 115, 100, 110),
    candle(13, 121, 108, 118),
    candle(14, 110, 100, 105),
    candle(15, 100, 80, 82),
  ];
  const patterns = detectHeadShoulders(skipped, hsOptions);
  assert.ok(patterns.length > 0);
  assert.ok(patterns.every((p) => p.lines[0].points[0].index === 5));
});

test("combined feed keeps failed patterns and one winner per overlap", () => {
  const failed = pricePatterns(failedBottom, options);
  assert.deepEqual(
    failed.map((p) => [p.type, p.status]),
    [["double-bottom", "failed"]],
  );
  assert.ok(
    pricePatterns(headShoulders, hsOptions).some(
      (p) => p.type === "head-shoulders" && p.status === "confirmed",
    ),
  );
  const line = (start, end) => [
    {
      style: "status",
      points: [
        { index: start, time: start, price: 1 },
        { index: end, time: end, price: 1 },
      ],
    },
  ];
  const kept = dedupeOverlappingPatterns([
    { type: "head-shoulders", status: "pending", startIndex: 0, lines: line(0, 10) },
    { type: "inverse-head-shoulders", status: "confirmed", startIndex: 5, lines: line(5, 15) },
    { type: "double-bottom", status: "confirmed", startIndex: 20, lines: line(20, 30) },
  ]);
  assert.deepEqual(
    kept.map((p) => p.type),
    ["inverse-head-shoulders", "double-bottom"],
  );
});
