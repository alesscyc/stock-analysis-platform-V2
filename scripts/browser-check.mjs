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
const click = (name) =>
  browser(["find", "role", "button", "click", "--name", name, "--exact"]);
const visible = (selector) =>
  `document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`;
// True when the centre of the element is not covered by another panel.
const topmost = async (selector) =>
  (await evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+Math.min(r.height/2,40)))})()`,
  )) === "true";
const ticketFocused = `document.querySelector('.trade-panel')?.contains(document.activeElement)`;
const rect = async (selector) =>
  JSON.parse(
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().toJSON()??null`,
    ),
  );
// Real pointer gesture on the chart; `release: false` leaves the button held.
const pointerDrag = async (x, from, to, release = true) => {
  await browser(["mouse", "move", String(x), String(from)]);
  await browser(["mouse", "down"]);
  await browser(["mouse", "move", String(x), String(to)]);
  if (release) await browser(["mouse", "up"]);
};
const lineY = async (label) => {
  const r = await rect(`[aria-label^="Review price: ${label} at "]`);
  return r && r.top + r.height / 2;
};
const ticketValues = async () =>
  JSON.parse(
    await evaluate(
      `[...document.querySelectorAll('.trade-form .form-grid input')].map(i=>i.value)`,
    ),
  );
const chartPixels = `[...document.querySelectorAll('.chart-stage canvas')].map(c=>c.toDataURL())`;
// Chart canvases repaint asynchronously (crosshair, rAF); wait until two reads match.
const stablePixels = async () => {
  let last = await evaluate(chartPixels);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const next = await evaluate(chartPixels);
    if (next === last) return next;
    last = next;
  }
  throw new Error("Chart canvases never settled");
};
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
    `document.querySelector('.chart-stage canvas')&&[...document.querySelectorAll('.instrument-actions button')].some(b=>b.textContent==='Trade'&&!b.disabled)`,
  );
  assert.deepEqual(
    JSON.parse(
      await evaluate(
        `[...document.querySelectorAll('.instrument-actions button')].map(b=>b.textContent)`,
      ),
    ),
    ["Trade"],
  );
  assert.equal(
    await evaluate(
      `!document.querySelector('.chart-footer,.statusbar')&&!document.body.innerText.includes('Local workspace')&&!/\\d bars/.test(document.body.innerText)`,
    ),
    "true",
  );
  assert.equal(
    await evaluate(visible(`.chart-stage a[href*="tradingview.com"]`)),
    "true",
    "TradingView attribution link missing",
  );
  const main = await rect(".main-workspace"),
    rail = await rect(".rail");
  assert.ok(
    rail.left >= main.right,
    `Navigation rail must be right of chart: ${JSON.stringify({ main, rail })}`,
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
    `document.querySelector('h1')?.textContent==='AAPL'&&document.querySelector('.chart-section')?.innerText.includes('Partial history')`,
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
    "Trade",
    "--exact",
  ]);
  await wait(`document.querySelector('.sidebar .trade-panel')!==null`);
  assert.equal(
    await evaluate(`document.querySelector('dialog')===null`),
    "true",
  );
  assert.deepEqual(
    JSON.parse(
      await evaluate(
        `[...document.querySelectorAll('.trade-side button')].map(b=>b.textContent)`,
      ),
    ),
    ["Buy", "Sell"],
  );
  assert.ok(
    (await rect(".sidebar")).left >= (await rect(".main-workspace")).right,
    "Order ticket must open right of chart",
  );
  assert.equal(await evaluate(ticketFocused), "true");
  assert.equal(
    await evaluate(
      `document.querySelector('.sidebar').getAttribute('aria-label')+'|'+document.querySelector('.splitter:has(+ .sidebar)').getAttribute('aria-label')`,
    ),
    '"Order ticket|Resize order ticket"',
  );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Sell",
    "--exact",
  ]);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Buy",
    "--exact",
  ]);
  assert.equal(liveWrites, 0);
  console.log(
    "PASS: one Trade entry opens a right-side BUY ticket; side changes submit nothing.",
  );
  await browser(["find", "label", "Limit price · USD", "fill", "123"]);
  await evaluate(`document.querySelector('.exit-chip').focus()`);
  await browser(["press", "ArrowDown"]);
  await browser(["press", "ArrowDown"]);
  await wait(
    `document.querySelector('.bracket-fields input:last-of-type')!==null&&[...document.querySelectorAll('.bracket-fields input')].some(i=>i.value==='122.98')&&document.activeElement?.classList.contains('exit-chip')`,
  );
  await click("Sell");
  await browser(["find", "label", "Quantity · shares", "fill", "3"]);
  await click("Watchlist");
  await wait(
    `!${visible(".trade-panel")}&&${visible(".watch-symbol")}&&!document.querySelector('.exit-chip')`,
  );
  await browser(["press", "Escape"]);
  await click("Screener");
  await click("Trade");
  await wait(visible(".trade-panel"));
  assert.equal(await evaluate(ticketFocused), "true");
  assert.deepEqual(
    JSON.parse(
      await evaluate(
        `[document.querySelector('.trade-side .active')?.textContent,document.querySelector('.check-row input').checked,...[...document.querySelectorAll('.trade-form .form-grid input')].map(i=>i.value)]`,
      ),
    ),
    ["Sell", true, "3", "123", "", "122.98"],
  );
  await browser(["press", "Escape"]);
  await wait(
    `!document.querySelector('.trade-panel')&&document.activeElement?.textContent==='Trade'`,
  );
  await click("Trade");
  await wait(
    `document.querySelector('.trade-side .active')?.textContent==='Buy'&&document.querySelector('.trade-form input').value==='1'`,
  );
  assert.equal(liveWrites, 0);
  console.log(
    "PASS: research menus keep the hidden draft; Trade restores it; Escape closes and restores focus.",
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
    "Trade",
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
  await click("Watchlist");
  await click("Trade");
  await wait(visible(".trade-panel"));
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
  await wait(`document.querySelector('.sidebar .trade-panel')!==null`);
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
  await click("Backtest");
  await click("Trade");
  await wait(
    `${visible(".trade-panel")}&&document.querySelector('.trade-panel h2')?.textContent==='Review order modification'`,
  );
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
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Toggle account panel",
    "--exact",
  ]);
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
  assert.ok(
    (await rect(".sidebar")).left >= (await rect(".main-workspace")).right,
    "Research panel must open right of chart",
  );
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
  await wait(`document.querySelector('.sidebar .trade-panel')!==null`);
  {
    const ticket = await rect(".sidebar"),
      chat = await rect(".chat-sidebar");
    assert.ok(
      ticket.left >= chat.right || ticket.right <= chat.left,
      "Ticket overlaps AI panel",
    );
  }
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
  await browser(["set", "viewport", "1000", "900"]);
  await click("Review in order ticket");
  await wait(
    `!document.querySelector('.chat-sidebar')&&${visible(".trade-panel")}`,
  );
  assert.ok(await topmost(".trade-panel"), "Ticket hidden at 1000px");
  await click("Toggle AI assistant");
  await wait(`${visible(".chat-sidebar")}&&!${visible(".trade-panel")}`);
  assert.ok(await topmost(".chat-sidebar"), "AI panel hidden at 1000px");
  await click("Close AI assistant");
  await click("Trade");
  await wait(
    `${visible(".trade-panel")}&&document.querySelector('.trade-panel').innerText.includes('AI draft')`,
  );
  await browser(["set", "viewport", "800", "900"]);
  await browser(["find", "label", "Limit price · USD", "fill", "123"]);
  await wait(`document.querySelector('.exit-chip')!==null`);
  assert.ok(await topmost(".exit-chip"), "Ticket blocks chart preview handles");
  assert.ok(await topmost(".chart-stage"), "Ticket disables the chart");
  assert.ok(
    Number(await evaluate("document.documentElement.scrollWidth")) <= 800,
  );
  await click("Cancel");
  await browser(["set", "viewport", "390", "844"]);
  await click("Toggle AI assistant");
  await wait(`!document.querySelector('.research-chat-input')?.disabled`);
  await browser(["fill", ".research-chat-input", "Draft an order."]);
  await browser(["scrollintoview", ".research-chat-form .button.primary"]);
  await click("Send");
  await wait(`document.querySelector('.research-chat-draft')!==null`);
  await browser(["scrollintoview", ".research-chat-draft .button.primary"]);
  await click("Review in order ticket");
  await wait(
    `!document.querySelector('.chat-sidebar')&&${visible(".trade-panel")}`,
  );
  assert.ok(await topmost(".trade-panel"), "Ticket hidden at 390px");
  assert.ok((await rect(".sidebar")).right <= (await rect(".rail")).left);
  await click("Cancel");
  await browser(["set", "viewport", "1500", "950"]);
  assert.equal(liveWrites, 0);
  console.log(
    "PASS: AI drafts reveal an uncovered ticket at 1000px and 390px; chart handles stay usable at 800px.",
  );
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
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "交易",
    "--exact",
  ]);
  await wait(
    `document.querySelector('.trade-panel')?.innerText.includes('賣出')`,
  );
  {
    const ticket = await rect(".sidebar"),
      navigation = await rect(".rail");
    assert.ok(ticket.left >= 0 && ticket.right <= navigation.left);
    assert.ok(navigation.right <= 390, "Mobile navigation hidden");
    assert.ok(
      Number(await evaluate("document.documentElement.scrollWidth")) <= 390,
    );
  }
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "關閉委託單",
    "--exact",
  ]);
  await wait(
    `!document.querySelector('.trade-panel')&&!document.querySelector('.app').classList.contains('side-open')`,
  );
  await mkdir("artifacts", { recursive: true });
  await browser(["screenshot", "artifacts/browser-check-mobile.png"]);
  console.log(
    "PASS: Traditional Chinese, narrow-screen chart navigation, no horizontal page overflow.",
  );
  await browser(["set", "viewport", "1500", "950"]);
  await evaluate(
    `localStorage.setItem('northstar.language',JSON.stringify('en'));location.reload()`,
  );
  ibConnected = true;
  const livePressed = `document.querySelector('.mode-switch button:last-child')?.getAttribute('aria-pressed')==='true'`;
  await wait(
    `document.querySelector('.connection-pill')?.textContent.includes('connected')&&!document.querySelector('.mode-switch button:last-child').disabled`,
  );
  await evaluate(
    `window.__confirms=0;window.confirm=()=>{window.__confirms++;return false}`,
  );
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Live",
    "--exact",
  ]);
  await wait(livePressed);
  assert.equal(await evaluate(`window.__confirms`), "0");
  assert.equal(
    await evaluate(
      `!document.querySelector('.live-banner')&&!document.body.innerText.includes('LIVE ROUTE')`,
    ),
    "true",
  );
  assert.equal(liveWrites, 0);
  console.log(
    "PASS: connected Paper-to-Live switch has no confirmation or LIVE ROUTE banner.",
  );
  ibConnected = false;
  await evaluate(`location.reload()`);
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
  await wait(livePressed);
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Trade",
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
    `document.querySelector('.warning-banner')!==null&&!document.querySelector('.trade-panel')`,
  );
  ibConnected = true;
  await wait(livePressed);
  assert.equal(
    await evaluate(`document.querySelector('.trade-panel')===null`),
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
  assert.equal(await evaluate(livePressed), "false");
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
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Toggle account panel",
    "--exact",
  ]);
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
  {
    // Order line dragging: grab lines away from their price buttons.
    await click("Trade");
    await browser(["find", "label", "Limit price · USD", "fill", "130"]);
    await browser(["check", ".check-row input"]);
    await browser(["find", "label", "Take-profit · USD", "fill", "130"]);
    await browser(["find", "label", "Stop-loss · USD", "fill", "130"]);
    await wait(
      `document.querySelector('[aria-label^="Review price: PREVIEW SL at 130.00"]')!==null`,
    );
    const overlay = await rect(".chart-overlays"),
      x = Math.round(overlay.left + overlay.width / 2),
      y0 = await lineY("PREVIEW LIMIT");
    // Exact tie: LIMIT, TP and SL coincide; the topmost (SL) line wins.
    await browser(["mouse", "move", String(x), String(Math.round(y0))]);
    const pixels = await stablePixels();
    await pointerDrag(x, Math.round(y0), Math.round(y0) + 40, false);
    await wait(
      `!document.querySelector('[aria-label^="Review price: PREVIEW SL at 130.00"]')`,
    );
    assert.deepEqual(
      (await ticketValues()).slice(1),
      ["130", "130", "130"],
      "Line drag previews without committing",
    );
    await browser(["mouse", "up"]);
    let [, limit, tp, sl] = await ticketValues();
    assert.deepEqual([limit, tp], ["130", "130"]);
    assert.ok(Number(sl) < 130, `SL line drag committed: ${sl}`);
    assert.equal(
      await stablePixels(),
      pixels,
      "Chart must not pan during line drag",
    );
    // Overlap: SL 6px below LIMIT/TP; pointer nearer TP selects TP (topmost of the LIMIT/TP tie).
    await pointerDrag(
      x,
      Math.round(await lineY("PREVIEW SL")),
      Math.round(y0 + 6),
    );
    const ySL = await lineY("PREVIEW SL"),
      press = Math.ceil(ySL - 5);
    assert.ok(
      Math.abs(press - y0) < Math.abs(press - ySL) &&
        Math.abs(press - ySL) <= 5,
      `Overlap setup: ${JSON.stringify({ y0, ySL, press })}`,
    );
    [, , , sl] = await ticketValues();
    await pointerDrag(x, press, press - 40);
    [, limit, tp] = await ticketValues();
    assert.equal(limit, "130");
    assert.ok(Number(tp) > 130, `TP line drag committed: ${tp}`);
    assert.equal((await ticketValues())[3], sl, "SL unchanged");
    // Entry line moves alone; sibling exits stay.
    await pointerDrag(x, Math.round(y0), Math.round(y0) - 20);
    const moved = await ticketValues();
    assert.ok(Number(moved[1]) > 130, `LIMIT line drag committed: ${moved}`);
    assert.deepEqual(moved.slice(2), [tp, sl]);
    // Fault injection only: a mouse cannot produce a real pointercancel, so
    // this checks the handler, not a browser-initiated cancel.
    const yLimit = Math.round(await lineY("PREVIEW LIMIT"));
    await pointerDrag(x, yLimit, yLimit + 30, false);
    await evaluate(
      `document.elementFromPoint(${x},${yLimit + 30}).dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1}))`,
    );
    await browser(["mouse", "up"]);
    assert.deepEqual(await ticketValues(), moved);
    // Active drawing tool keeps priority over line dragging.
    const drawingsKey = `northstar.drawings.${JSON.parse(await evaluate(`document.querySelector('h1').textContent`))}`,
      drawingCount = async () =>
        JSON.parse(
          (await evaluate(
            `JSON.parse(localStorage.getItem(${JSON.stringify(drawingsKey)})||'[]').length`,
          )) || "0",
        );
    const drawingsBefore = await drawingCount();
    await click("Horizontal line");
    await pointerDrag(x, yLimit, yLimit);
    await wait(
      `JSON.parse(localStorage.getItem(${JSON.stringify(drawingsKey)})||'[]').length===${drawingsBefore + 1}`,
    );
    assert.deepEqual(await ticketValues(), moved);
    // A saved drawing on an order line stays selectable and deletable.
    await pointerDrag(x, yLimit, yLimit);
    await wait(`document.querySelector('.drawing-shape circle')!==null`);
    await browser(["press", "Delete"]);
    await wait(
      `JSON.parse(localStorage.getItem(${JSON.stringify(drawingsKey)})||'[]').length===${drawingsBefore}`,
    );
    assert.deepEqual(await ticketValues(), moved, "Drawing click edits no price");
    // Dragging past the plot edge keeps the gesture (the line leaves view);
    // release commits, and panning and later drags still work.
    const plotTop = Math.round((await rect(".chart-overlays")).top);
    await pointerDrag(x, yLimit, plotTop - 10);
    const outside = await ticketValues();
    assert.ok(
      Number(outside[1]) > Number(moved[1]),
      `Off-plot LIMIT drag committed: ${outside}`,
    );
    assert.deepEqual(outside.slice(2), moved.slice(2));
    const hitYs = JSON.parse(
        await evaluate(
          `[...document.querySelectorAll('.order-line-hit')].map(r=>{const b=r.getBoundingClientRect();return b.top+b.height/2})`,
        ),
      ),
      panY = [0.2, 0.5, 0.8]
        .map((f) => Math.round(overlay.top + (overlay.height - 25) * f))
        .find((y) => hitYs.every((h) => Math.abs(h - y) > 20));
    assert.ok(panY, `No empty chart row to pan: ${hitYs}`);
    await browser(["mouse", "move", String(x), String(panY)]);
    const beforePan = await stablePixels();
    await browser(["mouse", "down"]);
    for (const dx of [50, 100, 150])
      await browser(["mouse", "move", String(x + dx), String(panY)]);
    await browser(["mouse", "up"]);
    await browser(["mouse", "move", String(x), String(panY)]);
    assert.notEqual(await stablePixels(), beforePan, "Chart pans after off-plot drag");
    const yTP = Math.round(await lineY("PREVIEW TP"));
    await pointerDrag(x, yTP, yTP - 20);
    const next = await ticketValues();
    assert.ok(Number(next[2]) > Number(outside[2]), `Next TP drag: ${next}`);
    assert.deepEqual([next[1], next[3]], [outside[1], outside[3]]);
    assert.equal((await paper()).orders.length, 0, "Dragging never submits");
    await click("Cancel");
    // Manageable working order line opens a modification ticket.
    quotePrice = 200;
    await click("Trade");
    await browser(["find", "label", "Limit price · USD", "fill", "130"]);
    await click("Review order");
    await click("Place Paper Order");
    await wait(
      `JSON.parse(localStorage.getItem(${JSON.stringify(paperKey)})).orders.length===1&&!document.querySelector('.trade-panel')`,
    );
    const yOrder = Math.round(await lineY("BUY 1 · LMT"));
    await pointerDrag(x, yOrder, yOrder - 30);
    await wait(
      `document.querySelector('.trade-panel h2')?.textContent==='Review order modification'`,
    );
    assert.ok(Number((await ticketValues())[1]) > 130);
    assert.equal((await paper()).orders[0].limitPrice, 130);
    // The orders panel also lists a working-order Cancel button.
    await browser(["click", ".trade-panel .dialog-actions .button:not(.primary)"]);
    assert.equal(liveWrites, 0);
    console.log(
      "PASS: dragging draft and working order lines previews, picks nearest/topmost, yields to drawing tools, and never submits.",
    );
  }
  await browser([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Trade",
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
