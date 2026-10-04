import React from "react";
import { Empty, Icon, tx, number, percent } from "../src/ui.jsx";

export default function Watchlist({
  lang,
  symbols,
  symbol,
  quotes,
  onSelect,
  onRemove,
  onAdd,
  quoteError,
}) {
  return (
    <div className="watchlist">
      <header className="panel-header">
        <div>
          <h2>{tx(lang, "Watchlist", "觀察清單")}</h2>
          <span className="muted">
            {symbols.length} {tx(lang, "symbols", "檔股票")}
          </span>
        </div>
        <button
          className="button ghost icon-button"
          onClick={onAdd}
          aria-label={tx(
            lang,
            "Add selected symbol to watchlist",
            "加入目前股票至觀察清單",
          )}
        >
          <Icon name="plus" />
        </button>
      </header>
      <div className="watchlist-columns">
        <span>{tx(lang, "SYMBOL", "股票")}</span>
        <span>{tx(lang, "LAST / CHANGE", "最新／漲跌")}</span>
      </div>
      {symbols.length ? (
        <ul className="watchlist-items">
          {symbols.map((ticker, i) => {
            const quote = quotes[ticker],
              change = quote?.previousClose
                ? quote.price / quote.previousClose - 1
                : quote?.changePercent != null
                  ? quote.changePercent / 100
                  : null;
            return (
              <li key={ticker} className={ticker === symbol ? "selected" : ""}>
                <button
                  className="watch-symbol"
                  onClick={() => onSelect(ticker)}
                  aria-current={ticker === symbol ? "true" : undefined}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      e.currentTarget
                        .closest("ul")
                        .querySelectorAll(".watch-symbol")
                        [
                          (i +
                            (e.key === "ArrowDown" ? 1 : -1) +
                            symbols.length) %
                            symbols.length
                        ]?.focus();
                    }
                  }}
                >
                  <span className={`ticker-icon ticker-${i % 5}`}>
                    {ticker.slice(0, 1)}
                  </span>
                  <span className="watch-name">
                    <strong>{ticker}</strong>
                    <small>{tx(lang, "US Equity", "美國股票")}</small>
                  </span>
                  <span className="watch-price">
                    <strong>{number(quote?.price)}</strong>
                    <small
                      className={(change || 0) >= 0 ? "positive" : "negative"}
                    >
                      {percent(change)}
                    </small>
                  </span>
                </button>
                <button
                  className="watch-remove"
                  onClick={() => onRemove(ticker)}
                  aria-label={tx(lang, `Remove ${ticker}`, `移除 ${ticker}`)}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          icon="star"
          title={tx(lang, "Keep an eye on your ideas", "追蹤您的投資想法")}
        >
          {tx(
            lang,
            "Open a symbol and use + to save it here.",
            "開啟股票並使用 + 儲存至此。",
          )}
        </Empty>
      )}
      <div className="watchlist-note">
        <Icon name="clock" size={13} />
        <span>
          {quoteError
            ? tx(
                lang,
                "Quotes unavailable · research still available",
                "行情暫時無法使用 · 仍可研究",
              )
            : tx(
                lang,
                "Snapshot prices · refresh every 15s",
                "快照行情 · 每 15 秒更新",
              )}
        </span>
      </div>
    </div>
  );
}
