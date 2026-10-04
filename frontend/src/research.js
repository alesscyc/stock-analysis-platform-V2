export const SCREENER_DEFAULTS = Object.freeze({
  aboveLowEnabled: true,
  aboveLowPercent: 25,
  nearHighEnabled: true,
  nearHighPercent: 25,
  risingMaEnabled: true,
  maTrendDays: 21,
});

export const DEFAULT_BACKTEST_SETTINGS = Object.freeze({
  entry: {
    left: { type: "close" },
    operator: ">",
    right: { type: "ma", period: 50 },
  },
  exit: {
    left: { type: "close" },
    operator: "<",
    right: { type: "ma", period: 20 },
  },
  frequency: "daily",
  exitMode: "immediate",
  exitPeriods: 3,
  exitFrequency: "monthly",
  period: "1y",
  initialCapital: 10000,
});

const OPERATORS = new Set([">", "<", ">=", "<="]);
const PERIODS = new Set(["1y", "2y", "5y", "max"]);
const NUMBER = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function parseSymbols(text) {
  const found = new Set();
  for (const raw of String(text ?? "").split(/[\s,;|]+/)) {
    const symbol = raw.trim().replace(/^\$/, "").toUpperCase();
    if (/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) found.add(symbol);
  }
  return [...found];
}

export function evaluateScreener(candles, conditions) {
  const bars = Array.isArray(candles) ? candles : [];
  const enabled = conditions ?? {};
  if (
    !enabled.aboveLowEnabled &&
    !enabled.nearHighEnabled &&
    !enabled.risingMaEnabled
  ) {
    return { matches: false, reason: "condition-required" };
  }
  const closes = bars.map((bar) => bar?.close).filter(NUMBER);
  const price = bars.at(-1)?.close;
  if (
    !NUMBER(price) ||
    ((enabled.aboveLowEnabled || enabled.nearHighEnabled) &&
      closes.length < 252)
  ) {
    return { matches: false, reason: "insufficient-history" };
  }

  const weekLow = Math.min(...closes.slice(-252));
  const weekHigh = Math.max(...closes.slice(-252));
  const aboveLowPercent =
    weekLow > 0 ? ((price - weekLow) / weekLow) * 100 : null;
  const belowHighPercent =
    weekHigh > 0 ? ((weekHigh - price) / weekHigh) * 100 : null;
  const tests = [];

  if (enabled.aboveLowEnabled) {
    const limit = Number(enabled.aboveLowPercent);
    tests.push(aboveLowPercent != null && aboveLowPercent >= limit);
  }
  if (enabled.nearHighEnabled) {
    const limit = Number(enabled.nearHighPercent);
    tests.push(belowHighPercent != null && belowHighPercent <= limit);
  }

  let maStart = null;
  let maEnd = null;
  let risingDays = 0;
  const trendDays = clamp(Math.trunc(Number(enabled.maTrendDays) || 21), 5, 63);
  if (enabled.risingMaEnabled) {
    const closesAll = bars.map((bar) => bar?.close);
    const end = closesAll.length - 1;
    const start = end - trendDays;
    const maAt = (last) => {
      if (last < 199) return null;
      let sum = 0;
      for (let i = last - 199; i <= last; i++) {
        if (!NUMBER(closesAll[i])) return null;
        sum += closesAll[i];
      }
      return sum / 200;
    };
    maStart = maAt(start);
    maEnd = maAt(end);
    if (maStart == null || maEnd == null)
      return { matches: false, reason: "insufficient-history" };
    else {
      for (let i = start + 1; i <= end; i++) {
        const before = maAt(i - 1);
        const after = maAt(i);
        if (before != null && after != null && after > before) risingDays++;
      }
      tests.push(maEnd > maStart && risingDays >= Math.ceil(trendDays * 0.9));
    }
  }

  return {
    matches: tests.length > 0 && tests.every(Boolean),
    price,
    weekLow,
    weekHigh,
    aboveLowPercent,
    belowHighPercent,
    maStart,
    maEnd,
    risingDays,
    trendDays,
  };
}

function normalizeOperand(operand, fallback) {
  const value = operand && typeof operand === "object" ? operand : fallback;
  const type = ["close", "ma", "number"].includes(value.type)
    ? value.type
    : fallback.type;
  if (type === "ma") {
    const period = Number(value.period);
    return {
      type,
      period: clamp(Number.isFinite(period) ? Math.trunc(period) : 50, 2, 500),
    };
  }
  if (type === "number") {
    const number = Number(value.value);
    return {
      type,
      value: Number.isFinite(number) && number > 0 ? number : 100,
    };
  }
  return { type: "close" };
}

function normalizeRule(rule, fallback) {
  const value = rule && typeof rule === "object" ? rule : fallback;
  return {
    left: normalizeOperand(value.left, fallback.left),
    operator: OPERATORS.has(value.operator)
      ? value.operator
      : fallback.operator,
    right: normalizeOperand(value.right, fallback.right),
  };
}

