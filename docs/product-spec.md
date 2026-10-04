# Product specification

## Document scope

**Delivery scope:** The complete browser workspace is implemented. The user explicitly excluded the desktop app; Electron packaging and desktop credential settings are not part of this build. See [README](../README.md) for the delivered setup and test commands.

This is an **as-built specification** of the current repository, not a proposal or a claim of production readiness. It describes observable product behavior and boundaries. Acceptance scenarios below are review criteria derived from the code, not a record of tests run for this document.

- [Feature catalog](features.md): capabilities, dependencies, and limitations.
- [README](../README.md): installation, configuration, API overview, and packaging.
- [Domain language](../CONTEXT.md): canonical account and trading-mode terminology.

Historical roadmap documents from the source specification were not supplied with this repository and are not implementation commitments.

## Product purpose

Stock Analysis Platform is a local stock-research and trading workspace. It brings chart inspection, technical screening, simple strategy testing, account monitoring, and user-submitted trades into one interface.

The intended user is an individual researching stocks on their own computer. The delivered application runs in a browser with local services. The optional Windows desktop shell is excluded from this build. It is not a hosted, multi-user brokerage platform.

### User outcomes

1. Find a stock and understand its price history, technical structure, and basic fundamentals.
2. Reduce a supplied list of symbols to candidates matching technical conditions.
3. Compare a declarative trading strategy against historical prices before risking capital.
4. Practice with a local simulated account or submit an explicitly reviewed order through Interactive Brokers.
5. Inspect holdings, pending orders, and account-level risk indicators without leaving the chart workspace.
6. Ask an AI assistant to explain supplied research and account data without giving it execution authority.

## Scope

| In scope | Outside current scope |
| --- | --- |
| Daily, weekly, and monthly stock research | Intraday charts or a guaranteed real-time market-data feed |
| Local watchlist, drawings, and preferences | Cloud profiles, cross-device synchronization, or collaboration |
| Technical screening of user-supplied symbols | An automatically maintained whole-market scanning service |
| Single-symbol, rule-based historical simulation | Portfolio optimization or execution-realistic backtesting |
| Random Forest classification and contextual AI chat | Guaranteed forecasts, personalized financial advice, or autonomous trading |
| Whole-share limit orders and bracket orders | A general-purpose multi-asset order-entry platform |
| Local Paper Account and connected IB account access | A broker-hosted paper account managed by this app |
| Complete browser workflow | Desktop packaging, authenticated public hosting, or a native mobile app |

## Workspace

The main workspace contains a symbol search, instrument information, a central chart, feature side panels, an account panel with portfolio and orders tabs, and an AI chat panel. Side and account panels can be resized; the account panel can be maximized. The interface supports English and Traditional Chinese.

Search can start from the top bar or by typing a supported ticker character outside an input. Selecting a watchlist item, screener result, or holding also opens its chart. On narrow screens, choosing a symbol from a side panel reveals the chart.

## Core workflows

### 1. Research a stock

**Entry:** Enter a ticker directly, choose a search suggestion, or select a saved/result symbol.

**Flow:** Load recent daily candles first, then independently request older history, a model prediction, and fundamentals. Inspect moving averages, volume, price patterns, and drawings. Switch to weekly or monthly bars when needed.

**Outcome:** A usable chart does not wait for prediction or full-history completion. Cached candles can appear immediately on a revisit. Failures in background history or prediction do not discard the visible chart.

### 2. Screen candidates

**Entry:** Paste symbols or import a text file.

**Flow:** Enable and tune the supported conditions, run the scan, inspect progressively added matches and miniature charts, and open a result in the main chart. A running scan can be cancelled.

**Outcome:** Results represent matches among successfully fetched symbols, not proof that every submitted symbol was analyzed. Individual fetch failures are skipped.

### 3. Test a strategy

**Entry:** Select a symbol and open backtesting.

**Flow:** Define one entry comparison and one exit comparison, choose immediate or staged exits, evaluation frequency, initial capital, and history range. Run the simulation and inspect performance metrics and trade actions on the chart.

**Outcome:** Historical results support research only. No backtest action creates a Paper Order or an IB order.

### 4. Submit and manage a trade

**Entry:** Check the visible trading mode, then open the order ticket or review an AI-generated draft.

