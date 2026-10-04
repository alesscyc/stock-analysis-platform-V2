import test from "node:test";
import assert from "node:assert/strict";
import {
  PAPER_HISTORY_LIMIT,
  applyPaperQuotes,
  availableResources,
  cancelPaperOrder,
  createPaperAccount,
  expirePaperOrders,
  modifyPaperOrder,
  parsePaperAccount,
  paperSummary,
  submitPaperOrder,
  validatePaperAccount,
} from "./paperAccount.js";

const time = new Date("2025-03-04T15:00:00Z").getTime();
let sequence = 0;
const ids = () => `id-${++sequence}`;
const account = (cash = 10_000) => createPaperAccount(cash, { now: time });
const submit = (state, ticket, now = time) =>
  submitPaperOrder(state, ticket, { now, id: ids });
const quote = (symbol, price, at) => ({
  symbol,
  price,
  asOf: new Date(at).toISOString(),
});

test("creates and parses schema; rejects corrupt and over-reserved snapshots", () => {
  const initial = account();
  assert.equal(parsePaperAccount(JSON.stringify(initial)).cash, 10_000);
  assert.throws(() => parsePaperAccount("{broken"), /corrupt/);
  assert.throws(
    () => validatePaperAccount({ ...initial, version: 2 }),
    /Unsupported/,
  );
  const overdrawn = submit(account(500), {
    symbol: "AAPL",
    side: "BUY",
    quantity: 5,
    limitPrice: 100,
    tif: "GTC",
  });
  assert.throws(
    () => validatePaperAccount({ ...overdrawn, cash: 100 }),
    /reserve more cash/,
  );
});

test("reserves cash and shares; fills whole shares without margin or shorting", () => {
  let state = submit(account(1_000), {
    symbol: "AAPL",
    side: "BUY",
    quantity: 5,
    limitPrice: 100,
    tif: "GTC",
  });
  assert.equal(availableResources(state, "AAPL").availableCash, 500);
  assert.throws(
    () =>
      submit(state, {
        symbol: "AAPL",
        side: "BUY",
        quantity: 6,
        limitPrice: 100,
        tif: "GTC",
      }),
    /Insufficient available cash/,
  );
  assert.throws(
    () =>
      submit(state, {
        symbol: "AAPL",
        side: "SELL",
        quantity: 1,
        limitPrice: 100,
        tif: "GTC",
      }),
    /unreserved shares/,
  );
  assert.throws(
    () =>
      submit(state, {
        symbol: "AAPL",
        side: "BUY",
        quantity: 1.5,
        limitPrice: 10,
        tif: "GTC",
      }),
    /whole number/,
  );

  state = applyPaperQuotes(state, [quote("AAPL", 90, time)], time);
  assert.deepEqual(state.positions, [
    { symbol: "AAPL", quantity: 5, averageCost: 90 },
  ]);
  assert.equal(state.cash, 550);
  state = submit(state, {
    symbol: "AAPL",
    side: "SELL",
    quantity: 3,
    limitPrice: 110,
    tif: "GTC",
  });
  assert.equal(availableResources(state, "AAPL").availableShares, 2);
  assert.throws(
    () =>
      submit(state, {
        symbol: "AAPL",
        side: "SELL",
        quantity: 3,
        limitPrice: 110,
        tif: "GTC",
      }),
    /unreserved shares/,
  );
  state = applyPaperQuotes(
    state,
    [quote("AAPL", 111, time + 1_000)],
    time + 1_000,
  );
  assert.equal(state.positions[0].quantity, 2);
  assert.equal(state.cash, 883);
  assert.equal(state.realizedPnl, 63);
});

test("BUY bracket holds children, activates after parent fill, then OCO cancels sibling", () => {
  let state = submit(account(), {
    symbol: "MSFT",
    side: "BUY",
    quantity: 10,
    limitPrice: 100,
    tif: "GTC",
    takeProfit: 120,
    stopLoss: 90,
  });
  const parent = state.orders.find((order) => !order.parentId);
  assert.equal(
    state.orders.filter((order) => order.status === "held").length,
    2,
  );
  assert.equal(availableResources(state, "MSFT").availableCash, 9_000);
  assert.equal(availableResources(state, "MSFT").availableShares, 0);

  state = applyPaperQuotes(state, [quote("MSFT", 89, time)], time);
  assert.equal(state.positions[0].quantity, 10);
  assert.equal(
    state.orders.filter((order) => order.status === "pending").length,
    2,
  );
  assert.equal(
    state.history.find((order) => order.id === parent.id).status,
    "filled",
  );
  assert.equal(availableResources(state, "MSFT").reservedShares, 10);

  state = applyPaperQuotes(
    state,
    [quote("MSFT", 121, time + 1_000)],
    time + 1_000,
  );
  assert.equal(state.positions.length, 0);
  assert.equal(state.cash, 10_320);
  assert.equal(state.realizedPnl, 320);
  assert.deepEqual(
    state.history.slice(0, 2).map((order) => order.status),
    ["cancelled", "filled"],
  );
  assert.equal(state.history[0].reason, "oco-filled");
});

