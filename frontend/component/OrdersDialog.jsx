import React, { useState } from "react";
import { Empty, Notice, Icon, tx, money, number } from "../src/ui.jsx";

export default function OrdersDialog({
  lang,
  mode,
  orders = [],
  history = [],
  error,
  writable,
  onSelect,
  onEdit,
  onCancel,
}) {
  const [showHistory, setShowHistory] = useState(false),
    [busy, setBusy] = useState(null),
    [actionError, setActionError] = useState(null);
  const rows = showHistory ? history : orders;
  async function cancel(order) {
    if (
      !confirm(
        tx(
          lang,
          `Cancel ${order.side} ${order.quantity} ${order.symbol}? Related bracket legs may also be cancelled.`,
          `取消 ${order.side} ${order.quantity} 股 ${order.symbol}？相關括號單亦可能取消。`,
        ),
      )
    )
      return;
    setBusy(order.id);
    setActionError(null);
    try {
      await onCancel(order.id, mode);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="orders-content">
      <div className="account-context row spread">
        <div className="segmented">
          <button
            className={!showHistory ? "active" : ""}
            onClick={() => setShowHistory(false)}
          >
            {tx(lang, "Pending", "待成交")} <span>{orders.length}</span>
          </button>
          {mode === "paper" && (
            <button
              className={showHistory ? "active" : ""}
              onClick={() => setShowHistory(true)}
            >
              {tx(lang, "History", "歷史")} <span>{history.length}</span>
            </button>
          )}
        </div>
        <small className="muted">
          {tx(
            lang,
            "Submission ≠ fill · Dragging a price opens review",
            "提交 ≠ 成交 · 拖曳價格開啟確認",
          )}
        </small>
      </div>
      <Notice tone="error">{actionError || error}</Notice>
      {rows.length ? (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                {[
                  ["Symbol / reference", "股票／編號"],
                  ["Side", "方向"],
                  ["Qty", "股數"],
                  ["Type / TIF", "類型／效期"],
                  ["Price", "價格"],
                  ["Status", "狀態"],
                  ["Actions", "操作"],
                ].map(([en, zh]) => (
                  <th key={en}>{tx(lang, en, zh)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id}>
                  <td>
                    <button
                      className="symbol-link"
                      onClick={() => onSelect(order.symbol)}
                    >
                      {order.symbol}
                    </button>
                    <small className="order-ref" title={String(order.id)}>
                      {String(order.id).slice(-10)}
                      {order.parentId
                        ? ` ↳ ${String(order.parentId).slice(-6)}`
                        : ""}
                    </small>
                  </td>
                  <td
                    className={order.side === "BUY" ? "positive" : "negative"}
                  >
                    {tx(
                      lang,
                      order.side,
                      order.side === "BUY" ? "買入" : "賣出",
                    )}
                  </td>
                  <td>
                    {number(order.quantity)}
                    {order.filled > 0 && (
                      <small className="order-ref">
                        {order.filled} {tx(lang, "filled", "已成交")}
                      </small>
                    )}
                  </td>
                  <td>
                    {order.type || "LMT"} · {order.tif}
                    <small className="order-ref">
                      {order.bracketRole || ""}
                    </small>
                  </td>
                  <td>
                    {money(
                      order.type === "STP" ? order.stopPrice : order.limitPrice,
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${String(order.status).toLowerCase() === "filled" ? "teal" : ""}`}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td>
                    {!showHistory && (
                      <div className="row">
                        <button
                          className="button ghost small"
                          disabled={
                            !writable || !!busy || order.manageable === false
                          }
                          onClick={() => onEdit(order)}
                        >
                          <Icon name="edit" size={13} />
                          {tx(lang, "Modify", "修改")}
                        </button>
                        <button
                          className="button ghost small negative"
                          disabled={
                            !writable || !!busy || order.manageable === false
                          }
                          onClick={() => cancel(order)}
                        >
                          {busy === order.id ? "…" : tx(lang, "Cancel", "取消")}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon="book"
          title={tx(
            lang,
            showHistory ? "No completed orders yet" : "No pending orders",
            showHistory ? "尚無已完成委託" : "沒有待成交委託",
          )}
        >
          {tx(
            lang,
            mode === "paper"
              ? "Paper Orders stay in this browser and never reach IB."
              : "Open orders from your IB connection appear here.",
            mode === "paper"
              ? "模擬委託僅儲存於此瀏覽器，永不送至 IB。"
              : "IB 連線的待成交委託將顯示於此。",
          )}
        </Empty>
      )}
    </div>
  );
}
