import { useEffect, useState } from "react";
import { api } from "./api.js";

const historyCache = new Map();
const keyFor = (symbol, interval) => `${symbol}:${interval}`;
function cacheHistory(key, data) {
  historyCache.delete(key);
  historyCache.set(key, data);
  while (historyCache.size > 30)
    historyCache.delete(historyCache.keys().next().value);
}
export function seedHistory(symbol, candles) {
  if (Array.isArray(candles) && candles.length)
    cacheHistory(keyFor(symbol, "1d"), {
      candles,
      full: false,
      cachedAt: Date.now(),
      source: "Yahoo Finance",
    });
}
export function normalizeSymbol(value) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol))
    throw new Error(
      "Enter a valid ticker (for example AAPL or BRK-B). / 請輸入有效股票代號。",
    );
  return symbol;
}
export function mergeCandles(...lists) {
  return [
    ...new Map(
      lists
        .flat()
        .filter(
          (b) =>
            b &&
            /^\d{4}-\d{2}-\d{2}$/.test(b.time) &&
            [b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite),
        )
        .map((b) => [b.time, b]),
    ).values(),
  ].sort((a, b) => a.time.localeCompare(b.time));
}
export function useStock(symbol, interval) {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState({
    candles: [],
    loading: true,
    predictionLoading: true,
    fundamentalsLoading: true,
  });
  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController(),
      signal = controller.signal,
      key = keyFor(symbol, interval),
      cached = historyCache.get(key);
    const update = (patch) => {
      if (!signal.aborted) setState((previous) => ({ ...previous, ...patch }));
    };
    setState({
      symbol,
      interval,
      candles: cached?.candles || [],
      loading: !cached?.candles.length,
      historyLoading: false,
      error: null,
      partialHistory: false,
      prediction: null,
      predictionLoading: true,
      predictionError: null,
      fundamentals: null,
      fundamentalsLoading: true,
      fundamentalsError: null,
      source: cached?.source,
      asOf: cached?.asOf,
    });
    async function loadHistory() {
      try {
        const recent = await api(
          `/history/${encodeURIComponent(symbol)}?interval=${interval}&period=${interval === "1d" ? "6mo" : "max"}`,
          { signal },
        );
        if (signal.aborted) return;
        let candles = mergeCandles(cached?.candles || [], recent.candles || []);
        if (!candles.length)
          throw new Error("No price history returned. / 未取得歷史價格。");
        const full = interval !== "1d" || !!cached?.full;
        cacheHistory(key, { ...recent, candles, full, cachedAt: Date.now() });
        update({
          candles,
          loading: false,
          asOf: recent.asOf,
          source: recent.source,
        });
        if (
          interval === "1d" &&
          !(cached?.full && Date.now() - cached.cachedAt < 300000)
        ) {
          update({ historyLoading: true });
          try {
            const older = await api(
              `/history/${encodeURIComponent(symbol)}?interval=1d&period=max`,
              { signal },
            );
            if (signal.aborted) return;
            candles = mergeCandles(older.candles || [], recent.candles || []);
            cacheHistory(key, {
              ...older,
              candles,
              full: true,
              cachedAt: Date.now(),
            });
            update({ candles, historyLoading: false, partialHistory: false });
          } catch (error) {
            if (!signal.aborted)
              update({
                historyLoading: false,
                partialHistory: true,
                historyError: error.message,
              });
          }
        }
      } catch (error) {
        if (!signal.aborted)
          update({
            loading: false,
            error: error.message,
            partialHistory: !!cached?.candles.length,
          });
      }
    }
    loadHistory();
    api(`/prediction/${encodeURIComponent(symbol)}`, { signal })
      .then((prediction) => update({ prediction, predictionLoading: false }))
      .catch((error) =>
        update({ predictionLoading: false, predictionError: error.message }),
      );
    api(`/fundamentals/${encodeURIComponent(symbol)}`, { signal })
      .then((fundamentals) =>
        update({ fundamentals, fundamentalsLoading: false }),
      )
      .catch((error) =>
        update({
          fundamentalsLoading: false,
          fundamentalsError: error.message,
        }),
      );
    return () => controller.abort();
  }, [symbol, interval, reloadToken]);
  const visible =
    state.symbol === symbol && state.interval === interval
      ? state
      : {
          candles: historyCache.get(keyFor(symbol, interval))?.candles || [],
          loading: true,
          predictionLoading: true,
          fundamentalsLoading: true,
        };
  return { ...visible, reload: () => setReloadToken((n) => n + 1) };
}
