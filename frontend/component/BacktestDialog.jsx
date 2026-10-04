import { useEffect, useRef, useState } from "react";
import { api } from "../src/api.js";
import { money, Notice, percent, tx, useStored } from "../src/ui.jsx";
import {
  DEFAULT_BACKTEST_SETTINGS,
  equityPath,
  normalizeBacktestSettings,
} from "../src/research.js";

const formatNumber = (value, digits = 2) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, {
        maximumFractionDigits: digits,
      }).format(value)
    : "—";
const formatMultiple = (value) =>
  Number.isFinite(value) ? value.toFixed(2) : "—";

function OperandEditor({ lang, name, side, value, onChange }) {
  const label = tx(
    lang,
    `${name} ${side} operand`,
    `${name === "Entry" ? "進場" : "出場"}${side === "left" ? "左側" : "右側"}運算元`,
  );
  return (
    <div className="research-operand">
      <label className="field">
        <span>{label}</span>
        <select
          className="select"
          value={value.type}
          onChange={(event) => onChange({ type: event.target.value })}
        >
          <option value="close">{tx(lang, "Close price", "收盤價")}</option>
          <option value="ma">{tx(lang, "Moving average", "移動平均線")}</option>
          <option value="number">{tx(lang, "Fixed number", "固定數值")}</option>
        </select>
      </label>
      {value.type === "ma" && (
        <label className="field">
          <span>
            {tx(lang, "Moving-average period (2–500)", "移動平均期間（2–500）")}
          </span>
          <input
            className="input"
            type="number"
            min="2"
            max="500"
            step="1"
            value={value.period}
            onChange={(event) =>
              onChange({ type: "ma", period: Number(event.target.value) })
            }
          />
        </label>
      )}
      {value.type === "number" && (
        <label className="field">
          <span>{tx(lang, "Comparison value", "比較數值")}</span>
          <input
            className="input"
            type="number"
            min="0.000001"
            step="any"
            value={value.value}
            onChange={(event) =>
              onChange({ type: "number", value: Number(event.target.value) })
            }
          />
        </label>
      )}
    </div>
  );
}

function RuleEditor({ lang, name, value, onChange }) {
  const title =
    name === "entry"
      ? tx(lang, "Entry rule", "進場規則")
      : tx(lang, "Exit rule", "出場規則");
  return (
    <fieldset className="research-rule">
      <legend>{title}</legend>
      <OperandEditor
        lang={lang}
        name={name === "entry" ? "Entry" : "Exit"}
        side="left"
        value={value.left}
        onChange={(operand) => onChange({ left: operand })}
      />
      <label className="field research-operator">
        <span>{tx(lang, "Comparison operator", "比較運算子")}</span>
        <select
          className="select"
          value={value.operator}
          onChange={(event) => onChange({ operator: event.target.value })}
        >
          <option value=">">&gt; ({tx(lang, "greater than", "大於")})</option>
          <option value="<">&lt; ({tx(lang, "less than", "小於")})</option>
          <option value=">=">
            ≥ ({tx(lang, "greater than or equal", "大於或等於")})
          </option>
          <option value="<=">
            ≤ ({tx(lang, "less than or equal", "小於或等於")})
          </option>
        </select>
      </label>
      <OperandEditor
        lang={lang}
        name={name === "entry" ? "Entry" : "Exit"}
        side="right"
        value={value.right}
        onChange={(operand) => onChange({ right: operand })}
      />
    </fieldset>
  );
}

function metricValue(key, value) {
  if (
    key === "totalReturn" ||
    key === "cagr" ||
    key === "maxDrawdown" ||
    key === "winRate" ||
    key === "averageReturn" ||
    key === "averageLoss"
  )
    return percent(value);
  if (key === "tradeCount")
    return Number.isFinite(value) ? formatNumber(value, 0) : "—";
  if (key === "profitFactor" || key === "sharpe") return formatMultiple(value);
  return "—";
}

function describeOperand(operand, lang) {
  if (operand.type === "close") return tx(lang, "Close", "收盤價");
  if (operand.type === "ma")
    return `${tx(lang, "MA", "移動平均")}(${operand.period})`;
  return money(operand.value);
}

