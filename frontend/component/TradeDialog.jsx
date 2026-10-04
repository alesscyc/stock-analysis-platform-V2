import React, { useEffect, useState } from "react";
import { Modal, Notice, tx, money, number, Icon } from "../src/ui.jsx";
import { validateTicket } from "../src/orderValidation.js";

export default function TradeDialog({
  lang,
  ticket,
  mode,
  connected,
  writable,
  paperError,
  onClose,
  onSubmit,
  onPreview,
}) {
  const editing = ticket.id != null,
    stop = editing && ticket.type === "STP";
  const [form, setForm] = useState({
    symbol: ticket.symbol,
    side: ticket.side || "BUY",
    quantity: ticket.quantity || 1,
    limitPrice: ticket.limitPrice || "",
    stopPrice: ticket.stopPrice || "",
    tif: ticket.tif || "DAY",
    takeProfit: ticket.takeProfit || "",
    stopLoss: ticket.stopLoss || "",
  });
  const [bracket, setBracket] = useState(
    !!(ticket.takeProfit || ticket.stopLoss),
  );
  const [stage, setStage] = useState("edit"),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [acknowledged, setAcknowledged] = useState(false);
  const invalidMode = ticket.mode !== mode || (mode === "live" && !connected);
  const blocked = invalidMode || (mode === "paper" && !writable);
  const change = (key, value) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setStage("edit");
    setError(null);
    setAcknowledged(false);
  };
  useEffect(() => {
    onPreview({
      ...form,
      ...(bracket ? {} : { takeProfit: "", stopLoss: "" }),
      editing,
    });
    return () => onPreview(null);
  }, [form, bracket, onPreview]);
  async function submit(event) {
    event.preventDefault();
    setError(null);
    try {
      if (blocked)
        throw new Error(
          tx(
            lang,
            "Trading mode or account availability changed. Close and reopen this ticket.",
            "交易模式或帳戶狀態已變更，請關閉後重新開啟委託單。",
          ),
        );
      let payload;
      if (editing) {
        const value = Number(stop ? form.stopPrice : form.limitPrice);
        if (!Number.isFinite(value) || value <= 0)
          throw new Error(
            tx(lang, "Enter a positive price.", "請輸入正數價格。"),
          );
        payload = { [stop ? "stopPrice" : "limitPrice"]: value };
      } else
        payload = validateTicket(
          {
            ...form,
            ...(bracket ? {} : { takeProfit: undefined, stopLoss: undefined }),
          },
          mode,
        );
      if (stage !== "review") {
        setStage("review");
        return;
      }
      if (mode === "live" && !acknowledged)
        throw new Error(
          tx(
            lang,
            "Acknowledge the live order before submitting.",
            "提交前請確認真實委託風險。",
          ),
        );
      setBusy(true);
      await onSubmit(payload, editing ? ticket.id : null, ticket.mode);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      nonModal
      title={tx(
        lang,
        editing ? "Review order modification" : "New limit order",
        editing ? "確認修改委託" : "新增限價委託",
      )}
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={submit} className="stack trade-form">
        <div className="row spread">
          <span className={`badge ${mode === "live" ? "warning" : "teal"}`}>
            <Icon name="shield" size={13} />
            {tx(
              lang,
              mode === "live"
                ? "LIVE · IB CONNECTION"
                : "PAPER · LOCAL SIMULATION",
              mode === "live" ? "LIVE · IB 連線" : "模擬 · 本機帳戶",
            )}
          </span>
          <span className="muted">USD · {stop ? "STP" : "LMT"}</span>
        </div>
        {invalidMode && (
          <Notice tone="error">
            {tx(
              lang,
              "Connection or trading mode changed. This ticket cannot be submitted; reopen it in the intended mode.",
              "連線或交易模式已變更，此委託單無法提交，請以所需模式重新開啟。",
            )}
          </Notice>
        )}
        {mode === "paper" && !writable && (
          <Notice tone="error">
            {paperError ||
              tx(
                lang,
                "Paper Account is read-only or unavailable in this tab.",
                "此分頁的模擬帳戶為唯讀或無法使用。",
              )}
          </Notice>
        )}
        {ticket.fromAI && (
          <Notice>
            {tx(
              lang,
              "AI draft, not an instruction. Independently verify the symbol, prices, and quantity.",
              "AI 草稿並非交易指示，請獨立確認代號、價格和股數。",
            )}
          </Notice>
        )}
        <div className="trade-symbol">
          <div className="symbol-avatar">{form.symbol?.slice(0, 1)}</div>
          <div>
            <h3>{form.symbol}</h3>
            <span className="muted">
              {tx(lang, "Whole-share limit order", "整股限價委託")}
            </span>
          </div>
        </div>
        {stage === "edit" ? (
          <>
            {!editing && (
              <div className="segmented trade-side">
                <button
                  type="button"
                  className={form.side === "BUY" ? "active buy" : ""}
                  onClick={() => change("side", "BUY")}
                >
                  {tx(lang, "Buy", "買入")}
                </button>
                <button
                  type="button"
                  className={form.side === "SELL" ? "active sell" : ""}
                  onClick={() => change("side", "SELL")}
                >
                  {tx(lang, "Sell", "賣出")}
                </button>
              </div>
            )}
            <div className="form-grid">
              <label className="field">
                {tx(lang, "Quantity · shares", "数量 · 股")}
                <input
                  className="input"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={form.quantity}
                  disabled={editing}
                  onChange={(e) => change("quantity", e.target.value)}
                />
              </label>
              <label className="field">
                {tx(
                  lang,
                  stop ? "Stop price · USD" : "Limit price · USD",
                  stop ? "停損觸發價 · USD" : "限價 · USD",
                )}
                <input
                  className="input"
                  type="number"
                  min="0.0001"
                  step="any"
                  required
                  value={stop ? form.stopPrice : form.limitPrice}
                  onChange={(e) =>
                    change(stop ? "stopPrice" : "limitPrice", e.target.value)
                  }
                  autoFocus
                />
              </label>
            </div>
            <label className="field">
              {tx(lang, "Time in force", "有效期限")}
              <select
                className="select"
                value={form.tif}
                disabled={editing}
                onChange={(e) => change("tif", e.target.value)}
              >
                <option value="DAY">DAY · {tx(lang, "Day", "當日")}</option>
                <option value="GTC">
                  GTC · {tx(lang, "Until cancelled", "直到取消")}
                </option>
                <option value="IOC">
                  IOC · {tx(lang, "Immediate or cancel", "立即成交或取消")}
                </option>
                <option value="FOK">
                  FOK · {tx(lang, "Fill or kill", "全部成交或取消")}
                </option>
              </select>
            </label>
            {!editing && (
              <>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={bracket}
                    onChange={(e) => {
                      setBracket(e.target.checked);
                      setStage("edit");
                    }}
                  />
                  {tx(lang, "Add bracket exits", "附加括號出場單")}
                  <span className="muted">{tx(lang, "Optional", "選填")}</span>
                </label>
                {bracket && (
                  <div className="form-grid bracket-fields">
                    <label className="field">
                      {tx(lang, "Take-profit · USD", "停利 · USD")}
                      <input
                        className="input"
                        type="number"
                        min="0.0001"
                        step="any"
                        value={form.takeProfit}
                        onChange={(e) => change("takeProfit", e.target.value)}
                      />
                    </label>
                    <label className="field">
                      {tx(lang, "Stop-loss · USD", "停損 · USD")}
                      <input
                        className="input"
                        type="number"
                        min="0.0001"
                        step="any"
                        value={form.stopLoss}
                        onChange={(e) => change("stopLoss", e.target.value)}
                      />
                    </label>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <div className="review-card">
            <h3>{tx(lang, "Confirm the details", "確認委託詳情")}</h3>
            <dl>
              <dt>{tx(lang, "Action", "操作")}</dt>
              <dd>
                {editing ? tx(lang, "Modify price", "修改價格") : form.side}{" "}
                {number(Number(form.quantity))} {form.symbol}
              </dd>
              <dt>{tx(lang, "Price", "價格")}</dt>
              <dd>{money(Number(stop ? form.stopPrice : form.limitPrice))}</dd>
              <dt>{tx(lang, "Time in force", "有效期限")}</dt>
              <dd>{form.tif}</dd>
              {bracket && (
                <>
                  <dt>{tx(lang, "Take-profit / stop-loss", "停利／停損")}</dt>
                  <dd>
                    {form.takeProfit ? money(Number(form.takeProfit)) : "—"} /{" "}
                    {form.stopLoss ? money(Number(form.stopLoss)) : "—"}
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}
        <div className="trade-total">
          <span>{tx(lang, "Limit notional", "限價委託金額")}</span>
          <strong>
            {money(
              Number(form.quantity) *
                Number(stop ? form.stopPrice : form.limitPrice),
            )}
          </strong>
        </div>
        <p className="microcopy">
          {mode === "paper"
            ? tx(
                lang,
                "Simulation only. Quotes drive full fills while this app is open. No short selling, borrowing, or commissions. DAY expires at local midnight.",
                "僅供模擬。應用程式開啟時，行情觸發全額成交。不支援放空、融資或手續費。DAY 於本機午夜到期。",
              )
            : tx(
                lang,
                "Live Mode sends to your configured IB connection, which may be a real account. Submission is not confirmation of a fill. The display-account selector does not change the destination.",
                "LIVE 模式送至設定的 IB 連線，可能為真實帳戶。提交不代表成交。檢視帳戶選單不會改變委託目的帳戶。",
              )}
        </p>
        {stage === "review" && mode === "live" && (
          <label className="check-row live-ack">
            <input
              type="checkbox"
              required
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            {tx(
              lang,
              "I reviewed this order and authorize sending it to IB.",
              "我已確認此委託並授權送至 IB。",
            )}
          </label>
        )}
        <Notice tone="error">{error}</Notice>
        <div className="row dialog-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => (stage === "review" ? setStage("edit") : onClose())}
          >
            {tx(
              lang,
              stage === "review" ? "Back to edit" : "Cancel",
              stage === "review" ? "返回編輯" : "取消",
            )}
          </button>
          <button
            type="submit"
            className={`button ${mode === "live" && stage === "review" ? "danger" : "primary"}`}
            disabled={
              busy ||
              blocked ||
              (stage === "review" && mode === "live" && !acknowledged)
            }
          >
            {busy
              ? tx(lang, "Submitting…", "提交中…")
              : tx(
                  lang,
                  stage === "review"
                    ? editing
                      ? "Confirm modification"
                      : mode === "paper"
                        ? "Place Paper Order"
                        : "Send order to IB"
                    : "Review order",
                  stage === "review"
                    ? editing
                      ? "確認修改"
                      : mode === "paper"
                        ? "提交模擬委託"
                        : "送出 IB 委託"
                    : "檢閱委託",
                )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
