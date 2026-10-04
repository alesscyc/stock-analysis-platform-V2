import { useEffect, useRef, useState } from "react";
import { api } from "../src/api.js";
import { money, Notice, tx } from "../src/ui.jsx";
import {
  evaluateScreener,
  miniCandleGeometry,
  parseSymbols,
  SCREENER_DEFAULTS,
} from "../src/research.js";

function ScanProgress({ lang, scan }) {
  const fraction = scan.total ? Math.min(1, scan.done / scan.total) : 0;
  const percent = Math.round(fraction * 100);
  return (
    <svg
      className="research-scan-progress"
      width="40"
      height="40"
      viewBox="0 0 40 40"
      role="img"
      aria-label={tx(
        lang,
        `${percent}% of symbols scanned`,
        `已掃描 ${percent}% 股票代號`,
      )}
    >
      <circle
        className="research-scan-progress-track"
        cx="20"
        cy="20"
        r="16"
        pathLength="100"
        fill="none"
        stroke="#304253"
        strokeWidth="3"
      />
      <circle
        className="research-scan-progress-value"
        cx="20"
        cy="20"
        r="16"
        pathLength="100"
        fill="none"
        stroke="#62cfad"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="100 100"
        strokeDashoffset={100 - percent}
        transform="rotate(-90 20 20)"
      />
      <text
        x="20"
        y="21"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#a0c2b3"
        fontSize="8"
        fontFamily="monospace"
      >
        {percent}%
      </text>
    </svg>
  );
}

function MiniCandles({ lang, candles, symbol }) {
  const bars = miniCandleGeometry(candles);
  return (
    <svg
      className="research-mini-candles"
      viewBox="0 0 88 36"
      role="img"
      aria-label={tx(
        lang,
        `${symbol} daily candlesticks`,
        `${symbol} 日線蠟燭圖`,
      )}
    >
      {bars.map((bar, index) => (
        <g key={index} className={bar.up ? "candle-up" : "candle-down"}>
          <line x1={bar.x} x2={bar.x} y1={bar.highY} y2={bar.lowY} />
          <rect x={bar.x - 1} y={bar.bodyY} width="2" height={bar.bodyHeight} />
        </g>
      ))}
    </svg>
  );
}

