# Implementation coordination

Build the complete browser scope of `docs/product-spec.md` and `docs/features.md`. User explicitly waived the desktop app; DO NOT build Electron or desktop packaging. Those two source docs are authoritative. This file records the implementation work split and integration contracts. No placeholder providers and no real order submissions in tests. Work in assigned files only; no commits needed.

## Ownership
- Main agent: root tooling, frontend app shell, chart/drawings/patterns, trade/account/settings UI, styling, integration, documentation.
- analysis agent: `analysis/**` only, including requirements and tests.
- services agent: `backend/**` only, including tests. Desktop app waived; omit desktop settings endpoints (health desktop:false).
- paper agent: `frontend/src/paperAccount.js`, `frontend/src/usePaperAccount.js`, `frontend/src/paperAccount.test.js` only.
- research agent: `frontend/component/ScreenerDialog.jsx`, `BacktestDialog.jsx`, `AIChat.jsx`, `frontend/src/research.js`, `research.test.js` only.

## Shared contracts
ES modules, React JSX. Root npm package installs react, react-dom, vite, @vitejs/plugin-react, lightweight-charts (v5), express, cors, dotenv, @stoqey/ib. No Electron. Use native fetch and Node test runner. Python 3.12 is available via `py -3.12`; root launch script uses analysis/.venv when present. Analysis service default loopback port 8000; Express loopback 3001; Vite 5173 proxies `/api`.

Backend exports `createApp(...)` for tests; executable `node backend/server.js`. Python executable entry `analysis/stock_data.py`, HTTP server port via ANALYSIS_PORT env. Frontend helpers created by main: `frontend/src/api.js`: `api(path, options={})` returns parsed JSON or throws Error; accepts AbortSignal and JSON body object. `frontend/src/ui.jsx`: `tx(lang,en,zh)`, `Icon({name,size=18})`, `Modal({title,onClose,children,wide})`, `Notice({children,tone})`, `useStored(key,fallback)`. All components named default exports. Shared classes: button (primary/danger/ghost/small), input, select, field, row, stack, muted, badge, panel-header, panel-body, metric, metrics, table, notice, empty, form-grid. Language props `lang` = en or zh-TW. Label every control and translate user-facing UI via tx.

### Market API (Express proxies analysis)
- GET `/api/health` -> `{status, analysis:boolean, ib:{connected:boolean,error?:string}, desktop:boolean}`
- GET `/api/history/:symbol?interval=1d|1wk|1mo&period=6mo|1y|2y|5y|max` -> `{symbol,interval,candles:[{time:'YYYY-MM-DD',open,high,low,close,volume}],asOf,source}`
- GET `/api/quotes?symbols=AAPL,NVDA` -> `{quotes:[{symbol,price,previousClose,change,changePercent,asOf}],errors?:[]}`. Express may fan out analysis requests but analysis preferably supports same route.
- GET `/api/fundamentals/:symbol` -> `{symbol,name,currency,marketCap,trailingPE,forwardPE,trailingEps,dividendYield,sector,industry,beta,fiftyTwoWeekLow,fiftyTwoWeekHigh,averageVolume}` nullable fields. Dividend yield is a fraction (0.0044 = 0.44%).
- GET `/api/prediction/:symbol` -> `{symbol,signal:'BUY'|'SELL',confidence:0..1,probabilities:{BUY,SELL},training:{trainedAt,samples,accuracy,trainSamples,testSamples,gapBars:22}}`
- GET `/api/models/:symbol` -> model cache status; POST `/api/models/:symbol/retrain` -> prediction.
- POST `/api/backtest` body `{symbol,interval:'1d'|'1wk'|'1mo',period:'1y'|'2y'|'5y'|'max',initialCapital,entry:{left:{type:'close'|'ma'|'number',period?:number,value?:number},operator:'>'|'<'|'>='|'<=',right:{...}},exit:{left,operator,right},frequency:'daily'|'monthly',exitMode:'immediate'|'staged',exitPeriods:3,exitFrequency:'weekly'|'monthly'}` -> `{metrics:{totalReturn,cagr,sharpe,maxDrawdown,winRate,tradeCount,averageReturn,averageLoss,profitFactor},actions:[{time,side:'BUY'|'SELL',price,quantity,reason,pnl?}],equity:[{time,value}],...}`. Returns percentages as fractions, non-finite metrics null.
- GET `/api/search?q=...` -> `{results:[{symbol,description}]}`; missing Finnhub returns empty results.

