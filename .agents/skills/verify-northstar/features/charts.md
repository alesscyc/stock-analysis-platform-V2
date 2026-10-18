# Charts and technical overlays

Users inspect NVDA candles, switch intervals, configure persisted indicators, draw annotations, and export loaded bars.

## Sub-features

- `chart-indicators`: MA 10 visibility persists across navigation.
- `chart-intervals`: D/W/M changes selected interval and candles.
- `chart-drawings`: select/pan, Trend line, Horizontal line, Ray, Rectangle, Price range; select/delete and Escape cancellation.
- `chart-export`: CSV exports loaded OHLCV.

## How to get to it (user POV)

- Default NVDA workspace opens the chart directly.
- Search, watchlist, screener results, or portfolio holdings open a symbol's chart; those entries need their own proof.
- Chart toolbar provides D/W/M, Indicators, drawing tools, Fit all history, and CSV.

## Driving it with T3 preview

Preconditions: default isolated demo launch and Doctor pass; English UI, NVDA canvas visible. Use the retained `tabId` on every call.

- **Before:** `preview_evaluate` reads `localStorage.getItem('northstar.indicators')`; save initial snapshot and screenshot. Fresh state defaults MA 10 off; if already on, toggle to the opposite value and record that baseline.
- **Open indicators:** `preview_click({tabId, locator: 'summary:has-text("Indicators")'})`. Snapshot shows checkbox `MA 10` and neighboring indicators.
- **Toggle:** `preview_click({tabId, locator: 'role=checkbox[name="MA 10"]'})`. Read DOM checkbox and `JSON.parse(localStorage.getItem('northstar.indicators')).ma10`. Both must change; save snapshot/screenshot with menu open and chart visible.
- **Persistence:** `preview_navigate({tabId, url: 'http://127.0.0.1:5187/?demo=1'})`, wait for chart canvas, reopen Indicators, and require same checked state and stored value. Read network resource URLs and assert no `/api/` requests. Save after evidence; this completes `chart-indicators`.
- **Intervals:** close Indicators, click `role=button[name="W"]`, then M and D. Each must have `aria-pressed=true` and chart header 1W/1M/1D respectively. Capture candle changes; selected button alone is insufficient.
- **Drawings:** choose a named drawing tool, snapshot chart bounds, click appropriate chart points with `preview_click` coordinates relative to those bounds. Capture preview, completed overlay, reload persistence, selection and Delete. Escape must cancel an unfinished drawing. Coordinates depend on viewport and are never hardcoded.
- **CSV:** click `role=button[name="CSV"]`, inspect `preview_status` downloads, and read the downloaded CSV. Require OHLCV headers, chronological dates, and rows matching loaded sample/selected interval. Keep file with proof.

## Gotchas

- Indicators is a native `summary`, not a button. Checkbox state and storage prove preference persistence; inspect screenshots for actual overlay rendering.
- Static preview aggregates fictional bars for weekly/monthly views. It does not prove provider interval data.
- Drawings are per symbol; indicator preferences are shared within origin. Do not erase user storage.
- Preserve TradingView attribution. A canvas existing alone does not prove chart correctness.
