import { HttpError } from './errors.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function object(value, label) {
  if (!isObject(value)) throw new HttpError(400, `${label} must be an object`);
  return value;
}

function onlyKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new HttpError(400, `${label} contains unsupported field: ${extra}`);
}

function number(value, label, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new HttpError(400, `${label} is invalid`);
  }
  return value;
}

export function validateSymbol(value, label = 'symbol') {
  if (typeof value !== 'string') throw new HttpError(400, `${label} is invalid`);
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new HttpError(400, `${label} is invalid`);
  return symbol;
}

export function validateOrderTicket(value, { expectedSymbol } = {}) {
  const input = object(value, 'Order');
  onlyKeys(input, ['symbol', 'side', 'quantity', 'limitPrice', 'tif', 'takeProfit', 'stopLoss'], 'Order');
  const symbol = validateSymbol(input.symbol);
  if (expectedSymbol && symbol !== expectedSymbol) throw new HttpError(400, 'Draft symbol must match chart symbol');
  if (!['BUY', 'SELL'].includes(input.side)) throw new HttpError(400, 'side must be BUY or SELL');
  const quantity = number(input.quantity, 'quantity', { min: 1, max: 1000000, integer: true });
  const limitPrice = number(input.limitPrice, 'limitPrice', { min: Number.MIN_VALUE, max: 1000000000 });
  if (!['DAY', 'GTC', 'IOC', 'FOK'].includes(input.tif)) throw new HttpError(400, 'tif is invalid');

  const result = { symbol, side: input.side, quantity, limitPrice, tif: input.tif };
  for (const field of ['takeProfit', 'stopLoss']) {
    if (own(input, field)) result[field] = number(input[field], field, { min: Number.MIN_VALUE, max: 1000000000 });
  }
  if (result.takeProfit !== undefined && result.stopLoss !== undefined) {
    const valid = input.side === 'BUY'
      ? result.takeProfit > limitPrice && result.stopLoss < limitPrice
      : result.takeProfit < limitPrice && result.stopLoss > limitPrice;
    if (!valid) throw new HttpError(400, 'Bracket prices must be on opposite sides of entry price');
  } else if (result.takeProfit !== undefined) {
    if (input.side === 'BUY' ? result.takeProfit <= limitPrice : result.takeProfit >= limitPrice) {
      throw new HttpError(400, 'takeProfit must be beyond entry price');
    }
  } else if (result.stopLoss !== undefined) {
    if (input.side === 'BUY' ? result.stopLoss >= limitPrice : result.stopLoss <= limitPrice) {
      throw new HttpError(400, 'stopLoss must be beyond entry price');
    }
  }
  return result;
}

export function validatePricePatch(value) {
  const input = object(value, 'Order patch');
  onlyKeys(input, ['limitPrice', 'stopPrice'], 'Order patch');
  const result = {};
  if (own(input, 'limitPrice')) result.limitPrice = number(input.limitPrice, 'limitPrice', { min: Number.MIN_VALUE, max: 1000000000 });
  if (own(input, 'stopPrice')) result.stopPrice = number(input.stopPrice, 'stopPrice', { min: Number.MIN_VALUE, max: 1000000000 });
  if (!Object.keys(result).length) throw new HttpError(400, 'Provide limitPrice or stopPrice');
  return result;
}

function comparison(value, label) {
  const input = object(value, label);
  onlyKeys(input, ['left', 'operator', 'right'], label);
  if (!['>', '<', '>=', '<='].includes(input.operator)) throw new HttpError(400, `${label}.operator is invalid`);
  return { left: operand(input.left, `${label}.left`), operator: input.operator, right: operand(input.right, `${label}.right`) };
}

function operand(value, label) {
  const input = object(value, label);
  if (!['close', 'ma', 'number'].includes(input.type)) throw new HttpError(400, `${label}.type is invalid`);
  if (input.type === 'close') {
    onlyKeys(input, ['type'], label);
    return { type: 'close' };
  }
  if (input.type === 'ma') {
    onlyKeys(input, ['type', 'period'], label);
    return { type: 'ma', period: number(input.period, `${label}.period`, { min: 2, max: 500, integer: true }) };
  }
  onlyKeys(input, ['type', 'value'], label);
  return { type: 'number', value: number(input.value, `${label}.value`) };
}

export function validateBacktest(value) {
  const input = object(value, 'Backtest');
  onlyKeys(input, ['symbol', 'interval', 'period', 'initialCapital', 'entry', 'exit', 'frequency', 'exitMode', 'exitPeriods', 'exitFrequency'], 'Backtest');
  const symbol = validateSymbol(input.symbol);
  if (!['1d', '1wk', '1mo'].includes(input.interval)) throw new HttpError(400, 'interval is invalid');
  if (!['1y', '2y', '5y', 'max'].includes(input.period)) throw new HttpError(400, 'period is invalid');
  const initialCapital = number(input.initialCapital, 'initialCapital', { min: Number.MIN_VALUE, max: 1000000000000 });
  if (!['daily', 'monthly'].includes(input.frequency)) throw new HttpError(400, 'frequency is invalid');
  if (!['immediate', 'staged'].includes(input.exitMode)) throw new HttpError(400, 'exitMode is invalid');
  const exitPeriods = number(input.exitPeriods, 'exitPeriods', { min: 1, max: 120, integer: true });
  if (!['weekly', 'monthly'].includes(input.exitFrequency)) throw new HttpError(400, 'exitFrequency is invalid');
  return {
    symbol,
    interval: input.interval,
    period: input.period,
    initialCapital,
    entry: comparison(input.entry, 'entry'),
    exit: comparison(input.exit, 'exit'),
    frequency: input.frequency,
    exitMode: input.exitMode,
    exitPeriods,
    exitFrequency: input.exitFrequency,
  };
}

export function validateCandles(value, { max = 500 } = {}) {
  if (!Array.isArray(value) || value.length > max) throw new HttpError(400, `candles must be an array of at most ${max}`);
  return value.map((bar, index) => {
    const input = object(bar, `candles[${index}]`);
    onlyKeys(input, ['time', 'open', 'high', 'low', 'close', 'volume'], `candles[${index}]`);
    const parsedDate = typeof input.time === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.time)
      ? new Date(`${input.time}T00:00:00.000Z`)
      : null;
    if (!parsedDate || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== input.time) {
      throw new HttpError(400, `candles[${index}].time is invalid`);
    }
    return {
      time: input.time,
      open: number(input.open, `candles[${index}].open`, { min: 0 }),
      high: number(input.high, `candles[${index}].high`, { min: 0 }),
      low: number(input.low, `candles[${index}].low`, { min: 0 }),
      close: number(input.close, `candles[${index}].close`, { min: 0 }),
      volume: number(input.volume, `candles[${index}].volume`, { min: 0 }),
    };
  });
}

export function validateModelId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpError(400, 'model is invalid');
  }
  return value;
}
