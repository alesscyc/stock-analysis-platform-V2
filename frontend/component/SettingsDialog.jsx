import React, { useState } from "react";
import { Modal, Notice, Icon, tx, money } from "../src/ui.jsx";
import { DEMO } from "../src/api.js";

export default function SettingsDialog({
  lang,
  setLang,
  paper,
  health,
  preference,
  onClose,
  onReset,
}) {
  const [cash, setCash] = useState(100000),
    [resetOpen, setResetOpen] = useState(false),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [success, setSuccess] = useState(false);
  async function reset(event) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    if (confirmation !== "RESET") return;
    const value = Number(cash);
    if (!Number.isFinite(value) || value <= 0 || value > 1e12) {
      setError(
        tx(
          lang,
          "Starting cash must be between $0.01 and $1 trillion.",
          "起始資金必須介於 $0.01 至 1 兆美元。",
        ),
      );
      return;
    }
    setBusy(true);
    try {
      await onReset(value);
      setResetOpen(false);
      setConfirmation("");
      setSuccess(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function downloadAccount() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(paper.account, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `paper-account-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Modal
      title={tx(lang, "Workspace settings", "工作區設定")}
      onClose={() => !busy && onClose()}
      wide
    >
      <div className="settings-grid">
        <section className="stack">
          <h3>{tx(lang, "Preferences", "偏好設定")}</h3>
          <label className="field">
            {tx(lang, "Language", "語言")}
            <select
              className="select"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            >
              <option value="en">English</option>
              <option value="zh-TW">繁體中文</option>
            </select>
          </label>
          <div className="setting-card">
            <Icon name="shield" />
            <div>
              <strong>
                {tx(lang, "Trading mode preference", "交易模式偏好")}
              </strong>
              <p>{preference === "live" ? "Live / IB" : "Paper / 模擬"}</p>
              <small className="muted">
                {tx(
                  lang,
                  "Disconnection forces Paper Mode. Your preference is retained; reconnecting can restore Live Mode. Paper Orders never migrate to IB.",
                  "斷線時強制使用模擬模式，但保留偏好；重新連線可能恢復 LIVE 模式。模擬委託永不轉移至 IB。",
                )}
              </small>
            </div>
          </div>
          <h3>{tx(lang, "Local Paper Account", "本機模擬帳戶")}</h3>
          <p className="muted">
            {tx(
              lang,
              `Starting cash: ${money(paper.account?.startingCash)}. Browser-local data. Keep a backup before deleting browser storage.`,
              `起始資金：${money(paper.account?.startingCash)}。資料僅存於瀏覽器，刪除瀏覽器資料前請備份。`,
            )}
          </p>
          <Notice tone={paper.error ? "error" : "info"}>
            {paper.error ||
              tx(
                lang,
                paper.primary
                  ? "This is the primary tab. Trading writes are protected by browser locks."
                  : "This tab is read-only. Another tab owns the Paper Account, or browser locks are unavailable.",
                paper.primary
                  ? "此為主要分頁，交易寫入受瀏覽器鎖定保護。"
                  : "此分頁為唯讀，其他分頁持有帳戶或瀏覽器不支援鎖定。",
              )}
          </Notice>
          <div className="row">
            <button
              className="button"
              onClick={downloadAccount}
              disabled={!paper.account}
            >
              {tx(lang, "Export account JSON", "匯出帳戶 JSON")}
            </button>
            <button
              className="button danger"
              onClick={() => setResetOpen(!resetOpen)}
              disabled={!paper.primary || DEMO}
            >
              {tx(lang, "Reset Paper Account", "重設模擬帳戶")}
            </button>
          </div>
          {resetOpen && (
            <form className="stack reset-form" onSubmit={reset}>
              <Notice tone="error">
                {tx(
                  lang,
                  "This permanently deletes Paper holdings, orders, and history in this browser. IB accounts are unaffected. Export a backup first.",
                  "此操作會永久刪除此瀏覽器內的模擬持倉、委託與歷史，IB 帳戶不受影響。請先匯出備份。",
                )}
              </Notice>
              <label className="field">
                {tx(lang, "New starting cash · USD", "新的起始資金 · USD")}
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  max="1000000000000"
                  step="0.01"
                  required
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                />
              </label>
              <label className="field">
                {tx(lang, "Type RESET to confirm", "輸入 RESET 以確認")}
                <input
                  className="input"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                className="button danger"
                disabled={busy || confirmation !== "RESET"}
              >
                {tx(
                  lang,
                  busy ? "Resetting…" : "Permanently reset simulation",
                  busy ? "重設中…" : "永久重設模擬資料",
                )}
              </button>
            </form>
          )}
          <Notice tone="error">{error}</Notice>
          {success && (
            <Notice>
              {tx(
                lang,
                "Paper Account reset. No IB request was made.",
                "模擬帳戶已重設，未送出任何 IB 請求。",
              )}
            </Notice>
          )}
        </section>
        <section className="stack">
          <h3>{tx(lang, "Local services", "本機服務")}</h3>
          <div className="service-list">
            {[
              [
                tx(lang, "API server", "API 伺服器"),
                health.status === "ok" || health.status === "healthy",
              ],
              [tx(lang, "Market analysis", "市場分析"), health.analysis],
              ["Interactive Brokers", health.ib?.connected],
            ].map(([name, up]) => (
              <div key={name}>
                <span>{name}</span>
                <span className={`badge ${up ? "teal" : ""}`}>
                  <i className={`status-dot ${up ? "" : "offline"}`} />
                  {tx(
                    lang,
                    up ? "Connected" : "Unavailable",
                    up ? "已連線" : "無法使用",
                  )}
                </span>
              </div>
            ))}
          </div>
          <Notice tone="warning">
            {tx(
              lang,
              "The API has no authentication. Keep both services on loopback and never expose them to untrusted networks. A disabled button is not API authorization.",
              "API 不具身分驗證。請將服務綁定本機回環位址，切勿暴露於不受信任的網路。停用按鈕不等於 API 授權。",
            )}
          </Notice>
          <h3>{tx(lang, "Connection configuration", "連線設定")}</h3>
          <p className="muted">
            {tx(
              lang,
              "Browser edition reads configuration from the local .env file. Edit it on your computer, then restart services. API keys never need to be entered in this page.",
              "瀏覽器版本從本機 .env 檔案讀取設定。請在電腦上編輯後重新啟動服務，不需在此頁輸入 API 金鑰。",
            )}
          </p>
          <dl className="config-help">
            <dt>Yahoo Finance</dt>
            <dd>
              {tx(
                lang,
                "Network access required. No key needed.",
                "需網路連線，無需金鑰。",
              )}
            </dd>
            <dt>FINNHUB_API_KEY</dt>
            <dd>
              {tx(
                lang,
                "Optional search suggestions; direct tickers always work.",
                "選填：搜尋建議，直接輸入代號不受影響。",
              )}
            </dd>
            <dt>IB_HOST · IB_PORT · IB_CLIENT_ID</dt>
            <dd>
              {tx(
                lang,
                "Connect an existing TWS or IB Gateway. Use a broker paper account for development.",
                "連接已啟動的 TWS 或 IB Gateway。開發請使用券商模擬帳戶。",
              )}
            </dd>
            <dt>CHAT_BASE_URL · CHAT_API_KEY · CHAT_MODEL</dt>
            <dd>
              {tx(
                lang,
                "OpenAI-compatible provider. Chat shares supplied chart and sanitized account data with this provider.",
                "OpenAI 相容供應商。聊天會將圖表及清理後的帳戶資料送至此供應商。",
              )}
            </dd>
          </dl>
          <div className="setting-card">
            <Icon name="info" />
            <p className="microcopy">
              {tx(
                lang,
                "Charts and model outputs are research aids, not financial advice. Data may be delayed. The model confidence is not a probability of investment success.",
                "圖表與模型輸出僅供研究，不構成財務建議。資料可能延遲，模型信心度不代表投資成功機率。",
              )}
            </p>
          </div>
          <a className="button ghost" href={DEMO ? "./" : "?demo=1"}>
            {tx(
              lang,
              DEMO
                ? "Return to local workspace"
                : "Open generated NVDA preview",
              DEMO ? "返回本機工作區" : "開啟產生的 NVDA 預覽",
            )}
          </a>
        </section>
      </div>
    </Modal>
  );
}
