import { HttpError } from './errors.js';
import { validateOrderTicket, validateSymbol } from './validation.js';

const SUMMARY_FIELDS = [
  'netLiquidation', 'cash', 'buyingPower', 'availableFunds', 'excessLiquidity',
  'maintenanceMargin', 'grossPositionValue', 'unrealizedPnl', 'realizedPnl', 'startingCash',
];
const POSITION_FIELDS = ['quantity', 'averageCost', 'price', 'marketValue', 'unrealizedPnl'];
const ORDER_FIELDS = ['quantity', 'limitPrice', 'stopPrice', 'filled'];
const SAFE_ACCOUNT_WARNINGS = new Set([
  'Account snapshot is stale or incomplete.',
  'Snapshot refresh failed; showing available cached data.',
  'Non-stock positions and P&L are excluded from this stock-only overview.',
  'Non-USD account totals or positions are excluded from this USD-only overview.',
]);
const FUNDAMENTAL_NUMBERS = [
  'marketCap', 'trailingPE', 'forwardPE', 'trailingEps', 'dividendYield', 'beta',
  'fiftyTwoWeekLow', 'fiftyTwoWeekHigh', 'averageVolume',
];

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const shortText = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : undefined;

function maskAccountId(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const id = value.slice(0, 64);
  return id.length <= 4 ? `••••` : `${id.slice(0, 2)}••••${id.slice(-4)}`;
}

export function sanitizeAccountContext(value) {
  if (!record(value)) return undefined;
  const source = record(value.account) ? value.account : value;
  const out = {};
  if (['live', 'paper'].includes(value.mode)) out.mode = value.mode;
  const accountId = maskAccountId(source.accountId);
  if (accountId) out.accountId = accountId;
  if (typeof source.asOf === 'string') out.asOf = source.asOf.slice(0, 40);
  if (typeof source.currency === 'string' && /^[A-Z]{3}$/.test(source.currency)) out.currency = source.currency;
  if (Array.isArray(source.warnings)) {
    const warnings = [...new Set(source.warnings.filter((warning) => SAFE_ACCOUNT_WARNINGS.has(warning)))];
    if (warnings.length) out.warnings = warnings;
  }

  const rawSummary = record(source.summary) ? source.summary : source;
  const summary = {};
  for (const key of SUMMARY_FIELDS) if (finite(rawSummary[key])) summary[key] = rawSummary[key];
  if (Object.keys(summary).length) out.summary = summary;

  if (Array.isArray(source.positions)) {
    out.positions = source.positions.slice(0, 100).flatMap((item) => {
      if (!record(item) || typeof item.symbol !== 'string') return [];
      let symbol;
      try { symbol = validateSymbol(item.symbol); } catch { return []; }
      const position = { symbol };
      for (const key of POSITION_FIELDS) if (finite(item[key])) position[key] = item[key];
      return [position];
    });
  }
  if (Array.isArray(source.orders)) {
    out.orders = source.orders.slice(0, 100).flatMap((item) => {
      if (!record(item) || typeof item.symbol !== 'string') return [];
      let symbol;
      try { symbol = validateSymbol(item.symbol); } catch { return []; }
      const order = { symbol };
      for (const key of ['side', 'type', 'tif', 'status', 'bracketRole']) {
        if (typeof item[key] === 'string' && item[key].length <= 40) order[key] = item[key];
      }
      for (const key of ORDER_FIELDS) if (finite(item[key])) order[key] = item[key];
      return [order];
    });
  }
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeFundamentals(value) {
  if (value == null) return undefined;
  if (!record(value)) throw new HttpError(400, 'fundamentals must be an object');
  const out = {};
  for (const key of ['symbol', 'name', 'currency', 'sector', 'industry']) {
    const text = shortText(value[key], key === 'name' ? 160 : 80);
    if (text !== undefined) out[key] = text;
  }
  for (const key of FUNDAMENTAL_NUMBERS) {
    if (value[key] === null || finite(value[key])) out[key] = value[key];
    else if (value[key] !== undefined) throw new HttpError(400, `fundamentals.${key} is invalid`);
  }
  return out;
}

export function sanitizePrediction(value) {
  if (value == null) return undefined;
  if (!record(value)) throw new HttpError(400, 'prediction must be an object');
  if (typeof value.signal !== 'string' || !['BUY', 'SELL'].includes(value.signal)) throw new HttpError(400, 'prediction.signal is invalid');
  const confidence = finite(value.confidence) && value.confidence >= 0 && value.confidence <= 1 ? value.confidence : null;
  const out = { signal: value.signal, confidence };
  if (record(value.probabilities)) {
    out.probabilities = {};
    for (const side of ['BUY', 'SELL']) {
      const probability = value.probabilities[side];
      if (finite(probability) && probability >= 0 && probability <= 1) out.probabilities[side] = probability;
    }
  }
  if (record(value.training)) {
    out.training = {};
    for (const key of ['trainedAt', 'samples', 'accuracy', 'trainSamples', 'testSamples', 'gapBars']) {
      const item = value.training[key];
      if (typeof item === 'string') out.training[key] = item.slice(0, 40);
      else if (finite(item)) out.training[key] = item;
    }
  }
  return out;
}

export function validateDraft(value, expectedSymbol) {
  try {
    return validateOrderTicket(value, { expectedSymbol });
  } catch {
    return undefined;
  }
}

export function validateChatMessages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw new HttpError(400, 'messages must contain 1 to 30 turns');
  const messages = value.map((message, index) => {
    if (!record(message) || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw new HttpError(400, `messages[${index}] is invalid`);
    }
    if (!message.content.trim() || message.content.length > 8000) throw new HttpError(400, `messages[${index}].content is invalid`);
    return { role: message.role, content: message.content };
  });
  if (!messages.some((message) => message.role === 'user')) throw new HttpError(400, 'messages must include a user message');
  return messages;
}
