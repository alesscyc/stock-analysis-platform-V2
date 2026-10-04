import React, { useEffect, useState } from "react";
import { api, DEMO } from "../src/api.js";
import { Icon, Notice, tx, percent, number } from "../src/ui.jsx";

export default function PredictionCard({
  lang,
  symbol,
  prediction,
  loading,
  error,
  onPrediction,
}) {
  const [retraining, setRetraining] = useState(false),
    [actionError, setActionError] = useState(null),
    [status, setStatus] = useState(null);
  useEffect(() => {
    setActionError(null);
    setStatus(null);
    setRetraining(false);
  }, [symbol]);
  async function retrain() {
    setRetraining(true);
    setActionError(null);
    try {
      const data = await api(`/models/${encodeURIComponent(symbol)}/retrain`, {
        method: "POST",
      });
      onPrediction(symbol, data);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setRetraining(false);
    }
  }
  return (
    <section className="prediction-card">
      <div className="row spread">
        <h3>
          <Icon name="north" size={15} />
          {tx(lang, "Model signal", "模型訊號")}
        </h3>
        <span className="model-label">RANDOM FOREST</span>
      </div>
      {loading || retraining ? (
        <div className="signal-loading">
          <span className="spinner" />
          {tx(
            lang,
            retraining ? "Retraining daily model…" : "Analyzing daily history…",
            retraining ? "重新訓練日線模型…" : "正在分析日線歷史…",
          )}
        </div>
      ) : prediction ? (
        <>
          <div className="signal-result">
            <strong
              className={prediction.signal === "BUY" ? "positive" : "muted"}
            >
              {prediction.signal}
            </strong>
            <div>
              <b>{percent(prediction.confidence).replace("+", "")}</b>
              <span>{tx(lang, "classifier confidence", "分類器信心度")}</span>
            </div>
          </div>
          <div className="confidence-track">
            <div
              style={{
                width: `${Math.min(100, Math.max(0, prediction.confidence * 100))}%`,
              }}
            />
          </div>
          <details className="signal-details">
            <summary>{tx(lang, "Training & evaluation", "訓練與評估")}</summary>
            <dl>
              <dt>BUY / SELL</dt>
              <dd>
                {percent(prediction.probabilities?.BUY).replace("+", "")} /{" "}
                {percent(prediction.probabilities?.SELL).replace("+", "")}
              </dd>
              <dt>{tx(lang, "Evaluation accuracy", "評估準確率")}</dt>
              <dd>{percent(prediction.training?.accuracy).replace("+", "")}</dd>
              <dt>{tx(lang, "Train / test samples", "訓練／測試樣本")}</dt>
              <dd>
                {number(prediction.training?.trainSamples)} /{" "}
                {number(prediction.training?.testSamples)}
              </dd>
              <dt>{tx(lang, "Purged gap", "隔離間距")}</dt>
              <dd>
                {prediction.training?.gapBars ?? 22}{" "}
                {tx(lang, "bars", "根 K 線")}
              </dd>
              <dt>{tx(lang, "Trained", "訓練時間")}</dt>
              <dd>
                {prediction.training?.trainedAt
                  ? new Date(prediction.training.trainedAt).toLocaleString(lang)
                  : "—"}
              </dd>
            </dl>
            <div className="row">
              <button
                className="button small"
                disabled={DEMO || retraining}
                onClick={retrain}
              >
                {tx(lang, "Retrain", "重新訓練")}
              </button>
              <button
                className="button ghost small"
                onClick={async () => {
                  try {
                    setStatus(
                      await api(`/models/${encodeURIComponent(symbol)}`),
                    );
                  } catch (e) {
                    setActionError(e.message);
                  }
                }}
              >
                {tx(lang, "Cache status", "快取狀態")}
              </button>
            </div>
            {status && (
              <pre className="model-status">
                {JSON.stringify(status, null, 2)}
              </pre>
            )}
          </details>
        </>
      ) : (
        <div className="signal-unavailable">
          <span className="badge">{tx(lang, "UNAVAILABLE", "暫無訊號")}</span>
          <p>
            {error ||
              tx(
                lang,
                "Not enough daily history to train a model.",
                "日線歷史不足，無法訓練模型。",
              )}
          </p>
          {!DEMO && (
            <button className="button ghost small" onClick={retrain}>
              {tx(lang, "Retry training", "重試訓練")}
            </button>
          )}
        </div>
      )}
      <Notice tone="error">{actionError}</Notice>
      <p className="microcopy">
        {tx(
          lang,
          "BUY labels a >5% return over 22 bars. SELL is the other class—not a forecast of loss. Confidence is not investment success probability.",
          "BUY 標記 22 根 K 線後報酬 >5%；SELL 為其他類別，不代表預測下跌。信心度不等於投資成功機率。",
        )}
      </p>
    </section>
  );
}
