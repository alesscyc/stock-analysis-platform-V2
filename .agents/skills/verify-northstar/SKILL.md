---
name: verify-northstar
description: Verify Northstar Stock Analysis Platform's browser UI, charts, research panels, and simulated Paper Account after UI or behavior changes. Use isolated static preview for chart proofs and the existing fixture browser regression for order, screener, backtest, and AI flows.
---

# Verify Northstar

Read [features/README.md](features/README.md) first. The primary surface is React in a browser. Express `/api` and the Python research service are secondary surfaces; a static or fixture proof does not prove Yahoo, model training, chat providers, or IB connectivity.

## Launch

Run from the repository root in PowerShell. Node >=22.12 and installed npm dependencies are required (`npm ci` if absent). Do not print `.env` or load credentials for verification.

### Interactive chart proof (default)

Check that port 5187 is unused with `Get-NetTCPConnection -LocalPort 5187 -State Listen -ErrorAction SilentlyContinue`. If occupied, select another unused loopback port and use it consistently; never stop its owner. Run:

```powershell
New-Item -ItemType Directory -Force artifacts/verify-northstar | Out-Null
node node_modules/vite/bin/vite.js --config frontend/vite.config.js --host 127.0.0.1 --port 5187 --strictPort
```

Keep this command in an owned terminal session; retain its session ID. Ready means Vite prints `ready` and `http://127.0.0.1:5187/`. Record the listener PID and verify its command line points to this checkout's Vite invocation. Open **http://127.0.0.1:5187/?demo=1**, always including the query. Use a new incognito preview tab. This uses the checked-in fictional NVDA sample at `frontend/public/demo/NVDA.json`; it needs no Python, authentication, API key, or backend. The Vite proxy still points at 3001: do not remove `?demo=1` or follow `Local workspace`/`Northstar home` during this proof.

### Fixture regression (Paper/research flows)

Use the existing harness, not a new framework:

```powershell
agent-browser skills get core
npm run test:browser 2>&1 | Tee-Object artifacts/verify-northstar/regression.txt
$regressionExit = $LASTEXITCODE
if ($regressionExit -ne 0) { throw "Browser regression failed: $regressionExit" }
```

Create the evidence directory as above first. If missing, install the documented prerequisites with `npm install -g agent-browser` and `agent-browser install`. A nonstandard global installation needs `AGENT_BROWSER_SCRIPT` pointing to its `bin/agent-browser.js`. The npm script builds normal production assets, then `scripts/browser-check.mjs` starts a loopback server on an OS-selected port and a browser session named `northstar-check-<Node PID>`. It drives the real built frontend through fixture HTTP boundaries, without importing a broker client or credentials. Do not manually drive this session while the script runs. Successful completion includes `Browser regression passed (... fixture requests, 0 live writes).` and exit 0; it closes the browser and server in `finally`, also on assertion failures.

The fixture is an automated, self-contained launch/drive/cleanup path, not a persistent interactive server. Its quote-price changes, connection changes, and provider failures are fixture controls, not user actions. No fixture result proves real provider behavior. Serialize fixture runs: their screenshots and `frontend/dist` output paths are shared.

### Live services (only when needed)

Documented launch is `npm run setup:analysis`, then `npm run dev` (web 5173, API 3001, analysis 8000). Python 3.12+ and Yahoo network access are required. `GET http://127.0.0.1:3001/api/health` checks service availability. This path reads local `.env` and may connect to IB; it is not the default verification environment. Never submit, modify, cancel broker orders, send provider chat, or reset the user's account as an incidental smoke check. Stop the owned launcher with Ctrl+C. Parallel full-service runs need separate API/analysis/cache settings and a matching Vite proxy; the checked-in proxy is fixed at API 3001.

## Doctor

Run this read-only check before driving the default preview and whenever something looks wrong:

```powershell
$listener = Get-NetTCPConnection -LocalPort 5187 -State Listen -ErrorAction Stop
$listener | Select-Object LocalAddress, LocalPort, OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" | Select-Object ProcessId, CommandLine
$page = Invoke-WebRequest 'http://127.0.0.1:5187/?demo=1' -UseBasicParsing
$sample = Invoke-RestMethod 'http://127.0.0.1:5187/demo/NVDA.json'
if ($page.StatusCode -ne 200 -or $sample.symbol -ne 'NVDA' -or !$sample.candles.Count) { throw 'Wrong or unready Northstar preview' }
```

