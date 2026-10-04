# Northstar · Stock Analysis Platform

Complete local **browser** implementation of the [product specification](docs/product-spec.md) and [feature catalog](docs/features.md). Desktop packaging was explicitly excluded. React workspace, Express integrations, Python research service, and independent browser-local Paper Account.

## Run locally

Requirements: **Node.js 22.12+**, **Python 3.12+**, network access for Yahoo Finance, and a modern browser supporting **Web Locks** and local storage. Chrome/Edge on `localhost` or `127.0.0.1` are supported targets.

```sh
npm install
npm run setup:analysis
npm run dev
```

Open **http://127.0.0.1:5173**. The launcher starts and stops all three local services. Windows setup uses `py -3.12`; other platforms use `python3`. Set `PYTHON` to an executable path before setup if needed. The provided virtual environment takes precedence afterward.

Optional integrations: copy `.env.example` to `.env`, fill only the services you use, then restart. Charts, backtesting, fundamentals, and Random Forest training need no API key. Missing Finnhub removes suggestions, not direct ticker entry. Missing IB or chat does not disable research.

### Built deployment

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Express serves `frontend/dist` and `/api` from one loopback origin; Python remains a separate local process. `npm run preview` only previews static assets, not a complete live deployment.

Changing origin changes browser-local storage. Development (`:5173`) and built deployment (`:3001`) have separate Paper Accounts, watchlists, and drawings.

### Explicit static preview

`http://127.0.0.1:5173/?demo=1` uses the included **generated, fictional NVDA bars**, clearly labeled. No live orders, Paper fills, model predictions, or chat are enabled there. Do not interpret preview prices as historical market data.

```sh
npm run build:demo
npm run preview
```

`frontend/dist` from `build:demo` can be published as a static site, including a GitHub Pages subdirectory. Relative asset paths work without a server-side router. Re-run `npm run build` before a normal live deployment.

## Workspace

- **Research:** type a ticker directly or press `/`; select suggestions with arrows and Enter. Open stocks from watchlists, screen results, or holdings. Daily candles load recent-first; older history, fundamentals, and predictions have independent loading/error states. Switching symbols aborts previous requests.
- **Chart:** daily/weekly/monthly candles and volume; configurable MA 10/20/50/150/200 and volume MA 20; swing zones and four heuristic price-pattern families. Trend line, horizontal line, ray, rectangle, and price-range tools persist per symbol. Click a drawing to select it; Delete removes it, Esc cancels drawing. CSV exports loaded bars. Drag order lines or preview labels to open/update an unsubmitted review ticket.
- **Screener:** paste/import symbols, tune all enabled conditions, scan sequentially with progress, cancel, navigate results by keyboard, and reuse fetched chart history. Failed symbols are counted as skipped.
- **Backtest:** entry/exit comparisons on close, 2–500-period MA, or fixed numbers; daily/monthly evaluation; immediate or weekly/monthly staged exits; all requested metrics, equity curve, trade list, and chart markers. No account changes.
- **Paper Account:** $100,000 initial simulated cash, reservations, whole-share limit orders, BUY brackets, OCO exits, no shorts/margin, DAY/GTC/IOC/FOK rules, bounded terminal history. Fresh quote snapshots (no older than five minutes) drive fills while the app runs; cached/replayed provider timestamps never create a new fill. One primary tab writes; other tabs synchronize read-only. Invalid or unsavable data blocks trading rather than resetting it. Settings offers export and an explicitly confirmed destructive reset with chosen cash.
- **IB:** connection status, masked read-only display-account selector, account/margin/P&L/allocation overview, holdings, risk/freshness warnings, pending orders, reviewed limit/bracket submission, confirmed price modifications, cancellation. **Display-account selection never changes order routing.** Overview reports USD stock holdings; unsupported assets/currencies are explicitly warned and omitted, never relabeled as USD.
- **AI:** configured OpenAI-compatible model selection, latest 500 chart bars, fundamentals, prediction, recent turns, and allowlisted read-only active-mode account context. `deepseek-*` models may propose validated order drafts; unsupported structured responses fall back to plain answers. Drafts only open the normal review ticket.
- **Usability:** English/Traditional Chinese, keyboard search and result navigation, native labeled controls, focus-managed dialogs, resizable research/chat/account panels, account maximization, and narrow-screen chart navigation.

## Configuration

| Variable | Purpose / default |
| --- | --- |
| `API_PORT` | Express loopback port, `3001` |
| `ANALYSIS_PORT` | Python loopback port, `8000` |
| `ANALYSIS_BASE_URL` | `http://127.0.0.1:8000`; update if changing analysis port |
| `ANALYSIS_TIMEOUT_MS` | Maximum research request duration; sample configuration uses `90000` |
| `YAHOO_TIMEOUT_SECONDS` | Provider timeout, `12` |
| `FINNHUB_API_KEY` | Optional symbol autocomplete |
| `IB_HOST`, `IB_PORT`, `IB_CLIENT_ID` | Existing TWS/Gateway API socket; defaults `127.0.0.1`, `7497`, `17` |
| `IB_ACCOUNT` | Optional fixed routing account; never changed by display selection |
| `IB_REQUEST_TIMEOUT_MS` | IB request timeout, `8000` |
| `IB_SNAPSHOT_MAX_AGE_MS` | Snapshot staleness threshold, `90000` |
| `CHAT_BASE_URL` | OpenAI-compatible base URL (usually including `/v1`) |
| `CHAT_API_KEY` | Optional bearer credential for provider; keep in `.env` |
| `CHAT_MODEL` | Default model ID |
| `CHAT_TIMEOUT_MS` | Provider timeout; sample configuration uses `60000` |
| `ANALYSIS_CACHE_DIR` | Optional private directory for market/model caches |

