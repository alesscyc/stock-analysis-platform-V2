import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { spawn } from "node:child_process";

// Isolated fixture origin: this process has no IB client, credentials, or broker routes.
// Install agent-browser globally first. Build the frontend before running this check.
const session = `northstar-check-${process.pid}`;
const browserScript =
  process.env.AGENT_BROWSER_SCRIPT ||
  (process.platform === "win32"
    ? join(
        process.env.APPDATA,
        "npm/node_modules/agent-browser/bin/agent-browser.js",
      )
    : null);
const command = browserScript ? process.execPath : "agent-browser";
if (browserScript && !existsSync(browserScript))
  throw new Error(
    "Install agent-browser globally, or set AGENT_BROWSER_SCRIPT to its bin/agent-browser.js.",
  );
async function browser(args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      command,
      [
        ...(browserScript ? [browserScript] : []),
        "--session",
        session,
        ...args,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      error = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      error += data;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        code
          ? reject(
              new Error(`${args.slice(0, 2).join(" ")}: ${error || output}`),
            )
          : resolvePromise(output.trim());
      }, 25),
    );
    child.stdin.end(input || "");
  });
}
const evaluate = (script) => browser(["eval", "--stdin"], script);
const wait = (expression) => browser(["wait", "--fn", expression]);
const sample = JSON.parse(
  await readFile("frontend/public/demo/NVDA.json", "utf8"),
);
let quotePrice = 100,
  ibConnected = false,
  liveWrites = 0,
  chatRequests = 0,
  backtests = 0;
