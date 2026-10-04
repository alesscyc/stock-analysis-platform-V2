# Feature catalog

This catalog describes implemented browser capabilities, not roadmap commitments. Desktop delivery (F11) was explicitly excluded by the user. “Available” means a code path exists; it does not imply live-provider verification or production certification. See the [product specification](product-spec.md) for workflows and safety requirements.

## Availability at a glance

| Capability | Required services or state |
| --- | --- |
| Charts, fundamentals, screening, backtests, Random Forest signals | Local backend and analysis service; Yahoo Finance access |
| Search suggestions | Backend and configured Finnhub key |
| Direct ticker entry | No Finnhub key required |
| Watchlist and chart drawings | Browser storage; backend for refreshed prices |
| AI chat | Loaded chart and configured OpenAI-compatible provider |
| Live account overview and order operations | Connected IB Gateway or TWS |
| Paper Account | Browser storage, Web Locks, primary tab; backend quotes for fills |
| Connection configuration | Local `.env` file; restart services after changes |
| Static GitHub Pages preview | Generated NVDA sample data; not a live research/trading deployment |

## F01 — Symbol discovery and watchlist

- Direct ticker entry, debounced Finnhub autocomplete, and keyboard suggestion navigation.
- Type-to-search shortcut when focus is outside an editable control.
- Browser-local watchlist with add/remove actions and chart navigation.
- Watchlist prices refresh while the panel is open, using lightweight price snapshots rather than full chart downloads.

**Boundary:** A missing Finnhub key removes suggestions, not direct ticker research. Watchlists are not synchronized across devices or browser origins. Quote refreshes are not a streaming market feed.

## F02 — Charts and technical overlays

- Candlestick and volume charts at daily, weekly, and monthly intervals.
- 10-, 20-, 50-, 150-, and 200-period price moving averages, plus a 20-period volume average. Periods follow the selected bar interval; they are trading days only on daily charts.
- Automatic swing zones and a shared Price Pattern indicator covering double bottoms, double tops, head-and-shoulders, and inverse head-and-shoulders.
- Trend lines, horizontal lines, rays, rectangles, and price-range drawings saved per symbol.
- Persistent visibility preferences for indicators.
- Active-mode position/order lines, editable order-price previews, and backtest trade markers.
- Recent-first daily loading, older-history backfill, and in-session reuse of already fetched chart data, including screener data.

**Boundary:** Pattern detection is heuristic visual analysis, not an execution signal or a guarantee of future price direction. Weekly/monthly charts load their full available history in one request. Chart history and model prediction load independently.

Sources: [StockChart.jsx](../frontend/component/StockChart.jsx), [pricePatterns.js](../frontend/component/pricePatterns.js), [drawings.js](../frontend/component/drawings.js), [progressive loading](../frontend/src/useStock.js).

## F03 — Company fundamentals

The instrument view exposes available market capitalization, trailing/forward P/E, trailing EPS, dividend yield, sector, industry, beta, 52-week range, and average volume.

**Boundary:** Fields depend on Yahoo Finance coverage and can be absent. This is a compact company snapshot, not financial-statement analysis or a point-in-time fundamentals database.

## F04 — Technical screener

- Accepts pasted symbols or imported text, separated by newlines, commas, semicolons, or pipes.
- Combines enabled conditions: price above the 52-week low by a chosen percentage; price within a chosen percentage of the 52-week high; and a rising 200-day moving average over a chosen window.
- Defaults to 25% above the low, within 25% of the high, and a one-month MA trend window.
- Requires all enabled conditions to pass. The MA trend test requires increases on at least 90% of the comparison days and a higher ending value.
- Scans sequentially, displays progress, appends matches with miniature candle charts, and supports cancellation and keyboard result selection.
- Reuses scanned history when opening a result.

**Boundary:** This scans the supplied list, not an exchange universe. Failed fetches are skipped. The screener's 52-week bounds use rolling daily closing prices, which need not match intraday high/low figures shown in fundamentals.

Source: [ScreenerDialog.jsx](../frontend/component/ScreenerDialog.jsx).

## F05 — Strategy backtesting

- One entry and one exit comparison using close price, a configurable 2–500-period moving average, or a fixed number in the UI.
- Comparison operators: `>`, `<`, `>=`, `<=`.
- Daily or monthly evaluation; immediate liquidation or staged exits over weekly/monthly periods.
- Configurable initial capital and history range: one, two, five years, or maximum available history.
- Results include total return, CAGR, Sharpe ratio, maximum drawdown, win rate, trade count, average return/loss, profit factor, and trade actions. The service also returns an equity curve.
- Strategy form settings persist locally; trade actions can be overlaid on the main chart.

**Simulation boundary:** Single-symbol, long-only, all-cash entries with fractional simulated shares; fills use the signal bar's close. Remaining positions are liquidated at the final close. No commissions, slippage, partial fills, or shorting are modeled. Daily entry evaluation detects a transition into the condition; monthly evaluation checks the condition on the first available bar of each month. These are materially different rules.

**Metric boundary:** Weekly/monthly bars are accepted, but Sharpe annualization still uses a daily factor. Staged exits produce multiple trade records, so trade-level statistics are not necessarily statistics for complete entry-to-final-exit cycles. Do not treat these results as broker-realistic execution estimates.

Sources: [BacktestDialog.jsx](../frontend/component/BacktestDialog.jsx), [stock_data.py](../analysis/stock_data.py).