**Flow:** Choose buy/sell, positive whole-share quantity, limit price, time in force, and optional bracket exits. Preview prices on the chart and explicitly submit. Review pending orders, confirm price changes, or cancel orders.

**Outcome:** Paper Mode changes only browser-local simulated state. Live Mode sends requests to the configured IB connection. A successful submission is not confirmation of a fill.

**Mode rule:** Live Mode is available only while IB is connected. Disconnection forces the active mode to Paper Mode without replacing the saved preference. Reconnection can therefore restore Live Mode when that remains the preference. Existing Paper Orders never migrate to IB.

### 5. Monitor an account

**Entry:** Open the account panel.

**Flow:** Inspect cash, account value, buying power, holdings, allocation, P&L, pending orders, and available freshness/risk warnings. In the live overview, select among available accounts for display.

**Outcome:** Display-account selection is read-only and does not select the destination account for new orders. Paper Mode shows the independent local simulation.

### 6. Ask for assistance

**Entry:** Load a chart and open chat with a configured provider.

**Flow:** Select a model and ask about the stock, supplied fundamentals, model signal, or read-only active-mode account context. Where structured output is supported, review a validated limit-order draft in the normal ticket.

**Outcome:** Chat can explain or draft, never submit, modify, or cancel an order. Unsupported structured output falls back to answers without drafts.

## Safety and operational requirements

- **The API has no authentication. Do not expose it to untrusted networks.** Browser development permits cross-origin access; a hidden or disabled UI control is not API authorization.
- **Live Mode can place real trades.** The label describes the IB-connected route, not whether IB itself is using a real or paper-trading account. Use an IB paper-trading account for development.
- The local Paper Account must remain separate from all IB accounts. It requires usable browser storage and browser lock support; only the primary tab can write it.
- Invalid or unsavable Paper Account data blocks trading rather than silently replacing the account. Reset is an explicit destructive action.
- Prices, fundamentals, predictions, and account snapshots can be delayed or stale. Polling frequency is not a guarantee of provider freshness.
- AI requests send chart data and sanitized account context to the configured provider. Local deployment does not mean those requests stay on the computer.
- External-service failures should remain localized: unavailable autocomplete, chat, or IB must not be described as preventing all research. Yahoo-backed operations still require market-data access.
- Existing keyboard interaction, focus handling, labels, and bilingual text are part of the UI contract; this is not a claim of a completed accessibility audit.

## Acceptance scenarios

| Scenario | Expected behavior |
| --- | --- |
| Finnhub is not configured | A directly entered ticker can still load; autocomplete has no results. |
| Prediction is slow or unavailable | Candles remain usable; prediction has its own loading/error state. |
| The user switches symbols during loading | Previous chart requests are aborted and must not overwrite the new selection. |
| Older history fails | Already loaded candles remain visible with a partial-history indication. |
| IB disconnects | The active mode becomes Paper Mode; existing IB orders are not converted into Paper Orders. |
| A Paper Order is placed | Cash/share constraints apply locally; no IB order request is made. |
| Another tab owns the Paper Account | The secondary tab is read-only for paper trading. |
| An AI draft is returned | It must pass validation and enter the normal review/submission flow. |
| The user drags an existing order price | A modification ticket opens; the drag alone does not submit a change. |
| An account is selected in the live overview | Displayed holdings change; order routing is unchanged. |
| A backtest completes | Metrics and chart actions appear without affecting any account. |
| Browser connection configuration changes | Credentials stay in the local `.env` file; restart services to apply changes. No credential-editing API is exposed. |

## Evidence and maintenance

Behavior was traced through [App.jsx](../frontend/src/App.jsx), the [feature components](../frontend/component/), [paperAccount.js](../frontend/src/paperAccount.js), [usePaperAccount.js](../frontend/src/usePaperAccount.js), [server.js](../backend/server.js), [chatSafety.js](../backend/chatSafety.js), [stock_data.py](../analysis/stock_data.py), and [service startup](../scripts/dev.mjs).

Update this specification when product behavior or safety boundaries change. Keep setup commands and detailed API documentation in the root README; keep service-specific behavior in the [analysis](../analysis/README.md) and [backend](../backend/README.md) documentation.