Require loopback address, the PID you launched, the correct checkout/config/port, and nonempty sample candles. Then snapshot the tab: require `NVDA`, `GENERATED PREVIEW`, chart canvas, and disabled `Trade`/`Live`. A responding port alone is insufficient. Record doctor output in the evidence directory. For fixture regression, the initial chart/Trade readiness wait and first `PASS: candles usable independently of model failure; Paper Account initialized.` form its built-in instance check; diagnose failures from the harness transcript and failure snapshot rather than attaching to an unrelated app.

## Drive

Prefer T3 collaborative preview tools for interactive verification. Call `preview_status`, then `preview_open` with `profileId: "incognito"`, `reuseExistingTab: false`, and the exact demo URL. Retain `tabId` and pass it on every call. Use `preview_snapshot` before interacting; use snapshot refs or stable locators with `preview_click`. Respect human ownership. If preview automation is explicitly unavailable, use the installed agent-browser workflow in a unique `--session northstar-verify-<run-id>` session and close only that session.

The default acceptance recipe is [chart indicators](features/charts.md): capture before state, open `summary` with text `Indicators`, toggle `MA 10`, verify stored preference and visible checkbox, navigate to the same demo URL, reopen Indicators, verify persistence, capture after state. `preview_evaluate` may read DOM/storage/network entries for assertions; do not use it to set app state instead of clicking UI. Every feature file distinguishes static, fixture, and live requirements. Other features use the existing agent-browser harness; the map names its exact commands for extending or diagnosing that sequence. Run the whole harness rather than claiming an isolated snippet provides its fixture setup.

## Evidence

Keep proof under ignored `artifacts/verify-northstar/`; use a run-specific subdirectory when preserving multiple runs. Record feature IDs, entry points, URL, checkout revision (`git rev-parse HEAD`), dirty state, actions, before/after assertions, stdout/stderr, exit codes, and skipped paths in `proof.md` or JSON. Save accessibility snapshots before and after. T3 `preview_snapshot` with `save: true` returns `screenshotPath`; copy that PNG into this directory before closing the tab. Save snapshot structured text separately; a screenshot alone does not show the action.

For indicator proof, capture `northstar.indicators` read-only before clicking, after clicking, and after navigation; compare `ma10` and unchanged neighboring values. Inspect browser network entries or resource URLs for unexpected `/api/` calls; include the observed list. The static label is not enough to prove no integration requests occurred. For downloaded CSV/account JSON, inspect the downloaded file, header/schema, and values alongside the UI action. Do not write exports into tracked source paths.

Fixture regression already asserts persisted account cash/positions, review-before-submit, and zero broker writes. Its transcript records those assertions and recent requests on failure; screenshots are `artifacts/browser-check-mobile.png` or `artifacts/browser-check-failure.png`. Copy relevant images into the proof directory before another run overwrites them. Failure images may be stale: check timestamps. Destructive storage/corruption tests in this harness affect only its isolated origin/session. Mocks are limited to provider/API boundaries; fixture backtest/chat responses do not verify actual calculations or provider answers. A final screen or a generic PASS does not certify unexercised entry points.

## Cleanup

Always clean up after success and failed iterations. Close only the preview tab created for this run with `t3_preview_close({tabId})`. For agent-browser fallback, run `agent-browser --session <recorded-session> close`. Stop Vite with Ctrl+C in the recorded terminal; if that fails, recheck listener PID and command line, then stop only the process tree you started (`taskkill /PID <recorded-pid> /T /F`). Never kill by process name or evict another port owner. The fixture harness has its own `finally`; if externally interrupted, close its recorded `northstar-check-<PID>` session and stop only its recorded Node PID.

Use disposable origin and browser state; never clear storage in a user tab. Incognito may be shared by other incognito tabs, so use a fresh port for each new proof and do not erase the whole profile. Concurrent dev previews require distinct ports/tabs; never double-drive one instance. Do not remove `artifacts/`. After cleanup, confirm the recorded listener is gone and `Get-ChildItem artifacts/verify-northstar -Recurse` still shows the transcript, snapshots, and screenshots.

## Helpers

No new helper is needed. `npm run test:browser` invokes the existing executable Node harness `scripts/browser-check.mjs` after building. `npm test` and `npm run test:analysis` are complementary unit/service checks, not substitutes for user-path proof. Maintain this map with `/maintain-verification-skill` when behavior changes.
