export const DEMO =
  import.meta.env.VITE_STATIC_DEMO === "1" ||
  new URLSearchParams(location.search).get("demo") === "1";
let sample;
async function demoApi(path, options) {
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (options.method && options.method !== "GET")
    throw new Error(
      "Static preview: this operation needs the local services. / 靜態預覽：此操作需要本機服務。",
    );
  const url = new URL(path, location.origin);
  if (/\/health$/.test(url.pathname))
    return {
      status: "demo",
      analysis: false,
      ib: { connected: false },
      desktop: false,
    };
  if (/\/ib\/status$/.test(url.pathname)) return { connected: false };
  if (/\/search$/.test(url.pathname))
    return {
      results: [
        {
          symbol: "NVDA",
          description: "NVIDIA · generated sample / 產生的範例",
        },
      ],
    };
  if (/\/chat\/models$/.test(url.pathname))
    return { models: [], configured: false };
  if (!sample) {
    const response = await fetch(`${import.meta.env.BASE_URL}demo/NVDA.json`, {
      signal: options.signal,
    });
    if (!response.ok)
      throw new Error("Sample unavailable. Run npm run demo:generate.");
    sample = await response.json();
  }
  if (/\/quotes$/.test(url.pathname)) {
    const last = sample.candles.at(-1),
      prev = sample.candles.at(-2);
    return {
      quotes: [
        {
          symbol: "NVDA",
          price: last.close,
          previousClose: prev.close,
          change: last.close - prev.close,
          changePercent: (last.close / prev.close - 1) * 100,
          asOf: sample.asOf,
        },
      ],
    };
  }
  if (url.pathname.includes("/history/")) {
    if (!url.pathname.endsWith("/NVDA"))
      throw new Error(
        "Static preview contains NVDA only. / 靜態預覽僅包含 NVDA。",
      );
    const interval = url.searchParams.get("interval") || "1d";
    let candles = sample.candles;
    if (interval !== "1d") {
      const buckets = new Map();
      for (const bar of candles) {
        const date = new Date(`${bar.time}T00:00:00Z`);
        if (interval === "1wk")
          date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        const key =
          interval === "1mo"
            ? `${bar.time.slice(0, 7)}-01`
            : date.toISOString().slice(0, 10);
        const existing = buckets.get(key);
        buckets.set(
          key,
          existing
            ? {
                ...existing,
                high: Math.max(existing.high, bar.high),
                low: Math.min(existing.low, bar.low),
                close: bar.close,
                volume: existing.volume + bar.volume,
              }
            : { ...bar, time: key },
        );
      }
      candles = [...buckets.values()];
    }
    return { ...sample, candles, interval };
  }
  if (url.pathname.includes("/fundamentals/"))
    return {
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      currency: "USD",
      sector: "Technology",
      industry: "Semiconductors",
      marketCap: null,
      trailingPE: null,
      source: "generated sample",
    };
  throw new Error(
    "Unavailable in static preview. Start local services for this feature. / 靜態預覽不支援此功能，請啟動本機服務。",
  );
}
export async function api(path, options = {}) {
  if (DEMO) return demoApi(path, options);
  const { body, signal, ...rest } = options;
  const response = await fetch(
    path.startsWith("/api/") ? path : `/api${path}`,
    {
      ...rest,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
        : AbortSignal.timeout(120000),
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...rest.headers,
      },
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    },
  );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Service returned an unreadable response (${response.status}). / 服務回應無法讀取。`,
    );
  }
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message ||
            data.message ||
            `Request failed (${response.status})`,
    );
  return data;
}
