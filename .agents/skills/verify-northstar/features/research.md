# Screener and strategy backtest

Users scan a supplied list, inspect matching charts, and run a strategy simulation without creating account orders.

## Sub-features

- `research-scan`: enabled conditions combine, failed symbols count as skipped.
- `research-results`: result selection opens a chart; keyboard and cancel paths.
- `research-backtest`: strategy form returns metrics, equity curve, and actions without account changes.

## How to get to it (user POV)

- Screener or Backtest buttons in the right navigation rail.
- Screener symbol textarea/file import, Run scan, result rows.
- Backtest strategy form and Run backtest.

## Driving it with agent-browser

Preconditions: `npm run test:browser` fixture session, English, 1500x950 viewport. Commands refer to the existing harness sequence; do not attach a second driver.

- **Scan:** `find role button click --name Screener --exact`; `fill '.research-symbol-input' 'NVDA,AAPL,BAD'`. Harness disables condition toggles 0 and 2 and sets `.research-condition-number input` to 100 through UI controls, then scrolls `.research-screener .research-actions .button.primary` into view and clicks Run scan. Require `.research-progress` contains `2 matches, 1 skipped` and exactly two `.research-result` rows.
- **Open result:** snapshot results and click an AAPL result's current ref; require heading AAPL and usable canvas. Also test keyboard ArrowDown/Enter from result list and Cancel during an active scan when extending coverage. These alternatives are not currently asserted by the regression.
- **Backtest:** `find role button click --name Backtest --exact`; scroll `.research-backtest .research-actions .button.primary` into view; click Run backtest. Require `.research-backtest-results`, one fixture request, and unchanged persisted account positions/cash. Capture strategy inputs, resulting metrics, equity curve, and trade list.

## Gotchas

- Static demo cannot POST backtests. Use fixture regression or live research services.
- Fixture backtest metrics are canned (10% total return, one trade); they prove UI rendering and no account mutation, not engine math. Use `npm run test:analysis` for calculations.
- File import, cancellation, keyboard results, rule combinations, and nondefault strategies require separate proofs. Do not certify them from default Run scan/Run backtest.
