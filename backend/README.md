# Express backend

Run from repository root with `node backend/server.js`. Server binds to `127.0.0.1` only. API has no authentication: do not expose it to untrusted networks. Development CORS accepts loopback origins only. Desktop/settings-secret routes are not implemented.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_PORT` | `3001` | Express loopback port |
| `ANALYSIS_BASE_URL` | `http://127.0.0.1:8000` | Python analysis service base URL |
| `ANALYSIS_HEALTH_PATH` | `/health` | Analysis health route |
| `ANALYSIS_TIMEOUT_MS` | `90000` | Analysis request deadline, including response body |
| `IB_HOST` | `127.0.0.1` | IB Gateway/TWS host |
| `IB_PORT` | `7497` | IB socket port; TWS paper default. Gateway paper commonly uses `4002` |
| `IB_CLIENT_ID` | `17` | API client ID; must be unique per Gateway/TWS instance |
| `IB_ACCOUNT` | unset | Fixed order destination. Unset leaves account routing to IB's configured default |
| `IB_REQUEST_TIMEOUT_MS` | `8000` | IB snapshot/order-list request deadline |
| `IB_SNAPSHOT_MAX_AGE_MS` | `90000` | Account snapshot freshness threshold |
| `FINNHUB_API_KEY` | unset | Enables `/api/search`; without it returns `{ "results": [] }` |
| `FINNHUB_BASE_URL` | `https://finnhub.io/api/v1` | Finnhub-compatible search API base |
| `FINNHUB_TIMEOUT_MS` | `8000` | Search deadline |
| `CHAT_BASE_URL` | unset | OpenAI-compatible API root, such as `https://api.example/v1` |
| `CHAT_API_KEY` | unset | Optional Bearer key; never returned by an API route |
| `CHAT_MODEL` | unset | Default model; request may select a listed model with `model` |
| `CHAT_TIMEOUT_MS` | `30000` | Chat/model-list deadline, including response body |

IB requires API socket access enabled in Gateway/TWS. Use a paper account for development. `IB_ACCOUNT` controls order routing independently of the account displayed by `GET /api/account?account=...`.

## Integration behavior

- Market history, quotes, fundamentals, prediction, model status/retraining, and backtests proxy analysis responses without generating market data. Backtest intervals accepted: `1d`, `1wk`, `1mo`.
- Account summaries and positions are read-only IB snapshots. `/api/account` selects configured `IB_ACCOUNT`, otherwise first managed account; `?account=` changes display snapshot only. Account overview is USD-only: non-USD totals/positions are omitted and warned; non-stock positions/P&L are omitted and warned.
- Orders accept whole-share US stock limit tickets, DAY/GTC/IOC/FOK, and optional take-profit/stop-loss children. Brackets use parent/child transmit sequencing and OCA type 1 when both exits exist. A response reports submission state, not a fill.
- Pending compatible USD stock LMT/STP orders are listed. Order status and parent references are scoped by IB client ID so another client's reused numeric order ID cannot change our order state. Orders created by this backend and still attached to its configured IB client/account return `manageable: true`; other compatible stock orders return `manageable: false`. Unsupported security/order types are omitted. Modify/cancel refresh a complete IB open-order snapshot first and reject stale, foreign, or unsupported refs. Quantity changes are not supported.
- Chat sends only validated chart/fundamental/prediction fields and an account-context allowlist. Provider receives this data. No tools or execution calls are supplied. `deepseek-*` models get structured draft requests; unsupported/invalid structured output falls back to a plain answer without a draft.

## Tests

`node --test backend/*.test.js`

IB and external HTTP providers are mocked in tests. Test suite never opens an IB connection or submits a broker order.