export function normalizeBacktestSettings(value) {
  const settings = value && typeof value === "object" ? value : {};
  const capital = Number(settings.initialCapital);
  const periods = Number(settings.exitPeriods);
  return {
    entry: normalizeRule(settings.entry, DEFAULT_BACKTEST_SETTINGS.entry),
    exit: normalizeRule(settings.exit, DEFAULT_BACKTEST_SETTINGS.exit),
    frequency: ["daily", "monthly"].includes(settings.frequency)
      ? settings.frequency
      : "daily",
    exitMode: ["immediate", "staged"].includes(settings.exitMode)
      ? settings.exitMode
      : "immediate",
    exitPeriods: clamp(
      Number.isFinite(periods) ? Math.trunc(periods) : 3,
      1,
      100,
    ),
    exitFrequency: ["weekly", "monthly"].includes(settings.exitFrequency)
      ? settings.exitFrequency
      : "monthly",
    period: PERIODS.has(settings.period) ? settings.period : "1y",
    initialCapital:
      Number.isFinite(capital) && capital > 0
        ? Math.min(capital, 1_000_000_000_000)
        : 10000,
  };
}

export function miniCandleGeometry(candles, width = 88, height = 36) {
  const bars = (Array.isArray(candles) ? candles : [])
    .slice(-32)
    .filter((bar) =>
      [bar?.open, bar?.high, bar?.low, bar?.close].every(NUMBER),
    );
  if (!bars.length) return [];
  const low = Math.min(...bars.map((bar) => bar.low));
  const high = Math.max(...bars.map((bar) => bar.high));
  const range = high - low || 1;
  const y = (price) => height - 2 - ((price - low) / range) * (height - 4);
  const slot = width / bars.length;
  return bars.map((bar, index) => {
    const openY = y(bar.open);
    const closeY = y(bar.close);
    return {
      x: slot * (index + 0.5),
      openY,
      closeY,
      highY: y(bar.high),
      lowY: y(bar.low),
      bodyY: Math.min(openY, closeY),
      bodyHeight: Math.max(1, Math.abs(closeY - openY)),
      up: bar.close >= bar.open,
    };
  });
}

