import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, DEMO } from "./api.js";
import {
  Icon,
  Notice,
  Splitter,
  tx,
  money,
  number,
  percent,
  useStored,
} from "./ui.jsx";
import { useStock, seedHistory, normalizeSymbol } from "./useStock.js";
import { useHealth, useLiveAccount, paperOverview } from "./useServices.js";
import { usePaperAccount } from "./usePaperAccount.js";
import { validateTicket } from "./orderValidation.js";
import StockChart from "../component/StockChart.jsx";
import SymbolSearch from "../component/SymbolSearch.jsx";
import Watchlist from "../component/Watchlist.jsx";
import PredictionCard from "../component/PredictionCard.jsx";
import ScreenerDialog from "../component/ScreenerDialog.jsx";
import BacktestDialog from "../component/BacktestDialog.jsx";
import AIChat from "../component/AIChat.jsx";
import PortfolioDialog from "../component/PortfolioDialog.jsx";
import OrdersDialog from "../component/OrdersDialog.jsx";
import TradeDialog from "../component/TradeDialog.jsx";
import SettingsDialog from "../component/SettingsDialog.jsx";

const defaultWatchlist = [
  "NVDA",
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "META",
  "TSLA",
];
export default function App() {
  const [savedLang, setLang, languageError] = useStored(
    "northstar.language",
    "en",
  );
  const lang = savedLang === "zh-TW" ? "zh-TW" : "en";
  const [savedWatchlist, setWatchlist, watchError] = useStored(
    "northstar.watchlist",
    defaultWatchlist,
  );
  const watchlist = Array.isArray(savedWatchlist)
    ? savedWatchlist.filter(
        (s) => typeof s === "string" && /^[A-Z][A-Z0-9.\-]{0,14}$/.test(s),
      )
    : [];
  const [savedSymbol, setSymbol] = useStored("northstar.symbol", "NVDA");
  const symbol =
    typeof savedSymbol === "string" &&
    /^[A-Z][A-Z0-9.\-]{0,14}$/.test(savedSymbol) &&
    !DEMO
      ? savedSymbol
      : "NVDA";
  const [interval, setInterval] = useState("1d"),
    [panel, setPanel] = useState("watchlist"),
    [sideOpen, setSideOpen] = useState(true),
    [chatOpen, setChatOpen] = useState(false);
  const [sideWidth, setSideWidth] = useStored("northstar.sidebarWidth", 276),
    [chatWidth, setChatWidth] = useStored("northstar.chatWidth", 330),
    [accountHeight, setAccountHeight] = useStored(
      "northstar.accountHeight",
      280,
    );
  const [accountOpen, setAccountOpen] = useState(true),
    [accountMax, setAccountMax] = useState(false),
    [accountTab, setAccountTab] = useState("portfolio"),
    [displayAccount, setDisplayAccount] = useState("");
  const [preference, setPreference, modeStorageError] = useStored(
    "northstar.tradingMode",
    "paper",
  );
  const [paperOverride, setPaperOverride] = useState(() => {
    try {
      return sessionStorage.getItem("northstar.paperOverride") === "1";
    } catch {
      return true;
    }
  });
  const [settings, setSettings] = useState(false),
    [ticket, setTicket] = useState(null),
    [preview, setPreview] = useState(null),
    [toast, setToast] = useState(null);
  const [backtest, setBacktest] = useState(null),
    [modelOverride, setModelOverride] = useState(null),
    [quotes, setQuotes] = useState({}),
    [quoteError, setQuoteError] = useState(null),
    [quoteToken, setQuoteToken] = useState(0);
  const searchRef = useRef(null),
    paperRef = useRef(null),
    ticketRef = useRef(null),
    modeRef = useRef("paper");
  const stock = useStock(symbol, interval),
    health = useHealth(),
    paper = usePaperAccount();
  const connected = !!health.ib?.connected && !DEMO,
    mode =
      preference === "live" && !paperOverride && !modeStorageError && connected
        ? "live"
        : "paper";
  modeRef.current = mode;
  paperRef.current = paper;
  ticketRef.current = ticket;
  const live = useLiveAccount(connected && mode === "live", displayAccount);
  const paperAccount = useMemo(
    () => paperOverview(paper.account),
    [paper.account],
  );
  const activeAccount = mode === "paper" ? paperAccount : live.account;
  const chartAccount = mode === "paper" ? paperAccount : live.defaultAccount;
  const activeOrders =
    mode === "paper"
      ? paper.account?.orders || []
      : live.orders.map((order) => ({
          ...order,
          manageable: live.ordersReady && order.manageable !== false,
        }));
  const prediction =
    modelOverride?.symbol === symbol
      ? modelOverride.prediction
      : stock.prediction;
  const last = stock.candles.at(-1),
    previous = stock.candles.at(-2),
    currentQuote = quotes[symbol];
  const price = currentQuote?.price ?? last?.close,
    priceChange = currentQuote?.previousClose
      ? currentQuote.price / currentQuote.previousClose - 1
      : previous
        ? last.close / previous.close - 1
        : null;
  const quoteSymbols = [
    ...new Set([
      symbol,
      ...(sideOpen && panel === "watchlist" ? watchlist : []),
      ...(paper.account?.positions || []).map((p) => p.symbol),
      ...(paper.account?.orders || []).map((o) => o.symbol),
    ]),
  ]
    .sort()
    .join(",");
  const onSelect = useCallback(
    (value, candles) => {
      try {
        const next = normalizeSymbol(value);
        if (DEMO && next !== "NVDA") {
          setToast({
            text: "Static preview contains NVDA only. Open the local workspace for other symbols. / 靜態預覽僅包含 NVDA，請開啟本機工作區以研究其他股票。",
            tone: "warning",
          });
          return;
        }
        if (Array.isArray(candles) && candles.length)
          seedHistory(next, candles);
        setSymbol(next);
        setModelOverride(null);
        setAccountMax(false);
        if (window.innerWidth < 900) setSideOpen(false);
      } catch (e) {
        setToast({ text: e.message, tone: "error" });
      }
    },
    [setSymbol],
  );
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${symbol} · Northstar`;
  }, [lang, symbol]);
  useEffect(() => {
    setTicket(null);
    setPreview(null);
  }, [mode, symbol]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const symbols = quoteSymbols.split(","),
          responses = [];
        for (let start = 0; start < symbols.length; start += 50)
          responses.push(
            await api(
              `/quotes?symbols=${encodeURIComponent(symbols.slice(start, start + 50).join(","))}`,
              { signal: controller.signal },
            ),
          );
        if (controller.signal.aborted) return;
        const incoming = responses.flatMap((response) => response.quotes || []);
        setQuotes((old) => ({
          ...old,
          ...Object.fromEntries(incoming.map((q) => [q.symbol, q])),
        }));
        setQuoteError(
          responses.some((response) => response.errors?.length)
            ? tx(
                lang,
                "Some quotes could not be refreshed.",
                "部分行情無法更新。",
              )
            : null,
        );
        if (!DEMO && paperRef.current.primary && paperRef.current.writable)
          await paperRef.current.applyQuotes(incoming);
      } catch (e) {
        if (!controller.signal.aborted) setQuoteError(e.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 15000);
      }
    }
    if (quoteSymbols) poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [quoteSymbols, quoteToken, lang]);
  const notify = (text, tone = "info") => setToast({ text, tone });
  function togglePanel(next) {
    if (next === panel) setSideOpen((open) => !open);
    else {
      setPanel(next);
      setSideOpen(true);
    }
  }
  function addWatch() {
    if (!watchlist.includes(symbol)) {
      setWatchlist([...watchlist, symbol]);
      notify(
        tx(lang, `${symbol} added to watchlist.`, `${symbol} 已加入觀察清單。`),
      );
    } else {
      searchRef.current?.focus();
      notify(
        tx(
          lang,
          "Search another symbol, then click + to save it.",
          "搜尋其他股票後，點選 + 儲存。",
        ),
      );
    }
  }
  function changeMode(next) {
    if (next === "live" && !connected) return;
    if (
      next === "live" &&
      preference !== "live" &&
      !confirm(
        tx(
          lang,
          "Live Mode sends orders to your connected Interactive Brokers account, which may use real money. The app does not determine whether IB is using a real or broker paper account. Enable Live Mode?",
          "LIVE 模式會將委託送至已連接的 Interactive Brokers 帳戶，可能使用真實資金。本應用程式無法判定 IB 為真實或券商模擬帳戶。啟用 LIVE 模式？",
        ),
      )
    )
      return;
    try {
      if (next === "paper") {
        sessionStorage.setItem("northstar.paperOverride", "1");
        localStorage.removeItem("northstar.tradingMode");
      } else sessionStorage.removeItem("northstar.paperOverride");
      setPaperOverride(next === "paper");
    } catch {
      setPaperOverride(true);
      notify(
        tx(
          lang,
          "Mode preference storage failed. Paper Mode forced; a previously saved preference may remain after restarting the browser.",
          "模式偏好儲存失敗，已強制使用模擬模式；重新啟動瀏覽器後可能仍保留舊偏好。",
        ),
        "error",
      );
    }
    setPreference(next);
    setTicket(null);
    setPreview(null);
  }
  function openTicket(side = "BUY", draft = null) {
    if (DEMO)
      return notify(
        tx(
          lang,
          "Trading is disabled in the generated static preview.",
          "產生的靜態預覽不提供交易功能。",
        ),
        "warning",
      );
    try {
      const data = draft
        ? validateTicket(draft, mode)
        : {
            symbol,
            side,
            quantity: 1,
            limitPrice: price ? Number(price.toFixed(2)) : "",
            tif: "DAY",
          };
      setTicket({ ...data, mode, fromAI: !!draft });
    } catch (e) {
      notify(e.message, "error");
    }
  }
  function editOrder(order, newPrice) {
    if (order.previewField) {
      setTicket((current) =>
        current
          ? {
              ...current,
              ...preview,
              [order.previewField]: newPrice,
              revision: (current.revision || 0) + 1,
            }
          : current,
      );
      return;
    }
    setTicket((current) => ({
      ...order,
      ...(newPrice != null
        ? { [order.type === "STP" ? "stopPrice" : "limitPrice"]: newPrice }
        : {}),
      mode,
      revision: (current?.revision || 0) + 1,
    }));
  }
  async function submitOrder(payload, id, ticketMode) {
    if (DEMO || ticketMode !== modeRef.current)
      throw new Error(
        tx(
          lang,
          "Trading mode changed; reopen the ticket.",
          "交易模式已變更，請重新開啟委託單。",
        ),
      );
    if (ticketMode === "paper") {
      if (id != null) await paper.modifyOrder(id, payload);
      else await paper.submitOrder(payload);
      setQuoteToken((n) => n + 1);
    } else {
      if (!connected) throw new Error("IB disconnected. / IB 已斷線。");
      if (id != null && !live.ordersReady)
        throw new Error(
          "Refresh IB orders before modifying. / 修改前請更新 IB 委託。",
        );
      await api(id != null ? `/orders/${encodeURIComponent(id)}` : "/orders", {
        method: id != null ? "PATCH" : "POST",
        body: payload,
      });
      live.refresh();
    }
    setAccountOpen(true);
    setAccountTab("orders");
    notify(
      tx(
        lang,
        ticketMode === "paper"
          ? "Paper Order saved locally. This is not a fill confirmation."
          : "Order request sent to IB. Check pending orders; submission is not a fill.",
        ticketMode === "paper"
          ? "模擬委託已儲存於本機，此通知不代表成交。"
          : "委託請求已送至 IB，請檢查待成交委託；提交不代表成交。",
      ),
    );
  }
  async function cancelOrder(id, sourceMode) {
    if (DEMO || sourceMode !== modeRef.current)
      throw new Error("Trading mode changed. / 交易模式已變更。");
    if (sourceMode === "paper") await paper.cancelOrder(id);
    else {
      if (!live.ordersReady)
        throw new Error(
          "Refresh IB orders before cancelling. / 取消前請更新 IB 委託。",
        );
      await api(`/orders/${encodeURIComponent(id)}`, { method: "DELETE" });
      live.refresh();
    }
    notify(
      tx(
        lang,
        "Cancellation requested. Check the resulting status.",
        "已請求取消，請檢查最終狀態。",
      ),
    );
  }
  const contextAccount = mode === "paper" ? paperAccount : live.defaultAccount;
  const accountContext = {
    mode,
    asOf: contextAccount?.asOf,
    summary: contextAccount?.summary,
    positions: contextAccount?.positions || [],
    orders: activeOrders,
  };
  const fundamentals = stock.fundamentals;
  const fundamentalFields = [
    ["Market cap", "市值", number(fundamentals?.marketCap, true)],
    ["Trailing P/E", "本益比", number(fundamentals?.trailingPE)],
    ["Forward P/E", "預估本益比", number(fundamentals?.forwardPE)],
    ["Trailing EPS", "每股盈餘", money(fundamentals?.trailingEps)],
    [
      "Dividend yield",
      "殖利率",
      percent(fundamentals?.dividendYield).replace("+", ""),
    ],
    ["Beta", "Beta 值", number(fundamentals?.beta)],
    [
      "52-week range",
      "52 週區間",
      `${money(fundamentals?.fiftyTwoWeekLow)} – ${money(fundamentals?.fiftyTwoWeekHigh)}`,
    ],
    ["Average volume", "平均成交量", number(fundamentals?.averageVolume, true)],
    ["Sector", "產業部門", fundamentals?.sector || "—"],
    ["Industry", "產業", fundamentals?.industry || "—"],
  ];
  return (
    <div
      className={`app ${accountMax ? "account-max" : ""} ${sideOpen ? "side-open" : ""} ${chatOpen ? "chat-open" : ""}`}
    >
      <a className="skip-link" href="#main-chart">
        {tx(lang, "Skip to chart", "跳至圖表")}
      </a>
      <header className="topbar">
        <a className="brand" href="./" aria-label="Northstar home">
          <span className="brand-mark">
            <Icon name="north" size={24} />
          </span>
          <span>
            NORTHSTAR
            <small>{tx(lang, "STOCK ANALYSIS PLATFORM", "股票分析平台")}</small>
          </span>
        </a>
        <span className="header-rule" />
        <SymbolSearch lang={lang} onSelect={onSelect} inputRef={searchRef} />
        <div className="topbar-right">
          <div
            className="connection-pill"
            title={
              health.ib?.error ||
              tx(
                lang,
                "Interactive Brokers connection",
                "Interactive Brokers 連線",
              )
            }
          >
            <span className={`status-dot ${connected ? "" : "offline"}`} />
            <span>
              IB{" "}
              {tx(
                lang,
                connected ? "connected" : "offline",
                connected ? "已連線" : "離線",
              )}
            </span>
          </div>
          <div
            className="mode-switch"
            aria-label={tx(lang, "Trading mode", "交易模式")}
          >
            <button
              className={mode === "paper" ? "active" : ""}
              onClick={() => changeMode("paper")}
              aria-pressed={mode === "paper"}
            >
              <Icon name="shield" size={13} />
              {tx(lang, "Paper", "模擬")}
            </button>
            <button
              className={mode === "live" ? "active live" : ""}
              onClick={() => changeMode("live")}
              disabled={!connected}
              aria-pressed={mode === "live"}
              title={tx(
                lang,
                "Live requires a connected IB Gateway or TWS",
                "LIVE 需要已連線的 IB Gateway 或 TWS",
              )}
            >
              {tx(lang, "Live", "LIVE")}
            </button>
          </div>
          <button
            className="button ghost icon-button language-button"
            aria-label={tx(lang, "Switch to Traditional Chinese", "切換至英文")}
            onClick={() => setLang(lang === "en" ? "zh-TW" : "en")}
          >
            {lang === "en" ? "繁" : "EN"}
          </button>
          <button
            className="button ghost icon-button"
            onClick={() => setSettings(true)}
            aria-label={tx(lang, "Settings", "設定")}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      {DEMO && (
        <div className="app-banner demo-banner">
          <Icon name="info" size={15} />
          <span>
            {tx(
              lang,
              "GENERATED PREVIEW · Fictional NVDA data, not market data. Trading, models, and chat are disabled.",
              "產生的預覽 · NVDA 為虛構資料，並非行情。交易、模型與聊天已停用。",
            )}
          </span>
          <a href="./">{tx(lang, "Local workspace", "本機工作區")} ↗</a>
        </div>
      )}
      {!DEMO && preference === "live" && !connected && (
        <div className="app-banner warning-banner">
          <Icon name="shield" size={15} />
          <span>
            {tx(
              lang,
              "IB disconnected → Paper Mode. Saved Live preference will resume on reconnection. Existing orders do not migrate.",
              "IB 已斷線 → 模擬模式。重新連線後恢復已儲存的 LIVE 偏好，既有委託不會轉移。",
            )}
          </span>
          <button
            className="button ghost small"
            onClick={() => changeMode("paper")}
          >
            {tx(lang, "Stay in Paper", "維持模擬模式")}
          </button>
        </div>
      )}
      {modeStorageError && (
        <div className="app-banner warning-banner" role="alert">
          {tx(
            lang,
            "Trading-mode preference cannot be saved. Live Mode is disabled until storage is available.",
            "無法儲存交易模式偏好，儲存空間恢復前將停用 LIVE 模式。",
          )}
        </div>
      )}
      {mode === "live" && (
        <div className="app-banner live-banner">
          <Icon name="info" size={15} />
          {tx(
            lang,
            "LIVE ROUTE · Orders can use real money. Verify your IB account before submitting.",
            "LIVE 路由 · 委託可能使用真實資金，提交前請確認 IB 帳戶。",
          )}
        </div>
      )}
      <div className="workspace">
        <nav
          className="rail"
          aria-label={tx(lang, "Workspace navigation", "工作區導覽")}
        >
          <div className="rail-top">
            {[
              ["watchlist", "star", "Watchlist", "觀察清單"],
              ["screener", "filter", "Screener", "選股"],
              ["backtest", "flask", "Backtest", "回測"],
            ].map(([key, icon, en, zh]) => (
              <button
                key={key}
                className={`rail-button ${sideOpen && panel === key ? "active" : ""}`}
                onClick={() => togglePanel(key)}
                title={tx(lang, en, zh)}
                aria-label={tx(lang, en, zh)}
                aria-pressed={sideOpen && panel === key}
              >
                <Icon name={icon} size={21} />
                <span>{tx(lang, en, zh)}</span>
              </button>
            ))}
            <div className="rail-separator" />
            <button
              className={`rail-button ${accountOpen ? "active subtle" : ""}`}
              onClick={() => {
                setAccountOpen(!accountOpen);
                setAccountMax(false);
              }}
              aria-label={tx(lang, "Toggle account panel", "切換帳戶面板")}
              title={tx(lang, "Account", "帳戶")}
            >
              <Icon name="wallet" size={21} />
              <span>{tx(lang, "Account", "帳戶")}</span>
            </button>
          </div>
          <button
            className={`rail-button ${chatOpen ? "active" : ""}`}
            onClick={() => setChatOpen(!chatOpen)}
            aria-label={tx(lang, "Toggle AI assistant", "切換 AI 助理")}
            title={tx(lang, "AI assistant", "AI 助理")}
          >
            <Icon name="chat" size={21} />
            <span>AI</span>
          </button>
          <div className="rail-bottom">
            <span
              className="local-badge"
              title={tx(lang, "Local-first workspace", "本機優先工作區")}
            >
              L
            </span>
          </div>
        </nav>
        {sideOpen && (
          <>
            <aside
              className={`sidebar ${panel === "watchlist" ? "" : "research-sidebar"}`}
              style={{
                width: Math.max(240, Math.min(500, Number(sideWidth) || 276)),
              }}
              aria-label={tx(lang, "Research panel", "研究面板")}
            >
              <div className="sidebar-content">
                {panel === "watchlist" ? (
                  <>
                    <Watchlist
                      lang={lang}
                      symbols={watchlist}
                      symbol={symbol}
                      quotes={quotes}
                      onSelect={onSelect}
                      onRemove={(ticker) =>
                        setWatchlist(watchlist.filter((s) => s !== ticker))
                      }
                      onAdd={addWatch}
                      quoteError={quoteError}
                    />
                    <PredictionCard
                      lang={lang}
                      symbol={symbol}
                      prediction={prediction}
                      loading={stock.predictionLoading && !prediction}
                      error={stock.predictionError}
                      onPrediction={(target, data) =>
                        setModelOverride({ symbol: target, prediction: data })
                      }
                    />
                    <div className="sidebar-bottom">
                      <Icon name="globe" size={14} />
                      <div>
                        <strong>
                          {tx(
                            lang,
                            "Built for your own research",
                            "為您的研究而建",
                          )}
                        </strong>
                        <span>
                          {tx(
                            lang,
                            "Local workspace. Independent decisions.",
                            "本機工作區，獨立判斷。",
                          )}
                        </span>
                      </div>
                    </div>
                  </>
                ) : panel === "screener" ? (
                  <ScreenerDialog lang={lang} onSelect={onSelect} />
                ) : (
                  <BacktestDialog
                    lang={lang}
                    symbol={symbol}
                    onResult={(result) =>
                      setBacktest({
                        ...result,
                        symbol: result.symbol || symbol,
                      })
                    }
                  />
                )}
              </div>
              <Notice tone="error">{watchError || languageError}</Notice>
            </aside>
            <Splitter
              value={Number(sideWidth) || 276}
              onChange={setSideWidth}
              min={240}
              max={500}
              label={tx(lang, "Resize research panel", "調整研究面板大小")}
            />
          </>
        )}
        <main className="main-workspace" id="main-chart">
          <section className="chart-area">
            <div className="instrument-header">
              <div className="instrument-main">
                <div className="instrument-avatar">{symbol.slice(0, 1)}</div>
                <div className="instrument-name">
                  <div className="row">
                    <h1>{symbol}</h1>
                    <span className="badge equity-badge">
                      {tx(lang, "EQUITY", "股票")}
                    </span>
                    <button
                      className={`button ghost icon-button small ${watchlist.includes(symbol) ? "starred" : ""}`}
                      onClick={() =>
                        watchlist.includes(symbol)
                          ? setWatchlist(watchlist.filter((s) => s !== symbol))
                          : setWatchlist([...watchlist, symbol])
                      }
                      aria-label={tx(
                        lang,
                        watchlist.includes(symbol)
                          ? "Remove from watchlist"
                          : "Add to watchlist",
                        watchlist.includes(symbol)
                          ? "從觀察清單移除"
                          : "加入觀察清單",
                      )}
                    >
                      <Icon name="star" size={16} />
                    </button>
                  </div>
                  <span>
                    {fundamentals?.name ||
                      tx(lang, "Stock research workspace", "股票研究工作區")}
                  </span>
                </div>
                <div className="instrument-price">
                  <strong>{money(price)}</strong>
                  <span
                    className={
                      (priceChange || 0) >= 0 ? "positive" : "negative"
                    }
                  >
                    {percent(priceChange)}{" "}
                    <small>{tx(lang, "snapshot", "快照")}</small>
                  </span>
                </div>
              </div>
              <div className="instrument-actions">
                <details className="popover fundamentals-popover">
                  <summary className="button ghost small">
                    <Icon name="info" size={15} />
                    {tx(lang, "Fundamentals", "基本面")}
                  </summary>
                  <div className="popover-menu">
                    <div className="row spread">
                      <strong>
                        {tx(lang, "Company snapshot", "公司概況")}
                      </strong>
                      <span className="badge">{DEMO ? "DEMO" : "YAHOO"}</span>
                    </div>
                    {stock.fundamentalsLoading && (
                      <p className="muted">{tx(lang, "Loading…", "載入中…")}</p>
                    )}
                    <Notice tone="error">{stock.fundamentalsError}</Notice>
                    <dl>
                      {fundamentalFields.map(([en, zh, value]) => (
                        <React.Fragment key={en}>
                          <dt>{tx(lang, en, zh)}</dt>
                          <dd>{value}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                    <small className="muted">
                      {tx(
                        lang,
                        "Provider coverage varies. Fields may be missing or delayed.",
                        "供應商涵蓋範圍不同，欄位可能缺漏或延遲。",
                      )}
                    </small>
                  </div>
                </details>
                <button
                  className="button buy-button"
                  disabled={DEMO || !stock.candles.length}
                  onClick={() => openTicket("BUY")}
                >
                  {tx(lang, "Buy", "買入")}
                </button>
                <button
                  className="button sell-button"
                  disabled={DEMO || !stock.candles.length}
                  onClick={() => openTicket("SELL")}
                >
                  {tx(lang, "Sell", "賣出")}
                </button>
              </div>
            </div>
            {stock.error && !!stock.candles.length && (
              <Notice tone="warning">{stock.error}</Notice>
            )}
            <StockChart
              demo={DEMO}
              lang={lang}
              symbol={symbol}
              interval={interval}
              onInterval={setInterval}
              candles={stock.candles}
              loading={stock.loading}
              error={stock.error}
              partialHistory={stock.partialHistory}
              historyLoading={stock.historyLoading}
              positions={chartAccount?.positions || []}
              orders={activeOrders}
              preview={preview}
              actions={backtest?.symbol === symbol ? backtest.actions : []}
              onOrderEdit={editOrder}
              onRetry={stock.reload}
            />
            {backtest?.symbol === symbol && (
              <div className="backtest-overlay-note">
                <span>
                  <Icon name="flask" size={13} />
                  {tx(
                    lang,
                    "Backtest actions on chart · simulation only",
                    "圖表顯示回測操作 · 僅供模擬",
                  )}
                </span>
                <button
                  className="button ghost small"
                  onClick={() => setBacktest(null)}
                >
                  {tx(lang, "Clear", "清除")}
                </button>
              </div>
            )}
          </section>
          {accountOpen && (
            <>
              {!accountMax && (
                <Splitter
                  axis="y"
                  reverse
                  value={Number(accountHeight) || 280}
                  onChange={setAccountHeight}
                  min={190}
                  max={620}
                  label={tx(lang, "Resize account panel", "調整帳戶面板大小")}
                />
              )}
              <section
                className="account-panel"
                style={
                  accountMax
                    ? undefined
                    : {
                        height: Math.max(
                          190,
                          Math.min(620, Number(accountHeight) || 280),
                        ),
                      }
                }
                aria-label={tx(lang, "Account panel", "帳戶面板")}
              >
                <header className="account-panel-header">
                  <div className="account-tabs">
                    <button
                      className={accountTab === "portfolio" ? "active" : ""}
                      onClick={() => setAccountTab("portfolio")}
                    >
                      <Icon name="wallet" size={15} />
                      {tx(lang, "Portfolio", "投資組合")}
                    </button>
                    <button
                      className={accountTab === "orders" ? "active" : ""}
                      onClick={() => setAccountTab("orders")}
                    >
                      <Icon name="book" size={15} />
                      {tx(lang, "Orders", "委託")}
                      <span className="tab-count">{activeOrders.length}</span>
                    </button>
                  </div>
                  <div className="row">
                    <span className="account-mode-label">
                      <i
                        className={`status-dot ${mode === "live" ? "amber" : ""}`}
                      />
                      {tx(
                        lang,
                        mode === "paper" ? "Paper Account" : "IB Account",
                        mode === "paper" ? "模擬帳戶" : "IB 帳戶",
                      )}
                    </span>
                    <button
                      className="button ghost icon-button small"
                      onClick={() => setAccountMax(!accountMax)}
                      aria-label={tx(
                        lang,
                        accountMax
                          ? "Restore account panel"
                          : "Maximize account panel",
                        accountMax ? "還原帳戶面板" : "最大化帳戶面板",
                      )}
                    >
                      <Icon
                        name={accountMax ? "collapse" : "expand"}
                        size={14}
                      />
                    </button>
                    <button
                      className="button ghost icon-button small"
                      onClick={() => {
                        setAccountOpen(false);
                        setAccountMax(false);
                      }}
                      aria-label={tx(
                        lang,
                        "Close account panel",
                        "關閉帳戶面板",
                      )}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                </header>
                <div className="account-panel-body">
                  {mode === "paper" && (!paper.writable || paper.error) && (
                    <Notice tone={paper.error ? "error" : "warning"}>
                      {paper.error ||
                        tx(
                          lang,
                          !paper.ready
                            ? "Opening Paper Account…"
                            : "Read-only tab. Close the primary tab to take ownership automatically.",
                          !paper.ready
                            ? "開啟模擬帳戶中…"
                            : "唯讀分頁。關閉主要分頁後將自動接管。",
                        )}
                    </Notice>
                  )}
                  {accountTab === "portfolio" ? (
                    <PortfolioDialog
                      lang={lang}
                      mode={mode}
                      account={activeAccount}
                      accounts={live.accounts}
                      displayAccount={displayAccount}
                      onAccountChange={setDisplayAccount}
                      connected={connected}
                      error={mode === "live" ? live.error : quoteError}
                      onSelect={onSelect}
                      refreshing={mode === "live" && live.refreshing}
                      onRefresh={() => {
                        setQuoteToken((n) => n + 1);
                        live.refresh();
                      }}
                    />
                  ) : (
                    <OrdersDialog
                      lang={lang}
                      mode={mode}
                      orders={activeOrders}
                      history={
                        mode === "paper" ? paper.account?.history || [] : []
                      }
                      error={mode === "live" ? live.ordersError : paper.error}
                      writable={
                        !DEMO &&
                        (mode === "paper"
                          ? paper.writable
                          : connected && live.ordersReady)
                      }
                      onSelect={onSelect}
                      onEdit={editOrder}
                      onCancel={cancelOrder}
                    />
                  )}
                </div>
              </section>
            </>
          )}
        </main>
        {chatOpen && (
          <>
            <Splitter
              reverse
              value={Number(chatWidth) || 330}
              onChange={setChatWidth}
              min={290}
              max={520}
              label={tx(lang, "Resize AI chat", "調整 AI 聊天大小")}
            />
            <aside
              className="chat-sidebar"
              style={{
                width: Math.max(290, Math.min(520, Number(chatWidth) || 330)),
              }}
              aria-label={tx(lang, "AI assistant", "AI 助理")}
            >
              <header className="chat-shell-header">
                <span>
                  <Icon name="north" size={17} />
                  {tx(lang, "Research assistant", "研究助理")}
                </span>
                <button
                  className="button ghost icon-button small"
                  onClick={() => setChatOpen(false)}
                  aria-label={tx(lang, "Close AI assistant", "關閉 AI 助理")}
                >
                  <Icon name="close" size={16} />
                </button>
              </header>
              <AIChat
                lang={lang}
                symbol={symbol}
                candles={stock.candles}
                fundamentals={fundamentals}
                prediction={prediction}
                accountContext={accountContext}
                onDraft={(draft) => openTicket(draft.side, draft)}
              />
            </aside>
          </>
        )}
      </div>
      <footer className="statusbar">
        <div>
          <span
            className={`status-dot ${health.status === "offline" ? "offline" : ""}`}
          />
          {DEMO
            ? tx(lang, "Static preview", "靜態預覽")
            : tx(
                lang,
                health.status === "offline"
                  ? "API unavailable"
                  : "Local workspace",
                health.status === "offline" ? "API 無法使用" : "本機工作區",
              )}
          <span className="status-divider">/</span>
          {tx(
            lang,
            DEMO ? "Generated NVDA sample" : "Yahoo Finance data",
            DEMO ? "產生的 NVDA 範例" : "Yahoo Finance 資料",
          )}
        </div>
        <span className="statusbar-center">
          {tx(
            lang,
            "Research with context. Trade with intention.",
            "掌握脈絡，審慎交易。",
          )}
        </span>
        <div>
          <Icon name="shield" size={12} />
          {tx(lang, "No autonomous execution", "無自主交易")}
          <span className="status-divider">/</span>USD
        </div>
      </footer>
      {toast && (
        <div className="toast">
          <Notice tone={toast.tone}>{toast.text}</Notice>
          <button
            className="button ghost icon-button small"
            onClick={() => setToast(null)}
            aria-label={tx(lang, "Dismiss notification", "關閉通知")}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {ticket && (
        <TradeDialog
          key={`${ticket.id || "new"}:${ticket.symbol}:${ticket.mode}:${ticket.revision || 0}`}
          lang={lang}
          ticket={ticket}
          mode={mode}
          connected={connected}
          writable={paper.writable}
          paperError={paper.error}
          onClose={() => {
            if (ticketRef.current !== ticket) return;
            setTicket(null);
            setPreview(null);
          }}
          onSubmit={submitOrder}
          onPreview={setPreview}
        />
      )}
      {settings && (
        <SettingsDialog
          lang={lang}
          setLang={setLang}
          paper={paper}
          health={health}
          preference={preference}
          onClose={() => setSettings(false)}
          onReset={async (cash) => {
            await paper.reset(cash);
            setQuoteToken((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