### Broker / chat / settings API
- GET `/api/ib/status` -> `{connected,error?}`
- GET `/api/accounts` -> `{accounts:[{id,label}],selectedAccount?:string}`; label masked.
- GET `/api/account?account=...` -> `{accountId,asOf,currency:'USD',summary:{netLiquidation,cash,buyingPower,availableFunds,excessLiquidity,maintenanceMargin,grossPositionValue,unrealizedPnl,realizedPnl},positions:[{symbol,quantity,averageCost,price,marketValue,unrealizedPnl}],warnings?:[],error?:string}`. Display selection MUST NOT alter routing.
- GET `/api/orders` -> `{orders:[{id,symbol,side,quantity,limitPrice,stopPrice?,type:'LMT'|'STP',tif,status,parentId?,bracketRole?,filled?,createdAt?,manageable?}]}`. Foreign or unsupported orders are read-only.
- POST `/api/orders` -> explicit user ticket `{symbol,side,quantity,limitPrice,tif,takeProfit?:number,stopLoss?:number}` -> `{orders:[...]}`. Validate all input, stable IDs; route configured IB_ACCOUNT only if configured otherwise IB default.
- PATCH `/api/orders/:id` -> `{limitPrice?:number,stopPrice?:number}`, never quantity edit. DELETE -> cancel. Response broker acceptance is not a fill.
- GET `/api/chat/models` -> `{models:[{id}],configured:boolean}`
- POST `/api/chat` -> `{symbol,candles(max500),fundamentals,prediction,messages:[{role,content}],accountContext}` -> `{answer,draft?:{symbol,side,quantity,limitPrice,tif,takeProfit?,stopLoss?}}`. Backend sanitizes supplied account; never trading tools. deepseek-* structured only, fallback plain responses.
- No credential-editing or desktop settings endpoints. Browser Settings manages local preferences and model-cache actions; provider configuration stays in `.env`.

### Paper engine / hook
Pure engine exports documented by paper agent. Hook `usePaperAccount()` returns `{account,ready,writable,error,primary,submitOrder(ticket),modifyOrder(id,patch),cancelOrder(id),reset(startingCash),applyQuotes(quotes)}`. Async mutation methods reject on failure. Account `{version:1,startingCash,cash,realizedPnl,positions:[{symbol,quantity,averageCost}],orders:[order],history:[terminalOrder],quotes:{[symbol]:{price,asOf}},updatedAt}`. Paper order `{id,symbol,side,quantity,limitPrice,tif,status,parentId?,bracketRole?:'takeProfit'|'stopLoss',type:'LMT'|'STP',stopPrice?,createdAt,expiresAt?}`. Active statuses `pending` and `held` (held child does not reserve twice); terminal history `filled`,`cancelled`,`expired`. Must persist before publishing mutation; storage invalid/unsavable blocks writes; one primary Web Lock owner; secondary tabs read-only; no silent reset; fresh incoming quote only drives fills, no replay. No short/margin, BUY bracket DAY/GTC only, no SELL brackets. Hook may expose helpers `paperSummary(account)` and `availableResources(account,symbol)` as named engine exports main can use.

### Research component props
- `<ScreenerDialog lang onSelect(symbol,candles) />` renders sidebar contents (NOT modal). Progressive sequential scan, file import, cancel, mini candles, keyboard selection. Uses market API. Can use `research.js` shared pure helpers.
- `<BacktestDialog lang symbol onResult(result) />` renders sidebar contents (NOT modal). Full settings persistence, all strategy options + metrics, equity visualization; actions fed to main chart via onResult.
- `<AIChat lang symbol candles fundamentals prediction accountContext onDraft(ticket) />` renders right-panel contents. Model selection, configured/unavailable states, cancel requests, sends only provided read-only data; approved draft button calls onDraft, never submit.

## Testing
Each owner adds runnable focused regression tests, runs them, reports exact command/result. Main integrates all. No actual broker orders. External failure must stay explicit/localized, no synthetic data passed as real quotes. Optional static demo will be explicitly labeled and disable live routing.
