// Browser-local paper trading engine. Pure functions only; callers persist returned snapshots.

export const PAPER_ACCOUNT_STORAGE_KEY = "stock-analysis-paper-account-v1";
export const PAPER_ACCOUNT_LOCK_NAME = `${PAPER_ACCOUNT_STORAGE_KEY}:writer`;
export const DEFAULT_STARTING_CASH = 100_000;
export const PAPER_HISTORY_LIMIT = 200;
export const QUOTE_MAX_AGE_MS = 5 * 60 * 1000;

const MAX_AMOUNT = Number.MAX_SAFE_INTEGER / 100;
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;
const ACTIVE_STATUSES = new Set(["pending", "held"]);
const TERMINAL_STATUSES = new Set(["filled", "cancelled", "expired"]);
const TIFS = new Set(["DAY", "GTC", "IOC", "FOK"]);

function fail(message) {
  throw new Error(message);
}

function amount(value, label, { positive = false, signed = false } = {}) {
  const n =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (
    !Number.isFinite(n) ||
    Math.abs(n) > MAX_AMOUNT ||
    (positive ? n <= 0 : !signed && n < 0)
  ) {
    fail(`Invalid ${label}`);
  }
  return n;
}

function wholeShares(value) {
  const n =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n <= 0)
    fail("Quantity must be a positive whole number");
  return n;
}

function money(value) {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_AMOUNT)
    fail("Amount exceeds supported range");
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function reserveMoney(value) {
  return Math.ceil(value * 100 - 1e-9) / 100;
}

function price(value, label = "price") {
  return amount(value, label, { positive: true });
}

function timestamp(value) {
  const result =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : typeof value === "string"
          ? Date.parse(value)
          : NaN;
  return Number.isFinite(result) ? result : NaN;
}

function nowValue(now) {
  const value = now === undefined ? Date.now() : timestamp(now);
  if (!Number.isFinite(value)) fail("Invalid current time");
  return value;
}

function iso(value) {
  return new Date(value).toISOString();
}

function symbolOf(value) {
  if (typeof value !== "string") fail("Invalid symbol");
  const symbol = value.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) fail("Invalid symbol");
  return symbol;
}

function cloneAccount(account) {
  return {
    ...account,
    positions: account.positions.map((position) => ({ ...position })),
    orders: account.orders.map((order) => ({ ...order })),
    history: account.history.map((order) => ({ ...order })),
    quotes: Object.fromEntries(
      Object.entries(account.quotes).map(([key, quote]) => [key, { ...quote }]),
    ),
  };
}

function reservedCash(account, excludeId) {
  return account.orders.reduce(
    (total, order) =>
      total +
      (order.id !== excludeId &&
      order.status === "pending" &&
      order.side === "BUY"
        ? reserveMoney(order.limitPrice * order.quantity)
        : 0),
    0,
  );
}

function reservedShares(account, symbol, excludeId) {
  let total = 0;
  const oco = new Map();
  for (const order of account.orders) {
    if (
      order.id === excludeId ||
      order.status !== "pending" ||
      order.side !== "SELL" ||
      order.symbol !== symbol
    )
      continue;
    if (order.parentId)
      oco.set(
        order.parentId,
        Math.max(oco.get(order.parentId) || 0, order.quantity),
      );
    else total += order.quantity;
  }
  for (const quantity of oco.values()) total += quantity;
  return total;
}

function availableCash(account, excludeId) {
  return Math.max(0, money(account.cash - reservedCash(account, excludeId)));
}

function positionFor(account, symbol) {
  return account.positions.find((position) => position.symbol === symbol);
}