## F06 — Random Forest signals

- Per-symbol model training on technical features from daily history.
- BUY/SELL classification with class probabilities, confidence, and training/evaluation metadata.
- Labels distinguish a forward return greater than 5% over 22 trading bars from other known outcomes. Unknown future outcomes are excluded from training.
- Chronological training/evaluation split with a 22-bar gap; models are reused from a four-hour memory/disk cache.
- Model-status and retraining operations are exposed through the API.

**Boundary:** SELL means the model's other class, not proof of a negative future return. Confidence is a classifier output, not a calibrated probability of investment success. Prediction remains daily-data analysis even when the displayed chart is weekly/monthly. Insufficient history or training failure can leave the signal unavailable without removing the chart.

Source: [stock_data.py](../analysis/stock_data.py).

## F07 — Contextual AI chat

- Model selection from an OpenAI-compatible provider.
- Sends up to the latest 500 loaded chart bars, recent conversation turns, supplied fundamentals, the existing prediction, and sanitized read-only account context.
- Can discuss positions and pending orders for the active trading mode.
- Supports a validated whole-share limit-order draft that opens in the normal trade ticket for review.

**Boundary:** No news search, independent live-price fetch, or order-execution tools. Conversation state is not a persistent research journal. Structured drafts are currently requested only for model IDs beginning with `deepseek-`; unsupported structured responses fall back to plain answers without drafts. Account display selection in the overview does not retarget chat's IB snapshots.

**Privacy:** The configured provider receives supplied research and account data. Account fields are allowlisted; the request is not purely local unless the provider is local.

Sources: [AIChat.jsx](../frontend/component/AIChat.jsx), [chatSafety.js](../backend/chatSafety.js), [server.js](../backend/server.js).

## F08 — Account overview

- Read-only live-account selector, masked account identifiers, and connection/freshness indicators.
- Available account value, cash, buying power, liquidity, margin, gross position value, holdings, and P&L information.
- Allocation visualization and holdings-to-chart navigation.
- Display warnings for stale data, synchronization errors, concentration, low excess liquidity, and high maintenance margin when supporting data is available.
- Equivalent overview for the local Paper Account, with simulated cash and no margin borrowing.

**Boundary:** Warnings are informational, not pre-trade enforcement. Display-account selection does not change IB order routing. Live overview data is periodically refreshed, not guaranteed real-time or a persistent performance history.

Source: [PortfolioDialog.jsx](../frontend/component/PortfolioDialog.jsx).

## F09 — Order entry and management

- BUY/SELL limit tickets with positive whole-share quantities and USD price inputs.
- Time-in-force choices: DAY, GTC, IOC, and FOK.
- Optional take-profit limit and stop-loss bracket legs.
- Chart previews and price dragging; existing order changes require explicit confirmation in the ticket.
- Pending-order inspection, supported price modification, and cancellation.
- Live orders use stock contracts through IB; stable references and bracket relationships are maintained by the backend.

**Boundary:** Quantity changes are not an in-place edit workflow. The ticket is not a general market/stop/options order builder. IB acceptance and fills depend on the connected account and broker rules. Live mode can reach a real account; use an IB paper-trading account when testing.

Sources: [TradeDialog.jsx](../frontend/component/TradeDialog.jsx), [OrdersDialog.jsx](../frontend/component/OrdersDialog.jsx), [server.js](../backend/server.js).

## F10 — Browser-local Paper Account

- Starts with USD 100,000 simulated cash; Settings supports an explicit reset with chosen starting cash.
- Persists cash, whole-share holdings, average cost, realized P&L, quotes, open orders, and bounded terminal-order history.
- Reserves available cash/shares; disallows short selling and margin borrowing.
- Simulates limit orders and BUY brackets; bracket exits activate after the parent fills and cancel the sibling on execution.
- BUY brackets support DAY/GTC, not IOC/FOK. SELL brackets are unavailable in Paper Mode.
- Quote snapshots drive full-order fills while the app is running. DAY expiry uses the next local midnight; IOC/FOK orders cancel if they cannot fill immediately under the simulator's rules.
- Uses primary-tab ownership and browser locks to serialize writes; secondary tabs are read-only.

**Boundary:** No background execution with the app closed, broker synchronization, commissions, order-book liquidity, or partial fills. Reopening the app does not replay missed market movements. DAY expiry is not an exchange-calendar model. Browser data deletion removes the account; storage corruption/failure disables trading until resolved. Quote polling does not make this an offline or exchange-realistic simulator.

Sources: [paperAccount.js](../frontend/src/paperAccount.js), [usePaperAccount.js](../frontend/src/usePaperAccount.js), [Paper Account regression tests](../frontend/src/paperAccount.test.js).

## F11 — Desktop delivery excluded

The user explicitly waived the desktop app. No Electron shell, bundled Python executable, installer, or renderer credential-editing endpoint is included.

The complete browser edition starts all local services with `npm run dev`, or serves the built frontend from Express with `npm run build && npm start`. Connection configuration lives in a local `.env` file and takes effect after restart. Browser Settings retains language, service status, Paper Account export/reset, and configuration guidance without returning secret values.

Sources: [SettingsDialog.jsx](../frontend/component/SettingsDialog.jsx), [service launcher](../scripts/dev.mjs), [configuration example](../.env.example), [README](../README.md).
