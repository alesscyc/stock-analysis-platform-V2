import test from "node:test";
import assert from "node:assert/strict";
import {
  allowlistChatAccount,
  allowlistChatCandles,
  allowlistChatPrediction,
  equityPath,
  evaluateScreener,
  miniCandleGeometry,
  normalizeBacktestSettings,
  parseSymbols,
  validateChatDraft,
} from "./research.js";

const risingCandles = (count = 280) =>
  Array.from({ length: count }, (_, index) => ({
    time: `2024-01-${String((index % 28) + 1).padStart(2, "0")}`,
    open: 20 + index,
    high: 22 + index,
    low: 19 + index,
    close: 21 + index,
    volume: index * 100,
  }));

test("parseSymbols normalizes, strips cash prefix, and deduplicates valid tickers", () => {
  assert.deepEqual(parseSymbols(" $aapl, MSFT; bad_ticker | brk.b AAPL "), [
    "AAPL",
    "MSFT",
    "BRK.B",
  ]);
});

test("screener applies enabled price filters and 90%-rising 200-day trend", () => {
  const candles = risingCandles();
  const result = evaluateScreener(candles, {
    aboveLowEnabled: true,
    aboveLowPercent: 0,
    nearHighEnabled: true,
    nearHighPercent: 0,
    risingMaEnabled: true,
    maTrendDays: 21,
  });
  assert.equal(result.matches, true);
  assert.equal(result.risingDays, 21);
  assert.ok(result.maEnd > result.maStart);

  assert.equal(
    evaluateScreener(candles.slice(0, 100), {
      aboveLowEnabled: false,
      nearHighEnabled: false,
      risingMaEnabled: true,
      maTrendDays: 21,
    }).reason,
    "insufficient-history",
  );
  assert.equal(
    evaluateScreener(candles.slice(0, 251), {
      aboveLowEnabled: true,
      aboveLowPercent: 0,
      nearHighEnabled: false,
      risingMaEnabled: false,
    }).reason,
    "insufficient-history",
  );
  assert.equal(
    evaluateScreener(candles, {
      aboveLowEnabled: false,
      nearHighEnabled: false,
      risingMaEnabled: false,
    }).reason,
    "condition-required",
  );
});

test("backtest preference normalization constrains persisted values and operands", () => {
  const result = normalizeBacktestSettings({
    period: "invalid",
    frequency: "yearly",
    exitMode: "all-at-once",
    exitPeriods: 900,
    initialCapital: -5,
    entry: {
      left: { type: "ma", period: 900 },
      operator: "!=",
      right: { type: "number", value: -1 },
    },
  });
  assert.equal(result.period, "1y");
  assert.equal(result.frequency, "daily");
  assert.equal(result.exitMode, "immediate");
  assert.equal(result.exitPeriods, 100);
  assert.equal(result.initialCapital, 10000);
  assert.equal(result.entry.left.period, 500);
  assert.equal(result.entry.operator, ">");
  assert.equal(result.entry.right.value, 100);
  assert.equal(
    normalizeBacktestSettings({ initialCapital: 9e12 }).initialCapital,
    1e12,
  );
});

test("native SVG geometry handles flat equity and filters invalid candles", () => {
  assert.equal(
    equityPath([{ value: 100 }, { value: 100 }]),
    "M0.0,154.0 L600.0,154.0",
  );
  assert.equal(equityPath([{ value: NaN }]), "");
  const bars = miniCandleGeometry([
    { open: 1, high: 3, low: 0, close: 2 },
    { open: NaN, high: 3, low: 0, close: 2 },
  ]);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].up, true);
  assert.ok(bars[0].highY < bars[0].lowY);
});

test("chat payload allowlists chart bars and read-only account fields", () => {
  const candles = Array.from({ length: 505 }, (_, index) => ({
    time: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
    open: index,
    high: index + 2,
    low: index - 1,
    close: index + 1,
    volume: index,
    token: "secret",
  }));
  const safeCandles = allowlistChatCandles(candles);
  assert.equal(safeCandles.length, 500);
  assert.equal(safeCandles[0].time, "2020-01-06");
  assert.equal("token" in safeCandles[0], false);

  const account = allowlistChatAccount({
    accountId: "real-account-123",
    apiKey: "secret",
    mode: "live",
    currency: "USD",
    summary: { cash: 100, privateField: "secret" },
    positions: [{ symbol: "AAPL", quantity: 2, price: 50, password: "secret" }],
    orders: [
      {
        symbol: "MSFT",
        side: "BUY",
        quantity: 1,
        status: "Submitted",
        orderId: "private",
      },
      { symbol: "NVDA", side: "SELL", quantity: 1, status: "Filled" },
    ],
  });
  assert.deepEqual(account, {
    mode: "live",
    currency: "USD",
    summary: { cash: 100 },
    positions: [{ symbol: "AAPL", quantity: 2, price: 50 }],
    orders: [{ symbol: "MSFT", quantity: 1, side: "BUY", status: "Submitted" }],
  });
  assert.equal("accountId" in account, false);
  assert.equal(
    allowlistChatPrediction({ confidence: 0.9, training: { samples: 10 } }),
    null,
  );
  assert.deepEqual(
    allowlistChatPrediction({ signal: "BUY", confidence: 1.5, secret: "drop" }),
    { signal: "BUY", confidence: 1 },
  );
  assert.deepEqual(
    allowlistChatAccount({
      mode: "Paper",
      account: { cash: 25, startingCash: 100 },
      orders: [],
    }),
    {
      mode: "paper",
      summary: { cash: 25, startingCash: 100 },
    },
  );
});

test("chat order drafts accept only explicit whole-share limit tickets", () => {
  assert.deepEqual(
    validateChatDraft({
      symbol: "aapl",
      side: "BUY",
      quantity: 2,
      limitPrice: 180,
      tif: "DAY",
      takeProfit: 200,
    }),
    {
      symbol: "AAPL",
      side: "BUY",
      quantity: 2,
      limitPrice: 180,
      tif: "DAY",
      takeProfit: 200,
    },
  );
  assert.equal(
    validateChatDraft({
      symbol: "AAPL",
      side: "BUY",
      quantity: 1.5,
      limitPrice: 180,
      tif: "DAY",
    }),
    null,
  );
  assert.equal(
    validateChatDraft({
      symbol: "AAPL",
      side: "BUY",
      quantity: 2,
      limitPrice: 180,
      tif: "DAY",
      stopLoss: -1,
    }),
    null,
  );
  assert.equal(
    validateChatDraft(
      { symbol: "MSFT", side: "BUY", quantity: 2, limitPrice: 180, tif: "DAY" },
      "AAPL",
    ),
    null,
  );
  assert.equal(
    validateChatDraft({
      symbol: "AAPL",
      side: "BUY",
      quantity: 2,
      limitPrice: 180,
      tif: "DAY",
      takeProfit: 170,
    }),
    null,
  );
});