test("stop-loss fills on trigger and takes sibling out; newly activated children do not replay parent quote", () => {
  let state = submit(account(), {
    symbol: "NVDA",
    side: "BUY",
    quantity: 2,
    limitPrice: 100,
    tif: "GTC",
    takeProfit: 120,
    stopLoss: 90,
  });
  state = applyPaperQuotes(state, [quote("NVDA", 80, time)], time);
  assert.equal(state.positions[0].quantity, 2);
  assert.equal(
    state.orders.find((order) => order.bracketRole === "stopLoss").status,
    "pending",
  );
  assert.equal(
    state.orders.find((order) => order.bracketRole === "takeProfit").status,
    "pending",
  );
  state = applyPaperQuotes(
    state,
    [quote("NVDA", 89, time + 1_000)],
    time + 1_000,
  );
  assert.equal(state.positions.length, 0);
  assert.equal(
    state.history.find((order) => order.bracketRole === "stopLoss").status,
    "filled",
  );
  assert.equal(
    state.history.find((order) => order.bracketRole === "takeProfit").reason,
    "oco-filled",
  );
});

test("DAY orders expire at next local midnight, including held bracket legs", () => {
  const localStart = new Date(2025, 2, 4, 23, 59, 0, 0).getTime();
  const deadline = new Date(localStart);
  deadline.setHours(24, 0, 0, 0);
  let state = submit(
    account(),
    {
      symbol: "AMD",
      side: "BUY",
      quantity: 1,
      limitPrice: 100,
      tif: "DAY",
      takeProfit: 120,
      stopLoss: 90,
    },
    localStart,
  );
  assert.equal(Date.parse(state.orders[0].expiresAt), deadline.getTime());
  state = expirePaperOrders(state, deadline.getTime());
  assert.equal(state.orders.length, 0);
  assert.equal(state.history.length, 3);
  assert.ok(state.history.every((order) => order.status === "expired"));
});

test("IOC/FOK use only fresh current snapshots and either fill fully or cancel", () => {
  let state = applyPaperQuotes(account(), [quote("IBM", 99, time)], time);
  state = submit(state, {
    symbol: "IBM",
    side: "BUY",
    quantity: 3,
    limitPrice: 100,
    tif: "IOC",
  });
  assert.equal(state.history[0].status, "filled");
  assert.equal(state.positions[0].quantity, 3);
  assert.equal(state.orders.length, 0);

  state = submit(state, {
    symbol: "IBM",
    side: "BUY",
    quantity: 3,
    limitPrice: 90,
    tif: "FOK",
  });
  assert.equal(state.history[0].status, "cancelled");
  assert.equal(state.history[0].reason, "not-filled-immediately");
  assert.equal(state.positions[0].quantity, 3);

  const stale = applyPaperQuotes(
    account(),
    [quote("IBM", 80, time - 10 * 60_000)],
    time,
  );
  state = submit(stale, {
    symbol: "IBM",
    side: "BUY",
    quantity: 1,
    limitPrice: 100,
    tif: "IOC",
  });
  assert.equal(state.history[0].status, "cancelled");
});

test("quotes must be newer than persisted snapshots; replays cannot fill pending orders", () => {
  let state = submit(account(), {
    symbol: "TSLA",
    side: "BUY",
    quantity: 1,
    limitPrice: 100,
    tif: "GTC",
  });
  state = applyPaperQuotes(state, [quote("TSLA", 110, time)], time);
  const replay = applyPaperQuotes(
    state,
    [quote("TSLA", 90, time)],
    time + 1_000,
  );
  assert.equal(replay.orders.length, 1);
  assert.equal(replay.positions.length, 0);
  state = applyPaperQuotes(
    replay,
    [quote("TSLA", 99, time + 2_000)],
    time + 2_000,
  );
  assert.equal(state.orders.length, 0);
  assert.equal(state.positions[0].quantity, 1);
});

