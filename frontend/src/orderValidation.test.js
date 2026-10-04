import test from "node:test";
import assert from "node:assert/strict";
import { validateTicket } from "./orderValidation.js";

test("whole-share limit tickets reject malformed and unsafe bracket input", () => {
  const ticket = {
    symbol: "NVDA",
    side: "BUY",
    quantity: 2,
    limitPrice: 100,
    tif: "GTC",
  };
  assert.deepEqual(validateTicket(ticket, "paper"), ticket);
  for (const patch of [
    { quantity: 1.5 },
    { quantity: -1 },
    { limitPrice: Infinity },
    { symbol: "../NVDA" },
    { side: "SHORT" },
    { tif: "MKT" },
    { takeProfit: 99 },
    { stopLoss: 101 },
  ])
    assert.throws(() => validateTicket({ ...ticket, ...patch }));
  assert.throws(() =>
    validateTicket({ ...ticket, tif: "IOC", takeProfit: 120 }, "paper"),
  );
  assert.throws(() =>
    validateTicket({ ...ticket, side: "SELL", takeProfit: 80 }, "paper"),
  );
  assert.deepEqual(
    validateTicket({ ...ticket, takeProfit: 120, stopLoss: 90 }, "paper"),
    { ...ticket, takeProfit: 120, stopLoss: 90 },
  );
  assert.equal(
    validateTicket(
      { ...ticket, side: "SELL", takeProfit: 80, stopLoss: 110 },
      "live",
    ).side,
    "SELL",
  );
});
