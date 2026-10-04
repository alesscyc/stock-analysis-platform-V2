# Analysis service

Python 3.12 service for Yahoo Finance market data, deterministic strategy simulations, and daily Random Forest signals. Symbol search optionally uses Finnhub; service never submits, modifies, or cancels orders.

## Run

```powershell
py -3.12 -m venv analysis/.venv
analysis/.venv/Scripts/python.exe -m pip install -r analysis/requirements.txt
analysis/.venv/Scripts/python.exe analysis/stock_data.py
```

Service binds only to `127.0.0.1`; `ANALYSIS_PORT` selects port (default `8000`). `YAHOO_TIMEOUT_SECONDS` sets finite external-provider request timeout (2–60 seconds, default 12). `ANALYSIS_CACHE_DIR` changes disk cache location. Do not expose this unauthenticated API to untrusted networks. JSON errors use `{ "error": "...", "code": "..." }`; validation failures are 400, Yahoo rate limits 429, Yahoo timeouts 504, other provider failures 502, and insufficient model history 422. A rate limit starts a shared 60-second cooldown across Yahoo requests; unexpired cache entries remain usable. No stale market data is served after TTL expiry.

Paths accept both `/...` and `/api/...` so Express can proxy without rewriting contracts:

- `GET /health`
- `GET /history/{symbol}?interval=1d|1wk|1mo&period=6mo|1y|2y|5y|max`
- `GET /quotes?symbols=AAPL,NVDA` (up to 50; per-symbol failures appear in `errors`)
- `GET /search?q=...` (top 10 Finnhub matches; missing `FINNHUB_API_KEY` returns `{ "results": [] }`)
- `GET /fundamentals/{symbol}`
- `GET /prediction/{symbol}`
- `GET /models/{symbol}` and `POST /models/{symbol}/retrain`
- `POST /backtest`

Yahoo candles are chronological, date-only, unadjusted OHLC with finite numeric fields; missing Yahoo volume is normalized to zero because candle contract requires a number. Fundamentals preserve unavailable Yahoo fields as `null`; `dividendYield` is always a fraction (`0.01` = 1%), derived from nonnegative annual `dividendRate` divided by positive `regularMarketPrice` (fallback `currentPrice`). If unavailable, only nonnegative `trailingAnnualDividendYield` is accepted as an already-fractional fallback; Yahoo's mixed-convention `dividendYield` field is ignored, otherwise output is `null`. Quotes use latest Yahoo 1-minute bar where available; `asOf` is that provider bar timestamp, or daily bar date on fallback. `fetchedAt` records when service fetched provider data. Neither field is advanced on 30-second cache hits, so repeated cached snapshots keep same `asOf` and cannot masquerade as fresh quotes. `changePercent` uses percentage points (for example, `1.5` means `1.5%`). Quotes are snapshots, not streaming prices. Market cache TTLs: daily history 15 minutes, weekly/monthly history 1 hour, quotes 30 seconds, fundamentals 6 hours. Cache files are atomically written below `.cache/` by default.

## Backtest semantics

Request supports one `entry` and one `exit` comparison (`close`, rolling simple `ma`, or fixed `number`; operators `>`, `<`, `>=`, `<=`). `interval` accepts `1d`, `1wk`, or `1mo`; periods are `1y`, `2y`, `5y`, or `max`. Moving averages require a full window (2–500 bars of requested interval); unavailable warm-up values make that comparison false.

- Long-only, one position at a time; entries invest all available cash and use fractional shares. No borrowing, shorting, commissions, slippage, partial fills, interest, or broker orders.
- Signals and fills both use that bar's close. This close-on-close convention is deliberately simple and can be optimistic because signal close is not known before that close's execution.
- `frequency: daily` evaluates every supplied bar, regardless of interval: every daily bar for `1d`, every weekly bar for `1wk`, every monthly bar for `1mo`. Entry requires a false-to-true condition transition; a condition already true on first observation is not a transition. `frequency: monthly` evaluates only first available bar of each calendar month (on `1mo`, each available monthly candle). Exits use same evaluation checkpoints. Entry bar cannot also exit; no new entry is opened on final bar.
- Immediate exit sells full position on signal close. Staged exit sells first equal tranche on signal close, then at most one tranche per available bar after the next ISO week/month boundary specified by `exitFrequency`; coarse bars can therefore stretch weekly stages across monthly candles. Last tranche absorbs floating-point remainder. If history ends first, remaining shares liquidate at final close. Each sell tranche counts as one trade record. Re-entry cannot happen on a sell bar.
- Any remaining shares liquidate at last available close. Yahoo OHLC is unadjusted (`auto_adjust=False`); simulations do not separately model splits, dividends, or other corporate actions.

Metrics use fractions for returns (`0.10` = 10%):

- `totalReturn`: final marked/liquidated equity divided by initial capital minus one.
- `cagr`: annualized geometric return using actual first-to-last calendar days and 365.25 days/year; `null` when period has no elapsed days.
- `sharpe`: arithmetic mean per-bar equity return divided by sample standard deviation, annualized by `sqrt(252)` for every interval, risk-free rate zero; `null` with fewer than two returns or zero deviation. Weekly/monthly inputs retain this daily factor by product specification, so Sharpe is not interval-adjusted.
- `maxDrawdown`: worst equity/preceding peak minus one; peak starts at initial capital.
- `winRate`: profitable sell tranches divided by all sell tranches; break-even is not a win.
- `tradeCount`: number of sell actions (staged tranches count separately).
- `averageReturn`: arithmetic mean sell-tranche return relative to its entry price. `averageLoss`: mean losing tranche return, signed negative. `profitFactor`: gross realized profit dollars divided by absolute gross realized loss dollars.
- Trade-only metrics are `null` when no qualifying trades exist; `profitFactor` is `null` when no losses exist, rather than non-finite infinity. All non-finite metrics serialize as `null`.

Results are single-symbol research, not execution estimates. Bar close fills, lack of corporate-action processing, and staged tranche accounting are material limitations.

## Random Forest semantics

Matches `D:\stock_analysis_platform` buy/sell model: 16 features covering MA alignment, volume/MA200 trends, 52-week positioning, weekly/monthly price ranges, momentum, and rising versus falling days. Continuous features are rounded to two decimals; binary warmup comparisons are false, matching the reference. Model inputs use adjusted Yahoo daily history (chart/backtest prices stay unchanged). Label at bar `t` is BUY only when close at `t+22` is strictly more than 5% above close at `t`; all other known outcomes are SELL. Last 22 bars lack known labels and never enter training. SELL means “not above +5%,” not necessarily a falling price.

The latest 20% of known labeled samples form chronological holdout; training samples in the 22 raw-bar interval immediately before first holdout sample are purged. Training label end must precede first holdout bar. The same evaluated estimator serves predictions, without a full-history refit: 200 trees, depth 15, minimum split 10, minimum leaf 5, balanced class weights, seed 42. At least 50 complete labeled samples are required; single-class training is supported. Classifier probabilities are not calibrated success odds. Insufficient samples return 422 rather than a synthetic signal. Existing model caches are invalidated by schema version 2.

Models are cached in memory and on disk for four hours. `GET /models/{symbol}` returns `missing`, `ready`, or `expired` cache status and sample metadata; prediction transparently trains missing/expired models. Retrain bypasses model cache. Disk artifacts use joblib pickle format and must remain in this service's private local cache directory; never load artifacts supplied by an untrusted party.

## Tests

```powershell
analysis/.venv/Scripts/python.exe -m unittest discover -s analysis/tests -v
```

Tests use synthetic candles only and make no Yahoo, broker, or order requests.