function describeRule(rule, lang) {
  return `${describeOperand(rule.left, lang)} ${rule.operator} ${describeOperand(rule.right, lang)}`;
}

function translateReason(reason, lang) {
  const text = String(reason ?? "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ");
  if (text.includes("entry") || text.includes("buy condition"))
    return tx(lang, "Entry rule", "進場規則");
  if (text.includes("stage")) return tx(lang, "Staged exit", "分批出場");
  if (
    text.includes("final") ||
    text.includes("end of") ||
    text.includes("history")
  )
    return tx(lang, "End-of-history liquidation", "歷史資料結尾平倉");
  if (text.includes("exit") || text.includes("sell condition"))
    return tx(lang, "Exit rule", "出場規則");
  return reason ? String(reason) : tx(lang, "Strategy rule", "策略規則");
}

export default function BacktestDialog({ lang, symbol, onResult }) {
  const [stored, setStored, storageError] = useStored(
    "research:backtest:v1",
    DEFAULT_BACKTEST_SETTINGS,
  );
  const settings = normalizeBacktestSettings(stored);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const controller = useRef(null);
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const busy = status === "running" || status === "cancelling";
  const resultStale =
    result && JSON.stringify(settings) !== JSON.stringify(result.settings);

  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setResult(null);
    setError("");
    setStatus("idle");
    return () => {
      const active = controller.current;
      controller.current = null;
      active?.abort();
    };
  }, [symbol]);

  function updateTop(patch) {
    setStored((current) =>
      normalizeBacktestSettings({
        ...normalizeBacktestSettings(current),
        ...patch,
      }),
    );
  }

  function updateRule(name, patch) {
    setStored((current) => {
      const next = normalizeBacktestSettings(current);
      return normalizeBacktestSettings({
        ...next,
        [name]: { ...next[name], ...patch },
      });
    });
  }

  async function runBacktest() {
    if (!symbol) {
      setError(
        tx(
          lang,
          "Select a symbol before running a backtest.",
          "執行回測前請先選擇股票代號。",
        ),
      );
      return;
    }
    controller.current?.abort();
    const requestSymbol = symbol;
    const request = new AbortController();
    controller.current = request;
    setError("");
    setResult(null);
    setStatus("running");
    let data;
    try {
      data = await api("/api/backtest", {
        method: "POST",
        signal: request.signal,
        body: {
          symbol,
          interval: "1d",
          period: settings.period,
          initialCapital: settings.initialCapital,
          entry: settings.entry,
          exit: settings.exit,
          frequency: settings.frequency,
          exitMode: settings.exitMode,
          exitPeriods: settings.exitPeriods,
          exitFrequency: settings.exitFrequency,
        },
      });
    } catch (cause) {
      if (controller.current !== request || symbolRef.current !== requestSymbol)
        return;
      if (request.signal.aborted || cause?.name === "AbortError") {
        controller.current = null;
        setStatus("cancelled");
        return;
      }
      setError(
        tx(
          lang,
          "Backtest failed. Market history or the research service may be unavailable; no result was created.",
          "回測失敗。市場歷史資料或研究服務可能無法使用；未建立任何結果。",
        ),
      );
      setStatus("error");
      controller.current = null;
      return;
    }
    if (
      request.signal.aborted ||
      controller.current !== request ||
      symbolRef.current !== requestSymbol
    ) {
      if (
        controller.current === request &&
        symbolRef.current === requestSymbol
      ) {
        controller.current = null;
        setStatus("cancelled");
      }
      return;
    }
    if (
      !data?.metrics ||
      !Array.isArray(data.equity) ||
      !Array.isArray(data.actions)
    ) {
      setError(
        tx(
          lang,
          "The research service returned an incomplete result.",
          "研究服務回傳的結果不完整。",
        ),
      );
      setStatus("error");
      if (controller.current === request) controller.current = null;
      return;
    }
    setResult({ data, settings });
    setStatus("done");
    if (controller.current === request) controller.current = null;
    onResult?.(data);
  }

  function cancelBacktest() {
    if (!busy) return;
    setStatus("cancelling");
    controller.current?.abort();
  }

  const labels = [
    ["totalReturn", tx(lang, "Total return", "總報酬")],
    ["cagr", tx(lang, "CAGR", "年化複合報酬率")],
    ["sharpe", tx(lang, "Sharpe ratio", "夏普比率")],
    ["maxDrawdown", tx(lang, "Maximum drawdown", "最大回撤")],
    ["winRate", tx(lang, "Win rate", "勝率")],
    ["tradeCount", tx(lang, "Trade count", "交易筆數")],
    ["averageReturn", tx(lang, "Average return", "平均報酬")],
    ["averageLoss", tx(lang, "Average loss", "平均虧損")],
    ["profitFactor", tx(lang, "Profit factor", "獲利因子")],
  ];

  return (
    <section
      className="research-sidebar research-backtest stack"
      aria-label={tx(lang, "Strategy backtest", "策略回測")}
    >
      <header className="panel-header">
        <div>
          <h2>{tx(lang, "Strategy backtest", "策略回測")}</h2>
          <p className="muted">
            {symbol ||
              tx(
                lang,
                "Choose a symbol in the chart first.",
                "請先在圖表選擇股票代號。",
              )}
          </p>
        </div>
      </header>
      <div className="panel-body stack">
        <div className="form-grid research-backtest-general">
          <label className="field">
            <span>{tx(lang, "History", "歷史期間")}</span>
            <select
              className="select"
              value={settings.period}
              onChange={(event) => updateTop({ period: event.target.value })}
            >
              <option value="1y">{tx(lang, "1 year", "1 年")}</option>
              <option value="2y">{tx(lang, "2 years", "2 年")}</option>
              <option value="5y">{tx(lang, "5 years", "5 年")}</option>
              <option value="max">
                {tx(lang, "Maximum available", "全部可用資料")}
              </option>
            </select>
          </label>
          <label className="field">
            <span>{tx(lang, "Initial capital (USD)", "初始資金（美元）")}</span>
            <input
              className="input"
              type="number"
              min="1"
              max="1000000000000"
              step="any"
              value={settings.initialCapital}
              onChange={(event) =>
                updateTop({ initialCapital: Number(event.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>{tx(lang, "Evaluation frequency", "評估頻率")}</span>
            <select
              className="select"
              value={settings.frequency}
              onChange={(event) => updateTop({ frequency: event.target.value })}
            >
              <option value="daily">{tx(lang, "Daily", "每日")}</option>
              <option value="monthly">{tx(lang, "Monthly", "每月")}</option>
            </select>
          </label>
        </div>

        <div className="research-rule-grid">
          <RuleEditor
            lang={lang}
            name="entry"
            value={settings.entry}
            onChange={(patch) => updateRule("entry", patch)}
          />
          <RuleEditor
            lang={lang}
            name="exit"
            value={settings.exit}
            onChange={(patch) => updateRule("exit", patch)}
          />
        </div>

        <fieldset className="research-exit-settings">
          <legend>{tx(lang, "Exit staging", "出場分批")}</legend>
          <div className="form-grid">
            <label className="field">
              <span>{tx(lang, "Exit mode", "出場模式")}</span>
              <select
                className="select"
                value={settings.exitMode}
                onChange={(event) =>
                  updateTop({ exitMode: event.target.value })
                }
              >
                <option value="immediate">
                  {tx(lang, "Immediate", "立即出場")}
                </option>
                <option value="staged">{tx(lang, "Staged", "分批出場")}</option>
              </select>
            </label>
            {settings.exitMode === "staged" && (
              <>
                <label className="field">
                  <span>{tx(lang, "Number of exit periods", "出場期數")}</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={settings.exitPeriods}
                    onChange={(event) =>
                      updateTop({ exitPeriods: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>
                    {tx(lang, "Staged-exit frequency", "分批出場頻率")}
                  </span>
                  <select
                    className="select"
                    value={settings.exitFrequency}
                    onChange={(event) =>
                      updateTop({ exitFrequency: event.target.value })
                    }
                  >
                    <option value="weekly">{tx(lang, "Weekly", "每週")}</option>
                    <option value="monthly">
                      {tx(lang, "Monthly", "每月")}
                    </option>
                  </select>
                </label>
              </>
            )}
          </div>
        </fieldset>

        <Notice tone="warning">
          <strong>{tx(lang, "Simulation limitations", "模擬限制")}</strong>
          <ul className="research-caveat-list">
            <li>
              {tx(
                lang,
                "Single-symbol, long-only, all-cash entries with fractional shares. Signals fill at that bar’s close; any remaining position is liquidated at the final close.",
                "單一股票、僅做多、全額投入，允許零股。訊號以該根 K 線收盤價成交；剩餘部位於最後收盤價平倉。",
              )}
            </li>
            <li>
              {tx(
                lang,
                "No commissions, slippage, partial fills, or short selling are modeled.",
                "未模擬佣金、滑價、部分成交或放空。",
              )}
            </li>
            <li>
              {tx(
                lang,
                "Daily evaluation detects a transition into the rule; monthly evaluation checks the first available bar of each calendar month.",
                "每日評估偵測規則由不符合轉為符合；每月評估檢查該月第一根可用 K 線。",
              )}
            </li>
            <li>
              {tx(
                lang,
                "Staged exits create multiple trade records; trade-level statistics may not represent complete entry-to-exit cycles. Sharpe uses daily annualization.",
                "分批出場會建立多筆交易紀錄；逐筆統計未必代表完整進出場週期。夏普比率採每日年化係數。",
              )}
            </li>
            <li>
              {tx(
                lang,
                "Research only. Results never create or submit orders.",
                "僅供研究。回測結果不會建立或送出訂單。",
              )}
            </li>
          </ul>
        </Notice>

        {storageError && (
          <Notice tone="error">
            {tx(
              lang,
              "Backtest settings could not be saved in browser storage.",
              "無法將回測設定儲存至瀏覽器。",
            )}
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="row research-actions">
          <button
            className="button primary"
            type="button"
            onClick={runBacktest}
            disabled={busy || !symbol}
          >
            {busy
              ? tx(lang, "Running…", "回測中…")
              : tx(lang, "Run backtest", "執行回測")}
          </button>
          {busy && (
            <>
              <span className="muted" role="status" aria-live="polite">
                {status === "cancelling"
                  ? tx(lang, "Cancelling backtest…", "正在取消回測…")
                  : tx(
                      lang,
                      "Fetching history and simulating strategy…",
                      "正在取得歷史資料並模擬策略…",
                    )}
              </span>
              <button
                className="button ghost"
                type="button"
                onClick={cancelBacktest}
                disabled={status === "cancelling"}
              >
                {tx(lang, "Cancel", "取消")}
              </button>
            </>
          )}
        </div>

        {status === "cancelled" && (
          <div className="muted" role="status">
            {tx(
              lang,
              "Backtest cancelled. No result was created.",
              "回測已取消，未建立結果。",
            )}
          </div>
        )}
        {!result && status === "idle" && (
          <div className="empty">
            {tx(
              lang,
              "Configure rules, then run to request a real historical simulation.",
              "設定規則後執行，取得真實歷史資料模擬結果。",
            )}
          </div>
        )}
        {result && (
          <section
            className="research-backtest-results"
            aria-label={tx(lang, "Backtest results", "回測結果")}
          >
            <div className="row research-results-heading">
              <h3>
                {tx(lang, "Results", "結果")} · {symbol}
              </h3>
              <span className="badge">
                {tx(
                  lang,
                  result.settings.period === "max"
                    ? "Maximum available"
                    : `${Number.parseInt(result.settings.period, 10)} year${result.settings.period === "1y" ? "" : "s"}`,
                  result.settings.period === "max"
                    ? "全部可用資料"
                    : `${Number.parseInt(result.settings.period, 10)} 年`,
                )}
                {" · "}
                {tx(
                  lang,
                  result.settings.frequency === "daily" ? "Daily" : "Monthly",
                  result.settings.frequency === "daily" ? "每日" : "每月",
                )}
              </span>
            </div>
            {resultStale && (
              <Notice tone="warning">
                {tx(
                  lang,
                  "Settings changed after this run. Results below use the recorded settings, not current form values.",
                  "本次回測後設定已變更。以下結果採用本次紀錄設定，而非目前表單值。",
                )}
              </Notice>
            )}
            <p className="muted research-run-config">
              {tx(
                lang,
                `Capital ${money(result.settings.initialCapital)} · Entry ${describeRule(result.settings.entry, lang)} · Exit ${describeRule(result.settings.exit, lang)}`,
                `初始資金 ${money(result.settings.initialCapital)} · 進場 ${describeRule(result.settings.entry, lang)} · 出場 ${describeRule(result.settings.exit, lang)}`,
              )}
            </p>
            <p className="muted research-run-config">
              {result.settings.exitMode === "staged"
                ? tx(
                    lang,
                    `Staged over ${result.settings.exitPeriods} ${result.settings.exitFrequency} periods.`,
                    `分 ${result.settings.exitPeriods} 個${result.settings.exitFrequency === "weekly" ? "每週" : "每月"}期間出場。`,
                  )
                : tx(lang, "Immediate exit.", "立即出場。")}
            </p>
            <dl className="metrics research-metrics">
              {labels.map(([key, label]) => (
                <div className="metric" key={key}>
                  <dt>{label}</dt>
                  <dd>{metricValue(key, result.data.metrics[key])}</dd>
                </div>
              ))}
            </dl>

            <section className="panel research-equity-panel">
              <div className="panel-header">
                <h3>{tx(lang, "Equity curve", "資產曲線")}</h3>
              </div>
              {result.data.equity.length ? (
                <svg
                  className="research-equity-chart"
                  viewBox="0 0 600 160"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={tx(lang, "Backtest equity curve", "回測資產曲線")}
                >
                  <path
                    d={equityPath(result.data.equity)}
                    fill="none"
                    className="research-equity-line"
                  />
                </svg>
              ) : (
                <div className="empty">
                  {tx(
                    lang,
                    "No equity points returned.",
                    "服務未回傳資產曲線資料。",
                  )}
                </div>
              )}
              <div className="row research-equity-range">
                <span className="muted">
                  {result.data.equity[0]?.time || "—"}
                </span>
                <span className="muted">
                  {money(result.data.equity.at(-1)?.value)}
                </span>
                <span className="muted">
                  {result.data.equity.at(-1)?.time || "—"}
                </span>
              </div>
            </section>

            <section className="research-actions-table">
              <div className="row research-results-heading">
                <h3>{tx(lang, "Trade actions", "交易動作")}</h3>
                <span className="badge">{result.data.actions.length}</span>
              </div>
              {result.data.actions.length === 0 ? (
                <div className="empty">
                  {tx(
                    lang,
                    "No trade actions in this period.",
                    "此期間沒有交易動作。",
                  )}
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{tx(lang, "Date", "日期")}</th>
                        <th scope="col">{tx(lang, "Action", "動作")}</th>
                        <th scope="col">{tx(lang, "Price", "價格")}</th>
                        <th scope="col">{tx(lang, "Quantity", "數量")}</th>
                        <th scope="col">{tx(lang, "Reason", "原因")}</th>
                        <th scope="col">{tx(lang, "P&L", "損益")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.actions.map((action, index) => (
                        <tr key={`${action.time}-${action.side}-${index}`}>
                          <td>{action.time || "—"}</td>
                          <td>
                            <span
                              className={`badge ${action.side === "BUY" ? "positive" : "negative"}`}
                            >
                              {action.side === "BUY"
                                ? tx(lang, "BUY", "買入")
                                : action.side === "SELL"
                                  ? tx(lang, "SELL", "賣出")
                                  : "—"}
                            </span>
                          </td>
                          <td>{money(action.price)}</td>
                          <td>{formatNumber(action.quantity, 6)}</td>
                          <td>{translateReason(action.reason, lang)}</td>
                          <td>{money(action.pnl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <p className="muted">
              {tx(
                lang,
                "Chart actions sent to the main chart. They are annotations only.",
                "交易動作已送至主圖表，僅作為標記。",
              )}
            </p>
          </section>
        )}
      </div>
    </section>
  );
}
