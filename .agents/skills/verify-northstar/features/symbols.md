# Symbols and watchlist

Users enter tickers directly, use keyboard discovery, and save symbols for later chart navigation.

## Sub-features

- `symbol-direct`: direct ticker entry works without Finnhub suggestions.
- `symbol-keyboard`: slash focuses search; typing outside editors starts search; Escape dismisses.
- `symbol-watchlist`: add, remove, select, keyboard navigation, persistence.
- `symbol-alternates`: screener results and portfolio holdings also navigate to charts.

## How to get to it (user POV)

- Header Search symbol combobox, `/`, or typing outside editable fields.
- Right rail Watchlist, instrument star, or Add selected symbol to watchlist.
- Screener result rows or Portfolio holding rows.

## Driving it with agent-browser

Preconditions: existing fixture harness owns a fresh session and serves fixture history for NVDA/AAPL; run `npm run test:browser`. Commands below describe its sequence or additions inside that harness, not commands to race against it. Every invocation uses `--session northstar-check-<PID>`.

- **Direct ticker:** `fill '.symbol-search input' AAPL`, then `press Enter`. Wait for `h1` AAPL, canvas retained, and `Partial history` during the harness's older-history failure. Restore NVDA through the same input. Existing assertion prints `PASS: direct ticker without Finnhub; older-history failure preserves visible candles.`
- **Keyboard:** focus a noneditable control, `press m`, then assert search focus and value M; `press Escape`. For slash, focus a noneditor and `press /`; require Search symbol focus. Slash is a mapped extension, not an existing regression assertion.
- **Saved symbol:** `find role button click --name Watchlist --exact`; select `.watch-symbol` containing AAPL, require h1 AAPL. Use `find role button click --name 'Remove AAPL' --exact`, then `find role button click --name 'Add selected symbol to watchlist' --exact`; reload and verify AAPL remains. Snapshot before/after and read `northstar.watchlist` without writing it. These mutations need additional harness actions; current regression only samples watchlist navigation.
- **Alternate entries:** follow research result recipe or fill a Paper position, then choose its symbol row and assert heading/chart. Record each entry separately; do not count direct input as holdings/result coverage.

## Gotchas

- Static preview accepts NVDA only; AAPL search there intentionally refuses navigation.
- Fixture search returns no suggestions. Arrow-key suggestion selection needs a configured Finnhub or explicit suggestion fixture.
- Watchlist row accessible names include prices; scoped CSS plus current snapshot avoids guessing full dynamic names.