function validDateString(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateOrder(order, active) {
  if (
    !order ||
    typeof order !== "object" ||
    typeof order.id !== "string" ||
    !order.id.trim()
  )
    fail("Invalid order");
  if (!SYMBOL_RE.test(order.symbol) || symbolOf(order.symbol) !== order.symbol)
    fail("Invalid order symbol");
  if (order.side !== "BUY" && order.side !== "SELL") fail("Invalid order side");
  if (!Number.isSafeInteger(order.quantity) || order.quantity <= 0)
    fail("Invalid order quantity");
  if (typeof order.limitPrice !== "number") fail("Invalid order limit price");
  price(order.limitPrice, "limit price");
  if (!TIFS.has(order.tif) || !["LMT", "STP"].includes(order.type))
    fail("Invalid order type or time in force");
  if (
    active
      ? !ACTIVE_STATUSES.has(order.status)
      : !TERMINAL_STATUSES.has(order.status)
  )
    fail("Invalid order status");
  if (!validDateString(order.createdAt)) fail("Invalid order creation time");
  if (order.tif === "DAY") {
    if (!validDateString(order.expiresAt)) fail("Invalid DAY expiry");
  } else if (order.expiresAt !== undefined) fail("Unexpected order expiry");
  if (active && order.tif !== "DAY" && order.tif !== "GTC")
    fail("IOC/FOK order cannot remain active");
  if (order.type === "STP") {
    if (typeof order.stopPrice !== "number") fail("Invalid stop price");
    price(order.stopPrice, "stop price");
    if (order.side !== "SELL") fail("Only SELL stop orders are supported");
  } else if (order.stopPrice !== undefined) fail("Unexpected stop price");
  if (
    order.parentId !== undefined &&
    (typeof order.parentId !== "string" || !order.parentId.trim())
  )
    fail("Invalid parent order");
  if (
    order.bracketRole !== undefined &&
    !["takeProfit", "stopLoss"].includes(order.bracketRole)
  )
    fail("Invalid bracket role");
  if (
    order.bracketRole !== undefined &&
    (!order.parentId || order.side !== "SELL")
  )
    fail("Invalid bracket child");
  if (order.type === "STP" && order.bracketRole !== "stopLoss")
    fail("Only bracket stop-loss orders are supported");
  if (order.bracketRole === "stopLoss" && order.type !== "STP")
    fail("Stop-loss must be a stop order");
  if (order.bracketRole === "takeProfit" && order.type !== "LMT")
    fail("Take-profit must be a limit order");
}

/** Validate and return a v1 account snapshot; throws rather than repairing data. */
export function validatePaperAccount(account) {
  if (!account || typeof account !== "object" || account.version !== 1)
    fail("Unsupported Paper Account data");
  if (
    typeof account.startingCash !== "number" ||
    typeof account.cash !== "number" ||
    typeof account.realizedPnl !== "number"
  )
    fail("Invalid account balances");
  amount(account.startingCash, "starting cash", { positive: true });
  amount(account.cash, "cash");
  amount(account.realizedPnl, "realized P&L", { signed: true });
  if (!validDateString(account.updatedAt)) fail("Invalid account timestamp");
  if (
    !Array.isArray(account.positions) ||
    !Array.isArray(account.orders) ||
    !Array.isArray(account.history) ||
    !account.quotes ||
    typeof account.quotes !== "object" ||
    Array.isArray(account.quotes)
  )
    fail("Invalid account data");
  if (account.history.length > PAPER_HISTORY_LIMIT)
    fail("Paper history exceeds limit");

  const symbols = new Set();
  for (const position of account.positions) {
    const symbol = symbolOf(position.symbol);
    if (
      symbols.has(symbol) ||
      !Number.isSafeInteger(position.quantity) ||
      position.quantity <= 0
    )
      fail("Invalid position");
    symbols.add(symbol);
    if (typeof position.averageCost !== "number") fail("Invalid average cost");
    price(position.averageCost, "average cost");
  }

  const ids = new Set();
  for (const order of account.orders) {
    validateOrder(order, true);
    if (ids.has(order.id)) fail("Duplicate order id");
    ids.add(order.id);
  }
  for (const order of account.history) {
    validateOrder(order, false);
    if (ids.has(order.id)) fail("Duplicate order id");
    ids.add(order.id);
  }

  for (const [key, quote] of Object.entries(account.quotes)) {
    if (
      symbolOf(key) !== key ||
      !quote ||
      typeof quote !== "object" ||
      typeof quote.price !== "number" ||
      amount(quote.price, "quote price", { positive: true }) <= 0 ||
      !validDateString(quote.asOf)
    )
      fail("Invalid quote snapshot");
  }
  for (const order of account.history) {
    if (!validDateString(order.terminalAt)) fail("Invalid terminal order time");
    if (order.status === "filled") {
      if (typeof order.fillPrice !== "number") fail("Invalid order fill price");
      price(order.fillPrice, "fill price");
    }
  }
  const allOrders = [...account.orders, ...account.history];
  const orderById = new Map(allOrders.map((order) => [order.id, order]));
  const bracketGroups = new Map();
  for (const order of allOrders) {
    if (!order.parentId) continue;
    const parent = orderById.get(order.parentId);
    if (
      parent &&
      (parent.side !== "BUY" ||
        parent.symbol !== order.symbol ||
        parent.quantity !== order.quantity ||
        parent.tif !== order.tif)
    ) {
      fail("Invalid bracket parent relationship");
    }
    if (
      order.status === "held" &&
      (!account.orders.includes(parent) ||
        parent.status !== "pending" ||
        parent.type !== "LMT")
    ) {
      fail("Orphaned held bracket order");
    }
    if (order.status === "pending" && parent && parent.status !== "filled")
      fail("Bracket child activated before parent fill");
    if (ACTIVE_STATUSES.has(order.status)) {
      const group = bracketGroups.get(order.parentId) || {};
      if (order.bracketRole === "takeProfit") group.target = order.limitPrice;
      if (order.bracketRole === "stopLoss") group.stop = order.stopPrice;
      bracketGroups.set(order.parentId, group);
    }
  }
  for (const [parentId, group] of bracketGroups) {
    const parent = orderById.get(parentId);
    if (
      group.target !== undefined &&
      group.stop !== undefined &&
      group.stop >= group.target
    )
      fail("Invalid OCO bracket prices");
    const entryPrice =
      parent?.status === "pending" ? parent.limitPrice : undefined;
    if (
      entryPrice !== undefined &&
      ((group.target !== undefined && group.target <= entryPrice) ||
        (group.stop !== undefined && group.stop >= entryPrice))
    )
      fail("Bracket exits do not straddle parent price");
  }

  const positions = new Map(
    account.positions.map((position) => [position.symbol, position.quantity]),
  );
  if (reservedCash(account) > account.cash + 1e-8)
    fail("Paper orders reserve more cash than available");
  for (const symbol of new Set([
    ...symbols,
    ...account.orders
      .filter((order) => order.side === "SELL")
      .map((order) => order.symbol),
  ])) {
    if (reservedShares(account, symbol) > (positions.get(symbol) || 0))
      fail("Paper orders reserve unavailable shares");
  }
  return account;
}

/** Parse persisted JSON and fail closed on malformed or incompatible snapshots. */
export function parsePaperAccount(raw) {
  if (typeof raw !== "string") fail("Paper Account data is missing");
  let account;
  try {
    account = JSON.parse(raw);
  } catch {
    fail("Paper Account data is corrupt");
  }
  return validatePaperAccount(account);
}

/** Create the initial USD account. */
export function createPaperAccount(
  startingCash = DEFAULT_STARTING_CASH,
  options = {},
) {
  const cash = money(amount(startingCash, "starting cash", { positive: true }));
  if (cash <= 0) fail("Starting cash must be positive");
  const at = iso(nowValue(options.now));
  return {
    version: 1,
    startingCash: cash,
    cash,
    realizedPnl: 0,
    positions: [],
    orders: [],
    history: [],
    quotes: {},
    updatedAt: at,
  };
}

/** Return unreserved cash and shares for trade-ticket validation. */
export function availableResources(account, symbol) {
  validatePaperAccount(account);
  const normalized = symbolOf(symbol);
  const position = positionFor(account, normalized);
  const reserved = reservedShares(account, normalized);
  const available = Math.max(0, (position?.quantity || 0) - reserved);
  const cash = availableCash(account);
  return {
    cash,
    availableCash: cash,
    reservedCash: reservedCash(account),
    shares: available,
    availableShares: available,
    reservedShares: reserved,
  };
}

function expireMutable(account, now) {
  let changed = false;
  for (const order of [...account.orders]) {
    if (order.tif === "DAY" && timestamp(order.expiresAt) <= now) {
      terminalize(account, order.id, "expired", now, { reason: "day-expired" });
      changed = true;
    }
  }
  return changed;
}

function terminalize(account, id, status, now, details = {}) {
  const index = account.orders.findIndex((order) => order.id === id);
  if (index < 0) return null;
  const [order] = account.orders.splice(index, 1);
  const terminal = { ...order, status, terminalAt: iso(now), ...details };
  account.history.unshift(terminal);
  if (account.history.length > PAPER_HISTORY_LIMIT)
    account.history.length = PAPER_HISTORY_LIMIT;
  return terminal;
}

/** Expire DAY orders at their saved local-midnight deadline. */
export function expirePaperOrders(account, now = Date.now()) {
  validatePaperAccount(account);
  const at = nowValue(now);
  const next = cloneAccount(account);
  if (!expireMutable(next, at)) return account;
  next.updatedAt = iso(at);
  return validatePaperAccount(next);
}

function nextLocalMidnight(now) {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

function newId(account, options) {
  const generator = typeof options.id === "function" ? options.id : null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = generator
      ? generator()
      : globalThis.crypto?.randomUUID?.() ||
        `paper-${Date.now().toString(36)}-${++newId.counter}`;
    const id = String(value || "").trim();
    if (
      id &&
      !account.orders.some((order) => order.id === id) &&
      !account.history.some((order) => order.id === id)
    )
      return id;
  }
  fail("Could not create a unique order id");
}
newId.counter = 0;

function normalizedTicket(ticket) {
  if (!ticket || typeof ticket !== "object") fail("Invalid order ticket");
  const symbol = symbolOf(ticket.symbol);
  const side = typeof ticket.side === "string" ? ticket.side.toUpperCase() : "";
  if (!["BUY", "SELL"].includes(side)) fail("Invalid order side");
  const quantity = wholeShares(ticket.quantity);
  const limitPrice = price(ticket.limitPrice, "limit price");
  const tif = typeof ticket.tif === "string" ? ticket.tif.toUpperCase() : "";
  if (!TIFS.has(tif)) fail("Invalid time in force");
  const optionalPrice = (value, label) =>
    value === undefined || value === null || value === ""
      ? undefined
      : price(value, label);
  const takeProfit = optionalPrice(ticket.takeProfit, "take-profit price");
  const stopLoss = optionalPrice(ticket.stopLoss, "stop-loss price");
  const bracket = takeProfit !== undefined || stopLoss !== undefined;
  if (bracket && side !== "BUY") fail("SELL brackets are not supported");
  if (bracket && !["DAY", "GTC"].includes(tif))
    fail("BUY brackets require DAY or GTC");
  if (
    bracket &&
    ((takeProfit !== undefined && takeProfit <= limitPrice) ||
      (stopLoss !== undefined && stopLoss >= limitPrice) ||
      (takeProfit !== undefined &&
        stopLoss !== undefined &&
        takeProfit <= stopLoss))
  ) {
    fail("Bracket exits must straddle the BUY limit price");
  }
  return { symbol, side, quantity, limitPrice, tif, takeProfit, stopLoss };
}

function quoteIsFresh(quote, now) {
  const at = timestamp(quote?.asOf);
  return (
    Number.isFinite(at) && at <= now + 5_000 && now - at <= QUOTE_MAX_AGE_MS
  );
}

function canFill(order, quote) {
  return order.type === "STP"
    ? quote.price <= order.stopPrice
    : order.side === "BUY"
      ? quote.price <= order.limitPrice
      : quote.price >= order.limitPrice;
}

function updatePositionForBuy(account, order, fillPrice) {
  const cost = money(fillPrice * order.quantity);
  if (cost > account.cash + 1e-8)
    fail("Paper order would exceed available cash");
  account.cash = Math.max(0, money(account.cash - cost));
  const existing = positionFor(account, order.symbol);
  if (existing) {
    const quantity = existing.quantity + order.quantity;
    existing.averageCost =
      Math.round(
        ((existing.averageCost * existing.quantity + cost) / quantity) * 1e6,
      ) / 1e6;
    existing.quantity = quantity;
  } else
    account.positions.push({
      symbol: order.symbol,
      quantity: order.quantity,
      averageCost: cost / order.quantity,
    });
}

function updatePositionForSell(account, order, fillPrice) {
  const position = positionFor(account, order.symbol);
  if (!position || position.quantity < order.quantity)
    fail("Paper order would create a short position");
  const proceeds = money(fillPrice * order.quantity);
  account.cash = money(account.cash + proceeds);
  account.realizedPnl = money(
    account.realizedPnl +
      money((fillPrice - position.averageCost) * order.quantity),
  );
  position.quantity -= order.quantity;
  if (!position.quantity)
    account.positions.splice(account.positions.indexOf(position), 1);
}

function fillMutable(account, id, quote, now) {
  const order = account.orders.find((item) => item.id === id);
  if (!order || !canFill(order, quote)) return false;
  if (order.side === "BUY") updatePositionForBuy(account, order, quote.price);
  else updatePositionForSell(account, order, quote.price);
  const parentId = order.id;
  const child = order.bracketRole !== undefined;
  terminalize(account, id, "filled", now, { fillPrice: quote.price });

  if (order.side === "BUY") {
    for (const held of account.orders) {
      if (held.parentId === parentId && held.status === "held")
        held.status = "pending";
    }
  }
  if (child) {
    for (const sibling of [...account.orders]) {
      if (sibling.parentId === order.parentId && sibling.id !== id) {
        terminalize(account, sibling.id, "cancelled", now, {
          reason: "oco-filled",
        });
      }
    }
  }
  return true;
}

function normalizeQuotes(input) {
  const list = Array.isArray(input) ? input : input?.quotes;
  if (!Array.isArray(list)) return [];
  const latest = new Map();
  for (const item of list) {
    try {
      const symbol = symbolOf(item?.symbol);
      const quotePrice = price(item?.price, "quote price");
      const at = timestamp(item?.asOf);
      if (!Number.isFinite(at)) continue;
      const prior = latest.get(symbol);
      if (!prior || at > prior.at)
        latest.set(symbol, { symbol, price: quotePrice, at, asOf: iso(at) });
    } catch {
      /* Ignore malformed market snapshots. */
    }
  }
  return [...latest.values()];
}

/** Apply only newer, fresh quote snapshots; existing persisted quotes never replay fills. */
export function applyPaperQuotes(account, quotes, now = Date.now()) {
  validatePaperAccount(account);
  const at = nowValue(now);
  const next = cloneAccount(account);
  let changed = expireMutable(next, at);
  const freshSymbols = new Set();
  for (const quote of normalizeQuotes(quotes)) {
    const previous = next.quotes[quote.symbol];
    if (
      !quoteIsFresh(quote, at) ||
      (previous && timestamp(previous.asOf) >= quote.at)
    )
      continue;
    next.quotes[quote.symbol] = { price: quote.price, asOf: quote.asOf };
    freshSymbols.add(quote.symbol);
    changed = true;
  }
  if (!freshSymbols.size && !changed) return account;

  // Process only orders active before this snapshot; newly released bracket legs wait for next quote.
  const activeIds = next.orders
    .filter((order) => order.status === "pending")
    .map((order) => order.id);
  for (const id of activeIds) {
    const order = next.orders.find((item) => item.id === id);
    const quote =
      order && freshSymbols.has(order.symbol)
        ? next.quotes[order.symbol]
        : null;
    if (quote) fillMutable(next, id, quote, at);
  }
  next.updatedAt = iso(at);
  return validatePaperAccount(next);
}

/** Submit a whole-share LMT order, optional BUY OCO bracket, or immediate IOC/FOK order. */
export function submitPaperOrder(account, ticket, options = {}) {
  validatePaperAccount(account);
  const at = nowValue(options.now);
  const base = expirePaperOrders(account, at);
  const orderTicket = normalizedTicket(ticket);
  const requiredCash =
    orderTicket.side === "BUY"
      ? reserveMoney(orderTicket.limitPrice * orderTicket.quantity)
      : 0;
  const current = availableResources(base, orderTicket.symbol);
  if (orderTicket.side === "BUY" && requiredCash > current.cash + 1e-8)
    fail("Insufficient available cash");
  if (
    orderTicket.side === "SELL" &&
    orderTicket.quantity > current.availableShares
  )
    fail("Insufficient unreserved shares");

  const next = cloneAccount(base);
  const id = newId(next, options);
  const createdAt = iso(at);
  const expiresAt =
    orderTicket.tif === "DAY" ? iso(nextLocalMidnight(at)) : undefined;
  const parent = {
    id,
    symbol: orderTicket.symbol,
    side: orderTicket.side,
    quantity: orderTicket.quantity,
    limitPrice: orderTicket.limitPrice,
    tif: orderTicket.tif,
    status: "pending",
    type: "LMT",
    createdAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
  next.orders.push(parent);

  if (orderTicket.takeProfit !== undefined)
    next.orders.push({
      id: newId(next, options),
      symbol: orderTicket.symbol,
      side: "SELL",
      quantity: orderTicket.quantity,
      limitPrice: orderTicket.takeProfit,
      tif: orderTicket.tif,
      status: "held",
      parentId: id,
      bracketRole: "takeProfit",
      type: "LMT",
      createdAt,
      ...(expiresAt ? { expiresAt } : {}),
    });
  if (orderTicket.stopLoss !== undefined)
    next.orders.push({
      id: newId(next, options),
      symbol: orderTicket.symbol,
      side: "SELL",
      quantity: orderTicket.quantity,
      limitPrice: orderTicket.stopLoss,
      stopPrice: orderTicket.stopLoss,
      tif: orderTicket.tif,
      status: "held",
      parentId: id,
      bracketRole: "stopLoss",
      type: "STP",
      createdAt,
      ...(expiresAt ? { expiresAt } : {}),
    });

  if (orderTicket.tif === "IOC" || orderTicket.tif === "FOK") {
    const quote = base.quotes[orderTicket.symbol];
    if (quote && quoteIsFresh(quote, at) && canFill(parent, quote))
      fillMutable(next, id, quote, at);
    else
      terminalize(next, id, "cancelled", at, {
        reason: "not-filled-immediately",
      });
  }
  next.updatedAt = iso(at);
  return validatePaperAccount(next);
}

/** Modify only an active order's price; quantity and time-in-force remain immutable. */
export function modifyPaperOrder(account, id, patch, now = Date.now()) {
  validatePaperAccount(account);
  const at = nowValue(now);
  const base = expirePaperOrders(account, at);
  const next = cloneAccount(base);
  const order = next.orders.find((item) => item.id === id);
  if (!order) fail("Paper order is not active");
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    fail("Invalid order patch");
  const keys = Object.keys(patch);
  if (
    !keys.length ||
    keys.some((key) => !["limitPrice", "stopPrice"].includes(key))
  )
    fail("Only order prices can be modified");

  if (order.type === "LMT") {
    if (Object.hasOwn(patch, "stopPrice"))
      fail("Limit orders have no stop price");
    order.limitPrice = price(patch.limitPrice, "limit price");
  } else {
    if (
      Object.hasOwn(patch, "limitPrice") &&
      Object.hasOwn(patch, "stopPrice") &&
      Number(patch.limitPrice) !== Number(patch.stopPrice)
    ) {
      fail("Stop price fields conflict");
    }
    const stopPrice = price(patch.stopPrice ?? patch.limitPrice, "stop price");
    order.stopPrice = stopPrice;
    order.limitPrice = stopPrice;
  }

  if (order.parentId) {
    const siblings = next.orders.filter(
      (item) => item.parentId === order.parentId,
    );
    const parent = [...next.orders, ...next.history].find(
      (item) => item.id === order.parentId,
    );
    const target =
      order.bracketRole === "takeProfit"
        ? order.limitPrice
        : siblings.find((item) => item.bracketRole === "takeProfit")
            ?.limitPrice;
    const stop =
      order.bracketRole === "stopLoss"
        ? order.stopPrice
        : siblings.find((item) => item.bracketRole === "stopLoss")?.stopPrice;
    const entry = parent?.status === "pending" ? parent.limitPrice : undefined;
    if (
      (target !== undefined && stop !== undefined && stop >= target) ||
      (entry !== undefined &&
        ((target !== undefined && target <= entry) ||
          (stop !== undefined && stop >= entry)))
    ) {
      fail("Bracket exits must straddle parent price");
    }
  } else if (order.side === "BUY") {
    const children = next.orders.filter((item) => item.parentId === order.id);
    const target = children.find(
      (item) => item.bracketRole === "takeProfit",
    )?.limitPrice;
    const stop = children.find(
      (item) => item.bracketRole === "stopLoss",
    )?.stopPrice;
    if (
      (target !== undefined && order.limitPrice >= target) ||
      (stop !== undefined && order.limitPrice <= stop)
    ) {
      fail("Bracket exits must straddle parent price");
    }
  }
  if (
    order.side === "BUY" &&
    reserveMoney(order.limitPrice * order.quantity) >
      availableCash(next, order.id) + 1e-8
  ) {
    fail("Insufficient available cash for modified price");
  }
  next.updatedAt = iso(at);
  return validatePaperAccount(next);
}

/** Cancel active order; cancelling a BUY parent also cancels its still-held children. */
export function cancelPaperOrder(account, id, now = Date.now()) {
  validatePaperAccount(account);
  const at = nowValue(now);
  const base = expirePaperOrders(account, at);
  const next = cloneAccount(base);
  const order = next.orders.find((item) => item.id === id);
  if (!order) fail("Paper order is not active");
  const wasParent = order.side === "BUY" && !order.parentId;
  terminalize(next, id, "cancelled", at, { reason: "user-cancelled" });
  if (wasParent) {
    for (const child of [...next.orders]) {
      if (child.parentId === id && child.status === "held")
        terminalize(next, child.id, "cancelled", at, {
          reason: "parent-cancelled",
        });
    }
  }
  next.updatedAt = iso(at);
  return validatePaperAccount(next);
}

/** Mark-to-last-snapshot summary matching the account overview shape. */
export function paperSummary(account, now = Date.now()) {
  validatePaperAccount(account);
  const at = nowValue(now);
  const warnings = [];
  let grossPositionValue = 0;
  let unrealizedPnl = 0;
  let missingQuote = false;
  const positions = account.positions.map((position) => {
    const quote = account.quotes[position.symbol];
    const fresh = quote && quoteIsFresh(quote, at);
    if (!fresh) warnings.push(`${position.symbol}: quote unavailable or stale`);
    if (!quote) missingQuote = true;
    const marketValue = quote ? money(position.quantity * quote.price) : null;
    const pnl = quote
      ? money((quote.price - position.averageCost) * position.quantity)
      : null;
    grossPositionValue += marketValue ?? 0;
    unrealizedPnl += pnl ?? 0;
    return {
      ...position,
      price: quote?.price ?? null,
      marketValue,
      unrealizedPnl: pnl,
      quoteAsOf: quote?.asOf ?? null,
    };
  });
  grossPositionValue = money(grossPositionValue);
  unrealizedPnl = money(unrealizedPnl);
  const netLiquidation = missingQuote
    ? null
    : money(account.cash + grossPositionValue);
  const buyingPower = availableCash(account);
  return {
    accountId: "Paper",
    asOf: account.updatedAt,
    currency: "USD",
    summary: {
      netLiquidation,
      cash: account.cash,
      buyingPower,
      availableFunds: buyingPower,
      excessLiquidity: buyingPower,
      maintenanceMargin: 0,
      grossPositionValue: missingQuote ? null : grossPositionValue,
      unrealizedPnl: missingQuote ? null : unrealizedPnl,
      realizedPnl: account.realizedPnl,
    },
    positions,
    warnings: [...new Set(warnings)],
  };
}