test("modify prices rechecks reservations; cancellation releases reserves", () => {
  let state = submit(account(1_000), {
    symbol: "AAPL",
    side: "BUY",
    quantity: 5,
    limitPrice: 100,
    tif: "GTC",
  });
  const id = state.orders[0].id;
  assert.throws(
    () => modifyPaperOrder(state, id, { limitPrice: 250 }, time + 1),
    /Insufficient available cash/,
  );
  assert.throws(
    () => modifyPaperOrder(state, id, { quantity: 2 }, time + 1),
    /Only order prices/,
  );
  state = modifyPaperOrder(state, id, { limitPrice: 80 }, time + 1);
  assert.equal(availableResources(state, "AAPL").availableCash, 600);
  state = cancelPaperOrder(state, id, time + 2);
  assert.equal(state.orders.length, 0);
  assert.equal(availableResources(state, "AAPL").availableCash, 1_000);
  assert.equal(state.history[0].status, "cancelled");
});

test("bracket price edits preserve parent and OCO price ordering", () => {
  let state = submit(account(), {
    symbol: "ORCL",
    side: "BUY",
    quantity: 1,
    limitPrice: 100,
    tif: "GTC",
    takeProfit: 120,
    stopLoss: 90,
  });
  const parent = state.orders.find((order) => !order.parentId);
  const stop = state.orders.find((order) => order.bracketRole === "stopLoss");
  assert.throws(
    () => modifyPaperOrder(state, parent.id, { limitPrice: 85 }, time + 1),
    /straddle/,
  );
  assert.throws(
    () => modifyPaperOrder(state, stop.id, { stopPrice: 110 }, time + 1),
    /straddle/,
  );
  state = modifyPaperOrder(state, stop.id, { stopPrice: 95 }, time + 1);
  assert.equal(
    state.orders.find((order) => order.id === stop.id).limitPrice,
    95,
  );
});

test("realized losses remain valid account state and summary reports real quote freshness", () => {
  let state = submit(account(), {
    symbol: "INTC",
    side: "BUY",
    quantity: 2,
    limitPrice: 100,
    tif: "GTC",
    takeProfit: 120,
    stopLoss: 90,
  });
  state = applyPaperQuotes(state, [quote("INTC", 100, time)], time);
  state = applyPaperQuotes(
    state,
    [quote("INTC", 89, time + 1_000)],
    time + 1_000,
  );
  assert.equal(state.realizedPnl, -22);
  assert.equal(validatePaperAccount(state), state);

  state = submit(
    state,
    { symbol: "INTC", side: "BUY", quantity: 1, limitPrice: 80, tif: "GTC" },
    time + 2_000,
  );
  state = applyPaperQuotes(
    state,
    [quote("INTC", 80, time + 3_000)],
    time + 3_000,
  );
  const summary = paperSummary(state, time + 3_000);
  assert.equal(summary.positions[0].price, 80);
  assert.equal(summary.summary.realizedPnl, -22);
});

test("canceling BUY parent cancels held children; SELL bracket rejected", () => {
  let state = submit(account(), {
    symbol: "META",
    side: "BUY",
    quantity: 1,
    limitPrice: 100,
    tif: "DAY",
    takeProfit: 120,
  });
  const parent = state.orders.find((order) => !order.parentId);
  state = cancelPaperOrder(state, parent.id, time + 1);
  assert.equal(state.orders.length, 0);
  assert.equal(state.history.length, 2);
  assert.ok(state.history.every((order) => order.status === "cancelled"));
  assert.throws(
    () =>
      submit(account(), {
        symbol: "META",
        side: "SELL",
        quantity: 1,
        limitPrice: 100,
        tif: "GTC",
        takeProfit: 120,
      }),
    /SELL brackets/,
  );
});

test("terminal order history stays bounded", () => {
  let state = account();
  for (let index = 0; index < PAPER_HISTORY_LIMIT + 7; index += 1) {
    state = submit(
      state,
      { symbol: "AAPL", side: "BUY", quantity: 1, limitPrice: 1, tif: "IOC" },
      time + index,
    );
  }
  assert.equal(state.history.length, PAPER_HISTORY_LIMIT);
  assert.equal(state.orders.length, 0);
  assert.doesNotThrow(() => validatePaperAccount(state));
});
