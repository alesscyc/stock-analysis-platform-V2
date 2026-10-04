import React, { useEffect, useRef, useState } from "react";
import { api } from "../src/api.js";
import { normalizeSymbol } from "../src/useStock.js";
import { Icon, tx } from "../src/ui.jsx";

export default function SymbolSearch({ lang, onSelect, inputRef }) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState([]),
    [open, setOpen] = useState(false),
    [index, setIndex] = useState(-1),
    [error, setError] = useState(null);
  const blurTimer = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    setIndex(-1);
    setResults([]);
    if (!query.trim()) return () => controller.abort();
    const timer = setTimeout(() => {
      api(`/search?q=${encodeURIComponent(query.trim())}`, {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted)
            setResults((data.results || []).slice(0, 8));
        })
        .catch(() => {});
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  useEffect(() => {
    const key = (event) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing ||
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],dialog',
        )
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (/^[a-zA-Z0-9^.]$/.test(event.key)) {
        event.preventDefault();
        setQuery(event.key.toUpperCase());
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(blurTimer.current);
      document.removeEventListener("keydown", key);
    };
  }, [inputRef]);
  function select(value) {
    try {
      const symbol = normalizeSymbol(value);
      onSelect(symbol);
      setQuery("");
      setOpen(false);
      setError(null);
      inputRef.current?.blur();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <form
      className="symbol-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        select(index >= 0 ? results[index].symbol : query);
      }}
    >
      <Icon name="search" size={17} />
      <input
        ref={inputRef}
        aria-label={tx(lang, "Search symbol", "搜尋股票代號")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !!query}
        aria-controls="symbol-results"
        aria-activedescendant={
          index >= 0 ? `symbol-option-${index}` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        placeholder={tx(lang, "Search symbol or company", "搜尋股票代號或公司")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setError(null);
        }}
        onFocus={() => {
          clearTimeout(blurTimer.current);
          setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 160);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setIndex((i) => Math.min(results.length - 1, i + 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(-1, i - 1));
          }
          if (e.key === "Escape") {
            setOpen(false);
            inputRef.current.blur();
          }
        }}
      />
      <kbd>/</kbd>
      {open && query && (
        <div className="search-results">
          <ul id="symbol-results" role="listbox">
            {results.map((item, i) => (
              <li
                key={item.symbol}
                id={`symbol-option-${i}`}
                role="option"
                aria-selected={index === i}
                className={index === i ? "selected" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(item.symbol)}
              >
                <strong>{item.symbol}</strong>
                <span>{item.description}</span>
                <Icon name="arrow" size={13} />
              </li>
            ))}
          </ul>
          <button type="submit" className="direct-search">
            <Icon name="search" size={14} />
            {tx(lang, "Open ticker", "開啟股票")} <b>{query.toUpperCase()}</b>
            <kbd>↵</kbd>
          </button>
          <p>
            {tx(
              lang,
              "Direct tickers work without autocomplete.",
              "即使沒有搜尋建議，也可直接輸入股票代號。",
            )}
          </p>
          {error && (
            <div className="search-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