export default function ScreenerDialog({ lang, onSelect }) {
  const [symbolsText, setSymbolsText] = useState("");
  const [conditions, setConditions] = useState(SCREENER_DEFAULTS);
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(-1);
  const [scan, setScan] = useState({
    status: "idle",
    done: 0,
    total: 0,
    symbol: "",
    failures: 0,
    matches: 0,
  });
  const [error, setError] = useState("");
  const controller = useRef(null);
  const busy = scan.status === "running" || scan.status === "cancelling";

  useEffect(
    () => () => {
      const active = controller.current;
      controller.current = null;
      active?.abort();
    },
    [],
  );

  const updateCondition = (key, value) =>
    setConditions((current) => ({ ...current, [key]: value }));

  async function importFile(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      setSymbolsText(await file.text());
      setError("");
    } catch {
      setError(tx(lang, "Could not read that file.", "無法讀取此檔案。"));
    }
  }

  async function runScan() {
    const symbols = parseSymbols(symbolsText);
    if (!symbols.length) {
      setError(
        tx(
          lang,
          "Enter at least one valid ticker symbol.",
          "請輸入至少一個有效股票代號。",
        ),
      );
      return;
    }
    if (
      !conditions.aboveLowEnabled &&
      !conditions.nearHighEnabled &&
      !conditions.risingMaEnabled
    ) {
      setError(
        tx(
          lang,
          "Enable at least one screening condition.",
          "請至少啟用一項篩選條件。",
        ),
      );
      return;
    }
    if (
      (conditions.aboveLowEnabled &&
        (!Number.isFinite(conditions.aboveLowPercent) ||
          conditions.aboveLowPercent < 0 ||
          conditions.aboveLowPercent > 500)) ||
      (conditions.nearHighEnabled &&
        (!Number.isFinite(conditions.nearHighPercent) ||
          conditions.nearHighPercent < 0 ||
          conditions.nearHighPercent > 500)) ||
      (conditions.risingMaEnabled &&
        (!Number.isInteger(conditions.maTrendDays) ||
          conditions.maTrendDays < 5 ||
          conditions.maTrendDays > 63))
    ) {
      setError(
        tx(
          lang,
          "Condition values are outside their allowed ranges.",
          "篩選條件數值超出允許範圍。",
        ),
      );
      return;
    }

    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setError("");
    setMatches([]);
    setSelected(-1);
    setScan({
      status: "running",
      done: 0,
      total: symbols.length,
      symbol: "",
      failures: 0,
      matches: 0,
    });
    let failures = 0;
    let completed = 0;
    let matched = 0;

    for (const symbol of symbols) {
      if (request.signal.aborted) break;
      setScan((current) => ({ ...current, symbol }));
      try {
        const data = await api(
          `/api/history/${encodeURIComponent(symbol)}?interval=1d&period=2y`,
          { signal: request.signal },
        );
        if (controller.current !== request) return;
        if (!Array.isArray(data?.candles) || data.candles.length < 1) {
          failures++;
        } else {
          const evaluation = evaluateScreener(data.candles, conditions);
          if (evaluation.reason === "insufficient-history") failures++;
          else if (evaluation.matches) {
            const item = { symbol, candles: data.candles, evaluation };
            matched++;
            setMatches((current) => [...current, item]);
            setSelected((index) => (index < 0 ? 0 : index));
            setScan((current) => ({ ...current, matches: matched }));
          }
        }
      } catch (cause) {
        if (controller.current !== request) return;
        if (request.signal.aborted || cause?.name === "AbortError") break;
        failures++;
      }
      completed++;
      setScan((current) => ({ ...current, done: completed, failures }));
    }

    if (controller.current !== request) return;
    const cancelled = request.signal.aborted;
    setScan((current) => ({
      ...current,
      status: cancelled ? "cancelled" : "done",
      done: completed,
      failures,
      matches: matched,
      symbol: "",
    }));
    if (controller.current === request) controller.current = null;
  }

  function cancelScan() {
    if (!busy) return;
    setScan((current) => ({ ...current, status: "cancelling" }));
    controller.current?.abort();
  }

  function openMatch(index) {
    const item = matches[index];
    if (!item) return;
    setSelected(index);
    onSelect?.(item.symbol, item.candles);
  }

  function handleResultKeys(event) {
    if (!matches.length) return;
    let next = selected;
    if (event.key === "ArrowDown")
      next = Math.min(matches.length - 1, selected + 1);
    else if (event.key === "ArrowUp")
      next = Math.max(0, selected < 0 ? 0 : selected - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = matches.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMatch(selected < 0 ? 0 : selected);
      return;
    } else return;
    event.preventDefault();
    setSelected(next);
  }

  const numberField = (key, label, min, max, step = 1) => (
    <label className="field research-condition-number" key={key}>
      <span>{label}</span>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={conditions[key]}
        onChange={(event) => updateCondition(key, Number(event.target.value))}
      />
    </label>
  );

  return (
    <section
      className="research-sidebar research-screener stack"
      aria-label={tx(lang, "Technical screener", "技術篩選器")}
    >
      <header className="panel-header">
        <div>
          <h2>{tx(lang, "Technical screener", "技術篩選器")}</h2>
          <p className="muted">
            {tx(
              lang,
              "Scan your symbols one at a time. Matching daily history is reused when opening a chart.",
              "逐一掃描股票代號。開啟圖表時會重用符合條件的日線資料。",
            )}
          </p>
        </div>
      </header>

      <div className="panel-body stack">
        <label className="field">
          <span>{tx(lang, "Symbols", "股票代號")}</span>
          <textarea
            className="input research-symbol-input"
            rows="4"
            value={symbolsText}
            disabled={busy}
            onChange={(event) => setSymbolsText(event.target.value)}
            aria-label={tx(
              lang,
              "Symbols, separated by commas or lines",
              "股票代號，以逗號或換行分隔",
            )}
            placeholder={tx(lang, "AAPL, MSFT, NVDA", "AAPL、MSFT、NVDA")}
          />
        </label>
        <label className="field">
          <span>{tx(lang, "Import symbol file", "匯入股票代號檔案")}</span>
          <input
            className="input"
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            disabled={busy}
            onChange={importFile}
            aria-label={tx(
              lang,
              "Import a text or CSV file of symbols",
              "匯入包含股票代號的文字或 CSV 檔案",
            )}
          />
        </label>

        <fieldset className="research-condition-group" disabled={busy}>
          <legend>
            {tx(
              lang,
              "Conditions — all enabled rules must pass",
              "篩選條件 — 所有啟用規則都必須符合",
            )}
          </legend>
          <label className="row research-condition-toggle">
            <input
              type="checkbox"
              checked={conditions.aboveLowEnabled}
              onChange={(event) =>
                updateCondition("aboveLowEnabled", event.target.checked)
              }
            />
            <span>
              {tx(
                lang,
                "Above 52-week closing low by at least (%)",
                "高於 52 週收盤低點至少（%）",
              )}
            </span>
          </label>
          {conditions.aboveLowEnabled &&
            numberField(
              "aboveLowPercent",
              tx(lang, "Minimum distance", "最小距離"),
              0,
              500,
              0.1,
            )}

          <label className="row research-condition-toggle">
            <input
              type="checkbox"
              checked={conditions.nearHighEnabled}
              onChange={(event) =>
                updateCondition("nearHighEnabled", event.target.checked)
              }
            />
            <span>
              {tx(
                lang,
                "Within this distance of 52-week closing high (%)",
                "距離 52 週收盤高點不超過（%）",
              )}
            </span>
          </label>
          {conditions.nearHighEnabled &&
            numberField(
              "nearHighPercent",
              tx(lang, "Maximum distance", "最大距離"),
              0,
              500,
              0.1,
            )}

          <label className="row research-condition-toggle">
            <input
              type="checkbox"
              checked={conditions.risingMaEnabled}
              onChange={(event) =>
                updateCondition("risingMaEnabled", event.target.checked)
              }
            />
            <span>
              {tx(
                lang,
                "Rising 200-day moving average",
                "200 日移動平均線上升",
              )}
            </span>
          </label>
          {conditions.risingMaEnabled &&
            numberField(
              "maTrendDays",
              tx(lang, "Trend window (trading days)", "趨勢期間（交易日）"),
              5,
              63,
              1,
            )}
          <p className="muted research-footnote">
            {tx(
              lang,
              "The 200-day average must finish higher and rise on at least 90% of days in the selected window. A full 52-week close window is required for price-range rules.",
              "200 日均線期末值必須較高，且至少在所選期間 90% 的交易日上升。價格區間規則需具備完整 52 週收盤資料。",
            )}
          </p>
        </fieldset>

        {error && <Notice tone="error">{error}</Notice>}
        <div className="row research-actions">
          <button
            className="button primary"
            type="button"
            onClick={runScan}
            disabled={busy}
          >
            {tx(lang, "Run scan", "開始掃描")}
          </button>
          {busy && (
            <button className="button ghost" type="button" onClick={cancelScan}>
              {tx(lang, "Cancel scan", "取消掃描")}
            </button>
          )}
        </div>

        <div className="research-progress row" role="status" aria-live="polite">
          {scan.total > 0 && <ScanProgress lang={lang} scan={scan} />}
          <div className="research-progress-label">
            {scan.status === "running" &&
              tx(
                lang,
                `Scanning ${scan.done + 1} of ${scan.total}: ${scan.symbol || "starting…"}`,
                `正在掃描 ${scan.done + 1}/${scan.total}：${scan.symbol || "準備中…"}`,
              )}
            {scan.status === "cancelling" &&
              tx(
                lang,
                "Cancelling after current request…",
                "目前請求完成後取消…",
              )}
            {scan.status === "done" &&
              tx(
                lang,
                `Scan complete: ${scan.matches} matches, ${scan.failures} skipped, ${scan.total} symbols.`,
                `掃描完成：${scan.matches} 個符合、${scan.failures} 個略過，共 ${scan.total} 個代號。`,
              )}
            {scan.status === "cancelled" &&
              tx(
                lang,
                `Scan cancelled after ${scan.done} of ${scan.total}: ${scan.matches} matches retained, ${scan.failures} skipped.`,
                `掃描於 ${scan.done}/${scan.total} 個代號後取消：保留 ${scan.matches} 個符合項目，${scan.failures} 個略過。`,
              )}
          </div>
        </div>

        <section
          className="research-results"
          aria-label={tx(lang, "Screener results", "篩選結果")}
        >
          <div className="row research-results-heading">
            <h3>{tx(lang, "Matches", "符合項目")}</h3>
            <span className="badge">{matches.length}</span>
          </div>
          {matches.length === 0 ? (
            <div className="empty">
              {busy
                ? tx(
                    lang,
                    "Matches appear as each symbol finishes.",
                    "每個股票代號掃描完成後會立即顯示符合項目。",
                  )
                : scan.status === "done"
                  ? tx(
                      lang,
                      "No symbols matched the enabled rules.",
                      "沒有股票符合已啟用的規則。",
                    )
                  : scan.status === "cancelled"
                    ? tx(
                        lang,
                        "No matches among completed symbols.",
                        "已完成掃描的股票中沒有符合項目。",
                      )
                    : tx(
                        lang,
                        "No matches yet. Run a scan to see candidates.",
                        "尚無符合項目。開始掃描以尋找候選股票。",
                      )}
            </div>
          ) : (
            <div
              className="research-result-list"
              role="listbox"
              tabIndex={0}
              aria-label={tx(
                lang,
                "Matching symbols. Use arrow keys to select and Enter to open chart.",
                "符合的股票代號。使用方向鍵選取，按 Enter 開啟圖表。",
              )}
              onKeyDown={handleResultKeys}
            >
              {matches.map((item, index) => (
                <button
                  key={item.symbol}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected === index}
                  className={`research-result ${selected === index ? "is-selected" : ""}`}
                  onClick={() => openMatch(index)}
                >
                  <span className="research-result-main">
                    <strong>{item.symbol}</strong>
                    <span className="muted">
                      {money(item.evaluation.price)}
                    </span>
                    <span className="muted research-result-range">
                      {tx(lang, "52w close range", "52 週收盤範圍")}:{" "}
                      {money(item.evaluation.weekLow)}–
                      {money(item.evaluation.weekHigh)}
                    </span>
                  </span>
                  <MiniCandles
                    lang={lang}
                    candles={item.candles}
                    symbol={item.symbol}
                  />
                  <span className="research-open-hint">
                    {tx(lang, "Open chart", "開啟圖表")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
