import test from "node:test";
import assert from "node:assert/strict";
import { swingZones } from "../component/pricePatterns.js";

function makeCandles(length) {
  return Array.from({ length }, (_, index) => ({
    time: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
    high: 10,
    low: 8,
  }));
}

function boxCoordinates(zones) {
  return zones.map(({ time1, time2, price1, price2 }) => ({
    time1,
    time2,
    price1,
    price2,
  }));
}

test("returns exact box endpoints and lowest interior price; 99% closes first eligible bar", () => {
  const candles = makeCandles(12);
  candles[3].high = 100;
  candles[3].low = 0;
  candles[4].low = 7;
  candles[5].low = 4;
  candles[6].low = 6;
  candles[7].high = 98.99;
  candles[7].low = 3;
  candles[8].high = 99;
  candles[8].low = 0;

  assert.deepEqual(boxCoordinates(swingZones(candles)), [
    {
      time1: candles[3].time,
      time2: candles[8].time,
      price1: 3,
      price2: 100,
    },
  ]);
});

test("equal highs disqualify both candidate pivots", () => {
  const candles = makeCandles(12);
  candles[3].high = 100;
  candles[6].high = 100;
  candles[9].high = 99;

  assert.deepEqual(swingZones(candles), []);
});

test("returns no boxes for empty or insufficient candle history", () => {
  for (const length of [0, 1, 6])
    assert.deepEqual(swingZones(makeCandles(length)), []);
});

test("requires three bars of context, starts at index 3, and excludes unconfirmed tail", () => {
  const shortest = makeCandles(7);
  shortest[3].high = 100;
  shortest[4].high = 99;
  assert.deepEqual(boxCoordinates(swingZones(shortest)), [
    {
      time1: shortest[3].time,
      time2: shortest[4].time,
      price1: 100,
      price2: 100,
    },
  ]);

  const beforeWarmup = makeCandles(10);
  beforeWarmup[2].high = 100;
  beforeWarmup[6].high = 99;
  assert.deepEqual(swingZones(beforeWarmup), []);

  const lastConfirmed = makeCandles(10);
  lastConfirmed[6].high = 100;
  lastConfirmed[7].high = 99;
  assert.deepEqual(boxCoordinates(swingZones(lastConfirmed)), [
    {
      time1: lastConfirmed[6].time,
      time2: lastConfirmed[7].time,
      price1: 100,
      price2: 100,
    },
  ]);

  const unconfirmedTail = makeCandles(10);
  unconfirmedTail[7].high = 100;
  unconfirmedTail[8].high = 99;
  assert.deepEqual(swingZones(unconfirmedTail), []);
});

test("uses latest-365 candidate start while retaining earlier bars as pivot context", () => {
  const beforeWindow = makeCandles(370);
  beforeWindow[4].high = 100;
  beforeWindow[5].high = 99;
  assert.deepEqual(swingZones(beforeWindow), []);

  const atWindowStart = makeCandles(370);
  atWindowStart[5].high = 100;
  atWindowStart[6].high = 99;
  assert.deepEqual(boxCoordinates(swingZones(atWindowStart)), [
    {
      time1: atWindowStart[5].time,
      time2: atWindowStart[6].time,
      price1: 100,
      price2: 100,
    },
  ]);
});

test("unfinished box does not block later completed swing", () => {
  const candles = makeCandles(15);
  candles[3].high = 100;
  candles[7].high = 80;
  candles[11].high = 79.2;

  assert.deepEqual(boxCoordinates(swingZones(candles)), [
    {
      time1: candles[7].time,
      time2: candles[11].time,
      price1: 8,
      price2: 80,
    },
  ]);
});

test("skips overlapping pivots but allows new box to start at prior close", () => {
  const candles = makeCandles(18);
  candles[3].high = 100;
  candles[7].high = 90;
  candles[11].high = 99;
  candles[15].high = 98.01;

  assert.deepEqual(boxCoordinates(swingZones(candles)), [
    {
      time1: candles[3].time,
      time2: candles[11].time,
      price1: 8,
      price2: 100,
    },
    {
      time1: candles[11].time,
      time2: candles[15].time,
      price1: 8,
      price2: 99,
    },
  ]);
});

test("keeps only latest ten completed boxes in chronological order", () => {
  const candles = makeCandles(100);
  const starts = Array.from({ length: 12 }, (_, index) => 3 + index * 8);
  for (const start of starts) {
    candles[start].high = 100;
    candles[start + 4].high = 99;
    candles[start + 5].high = 99;
  }

  assert.deepEqual(
    boxCoordinates(swingZones(candles)),
    starts.slice(-10).map((start) => ({
      time1: candles[start].time,
      time2: candles[start + 4].time,
      price1: 8,
      price2: 100,
    })),
  );
});