The Vite development proxy expects API port 3001; if changing it, also update `frontend/vite.config.js`. Settings intentionally does not expose credential editing: browser deployment reads local environment configuration. `.env` is ignored by version control.

### Interactive Brokers setup

Start an existing TWS or IB Gateway, enable its socket API, allow localhost, and match the port/client ID. TWS paper commonly uses 7497; Gateway paper commonly uses 4002. These are conventions, **not a safety guarantee**. Use an IB paper-trading account for development. API read-only configuration in TWS must be disabled only if you intend to submit trades.

The app never logs into IB for you. Disconnection forces active Paper Mode without replacing a saved Live preference. Reconnection can restore Live Mode. Paper Orders never migrate to IB. Backend order checks enforce the ticket schema; a successful request still does not mean a fill.

## API overview

All routes below are under `/api`; details are in [backend/README.md](backend/README.md) and [analysis/README.md](analysis/README.md).

| Method | Route | Result |
| --- | --- | --- |
| GET | `/health`, `/ib/status` | Independent service and broker availability |
| GET | `/search?q=NVDA` | Finnhub suggestions or empty results when unconfigured |
| GET | `/history/:symbol?interval=1d&period=6mo` | Normalized chronological OHLCV; intervals `1d`, `1wk`, `1mo`; periods `6mo`, `1y`, `2y`, `5y`, `max` |
| GET | `/quotes?symbols=NVDA,AAPL` | Lightweight snapshots and per-symbol errors; max 50/request |
| GET | `/fundamentals/:symbol` | Nullable company snapshot fields |
| GET | `/prediction/:symbol`, `/models/:symbol` | Daily Random Forest signal / cache status |
| POST | `/models/:symbol/retrain` | Retrain daily model |
| POST | `/backtest` | Metrics, equity, and simulated actions; no order side effects |
| GET | `/accounts`, `/account?account=...`, `/orders` | Read-only IB snapshots; account query only changes display |
| POST | `/orders` | Explicitly reviewed whole-share limit/bracket ticket |
| PATCH | `/orders/:id` | Price-only change, not quantity changes |
| DELETE | `/orders/:id` | Cancellation request |
| GET | `/chat/models` | Configured models |
| POST | `/chat` | Answer and optional validated, unsubmitted draft |

### Strategy request

```json
{
  "symbol": "NVDA", "interval": "1d", "period": "2y", "initialCapital": 100000,
  "entry": {"left": {"type": "close"}, "operator": ">", "right": {"type": "ma", "period": 50}},
  "exit": {"left": {"type": "close"}, "operator": "<", "right": {"type": "ma", "period": 50}},
  "frequency": "daily", "exitMode": "immediate", "exitPeriods": 3, "exitFrequency": "weekly"
}
```

Return metrics are fractions: `0.10` means 10%. Unknown/non-finite values are `null`, not invented zeros. Daily entry requires a false-to-true transition; monthly checks the first available bar of each month. Fills use the signal close, fractional all-cash entries are allowed, final positions liquidate, and no commissions/slippage/partial fills/shorting are modeled. Staged exits count separate sell tranches. See analysis README for exact calculations, cache behavior, purged model evaluation, and corporate-action limitations.

## Tests

```sh
npm test
npm run test:analysis
npm run build
```

Optional full browser regression (native `agent-browser`, no extra test framework):

```sh
npm install -g agent-browser
agent-browser install
npm run test:browser
```

Browser regression serves an isolated fixture origin with **no broker client or credentials**. It checks review-before-submit, Paper-only routing, reservations/fills, modification confirmation, secondary-tab ownership and automatic takeover, corruption/reset/storage-failure handling, partial-history preservation, screener skips, backtest/AI non-execution, ticket invalidation on disconnect, mode preference failures, language, and mobile layout. `AGENT_BROWSER_SCRIPT` can point to a nonstandard global installation's `bin/agent-browser.js`. Screenshots go to ignored `artifacts/`.

## Safety and limitations

**This unauthenticated application is for your own computer. Do not expose either API to untrusted networks. Development CORS permits loopback origins only; a hidden or disabled control is not authorization. Live Mode can place real trades.**

Yahoo data and IB snapshots can be delayed or stale; polling is not provider freshness. Model confidence is not a calibrated investment-success probability. Heuristic chart patterns and historical simulations are research aids, not financial advice.

Paper Account storage is origin-specific and can be deleted by browser cleanup. It requires usable storage and Web Locks, executes only while the app is open, does not replay missed market movements, and uses local midnight rather than an exchange calendar for DAY expiry. Reset is destructive. Cached model artifacts are local executable pickle/joblib data: keep the cache private; never import untrusted model files.

Chat sends the supplied research and sanitized account context to your chosen provider. There is no news search, execution tool, cloud synchronization, whole-market scan service, intraday-chart guarantee, portfolio optimization, or desktop app.

## Source map

- `frontend/src/App.jsx`, `useStock.js`, `useServices.js`: workspace orchestration and independent data loading.
- `frontend/component/`: chart/drawings, screening, backtests, chat, portfolio, orders, review tickets, settings.
- `frontend/src/paperAccount.js`, `usePaperAccount.js`: pure simulation and fail-closed persistence/ownership.
- `backend/`: Express proxy, provider chat safety, IB adapter and API validation.
- `analysis/`: Yahoo market data, backtest engine, Random Forest model training/cache.
- `scripts/`: service lifecycle, environment setup, generated preview, browser regression.
- [CONTEXT.md](CONTEXT.md): precise account, mode, submission, and draft terminology.