export function equityPath(equity, width = 600, height = 160) {
  const points = (Array.isArray(equity) ? equity : []).filter((point) =>
    NUMBER(point?.value),
  );
  if (!points.length) return "";
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || Math.abs(high) * 0.01 || 1;
  const pad = 6;
  return points
    .map((point, index) => {
      const x =
        points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y =
        height - pad - ((point.value - low) / range) * (height - pad * 2);
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const FUNDAMENTAL_NUMBERS = [
  "marketCap",
  "trailingPE",
  "forwardPE",
  "trailingEps",
  "dividendYield",
  "beta",
  "fiftyTwoWeekLow",
  "fiftyTwoWeekHigh",
  "averageVolume",
];
const SUMMARY_NUMBERS = [
  "netLiquidation",
  "cash",
  "buyingPower",
  "availableFunds",
  "excessLiquidity",
  "maintenanceMargin",
  "grossPositionValue",
  "unrealizedPnl",
  "realizedPnl",
  "startingCash",
];
const POSITION_NUMBERS = [
  "quantity",
  "averageCost",
  "price",
  "marketValue",
  "unrealizedPnl",
];
const ORDER_NUMBERS = ["quantity", "limitPrice", "stopPrice", "filled"];
const ACTIVE_ORDER_STATUSES = new Set([
  "pending",
  "held",
  "submitted",
  "presubmitted",
  "pendingsubmit",
  "apipending",
  "partiallyfilled",
]);
const TERMINAL_ORDER_STATUSES = new Set([
  "filled",
  "cancelled",
  "canceled",
  "expired",
  "rejected",
  "inactive",
]);
const safeText = (value, max = 200) =>
  typeof value === "string" ? value.slice(0, max) : undefined;

function pickNumbers(source, keys) {
  const result = {};
  if (!source || typeof source !== "object") return result;
  for (const key of keys) if (NUMBER(source[key])) result[key] = source[key];
  return result;
}

function safeSymbol(value) {
  if (typeof value !== "string") return undefined;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) ? symbol : undefined;
}

export function allowlistChatCandles(candles) {
  return (Array.isArray(candles) ? candles : []).slice(-500).flatMap((bar) => {
    if (
      !bar ||
      typeof bar.time !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(bar.time) ||
      Number.isNaN(Date.parse(`${bar.time}T00:00:00Z`)) ||
      ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(NUMBER) ||
      [bar.open, bar.high, bar.low, bar.close, bar.volume].some(
        (value) => value < 0,
      )
    )
      return [];
    return [
      {
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      },
    ];
  });
}

export function allowlistChatFundamentals(value) {
  if (!value || typeof value !== "object") return null;
  const result = pickNumbers(value, FUNDAMENTAL_NUMBERS);
  for (const key of ["symbol", "name", "currency", "sector", "industry"]) {
    const text = safeText(value[key]);
    if (text) result[key] = text;
  }
  return Object.keys(result).length ? result : null;
}

export function allowlistChatPrediction(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !["BUY", "SELL"].includes(value.signal)
  )
    return null;
  const result = {};
  const symbol = safeSymbol(value.symbol);
  if (symbol) result.symbol = symbol;
  result.signal = value.signal;
  if (NUMBER(value.confidence))
    result.confidence = clamp(value.confidence, 0, 1);
  if (value.probabilities && typeof value.probabilities === "object") {
    const probabilities = pickNumbers(value.probabilities, ["BUY", "SELL"]);
    for (const key of Object.keys(probabilities))
      probabilities[key] = clamp(probabilities[key], 0, 1);
    if (Object.keys(probabilities).length) result.probabilities = probabilities;
  }
  if (value.training && typeof value.training === "object") {
    const training = pickNumbers(value.training, [
      "samples",
      "accuracy",
      "trainSamples",
      "testSamples",
      "gapBars",
    ]);
    const trainedAt = safeText(value.training.trainedAt, 64);
    if (trainedAt) training.trainedAt = trainedAt;
    if (Object.keys(training).length) result.training = training;
  }
  return Object.keys(result).length ? result : null;
}

export function allowlistChatAccount(value) {
  if (!value || typeof value !== "object") return null;
  const source =
    value.account && typeof value.account === "object" ? value.account : value;
  const result = {};
  const mode = typeof value.mode === "string" ? value.mode : source.mode;
  if (
    typeof mode === "string" &&
    ["paper", "live"].includes(mode.toLowerCase())
  )
    result.mode = mode.toLowerCase();
  const currency = safeText(source.currency, 12);
  const asOf = safeText(source.asOf, 64);
  if (currency) result.currency = currency;
  if (asOf) result.asOf = asOf;
  const summary = pickNumbers(source.summary ?? source, SUMMARY_NUMBERS);
  if (Object.keys(summary).length) result.summary = summary;
  const positions = (Array.isArray(source.positions) ? source.positions : [])
    .slice(0, 100)
    .flatMap((position) => {
      const symbol = safeSymbol(position?.symbol);
      return symbol
        ? [{ symbol, ...pickNumbers(position, POSITION_NUMBERS) }]
        : [];
    });
  if (positions.length) result.positions = positions;

  const rawOrders = Array.isArray(source.orders)
    ? source.orders
    : Array.isArray(source.pendingOrders)
      ? source.pendingOrders
      : Array.isArray(value.pendingOrders)
        ? value.pendingOrders
        : Array.isArray(value.orders)
          ? value.orders
          : [];
  const explicitPending =
    Array.isArray(source.pendingOrders) || Array.isArray(value.pendingOrders);
  const orders = rawOrders.slice(0, 100).flatMap((order) => {
    const symbol = safeSymbol(order?.symbol);
    if (!symbol) return [];
    const status = safeText(order.status, 32);
    const normalizedStatus = status?.toLowerCase().replace(/[\s_-]/g, "");
    if (
      !explicitPending &&
      (TERMINAL_ORDER_STATUSES.has(normalizedStatus) ||
        !ACTIVE_ORDER_STATUSES.has(normalizedStatus))
    )
      return [];
    const item = { symbol, ...pickNumbers(order, ORDER_NUMBERS) };
    for (const key of ["side", "type", "tif", "status", "bracketRole"]) {
      const text = safeText(order[key], 32);
      if (text) item[key] = text;
    }
    return [item];
  });
  if (orders.length) result.orders = orders;
  return Object.keys(result).length ? result : null;
}

export function allowlistChatMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-20)
    .flatMap((message) => {
      if (
        !["user", "assistant"].includes(message?.role) ||
        typeof message.content !== "string"
      )
        return [];
      return [{ role: message.role, content: message.content.slice(0, 4000) }];
    });
}

export function validateChatDraft(value, expectedSymbol) {
  if (!value || typeof value !== "object") return null;
  const symbol = safeSymbol(value.symbol);
  const expected = safeSymbol(expectedSymbol);
  const quantity = Number(value.quantity);
  const limitPrice = Number(value.limitPrice);
  if (
    !symbol ||
    (expected && symbol !== expected) ||
    !["BUY", "SELL"].includes(value.side) ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > 1_000_000 ||
    !NUMBER(limitPrice) ||
    limitPrice <= 0 ||
    limitPrice > 1_000_000_000 ||
    !Number.isFinite(quantity * limitPrice)
  )
    return null;
  const tif = ["DAY", "GTC", "IOC", "FOK"].includes(value.tif)
    ? value.tif
    : null;
  if (!tif) return null;
  const draft = { symbol, side: value.side, quantity, limitPrice, tif };
  for (const key of ["takeProfit", "stopLoss"]) {
    if (value[key] == null) continue;
    const price = Number(value[key]);
    if (!NUMBER(price) || price <= 0 || price > 1_000_000_000) return null;
    if (
      key === "takeProfit" &&
      (value.side === "BUY" ? price <= limitPrice : price >= limitPrice)
    )
      return null;
    if (
      key === "stopLoss" &&
      (value.side === "BUY" ? price >= limitPrice : price <= limitPrice)
    )
      return null;
    draft[key] = price;
  }
  return draft;
}
