import { useEffect, useRef, useState } from "react";
import { api } from "../src/api.js";
import { money, Notice, tx } from "../src/ui.jsx";
import {
  allowlistChatAccount,
  allowlistChatCandles,
  allowlistChatFundamentals,
  allowlistChatMessages,
  allowlistChatPrediction,
  validateChatDraft,
} from "../src/research.js";

export default function AIChat({
  lang,
  symbol,
  candles,
  fundamentals,
  prediction,
  accountContext,
  onDraft,
}) {
  const [modelsState, setModelsState] = useState({
    status: "loading",
    configured: false,
    models: [],
  });
  const [model, setModel] = useState("");
  const [modelReload, setModelReload] = useState(0);
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [requestState, setRequestState] = useState("idle");
  const activeSymbol =
    typeof symbol === "string" &&
    /^[A-Za-z][A-Za-z0-9.-]{0,14}$/.test(symbol.trim())
      ? symbol.trim().toUpperCase()
      : "";
  const request = useRef(null);
  const activeSymbolRef = useRef(activeSymbol);
  activeSymbolRef.current = activeSymbol;
  const busy = requestState === "sending" || requestState === "cancelling";
  const available =
    modelsState.status === "ready" &&
    modelsState.configured &&
    modelsState.models.length > 0;
  const chartCandles = allowlistChatCandles(candles);
  const chartReady = chartCandles.length > 0;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setModelsState({ status: "loading", configured: false, models: [] });
    api("/api/chat/models", { signal: controller.signal })
      .then((data) => {
        if (!active || controller.signal.aborted) return;
        const models = Array.isArray(data?.models)
          ? data.models
              .filter((item) => typeof item?.id === "string" && item.id.trim())
              .filter(
                (item, index, all) =>
                  all.findIndex((candidate) => candidate.id === item.id) ===
                  index,
              )
          : [];
        const configured = data?.configured === true;
        setModelsState({ status: "ready", configured, models });
        setModel((current) =>
          models.some((item) => item.id === current)
            ? current
            : (models[0]?.id ?? ""),
        );
      })
      .catch((cause) => {
        if (!active || cause?.name === "AbortError") return;
        setModelsState({ status: "error", configured: false, models: [] });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [modelReload]);

  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setMessages([]);
    setPrompt("");
    setDraft(null);
    setError("");
    setRequestState("idle");
    return () => {
      const active = request.current;
      request.current = null;
      active?.abort();
    };
  }, [symbol]);

  async function sendMessage(event) {
    event?.preventDefault();
    const content = prompt.trim();
    if (!content || busy) return;
    if (!activeSymbol) {
      setError(
        tx(
          lang,
          "Select a valid symbol and load its research context first.",
          "請先選擇有效股票代號並載入研究資料。",
        ),
      );
      return;
    }
    if (!chartReady) {
      setError(
        tx(
          lang,
          "Load usable chart history before starting AI chat.",
          "請先載入可用圖表歷史資料再開始 AI 對話。",
        ),
      );
      return;
    }
    if (!available || !modelsState.models.some((item) => item.id === model)) {
      setError(
        tx(
          lang,
          "No configured chat model is available.",
          "沒有可用的已設定聊天模型。",
        ),
      );
      return;
    }

    const requestSymbol = activeSymbol;
    const outgoing = [...messages, { role: "user", content }];
    const controller = new AbortController();
    request.current = controller;
    setMessages(outgoing);
    setPrompt("");
    setDraft(null);
    setError("");
    setRequestState("sending");
    try {
      const data = await api("/api/chat", {
        method: "POST",
        signal: controller.signal,
        body: {
          model,
          symbol: activeSymbol,
          candles: chartCandles,
          fundamentals: allowlistChatFundamentals(fundamentals),
          prediction: allowlistChatPrediction(prediction),
          messages: allowlistChatMessages(outgoing),
          accountContext: allowlistChatAccount(accountContext),
        },
      });
      if (
        controller.signal.aborted ||
        request.current !== controller ||
        activeSymbolRef.current !== requestSymbol
      ) {
        if (
          request.current === controller &&
          activeSymbolRef.current === requestSymbol
        )
          setRequestState("cancelled");
        return;
      }
      if (typeof data?.answer !== "string" || !data.answer.trim()) {
        setError(
          tx(
            lang,
            "The provider returned no answer. Try again or select another model.",
            "服務提供者未回傳回答。請重試或選擇其他模型。",
          ),
        );
        setRequestState("error");
      } else {
        setMessages([...outgoing, { role: "assistant", content: data.answer }]);
        if (data.draft != null) {
          const safeDraft = validateChatDraft(data.draft, activeSymbol);
          if (safeDraft) setDraft(safeDraft);
          else
            setError(
              tx(
                lang,
                "An invalid order draft was discarded. No order was submitted.",
                "已捨棄無效訂單草稿，未送出任何訂單。",
              ),
            );
        }
        setRequestState("idle");
      }
    } catch (cause) {
      if (
        request.current !== controller ||
        activeSymbolRef.current !== requestSymbol
      )
        return;
      if (cause?.name === "AbortError") {
        setRequestState("cancelled");
      } else {
        setError(
          tx(
            lang,
            "Chat request failed. Check provider availability and configuration; no answer was fabricated.",
            "聊天請求失敗。請檢查服務提供者是否可用及設定；未產生假回答。",
          ),
        );
        setRequestState("error");
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function cancelRequest() {
    if (!busy) return;
    setRequestState("cancelling");
    request.current?.abort();
  }

  function clearChat() {
    request.current?.abort();
    request.current = null;
    setMessages([]);
    setPrompt("");
    setDraft(null);
    setError("");
    setRequestState("idle");
  }

  function handlePromptKeys(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
      sendMessage(event);
  }

  let modelNotice = null;
  if (modelsState.status === "loading")
    modelNotice = tx(
      lang,
      "Loading provider models…",
      "正在載入服務提供者模型…",
    );
  else if (modelsState.status === "error")
    modelNotice = tx(
      lang,
      "Could not load chat models. Check the local backend and try again.",
      "無法載入聊天模型。請檢查本機後端並重試。",
    );
  else if (!modelsState.configured)
    modelNotice = tx(
      lang,
      "AI chat is unavailable: configure an OpenAI-compatible provider in the local backend.",
      "AI 聊天目前無法使用：請在本機後端設定 OpenAI 相容服務提供者。",
    );
  else if (modelsState.models.length === 0)
    modelNotice = tx(
      lang,
      "Provider is configured, but it returned no selectable models.",
      "服務提供者已設定，但未提供可選模型。",
    );

  return (
    <section
      className="research-sidebar research-ai-chat stack"
      aria-label={tx(lang, "AI research chat", "AI 研究聊天")}
    >
      <header className="panel-header">
        <div>
          <h2>{tx(lang, "AI research chat", "AI 研究聊天")}</h2>
          <p className="muted">
            {activeSymbol ||
              tx(
                lang,
                "Select a chart symbol to start.",
                "選擇圖表股票代號以開始。",
              )}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            className="button ghost small"
            type="button"
            onClick={clearChat}
            disabled={busy}
          >
            {tx(lang, "Clear chat", "清除對話")}
          </button>
        )}
      </header>

      <div className="panel-body stack">
        <Notice tone="warning">
          {tx(
            lang,
            "Privacy: your selected provider receives this conversation, up to 500 supplied chart candles, supplied fundamentals and prediction, and allowlisted read-only account context. Provider may be remote; review its privacy policy. Chat has no news search or order-execution access.",
            "隱私：所選服務提供者會收到此對話、最多 500 根已提供的圖表 K 線、已提供的基本面與預測，以及經白名單篩選的唯讀帳戶資料。服務提供者可能位於遠端；請檢閱其隱私政策。聊天無法搜尋新聞或執行訂單。",
          )}
        </Notice>

        <label className="field">
          <span>{tx(lang, "Provider model", "服務提供者模型")}</span>
          <select
            className="select"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={!available || busy}
            aria-label={tx(
              lang,
              "Choose a configured chat model",
              "選擇已設定的聊天模型",
            )}
          >
            {!model && (
              <option value="">
                {tx(lang, "No model selected", "未選擇模型")}
              </option>
            )}
            {modelsState.models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
        </label>
        {activeSymbol && !chartReady && (
          <Notice tone="info">
            {tx(
              lang,
              "Load usable chart history before chatting. The provider is not sent synthetic data.",
              "開始對話前請載入可用圖表歷史資料；不會向服務提供者傳送模擬資料。",
            )}
          </Notice>
        )}
        {modelNotice && (
          <Notice tone={modelsState.status === "error" ? "error" : "info"}>
            {modelNotice}
            {modelsState.status !== "loading" && (
              <button
                className="button ghost small"
                type="button"
                onClick={() => setModelReload((value) => value + 1)}
              >
                {tx(
                  lang,
                  modelsState.status === "error"
                    ? "Retry model loading"
                    : "Reload provider models",
                  modelsState.status === "error"
                    ? "重新載入模型"
                    : "重新載入服務提供者模型",
                )}
              </button>
            )}
          </Notice>
        )}

        <div
          className="research-chat-log"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label={tx(lang, "Conversation", "對話內容")}
        >
          {messages.length === 0 ? (
            <div className="empty">
              {tx(
                lang,
                "Ask about the supplied chart, prediction, fundamentals, or read-only account context.",
                "可詢問已提供的圖表、預測、基本面或唯讀帳戶資料。",
              )}
            </div>
          ) : (
            messages.map((message, index) => (
              <article
                className={`research-chat-message ${message.role}`}
                key={`${index}-${message.role}`}
              >
                <strong>
                  {message.role === "user"
                    ? tx(lang, "You", "你")
                    : tx(lang, "Assistant", "助理")}
                </strong>
                <p>{message.content}</p>
              </article>
            ))
          )}
          {requestState === "sending" && (
            <p className="muted" role="status">
              {tx(lang, "Waiting for provider…", "等待服務提供者回覆…")}
            </p>
          )}
          {requestState === "cancelling" && (
            <p className="muted" role="status">
              {tx(lang, "Cancelling request…", "正在取消請求…")}
            </p>
          )}
          {requestState === "cancelled" && (
            <p className="muted" role="status">
              {tx(
                lang,
                "Request cancelled. No answer was added.",
                "請求已取消，未加入回答。",
              )}
            </p>
          )}
        </div>

        {draft && (
          <section
            className="research-chat-draft"
            aria-label={tx(lang, "Order draft for review", "待審核訂單草稿")}
          >
            <div className="row research-results-heading">
              <h3>
                {tx(lang, "Order draft — review only", "訂單草稿 — 僅供審核")}
              </h3>
              <span
                className={`badge ${draft.side === "BUY" ? "positive" : "negative"}`}
              >
                {draft.side === "BUY"
                  ? tx(lang, "BUY", "買入")
                  : tx(lang, "SELL", "賣出")}
              </span>
            </div>
            <p className="muted">
              {draft.symbol} · {tx(lang, "Whole shares", "整股")}{" "}
              {draft.quantity} · {money(draft.limitPrice)} · {draft.tif}
              {draft.takeProfit != null &&
                ` · ${tx(lang, "Take profit", "停利")} ${money(draft.takeProfit)}`}
              {draft.stopLoss != null &&
                ` · ${tx(lang, "Stop loss", "停損")} ${money(draft.stopLoss)}`}
            </p>
            <p className="muted">
              {tx(
                lang,
                "This opens the normal order ticket for your review. It does not submit an order.",
                "這會開啟一般訂單票券供你審核，不會送出訂單。",
              )}
            </p>
            <button
              className="button primary"
              type="button"
              disabled={!onDraft}
              onClick={() => onDraft?.({ ...draft })}
            >
              {tx(lang, "Review in order ticket", "在訂單票券中審核")}
            </button>
          </section>
        )}

        {error && <Notice tone="error">{error}</Notice>}
        {requestState === "error" && !error && (
          <Notice tone="error">
            {tx(lang, "Request failed.", "請求失敗。")}
          </Notice>
        )}

        <form className="stack research-chat-form" onSubmit={sendMessage}>
          <label className="field">
            <span>{tx(lang, "Message", "訊息")}</span>
            <textarea
              className="input research-chat-input"
              rows="3"
              maxLength="4000"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handlePromptKeys}
              placeholder={tx(
                lang,
                "Ask a research question…",
                "輸入研究問題…",
              )}
              aria-label={tx(
                lang,
                "Ask the AI research assistant",
                "詢問 AI 研究助理",
              )}
              disabled={!available || !activeSymbol || !chartReady || busy}
            />
          </label>
          <div className="row research-actions">
            <span className="muted">
              {tx(lang, "Ctrl/⌘ + Enter to send", "Ctrl/⌘ + Enter 送出")}
            </span>
            <button
              className="button primary"
              type="submit"
              disabled={
                !available ||
                !activeSymbol ||
                !chartReady ||
                busy ||
                !prompt.trim()
              }
            >
              {tx(lang, "Send", "送出")}
            </button>
            {busy && (
              <button
                className="button ghost"
                type="button"
                onClick={cancelRequest}
              >
                {tx(lang, "Cancel", "取消")}
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
