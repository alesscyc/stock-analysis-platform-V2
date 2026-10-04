import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";
import {
  Icon,
  tx,
  money,
  number,
  percent,
  useStored,
  Notice,
} from "../src/ui.jsx";
import {
  movingAverage,
  swingZones,
  pricePatterns,
  patternLabels,
} from "./pricePatterns.js";
import {
  DRAWING_TYPES,
  readDrawings,
  saveDrawings,
  timeString,
  rayEnd,
  drawingLogicalIndex,
  markerTime,
} from "./drawings.js";

const colors = {
  10: "#d6ac62",
  20: "#67b8e3",
  50: "#af8fe9",
  150: "#df89b3",
  200: "#de875b",
};
const names = {
  cursor: ["Select / pan", "選取／平移"],
  line: ["Trend line", "趨勢線"],
  horizontal: ["Horizontal line", "水平線"],
  ray: ["Ray", "射線"],
  rectangle: ["Rectangle", "矩形"],
  range: ["Price range", "價格範圍"],
};
export default function StockChart({
  demo = false,
  lang,
  symbol,
  interval,
  onInterval,
  candles,
  loading,
  error,
  partialHistory,
  historyLoading,
  positions = [],
  orders = [],
  preview,
  actions = [],
  onOrderEdit,
  onRetry,
}) {
  const container = useRef(null),
    chartRef = useRef(null),
    candleRef = useRef(null),
    seriesRef = useRef({}),
    markerRef = useRef(null),
    callbacks = useRef({});
  const [size, setSize] = useState({ width: 0, height: 0 }),
    [, redraw] = useState(0),
    [hover, setHover] = useState(null);
  const [tool, setTool] = useState("cursor"),
    [pending, setPending] = useState(null),
    [cursorPoint, setCursorPoint] = useState(null);
  const [drawings, setDrawings] = useState([]),
    [drawingError, setDrawingError] = useState(null),
    [selected, setSelected] = useState(null),
    [drag, setDrag] = useState(null);
  const [prefs, setPrefs, prefsError] = useStored("northstar.indicators", {
    ma10: false,
    ma20: true,
    ma50: true,
    ma150: false,
    ma200: true,
    volume: true,
    volumeMA: true,
    zones: false,
    patterns: false,
  });
  const keyRef = useRef(""),
    lastCandles = useRef([]);
  const zones = useMemo(
    () => (prefs.zones ? swingZones(candles) : []),
    [candles, prefs.zones],
  );
  const patterns = useMemo(
    () => (prefs.patterns ? pricePatterns(candles) : []),
    [candles, prefs.patterns],
  );
  const persist = useCallback(
    (next) => {
      try {
        saveDrawings(symbol, next);
        setDrawings(next);
        setDrawingError(null);
      } catch (e) {
        setDrawingError(e.message);
      }
    },
    [symbol],
  );
  const cancelTool = () => {
    setTool("cursor");
    setPending(null);
    setCursorPoint(null);
  };
  callbacks.current = {
    click: (param) => {
      if (tool === "cursor" || !param.point || !param.time) return;
      const price = candleRef.current?.coordinateToPrice(param.point.y),
        time = timeString(param.time);
      if (!time || !Number.isFinite(price) || price <= 0) return;
      const point = { time, price };
      if (tool === "horizontal" || pending) {
        persist([
          ...drawings,
          {
            id: crypto.randomUUID(),
            type: tool,
            points: pending ? [pending, point] : [point],
          },
        ]);
        cancelTool();
      } else setPending(point);
    },
    crosshair: (param) => {
      setHover(param.seriesData?.get(candleRef.current) || null);
      if (param.point && param.time)
        setCursorPoint({
          time: timeString(param.time),
          price: candleRef.current.coordinateToPrice(param.point.y),
        });
    },
  };
  useEffect(() => {
    setSelected(null);
    cancelTool();
    setDrawingError(null);
    try {
      setDrawings(readDrawings(symbol));
    } catch (e) {
      setDrawings([]);
      setDrawingError(e.message);
    }
  }, [symbol]);
  useEffect(() => {
    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0e1520" },
        textColor: "#7f90a6",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#182332" },
        horzLines: { color: "#182332" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#52677d", labelBackgroundColor: "#26384c" },
        horzLine: { color: "#52677d", labelBackgroundColor: "#26384c" },
      },
      rightPriceScale: {
        borderColor: "#233041",
        scaleMargins: { top: 0.08, bottom: 0.23 },
        minimumWidth: 70,
      },
      timeScale: {
        borderColor: "#233041",
        rightOffset: 10,
        timeVisible: false,
        fixLeftEdge: false,
      },
      localization: { priceFormatter: (value) => value.toFixed(2) },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#54c5a5",
      downColor: "#ec7d88",
      borderVisible: false,
      wickUpColor: "#54c5a5",
      wickDownColor: "#ec7d88",
      priceLineColor: "#54c5a5",
      priceLineStyle: 2,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const volumeMA = chart.addSeries(LineSeries, {
      priceScaleId: "volume",
      color: "#91a7bf",
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    chart
      .priceScale("volume")
      .applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    const mas = {};
    for (const period of [10, 20, 50, 150, 200])
      mas[period] = chart.addSeries(LineSeries, {
        color: colors[period],
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
    chartRef.current = chart;
    candleRef.current = candle;
    seriesRef.current = { volume, volumeMA, mas };
    markerRef.current = createSeriesMarkers(candle, []);
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => redraw((v) => v + 1));
    };
    const click = (p) => callbacks.current.click(p),
      crosshair = (p) => {
        callbacks.current.crosshair(p);
        refresh();
      };
    chart.subscribeClick(click);
    chart.subscribeCrosshairMove(crosshair);
    chart.timeScale().subscribeVisibleLogicalRangeChange(refresh);
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
      refresh();
    });
    observer.observe(container.current);
    const element = container.current;
    element.addEventListener("wheel", refresh);
    element.addEventListener("pointermove", refresh);
    return () => {
      element.removeEventListener("wheel", refresh);
      element.removeEventListener("pointermove", refresh);
      observer.disconnect();
      cancelAnimationFrame(frame);
      chart.remove();
      chartRef.current = null;
      keyRef.current = "";
    };
  }, []);
  useEffect(() => {
    const chart = chartRef.current,
      candle = candleRef.current;
    if (!chart || !candle) return;
    const key = `${symbol}:${interval}`,
      oldRange =
        keyRef.current === key ? chart.timeScale().getVisibleRange() : null;
    candle.setData(candles);
    seriesRef.current.volume.setData(
      candles.map((bar) => ({
        time: bar.time,
        value: bar.volume,
        color: bar.close >= bar.open ? "#54c5a545" : "#ec7d8845",
      })),
    );
    seriesRef.current.volume.applyOptions({ visible: !!prefs.volume });
    seriesRef.current.volumeMA.setData(movingAverage(candles, 20, "volume"));
    seriesRef.current.volumeMA.applyOptions({
      visible: !!prefs.volume && !!prefs.volumeMA,
    });
    for (const period of [10, 20, 50, 150, 200]) {
      seriesRef.current.mas[period].setData(movingAverage(candles, period));
      seriesRef.current.mas[period].applyOptions({
        visible: !!prefs[`ma${period}`],
      });
    }
    if (candles.length) {
      if (oldRange && lastCandles.current.length)
        chart.timeScale().setVisibleRange(oldRange);
      else
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, candles.length - 125),
          to: candles.length + 7,
        });
      keyRef.current = key;
    }
    lastCandles.current = candles;
    setHover(null);
    redraw((v) => v + 1);
  }, [candles, symbol, interval, prefs]);
  useEffect(() => {
    if (!markerRef.current) return;
    markerRef.current.setMarkers(
      actions
        .map((action) => ({
          ...action,
          time: markerTime(candles, action.time, interval),
        }))
        .filter((action) => action.time !== null)
        .map((a) => ({
          time: a.time,
          position: a.side === "BUY" ? "belowBar" : "aboveBar",
          color: a.side === "BUY" ? "#66ddba" : "#f4ae7c",
          shape: a.side === "BUY" ? "arrowUp" : "arrowDown",
          text: a.side === "BUY" ? "B" : "S",
        }))
        .sort((a, b) => a.time.localeCompare(b.time)),
    );
  }, [actions, candles, interval]);
  useEffect(() => {
    chartRef.current?.applyOptions({
      handleScroll: tool === "cursor" && !drag,
      handleScale: tool === "cursor" && !drag,
    });
  }, [tool, drag]);
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: { locale: lang === "zh-TW" ? "zh-TW" : "en-US" },
    });
  }, [lang]);
  useEffect(() => {
    const handler = (event) => {
      if (
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],dialog',
        )
      )
        return;
      if (event.key === "Escape") {
        cancelTool();
        setSelected(null);
      }
      if (selected && ["Delete", "Backspace"].includes(event.key)) {
        event.preventDefault();
        persist(drawings.filter((d) => d.id !== selected));
        setSelected(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selected, drawings, persist]);
  const xy = (point) => {
    if (!point || !chartRef.current || !candleRef.current) return null;
    const scale = chartRef.current.timeScale();
    let x = scale.timeToCoordinate(point.time);
    if (x === null) {
      const index = drawingLogicalIndex(candles, point.time);
      if (index !== null) x = scale.logicalToCoordinate(index);
    }
    const y = candleRef.current.priceToCoordinate(point.price);
    return x === null || y === null ? null : { x, y };
  };
  const width = Math.max(
    0,
    size.width - (chartRef.current?.priceScale("right").width() || 70),
  );
  const bar = hover || candles.at(-1);
  const renderDrawing = (drawing, ghost = false) => {
    const a =
        drawing.type === "horizontal"
          ? {
              x: 0,
              y: candleRef.current?.priceToCoordinate(drawing.points[0].price),
            }
          : xy(drawing.points[0]),
      b = xy(drawing.points[1]);
    if (!a || a.y == null || (drawing.type !== "horizontal" && !b)) return null;
    const active = selected === drawing.id,
      stroke = active ? "#fff" : "#78bcf1",
      common = {
        stroke,
        strokeWidth: active ? 2.5 : 1.5,
        strokeDasharray: ghost ? "5 4" : undefined,
      };
    let shape;
    if (drawing.type === "horizontal")
      shape = <line x1={0} y1={a.y} x2={width} y2={a.y} {...common} />;
    else if (drawing.type === "rectangle" || drawing.type === "range")
      shape = (
        <>
          <rect
            x={Math.min(a.x, b.x)}
            y={Math.min(a.y, b.y)}
            width={Math.max(1, Math.abs(a.x - b.x))}
            height={Math.max(1, Math.abs(a.y - b.y))}
            fill="#78bcf117"
            {...common}
          />
          {drawing.type === "range" && (
            <text
              x={(a.x + b.x) / 2}
              y={Math.min(a.y, b.y) - 8}
              textAnchor="middle"
              fill={stroke}
              fontSize="11"
            >
              {money(drawing.points[1].price - drawing.points[0].price)} (
              {percent(drawing.points[1].price / drawing.points[0].price - 1)})
            </text>
          )}
        </>
      );
    else {
      const end = drawing.type === "ray" ? rayEnd(a, b, width) : b;
      shape = <line x1={a.x} y1={a.y} x2={end.x} y2={end.y} {...common} />;
    }
    return (
      <g
        key={drawing.id}
        className={ghost ? "" : "drawing-shape"}
        tabIndex={ghost ? undefined : 0}
        role={ghost ? undefined : "button"}
        aria-label={tx(
          lang,
          `Select ${names[drawing.type][0]}`,
          `選取${names[drawing.type][1]}`,
        )}
        onKeyDown={(e) => {
          if (!ghost && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setSelected(drawing.id);
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
          setSelected(drawing.id);
        }}
      >
        <title>{names[drawing.type][lang === "zh-TW" ? 1 : 0]}</title>
        {shape}
        {active && (
          <>
            <circle cx={a.x} cy={a.y} r="4" fill={stroke} />
            {b && <circle cx={b.x} cy={b.y} r="4" fill={stroke} />}
          </>
        )}
      </g>
    );
  };
  const pointerPrice = (e) => {
    const rect = container.current.getBoundingClientRect();
    const next = candleRef.current.coordinateToPrice(e.clientY - rect.top);
    return next > 0 ? Math.round(next * 100) / 100 : null;
  };
  // Arrow keys nudge a draft price by one cent. Committing remounts the ticket,
  // which takes focus, so hand focus back to the chart handle afterwards.
  const nudgePreview = (e, order, price) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return false;
    e.preventDefault();
    const next = Math.round((price + (e.key === "ArrowUp" ? 0.01 : -0.01)) * 100) / 100;
    if (next > 0) {
      const handle = e.currentTarget;
      onOrderEdit(order, next);
      setTimeout(() => handle.focus(), 0);
    }
    return true;
  };
  // SL/TP chips beside the draft entry label: drag one out (or use arrow keys)
  // to set that bracket exit; the ticket then enables bracket exits.
  const exitChips = (order, price, y, x) =>
    [
      ["stopLoss", "SL", "#f07f7f", "Drag to set stop loss (arrow keys adjust)", "拖曳設定停損（方向鍵微調）"],
      ["takeProfit", "TP", "#66ddba", "Drag to set take profit (arrow keys adjust)", "拖曳設定停利（方向鍵微調）"],
    ].map(([field, text, color, en, zh], i) => {
      const exit = { ...order, id: `preview-${field}`, previewField: field };
      const current = Number(preview?.[field]) || price;
      return (
        <g
          key={field}
          className="order-price-handle exit-chip"
          tabIndex={0}
          role="button"
          aria-label={tx(lang, en, zh)}
          style={{ cursor: "ns-resize" }}
          onKeyDown={(e) => nudgePreview(e, exit, current)}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({ order: exit, price: current });
          }}
          onPointerMove={(e) => {
            if (drag?.order.id !== exit.id) return;
            const next = pointerPrice(e);
            if (next) setDrag({ order: exit, price: next });
          }}
          onPointerUp={(e) => {
            if (drag?.order.id !== exit.id) return;
            e.stopPropagation();
            setDrag(null);
            if (Math.abs(drag.price - current) >= 0.005)
              onOrderEdit(exit, drag.price);
          }}
          onPointerCancel={() => setDrag(null)}
        >
          <title>{tx(lang, en, zh)}</title>
          <rect
            x={x + i * 34}
            y={y - 9}
            width="28"
            height="18"
            rx="4"
            fill="#162330"
            stroke={color}
          />
          <text x={x + i * 34 + 14} y={y + 4} fill={color} fontSize="10" fontWeight="600" textAnchor="middle">
            {text}
          </text>
        </g>
      );
    });
  const line = (price, label, color, id, order, dashed = true) => {
    const y = candleRef.current?.priceToCoordinate(price);
    if (y == null || y < 0 || y > size.height - 25) return null;
    const labelX = order?.previewField ? 18 : Math.max(0, width - 245);
    return (
      <g key={id}>
        <line
          x1="0"
          y1={y}
          x2={width}
          y2={y}
          stroke={color}
          strokeWidth="1"
          strokeDasharray={dashed ? "5 4" : undefined}
        />
        <g
          className={order ? "order-price-handle" : ""}
          tabIndex={order ? 0 : undefined}
          role={order ? "button" : undefined}
          aria-label={
            order
              ? tx(
                  lang,
                  `Review price: ${label} at ${price.toFixed(2)}`,
                  `檢閱價格：${label} ${price.toFixed(2)}`,
                )
              : undefined
          }
          onKeyDown={
            order
              ? (e) => {
                  if (order.previewField && nudgePreview(e, order, price))
                    return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOrderEdit(order, price);
                  }
                }
              : undefined
          }
          style={{ cursor: order ? "ns-resize" : "default" }}
          onPointerDown={
            order
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDrag({ order, price });
                }
              : undefined
          }
          onPointerMove={
            order
              ? (e) => {
                  if (!drag || drag.order.id !== order.id) return;
                  const next = pointerPrice(e);
                  if (next) setDrag({ order, price: next });
                }
              : undefined
          }
          onPointerUp={
            order
              ? (e) => {
                  if (!drag) return;
                  e.stopPropagation();
                  const next = drag.price;
                  setDrag(null);
                  if (
                    Math.abs(
                      next -
                        (order.type === "STP"
                          ? order.stopPrice
                          : order.limitPrice),
                    ) >= 0.005
                  )
                    onOrderEdit(order, next);
                }
              : undefined
          }
          onPointerCancel={() => setDrag(null)}
        >
          <rect
            x={labelX}
            y={y - 10}
            width="242"
            height="20"
            rx="3"
            fill="#162330"
            stroke={color}
            strokeOpacity="0.7"
          />
          <text x={labelX + 9} y={y + 4} fill={color} fontSize="10">
            {label} · {price.toFixed(2)}
            {order ? " ↕" : ""}
          </text>
        </g>
        {order?.exits && exitChips(order, price, y, labelX + 250)}
      </g>
    );
  };
  function exportCSV() {
    const blob = new Blob(
      [
        "time,open,high,low,close,volume\n" +
          candles
            .map((b) =>
              [b.time, b.open, b.high, b.low, b.close, b.volume].join(","),
            )
            .join("\n"),
      ],
      { type: "text/csv" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `${symbol}-${interval}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="chart-section"
      aria-label={tx(lang, "Price chart", "價格圖表")}
    >
      <div className="chart-toolbar">
        <div className="segmented">
          {[
            ["1d", "D", "日"],
            ["1wk", "W", "週"],
            ["1mo", "M", "月"],
          ].map(([value, en, zh]) => (
            <button
              className={interval === value ? "active" : ""}
              key={value}
              onClick={() => onInterval(value)}
              aria-pressed={interval === value}
              title={tx(
                lang,
                en === "D" ? "Daily" : en === "W" ? "Weekly" : "Monthly",
                zh,
              )}
            >
              {tx(lang, en, zh)}
            </button>
          ))}
        </div>
        <span className="toolbar-divider" />
        <details className="popover">
          <summary className="button ghost small">
            <Icon name="layers" size={15} />
            {tx(lang, "Indicators", "指標")}
          </summary>
          <div className="popover-menu">
            <strong>{tx(lang, "Price & volume", "價格與成交量")}</strong>
            {[10, 20, 50, 150, 200].map((p) => (
              <label key={p}>
                <input
                  type="checkbox"
                  checked={!!prefs[`ma${p}`]}
                  onChange={(e) =>
                    setPrefs({ ...prefs, [`ma${p}`]: e.target.checked })
                  }
                />
                <span style={{ color: colors[p] }}>MA {p}</span>
              </label>
            ))}
            {[
              ["volume", "Volume", "成交量"],
              ["volumeMA", "Volume MA 20", "成交量均線 20"],
              ["zones", "Swing zones", "波段區域"],
              ["patterns", "Price patterns", "價格型態"],
            ].map(([key, en, zh]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={!!prefs[key]}
                  onChange={(e) =>
                    setPrefs({ ...prefs, [key]: e.target.checked })
                  }
                />
                {tx(lang, en, zh)}
              </label>
            ))}
            <small className="muted">
              {tx(
                lang,
                "Patterns are heuristics, not trade signals.",
                "型態為啟發式分析，非交易訊號。",
              )}
            </small>
          </div>
        </details>
        <div className="drawing-tools">
          {["cursor", ...DRAWING_TYPES].map((name) => (
            <button
              key={name}
              className={`button ghost icon-button small ${tool === name ? "active" : ""}`}
              title={tx(lang, ...names[name])}
              aria-label={tx(lang, ...names[name])}
              aria-pressed={tool === name}
              onClick={() => {
                setTool(name);
                setPending(null);
                setSelected(null);
              }}
            >
              <Icon name={name} size={16} />
            </button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <button
          className="button ghost icon-button small"
          onClick={() => {
            chartRef.current?.timeScale().fitContent();
            redraw((v) => v + 1);
          }}
          title={tx(lang, "Fit all history", "顯示全部歷史")}
          aria-label={tx(lang, "Fit all history", "顯示全部歷史")}
        >
          <Icon name="expand" size={15} />
        </button>
        <button
          className="button ghost small"
          onClick={exportCSV}
          disabled={!candles.length}
        >
          CSV
        </button>
      </div>
      {(drawingError || prefsError) && (
        <Notice tone="error">
          {drawingError || prefsError}
          {drawingError && (
            <button
              className="button small"
              onClick={() => {
                if (
                  confirm(
                    tx(
                      lang,
                      "Delete all saved drawings for this symbol? This cannot be undone.",
                      "刪除此股票全部已儲存繪圖？此操作無法復原。",
                    ),
                  )
                )
                  persist([]);
              }}
            >
              {tx(lang, "Clear drawings", "清除繪圖")}
            </button>
          )}
        </Notice>
      )}
      <div className="chart-meta">
        <strong>{symbol || "—"}</strong>
        <span>
          {tx(
            lang,
            interval === "1d" ? "1D" : interval === "1wk" ? "1W" : "1M",
            interval === "1d" ? "日線" : interval === "1wk" ? "週線" : "月線",
          )}
        </span>
        <span className="meta-dot">·</span>
        <span>{tx(lang, "NASDAQ / NYSE", "美國股票")}</span>
        {bar && (
          <div className="ohlc">
            <span>
              O <b>{number(bar.open)}</b>
            </span>
            <span>
              H <b>{number(bar.high)}</b>
            </span>
            <span>
              L <b>{number(bar.low)}</b>
            </span>
            <span>
              C{" "}
              <b className={bar.close >= bar.open ? "positive" : "negative"}>
                {number(bar.close)}
              </b>
            </span>
            <span>
              Vol <b>{number(bar.volume, true)}</b>
            </span>
          </div>
        )}
      </div>
      <div className="chart-stage">
        <div
          className="chart-canvas"
          ref={container}
          aria-label={`${symbol} ${tx(lang, "candlestick chart. Download CSV for accessible data.", "蠟燭圖。下載 CSV 以取得可存取資料。")}`}
        />
        <svg
          className="chart-overlays"
          width={size.width}
          height={size.height}
          style={{ overflow: "hidden" }}
        >
          <defs>
            <clipPath id="plot-clip">
              <rect width={width} height={Math.max(0, size.height - 25)} />
            </clipPath>
          </defs>
          <g clipPath="url(#plot-clip)">
            {zones.map((zone, i) => {
              const top = candleRef.current?.priceToCoordinate(zone.upper),
                bottom = candleRef.current?.priceToCoordinate(zone.lower);
              return top == null || bottom == null ? null : (
                <rect
                  key={`zone-${i}`}
                  x="0"
                  y={top}
                  width={width}
                  height={Math.max(2, bottom - top)}
                  fill="#d6ac6212"
                  stroke="#d6ac6235"
                />
              );
            })}
            {patterns.map((pattern) => {
              const lines = pattern.lines.map((line) => ({
                ...line,
                pts: line.points.map(xy),
              }));
              const area = lines.find((line) => line.style === "status")?.pts;
              if (!area || area.some((p) => !p)) return null;
              const xs = area.map((p) => p.x),
                ys = area.map((p) => p.y);
              const left = Math.min(...xs),
                right = Math.max(...xs),
                top = Math.min(...ys),
                bottom = Math.max(...ys);
              const below =
                pattern.type.includes("bottom") ||
                pattern.type.includes("inverse");
              const statusDash =
                pattern.status === "confirmed"
                  ? undefined
                  : pattern.status === "failed"
                    ? "2 4"
                    : "6 4";
              return (
                <g key={pattern.id}>
                  <rect
                    x={left}
                    y={top}
                    width={right - left}
                    height={bottom - top}
                    fill={pattern.color}
                    fillOpacity="0.08"
                  />
                  {lines.map((line, i) =>
                    line.pts.some((p) => !p) ? null : (
                      <polyline
                        key={i}
                        points={line.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                        stroke={pattern.color}
                        fill="none"
                        strokeWidth={line.width ?? 2}
                        strokeDasharray={
                          line.style === "status" ? statusDash : "6 4"
                        }
                      />
                    ),
                  )}
                  <text
                    x={(left + right) / 2}
                    y={below ? bottom + 16 : top - 8}
                    fill={pattern.color}
                    fontSize="10"
                    textAnchor="middle"
                  >
                    {tx(lang, ...patternLabels[pattern.nameKey])}
                  </text>
                </g>
              );
            })}
            {drawings.map((d) => renderDrawing(d))}
            {pending &&
              cursorPoint &&
              renderDrawing(
                { id: "pending", type: tool, points: [pending, cursorPoint] },
                true,
              )}
            {positions
              .filter((p) => p.symbol === symbol)
              .map((p, i) =>
                line(
                  p.averageCost,
                  `${tx(lang, "POSITION", "持倉")} ${p.quantity}`,
                  "#78bcf1",
                  `position-${i}`,
                ),
              )}
            {orders
              .filter(
                (o) =>
                  o.symbol === symbol &&
                  ![
                    "filled",
                    "cancelled",
                    "expired",
                    "Filled",
                    "Cancelled",
                    "ApiCancelled",
                    "Inactive",
                  ].includes(o.status),
              )
              .map((o) =>
                line(
                  drag?.order.id === o.id
                    ? drag.price
                    : o.type === "STP"
                      ? o.stopPrice
                      : o.limitPrice,
                  `${o.side} ${o.quantity} · ${o.bracketRole || o.type || "LMT"}${o.status === "held" ? " · HELD" : ""}`,
                  o.side === "BUY" ? "#66ddba" : "#f4ae7c",
                  o.id,
                  o.manageable === false ? null : o,
                ),
              )}
            {preview?.symbol === symbol &&
              [
                ["limitPrice", "LIMIT"],
                ["takeProfit", "TP"],
                ["stopLoss", "SL"],
                ["stopPrice", "STOP"],
              ]
                .filter(
                  ([key]) =>
                    Number(preview[key]) > 0 ||
                    drag?.order.id === `preview-${key}`,
                )
                .map(([key, label]) =>
                  line(
                    drag?.order.id === `preview-${key}`
                      ? drag.price
                      : Number(preview[key]),
                    `${tx(lang, "PREVIEW", "預覽")} ${label}`,
                    "#d9c588",
                    `preview-${key}`,
                    {
                      id: `preview-${key}`,
                      previewField: key,
                      symbol: preview.symbol,
                      side: preview.side,
                      quantity: preview.quantity,
                      type:
                        key === "stopLoss" || key === "stopPrice"
                          ? "STP"
                          : "LMT",
                      limitPrice: Number(preview[key]),
                      stopPrice: Number(preview[key]),
                      exits: key === "limitPrice" && !preview.editing,
                    },
                  ),
                )}
          </g>
        </svg>
        {(!candles.length || loading) && (
          <div className={`chart-message ${candles.length ? "compact" : ""}`}>
            {loading ? (
              <>
                <span className="spinner" />
                {tx(lang, "Loading price history…", "正在載入歷史價格…")}
              </>
            ) : (
              <>
                <Icon name="chart" size={38} />
                <h3>
                  {tx(
                    lang,
                    "Your next insight starts here",
                    "下一個洞見，從這裡開始",
                  )}
                </h3>
                <p>
                  {error ||
                    tx(
                      lang,
                      "Search a symbol to explore its price history.",
                      "搜尋股票代號以探索歷史價格。",
                    )}
                </p>
                {error && (
                  <button className="button" onClick={onRetry}>
                    {tx(lang, "Try again", "重試")}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {tool !== "cursor" && (
          <div className="drawing-hint">
            {tx(
              lang,
              pending
                ? "Click the second point · Esc to cancel"
                : "Click chart to set the first point · Esc to cancel",
              pending
                ? "點選第二個點 · Esc 取消"
                : "點選圖表設定第一個點 · Esc 取消",
            )}
          </div>
        )}
        {selected && (
          <div className="drawing-hint">
            <span>{tx(lang, "Drawing selected", "已選取繪圖")}</span>
            <button
              className="button small danger"
              onClick={() => {
                persist(drawings.filter((d) => d.id !== selected));
                setSelected(null);
              }}
            >
              <Icon name="trash" size={13} />
              {tx(lang, "Delete", "刪除")}
            </button>
          </div>
        )}
        <div className="chart-watermark">
          NORTHSTAR <span>{tx(lang, "RESEARCH WORKSPACE", "研究工作區")}</span>
        </div>
      </div>
      <footer className="chart-footer">
        <span className="status-dot" />
        <span>
          {historyLoading
            ? tx(lang, "Loading older history…", "載入更早歷史…")
            : partialHistory
              ? tx(
                  lang,
                  "Partial history · older data unavailable",
                  "歷史不完整 · 無法取得更早資料",
                )
              : `${number(candles.length)} ${tx(lang, "bars", "根 K 線")}`}
        </span>
        <span className="toolbar-spacer" />
        <span>
          {tx(
            lang,
            demo
              ? "Fictional sample · No trading"
              : "Delayed data · Research, not advice",
            demo ? "虛構範例 · 不可交易" : "行情可能延遲 · 僅供研究",
          )}
        </span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView
        </a>
      </footer>
    </section>
  );
}