let failOlderHistory = false;
const requests = [];
const summary = {
  netLiquidation: 100000,
  cash: 100000,
  buyingPower: 100000,
  unrealizedPnl: 0,
  realizedPnl: 0,
  availableFunds: 100000,
  excessLiquidity: 100000,
  maintenanceMargin: 0,
  grossPositionValue: 0,
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  requests.push(`${req.method} ${url.pathname}`);
  const send = (data, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/health")
      return send({
        status: "ok",
        analysis: true,
        ib: { connected: ibConnected },
        desktop: false,
      });
    if (url.pathname === "/api/search") return send({ results: [] });
    if (url.pathname.startsWith("/api/history/")) {
      const symbol = decodeURIComponent(url.pathname.split("/").at(-1));
      if (
        symbol === "BAD" ||
        (failOlderHistory && url.searchParams.get("period") === "max")
      )
        return send({ error: "Fixture history unavailable" }, 502);
      return send({
        ...sample,
        symbol,
        source: "TEST FIXTURE",
        interval: url.searchParams.get("interval"),
        asOf: new Date().toISOString(),
        candles: sample.candles,
      });
    }
    if (url.pathname === "/api/quotes")
      return send({
        quotes: url.searchParams
          .get("symbols")
          .split(",")
          .map((symbol) => ({
            symbol,
            price: quotePrice,
            previousClose: 99,
            change: quotePrice - 99,
            changePercent: (quotePrice / 99 - 1) * 100,
            asOf: new Date().toISOString(),
          })),
      });
    if (url.pathname.startsWith("/api/fundamentals/"))
      return send({
        symbol: url.pathname.split("/").at(-1),
        name: "Test Company",
        currency: "USD",
        marketCap: 1000000000,
        trailingPE: 20,
      });
    if (url.pathname.startsWith("/api/prediction/"))
      return send({ error: "Fixture model unavailable" }, 422);
    if (url.pathname === "/api/accounts")
      return send({
        accounts: [
          { id: "TEST-1", label: "••••ST-1" },
          { id: "TEST-2", label: "••••ST-2" },
        ],
      });
    if (url.pathname === "/api/account")
      return send({
        accountId: url.searchParams.get("account") || "TEST-1",
        asOf: new Date().toISOString(),
        currency: "USD",
        summary,
        positions: [],
      });
    if (url.pathname === "/api/orders" && req.method === "GET")
      return send({ orders: [] });
    if (url.pathname.startsWith("/api/orders")) {
      liveWrites++;
      return send(
        { error: "No broker exists in browser regression fixture" },
        503,
      );
    }
    if (url.pathname === "/api/chat/models")
      return send({
        configured: true,
        models: [{ id: "deepseek-test-fixture" }],
      });
    if (url.pathname === "/api/chat") {
      chatRequests++;
      return send({
        answer: "Fixture research answer. This is not financial advice.",
        draft: {
          symbol: "NVDA",
          side: "BUY",
          quantity: 2,
          limitPrice: 90,
          tif: "GTC",
        },
      });
    }
    if (url.pathname === "/api/backtest") {
      backtests++;
      return send({
        symbol: "NVDA",
        metrics: {
          totalReturn: 0.1,
          cagr: 0.08,
          sharpe: 1,
          maxDrawdown: -0.04,
          winRate: 1,
          tradeCount: 1,
          averageReturn: 0.1,
          averageLoss: null,
          profitFactor: null,
        },
        actions: [
          {
            time: sample.candles.at(-20).time,
            side: "BUY",
            price: 100,
            quantity: 10,
            reason: "entry",
          },
          {
            time: sample.candles.at(-1).time,
            side: "SELL",
            price: 110,
            quantity: 10,
            reason: "final",
            pnl: 100,
          },
        ],
        equity: [
          { time: sample.candles.at(-20).time, value: 10000 },
          { time: sample.candles.at(-1).time, value: 11000 },
        ],
      });
    }
    return send({ error: "Unknown fixture route" }, 404);
  }
  try {
    const path =
      url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const file = resolve("frontend/dist", `.${path}`);
    if (
      !file.startsWith(
        resolve("frontend/dist") + (process.platform === "win32" ? "\\" : "/"),
      )
    )
      return send({ error: "Invalid path" }, 400);
    const content = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".json": "application/json",
        }[extname(file)] || "application/octet-stream",
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((resolvePromise) =>
  server.listen(0, "127.0.0.1", resolvePromise),
);
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  await browser(["open", origin]);
  await browser(["set", "viewport", "1500", "950"]);
  await wait(
    `document.querySelector('.chart-footer')?.textContent.includes('1,144')`,
  );
  await wait(
    `Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).some(k=>k.includes('paper')&&localStorage.getItem(k)?.includes('startingCash'))`,
  );
  console.log(
    "PASS: candles usable independently of model failure; Paper Account initialized.",
  );
  failOlderHistory = true;
  await browser(["fill", ".symbol-search input", "AAPL"]);
  await browser(["press", "Enter"]);
  await wait(
    `document.querySelector('h1')?.textContent==='AAPL'&&document.querySelector('.chart-footer')?.textContent.includes('Partial history')`,
  );
  assert.equal(
    await evaluate(`!!document.querySelector('.chart-stage canvas')`),
    "true",
  );
  failOlderHistory = false;
  await browser(["fill", ".symbol-search input", "NVDA"]);
  await browser(["press", "Enter"]);
  await wait(`document.querySelector('h1')?.textContent==='NVDA'`);
  console.log(
    "PASS: direct ticker without Finnhub; older-history failure preserves visible candles.",
  );
  await evaluate(`document.querySelector('.mode-switch button').focus()`);
  await browser(["press", "m"]);
  await wait(
    `document.activeElement===document.querySelector('.symbol-search input')&&document.activeElement.value==='M'`,
  );
  await browser(["press", "Escape"]);
  await browser(["fill", ".symbol-search input", ""]);
  console.log("PASS: typing while a button has focus starts a symbol search.");
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Buy",
    "--exact",
  ]);
  await browser(["find", "label", "Limit price · USD", "fill", "123"]);
  await evaluate(`document.querySelector('.exit-chip').focus()`);
  await browser(["press", "ArrowDown"]);
  await browser(["press", "ArrowDown"]);
  await wait(
    `document.querySelector('.bracket-fields input:last-of-type')!==null&&[...document.querySelectorAll('.bracket-fields input')].some(i=>i.value==='122.98')&&document.activeElement?.classList.contains('exit-chip')`,
  );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Cancel",
    "--exact",
  ]);
  console.log(
    "PASS: SL chip beside draft entry sets a stop loss by keyboard and enables bracket exits.",
  );
  const paperKey = JSON.parse(
    await evaluate(
      `Object.keys(localStorage).find(k=>k.includes('paper')&&localStorage.getItem(k).includes('startingCash'))`,
    ),
  );
  const paper = async () =>
    JSON.parse(
      await evaluate(
        `JSON.parse(localStorage.getItem(${JSON.stringify(paperKey)}))`,
      ),
    );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Buy",
    "--exact",
  ]);
  await browser(["find", "label", "Limit price · USD", "fill", "90"]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Review order",
    "--exact",
  ]);
  assert.equal((await paper()).orders.length, 0);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Place Paper Order",
    "--exact",
  ]);
  await wait(
    `JSON.parse(localStorage.getItem(${JSON.stringify(paperKey)})).orders.length===1`,
  );
  assert.equal(liveWrites, 0);
  console.log(
    "PASS: review creates no order; confirmed Paper Order reserves locally, no IB calls.",
  );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Modify",
    "--exact",
  ]);
  await browser(["find", "label", "Limit price · USD", "fill", "91"]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Review order",
    "--exact",
  ]);
  assert.equal((await paper()).orders[0].limitPrice, 90);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Confirm modification",
    "--exact",
  ]);
  await wait(
    `JSON.parse(localStorage.getItem(${JSON.stringify(paperKey)})).orders[0].limitPrice===91`,
  );
  quotePrice = 89;
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Portfolio",
    "--exact",
  ]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Refresh account",
    "--exact",
  ]);
  await wait(
    `JSON.parse(localStorage.getItem(${JSON.stringify(paperKey)})).positions.length===1`,
  );
  assert.equal((await paper()).positions[0].quantity, 1);
  assert.equal((await paper()).cash, 99911);
  console.log(
    "PASS: price edits require confirmation; fresh quote fills full order and updates cash.",
  );
  await browser(["tab", "new", origin]);
  await browser(["wait", "--text", "Paper Account"]);
  await wait(
    `document.querySelector('.account-panel')?.textContent.includes('Read-only')`,
  );
  const tabs = JSON.parse(await browser(["tab", "--json"])).data.tabs;
  const primaryTab = tabs.find((tab) => !tab.active);
  assert.ok(primaryTab);
  await browser(["tab", "close", primaryTab.tabId]);
  await wait(
    `document.querySelector('.account-panel')&&!document.querySelector('.account-panel').textContent.includes('Read-only')`,
  );
  assert.equal((await paper()).positions[0].quantity, 1);
  console.log(
    "PASS: secondary tab automatically takes ownership after primary closes.",
  );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Screener",
    "--exact",
  ]);
  await browser(["fill", ".research-symbol-input", "NVDA,AAPL,BAD"]);
  await evaluate(
    `{const checks=document.querySelectorAll('.research-condition-toggle input');checks[0].click();checks[2].click();}`,
  );
  await browser(["fill", ".research-condition-number input", "100"]);
  await browser([
    "scrollintoview",
    ".research-screener .research-actions .button.primary",
  ]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Run scan",
    "--exact",
  ]);
  await wait(
    `document.querySelector('.research-progress')?.textContent.includes('2 matches, 1 skipped')`,
  );
  assert.equal(
    Number(
      await evaluate(`document.querySelectorAll('.research-result').length`),
    ),
    2,
  );
  console.log(
    "PASS: screener combines enabled rules and reports skipped symbol failures.",
  );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Backtest",
    "--exact",
  ]);
  const before = JSON.stringify(await paper());
  await browser([
    "scrollintoview",
    ".research-backtest .research-actions .button.primary",
  ]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Run backtest",
    "--exact",
  ]);
  await wait(`document.querySelector('.research-backtest-results')!==null`);
  assert.equal(backtests, 1);
  assert.deepEqual((await paper()).positions, JSON.parse(before).positions);
  assert.equal((await paper()).cash, JSON.parse(before).cash);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Toggle AI assistant",
    "--exact",
  ]);
  await wait(`!document.querySelector('.research-chat-input')?.disabled`);
  await evaluate(`document.querySelector('.toast button')?.click()`);
  await browser([
    "fill",
    ".research-chat-input",
    "Explain this chart and draft an order.",
  ]);
  await browser(["scrollintoview", ".research-chat-form .button.primary"]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Send",
    "--exact",
  ]);
  await wait(`document.querySelector('.research-chat-draft')!==null`);
  assert.equal(chatRequests, 1);
  await browser(["scrollintoview", ".research-chat-draft .button.primary"]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Review in order ticket",
    "--exact",
  ]);
  assert.equal(liveWrites, 0);
  assert.equal((await paper()).orders.length, 0);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Cancel",
    "--exact",
  ]);
  console.log(
    "PASS: secondary tab is read-only; backtest and AI drafts do not create account orders.",
  );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Close AI assistant",
    "--exact",
  ]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Watchlist",
    "--exact",
  ]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Switch to Traditional Chinese",
    "--exact",
  ]);
  await wait(`document.documentElement.lang==='zh-TW'`);
  await browser(["set", "viewport", "390", "844"]);
  await evaluate(`document.querySelector('.watch-symbol').click()`);
  await wait(`!document.querySelector('.app').classList.contains('side-open')`);
  const width = Number(await evaluate("document.documentElement.scrollWidth"));
  assert.ok(width <= 390, `Mobile overflows viewport: ${width}`);
  await mkdir("artifacts", { recursive: true });
  await browser(["screenshot", "artifacts/browser-check-mobile.png"]);
  console.log(
    "PASS: Traditional Chinese, narrow-screen chart navigation, no horizontal page overflow.",
  );
  await browser(["set", "viewport", "1500", "950"]);
  await evaluate(
    `localStorage.setItem('northstar.language',JSON.stringify('en'));localStorage.setItem('northstar.tradingMode',JSON.stringify('live'));location.reload()`,
  );
  await wait(`document.querySelector('.warning-banner')!==null`);
  assert.equal(
    JSON.parse(
      await evaluate(
        `JSON.parse(localStorage.getItem('northstar.tradingMode'))`,
      ),
    ),
    "live",
  );
  ibConnected = true;
  await wait(`document.querySelector('.live-banner')!==null`);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Buy",
    "--exact",
  ]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Review order",
    "--exact",
  ]);
  await browser(["check", ".live-ack input"]);
  assert.equal(liveWrites, 0);
  ibConnected = false;
  await wait(
    `document.querySelector('.warning-banner')!==null&&!document.querySelector('dialog')`,
  );
  ibConnected = true;
  await wait(`document.querySelector('.live-banner')!==null`);
  assert.equal(
    await evaluate(`document.querySelector('dialog')===null`),
    "true",
  );
  await evaluate(
    `{const original=Storage.prototype.setItem;window.__restoreModeStorage=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(k,v){if(k==='northstar.tradingMode')throw new DOMException('Fixture preference failure','QuotaExceededError');return original.call(this,k,v)}}`,
  );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Paper",
    "--exact",
  ]);
  await wait(
    `document.body.textContent.includes('Trading-mode preference cannot be saved')`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.live-banner')===null`),
    "true",
  );
  await evaluate(
    `window.__restoreModeStorage();localStorage.setItem('northstar.tradingMode',JSON.stringify('live'));location.reload()`,
  );
  await wait(
    `document.querySelector('.connection-pill')?.textContent.includes('connected')&&document.querySelector('.mode-switch button:first-child')?.getAttribute('aria-pressed')==='true'`,
  );
  ibConnected = false;
  console.log(
    "PASS: disconnect invalidates reviewed Live ticket; preference failure forces Paper across reload, no orders migrate.",
  );
  await evaluate(
    `localStorage.setItem('northstar.tradingMode',JSON.stringify('paper'));localStorage.setItem(${JSON.stringify(paperKey)},'{corrupt');location.reload()`,
  );
  await wait(
    `document.querySelector('.account-panel')?.textContent.includes('invalid')`,
  );
  assert.equal(
    JSON.parse(
      await evaluate(`localStorage.getItem(${JSON.stringify(paperKey)})`),
    ),
    "{corrupt",
  );
  console.log(
    "PASS: corrupt persisted account blocks trading and is not silently reset.",
  );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Settings",
    "--exact",
  ]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Reset Paper Account",
    "--exact",
  ]);
  await browser(["find", "label", "New starting cash · USD", "fill", "25000"]);
  await browser(["find", "label", "Type RESET to confirm", "fill", "RESET"]);
  await browser(["scrollintoview", ".reset-form .button.danger"]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Permanently reset simulation",
    "--exact",
  ]);
  await wait(
    `JSON.parse(localStorage.getItem(${JSON.stringify(paperKey)})).startingCash===25000`,
  );
  await browser(["click", ".modal-header button"]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Buy",
    "--exact",
  ]);
  await browser(["find", "label", "Limit price · USD", "fill", "80"]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Review order",
    "--exact",
  ]);
  const savedBeforeFailure = await paper();
  await evaluate(
    `{const original=Storage.prototype.setItem;window.__restoreStorage=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(k,v){if(k===${JSON.stringify(paperKey)})throw new DOMException('Fixture quota failure','QuotaExceededError');return original.call(this,k,v)}}`,
  );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Place Paper Order",
    "--exact",
  ]);
  await wait(
    `document.body.textContent.includes('Could not save Paper Account')`,
  );
  assert.deepEqual(await paper(), savedBeforeFailure);
  await evaluate(`window.__restoreStorage()`);
  assert.equal(liveWrites, 0);
  console.log(
    "PASS: explicit reset restores chosen cash; failed persistence publishes no order and disables trading.",
  );
  const errors = await browser(["errors"]);
  assert.ok(!errors || /^\[\s*\]$/.test(errors), `Browser errors: ${errors}`);
  console.log(
    `Browser regression passed (${requests.length} fixture requests, ${liveWrites} live writes).`,
  );
} catch (error) {
  await browser(["screenshot", "artifacts/browser-check-failure.png"]).catch(
    () => {},
  );
  console.error("Recent fixture requests:", requests.slice(-20));
  console.error(
    "Failure snapshot:",
    await evaluate(`document.body.innerText`).catch(() => "unavailable"),
  );
  throw error;
} finally {
  await browser(["close"]).catch(() => {});
  server.closeAllConnections();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
