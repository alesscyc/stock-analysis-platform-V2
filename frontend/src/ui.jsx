import React, { useEffect, useId, useRef, useState } from "react";

export const tx = (lang, en, zh) => (lang === "zh-TW" ? zh : en);
export const money = (value) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(value)
    : "—";
export const number = (value, compact = false) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
        ...(compact ? { notation: "compact" } : {}),
      }).format(value)
    : "—";
export const percent = (value) =>
  Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`
    : "—";
export function useStored(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      if (
        parsed === null ||
        typeof parsed !== typeof fallback ||
        Array.isArray(parsed) !== Array.isArray(fallback)
      )
        return fallback;
      return typeof fallback === "object" && !Array.isArray(fallback)
        ? { ...fallback, ...parsed }
        : parsed;
    } catch {
      return fallback;
    }
  });
  const [error, setError] = useState(null);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setError(null);
    } catch {
      setError("Preferences could not be saved. / 偏好設定無法儲存。");
    }
  }, [key, value]);
  return [value, setValue, error];
}
const paths = {
  star: "m12 2 2.8 6.1 6.7.8-5 4.6 1.4 6.5-5.9-3.3L6.1 20l1.4-6.5-5-4.6 6.7-.8L12 2Z",
  north: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z",
  chart: "M4 3v18h17M8 15l4-6 4 3 5-7",
  search: "m21 21-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0",
  filter: "M4 5h16M7 12h10M10 19h4M8 3v4M16 10v4M12 17v4",
  flask:
    "M9 3h6M10 3v7L4 19a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2l-6-9V3M8 14h8",
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 10h10M7 14h7",
  wallet:
    "M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6M20 12h-5v5h5",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 2h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1 1-3Z",
  close: "m6 6 12 12M6 18 18 6",
  plus: "M12 5v14M5 12h14",
  down: "m6 9 6 6 6-6",
  right: "m9 6 6 6-6 6",
  expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
  collapse: "M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z",
  refresh:
    "M20 5v5h-5M4 19v-5h5M5 8a8 8 0 0 1 14-3l1 5M4 14l1 5a8 8 0 0 0 14-3",
  cursor: "m4 3 6 18 3-8 8-3L4 3Z",
  line: "M4 19 20 5M3 18h2v2H3zM19 4h2v2h-2z",
  horizontal: "M3 12h18",
  ray: "M3 18 21 4M3 17v2h2v-2H3",
  rectangle: "M3 5h18v14H3z",
  range: "M8 3h8M8 21h8M12 3v18m-4-4 4 4 4-4M8 7l4-4 4 4",
  layers: "m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5",
  info: "M12 11v6M12 7v.5M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  shield: "m12 2 9 4v6c0 5-6 8-9 10-3-2-9-5-9-10V6l9-4Zm-4 9 3 3 5-6",
  send: "m22 2-7 20-4-9L2 9l20-7ZM11 13 22 2",
  globe:
    "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM2 12h20M12 2c6 5 6 15 0 20-6-5-6-15 0-20Z",
  arrow: "M4 17 17 4M7 4h10v10",
  clock: "M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  check: "m4 12 5 5L20 6",
  book: "M12 5C7 2 3 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Zm0 0v16",
};
export function Icon({ name, size = 18, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.chart} />
    </svg>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  nonModal = false,
}) {
  const ref = useRef(null),
    titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    if (nonModal) dialog.show();
    else dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus?.();
    };
  }, [nonModal]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""} ${nonModal ? "floating-ticket" : ""}`}
      aria-labelledby={titleId}
      aria-modal={!nonModal}
      onKeyDown={(event) => {
        if (nonModal && event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="button ghost icon-button"
          onClick={onClose}
          aria-label="Close / 關閉"
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Notice({ children, tone = "info" }) {
  return children ? (
    <div
      className={`notice ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon name={tone === "error" ? "info" : "shield"} size={16} />
      <div>{children}</div>
    </div>
  ) : null;
}
export function Empty({ icon = "chart", title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Splitter({
  axis = "x",
  reverse = false,
  value,
  onChange,
  min,
  max,
  label,
}) {
  return (
    <div
      className={`splitter ${axis}`}
      role="separator"
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = ["ArrowRight", "ArrowDown"].includes(e.key)
          ? 20
          : ["ArrowLeft", "ArrowUp"].includes(e.key)
            ? -20
            : 0;
        if (step) {
          e.preventDefault();
          onChange(Math.max(min, Math.min(max, value + step)));
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const start = axis === "x" ? e.clientX : e.clientY;
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const move = (event) =>
          onChange(
            Math.max(
              min,
              Math.min(
                max,
                value +
                  ((axis === "x" ? event.clientX : event.clientY) - start) *
                    (reverse ? -1 : 1),
              ),
            ),
          );
        const end = () => {
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", end);
          target.removeEventListener("pointercancel", end);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", end);
        target.addEventListener("pointercancel", end);
      }}
    />
  );
}
