import React from "react";
import { Empty, Icon, Notice, tx, money, number, percent } from "../src/ui.jsx";

export default function PortfolioDialog({
  lang,
  mode,
  account,
  accounts = [],
  displayAccount,
  onAccountChange,
  connected,
  error,
  onSelect,
  refreshing,
  onRefresh,
}) {
  const summary = account?.summary || {},
    positions = account?.positions || [],
    net = summary.netLiquidation;
  const allocation = positions
    .map((p) => ({ name: p.symbol, value: Math.abs(p.marketValue || 0) }))
    .filter((p) => p.value > 0);
  if (summary.cash > 0)
    allocation.push({ name: tx(lang, "Cash", "現金"), value: summary.cash });
  const total = allocation.reduce((s, p) => s + p.value, 0),
    palette = [
      "#60cfad",
      "#729ce7",
      "#b094e5",
      "#d6ad69",
      "#db8999",
      "#718498",
    ];
  let offset = 0;
  const gradient = allocation
    .map((p, i) => {
      const start = offset;
      offset += (p.value / total) * 100;
      return `${palette[i % palette.length]} ${start}% ${offset}%`;
    })
    .join(",");
  const stale =
    (mode === "live" || positions.length > 0) &&
    account?.asOf &&
    Date.now() - Date.parse(account.asOf) > 120000;
  const warnings = [...(account?.warnings || [])];
  if (stale)
    warnings.push(
      tx(lang, "Snapshot is older than two minutes.", "快照已超過兩分鐘。"),
    );
  if (net > 0 && positions.some((p) => Math.abs(p.marketValue) / net > 0.4))
    warnings.push(
      tx(
        lang,
        "Concentration: one position exceeds 40% of account value.",
        "集中風險：單一持倉超過帳戶價值的 40%。",
      ),
    );
  if (
    mode === "live" &&
    net > 0 &&
    Number.isFinite(summary.excessLiquidity) &&
    summary.excessLiquidity / net < 0.1
  )
    warnings.push(
      tx(
        lang,
        "Excess liquidity is below 10% of account value.",
        "剩餘流動性低於帳戶價值的 10%。",
      ),
    );
  if (mode === "live" && net > 0 && summary.maintenanceMargin / net > 0.5)
    warnings.push(
      tx(
        lang,
        "Maintenance margin exceeds 50% of account value.",
        "維持保證金超過帳戶價值的 50%。",
      ),
    );
  return (
    <div className="portfolio-content">
      <div className="account-context row spread">
        <div className="row">
          <span className={`badge ${mode === "paper" ? "teal" : "warning"}`}>
            {tx(
              lang,
              mode === "paper" ? "LOCAL PAPER ACCOUNT" : "IB ACCOUNT",
              mode === "paper" ? "本機模擬帳戶" : "IB 帳戶",
            )}
          </span>
          {mode === "live" && (
            <label className="row muted">
              {tx(lang, "View", "檢視")}
              <select
                className="select small"
                aria-label={tx(
                  lang,
                  "Display account (read-only selection)",
                  "檢視帳戶（僅供讀取）",
                )}
                value={displayAccount || ""}
                onChange={(e) => onAccountChange(e.target.value)}
              >
                <option value="">
                  {tx(lang, "Default account", "預設帳戶")}
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || `••••${a.id.slice(-4)}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="row muted">
          <span
            className={`status-dot ${mode === "live" && !connected ? "offline" : ""}`}
          />
          <span>
            {account?.asOf
              ? new Date(account.asOf).toLocaleTimeString(
                  lang === "zh-TW" ? "zh-TW" : "en-US",
                )
              : tx(lang, "No snapshot", "尚無快照")}
          </span>
          <button
            className="button ghost icon-button small"
            disabled={refreshing}
            onClick={onRefresh}
            aria-label={tx(lang, "Refresh account", "重新整理帳戶")}
          >
            <Icon name="refresh" size={14} />
          </button>
        </div>
      </div>
      <Notice tone="error">{error}</Notice>
      {mode === "live" && (
        <p className="microcopy routing-note">
          {tx(
            lang,
            "Display selection is read-only. New orders still use the configured IB routing account.",
            "此選擇僅供檢視。新委託仍送至設定的 IB 下單帳戶。",
          )}
        </p>
      )}
      {!!warnings.length && (
        <Notice tone="warning">
          {warnings.map((w, i) => (
            <div key={i}>
              {typeof w === "string" ? w : w.message || JSON.stringify(w)}
            </div>
          ))}
        </Notice>
      )}
      <div className="account-overview">
        <div className="account-metrics">
          <div className="metric main-metric">
            <span>{tx(lang, "Net account value", "帳戶淨值")}</span>
            <strong>{money(net)}</strong>
            <small className="muted">
              {tx(
                lang,
                mode === "paper"
                  ? "Simulated · USD"
                  : `Reported · ${account?.currency || "USD"}`,
                mode === "paper"
                  ? "模擬 · USD"
                  : `帳戶回報 · ${account?.currency || "USD"}`,
              )}
            </small>
          </div>
          <div className="metric">
            <span>{tx(lang, "Cash balance", "現金餘額")}</span>
            <strong>{money(summary.cash)}</strong>
          </div>
          <div className="metric">
            <span>{tx(lang, "Buying power", "購買力")}</span>
            <strong>{money(summary.buyingPower)}</strong>
          </div>
          <div className="metric">
            <span>{tx(lang, "Unrealized P&L", "未實現損益")}</span>
            <strong
              className={
                (summary.unrealizedPnl || 0) >= 0 ? "positive" : "negative"
              }
            >
              {money(summary.unrealizedPnl)}
            </strong>
          </div>
          <div className="metric">
            <span>{tx(lang, "Realized P&L", "已實現損益")}</span>
            <strong
              className={
                (summary.realizedPnl || 0) >= 0 ? "positive" : "negative"
              }
            >
              {money(summary.realizedPnl)}
            </strong>
          </div>
        </div>
        <div className="allocation">
          <div
            className="allocation-ring"
            style={{
              background: gradient ? `conic-gradient(${gradient})` : "#273447",
            }}
            role="img"
            aria-label={tx(lang, "Account allocation", "帳戶配置")}
          >
            <div>
              <Icon name="wallet" size={19} />
              <span>{tx(lang, "Allocation", "配置")}</span>
            </div>
          </div>
          <div className="allocation-legend">
            {allocation.slice(0, 5).map((p, i) => (
              <div key={p.name}>
                <i style={{ background: palette[i % palette.length] }} />
                <span>{p.name}</span>
                <b>{percent(p.value / total).replace("+", "")}</b>
              </div>
            ))}
            {allocation.length > 5 && (
              <small className="muted">
                +{allocation.length - 5} {tx(lang, "more", "項")}
              </small>
            )}
          </div>
        </div>
      </div>
      {mode === "live" && (
        <div className="risk-metrics">
          <span>
            {tx(lang, "Available funds", "可用資金")}{" "}
            <b>{money(summary.availableFunds)}</b>
          </span>
          <span>
            {tx(lang, "Excess liquidity", "剩餘流動性")}{" "}
            <b>{money(summary.excessLiquidity)}</b>
          </span>
          <span>
            {tx(lang, "Maintenance margin", "維持保證金")}{" "}
            <b>{money(summary.maintenanceMargin)}</b>
          </span>
          <span>
            {tx(lang, "Gross position value", "持倉總值")}{" "}
            <b>{money(summary.grossPositionValue)}</b>
          </span>
        </div>
      )}
      {positions.length ? (
        <div className="table-scroll">
          <table className="table holdings-table">
            <thead>
              <tr>
                {[
                  ["Symbol", "股票"],
                  ["Shares", "股數"],
                  ["Avg. cost", "平均成本"],
                  ["Price", "價格"],
                  ["Market value", "市值"],
                  ["Unrealized P&L", "未實現損益"],
                  ["Weight", "權重"],
                ].map(([en, zh]) => (
                  <th key={en}>{tx(lang, en, zh)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.symbol}>
                  <td>
                    <button
                      className="symbol-link"
                      onClick={() => onSelect(p.symbol)}
                    >
                      {p.symbol}
                      <Icon name="arrow" size={12} />
                    </button>
                  </td>
                  <td>{number(p.quantity)}</td>
                  <td>{money(p.averageCost)}</td>
                  <td>{money(p.price)}</td>
                  <td>{money(p.marketValue)}</td>
                  <td
                    className={
                      (p.unrealizedPnl || 0) >= 0 ? "positive" : "negative"
                    }
                  >
                    {money(p.unrealizedPnl)}
                  </td>
                  <td>
                    {net > 0
                      ? percent(p.marketValue / net).replace("+", "")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="account-empty">
          <Icon name="wallet" size={24} />
          <div>
            <strong>{tx(lang, "A clean slate", "全新開始")}</strong>
            <span>
              {tx(
                lang,
                mode === "paper"
                  ? "Your Paper Account is ready. Filled positions will appear here."
                  : "No stock holdings in this snapshot.",
                mode === "paper"
                  ? "模擬帳戶已準備好，成交持倉將顯示於此。"
                  : "此快照中沒有股票持倉。",
              )}
            </span>
          </div>
          <span className="badge">
            {tx(
              lang,
              mode === "paper" ? "NO REAL MONEY" : "READ ONLY",
              mode === "paper" ? "非真實資金" : "僅供讀取",
            )}
          </span>
        </div>
      )}
    </div>
  );
}
