"""Yahoo Finance analysis API. Run with ``py -3.12 analysis/stock_data.py``."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import socket
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen

import joblib
import pandas as pd
import sklearn
import yfinance as yf
from curl_cffi import requests as curl_requests

try:
    from .backtest import BacktestError, run_backtest, validate_request
    from .models import GAP_BARS, ModelDataError, predict as predict_model, prepare_data, train_model
except ImportError:  # direct script entry point
    from backtest import BacktestError, run_backtest, validate_request
    from models import GAP_BARS, ModelDataError, predict as predict_model, prepare_data, train_model

SYMBOL_RE = re.compile(r"^[A-Z0-9.^=_-]{1,20}$")
HISTORY_PERIODS = {"6mo", "1y", "2y", "5y", "max"}
HISTORY_INTERVALS = {"1d", "1wk", "1mo"}
QUOTE_LIMIT = 50
BODY_LIMIT = 65_536
MODEL_TTL_SECONDS = 4 * 60 * 60
CACHE_SCHEMA = 2
YAHOO_TIMEOUT_SECONDS = min(60.0, max(2.0, float(os.environ.get("YAHOO_TIMEOUT_SECONDS", "12"))))


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _utc_now().isoformat().replace("+00:00", "Z")


def _json_number(value: Any) -> float | int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(result):
        return None
    return int(result) if result.is_integer() and abs(result) < 2**53 else result


def _symbol(value: str) -> str:
    symbol = value.strip().upper()
    if not SYMBOL_RE.fullmatch(symbol):
        raise ServiceError(400, "INVALID_SYMBOL", "symbol must be 1-20 letters, digits, dots, hyphens, carets, underscores, or equals signs")
    return symbol


def _timeout(value: Any) -> float:
    if isinstance(value, tuple):
        return tuple(min(YAHOO_TIMEOUT_SECONDS, max(0.1, float(part))) for part in value)  # type: ignore[return-value]
    try:
        return min(YAHOO_TIMEOUT_SECONDS, max(0.1, float(value)))
    except (TypeError, ValueError, OverflowError):
        return YAHOO_TIMEOUT_SECONDS


class BoundedSession(curl_requests.Session):
    """Clamp every yfinance request, including fundamentals requests with a 30s default."""

    def request(self, method: str, url: str, **kwargs: Any) -> Any:
        kwargs["timeout"] = _timeout(kwargs.get("timeout"))
        return super().request(method, url, **kwargs)


_YAHOO_SESSION = BoundedSession(impersonate="chrome")
# ponytail: yfinance shares one curl session; serialize provider calls, use per-thread sessions if throughput matters.
_YAHOO_LOCK = threading.RLock()
# ponytail: yfinance hides Retry-After; use a 60s cooldown until header-aware retries are needed.
_YAHOO_RETRY_AT = 0.0


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _provider_error(exc: BaseException) -> ServiceError:
    global _YAHOO_RETRY_AT
    if isinstance(exc, ServiceError):
        return exc
    if isinstance(exc, yf.exceptions.YFRateLimitError):
        _YAHOO_RETRY_AT = time.monotonic() + 60
        return ServiceError(429, "YAHOO_RATE_LIMITED", "Yahoo Finance rate limit reached; wait at least one minute before retrying")
    text = f"{type(exc).__name__} {exc}".lower()
    if isinstance(exc, (TimeoutError, socket.timeout)) or "timed out" in text or "timeout" in text:
        return ServiceError(504, "YAHOO_TIMEOUT", "Yahoo Finance request timed out; try again")
    return ServiceError(502, "YAHOO_UNAVAILABLE", "Yahoo Finance data is unavailable; try again later")


class JsonTTLCache:
    """Small atomic JSON cache; TTL data only is served, never silently stale data."""

    def __init__(self, directory: Path):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self._memory: dict[str, tuple[float, Any]] = {}
        self._lock = threading.RLock()

    @staticmethod
    def _filename(key: str) -> str:
        return hashlib.sha256(key.encode("utf-8")).hexdigest() + ".json"

    def get(self, key: str) -> Any | None:
        now = time.time()
        with self._lock:
            item = self._memory.get(key)
            if item and item[0] > now:
                return item[1]
            path = self.directory / self._filename(key)
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
                if record.get("expiresAt", 0) > now:
                    self._memory[key] = (record["expiresAt"], record["value"])
                    return record["value"]
            except (OSError, ValueError, TypeError, KeyError, AttributeError):
                pass
            self._memory.pop(key, None)
            return None

    def set(self, key: str, value: Any, ttl: float) -> None:
        expires_at = time.time() + ttl
        record = {"expiresAt": expires_at, "value": value}
        path = self.directory / self._filename(key)
        temp_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.directory, delete=False) as output:
                temp_path = output.name
                json.dump(record, output, allow_nan=False, separators=(",", ":"))
            os.replace(temp_path, path)
        except (OSError, TypeError, ValueError):
            if temp_path:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
        with self._lock:
            self._memory[key] = (expires_at, value)


class ModelStore:
    def __init__(self, directory: Path, market: "MarketData"):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.market = market
        self._memory: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._train_lock = threading.Lock()

    def _paths(self, symbol: str) -> tuple[Path, Path]:
        digest = hashlib.sha256(symbol.encode("utf-8")).hexdigest()
        return self.directory / f"{digest}.joblib", self.directory / f"{digest}.json"

    @staticmethod
    def _valid_metadata(metadata: Any) -> bool:
        return isinstance(metadata, dict) and metadata.get("schema") == CACHE_SCHEMA and isinstance(metadata.get("trainedAtEpoch"), (int, float))

    def _disk_metadata(self, symbol: str) -> dict[str, Any] | None:
        _, metadata_path = self._paths(symbol)
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            return metadata if self._valid_metadata(metadata) else None
        except (OSError, ValueError, TypeError):
            return None

    def status(self, symbol: str) -> dict[str, Any]:
        with self._lock:
            record = self._memory.get(symbol)
            metadata = record["metadata"] if record else self._disk_metadata(symbol)
            model_path, _ = self._paths(symbol)
            if not metadata or (not record and not model_path.is_file()):
                return {"symbol": symbol, "status": "missing", "cached": False, "gapBars": GAP_BARS}
            external = {key: metadata.get(key) for key in ("trainedAt", "samples", "accuracy", "trainSamples", "testSamples", "gapBars")}
            valid_version = metadata.get("sklearnVersion") == sklearn.__version__
            fresh = time.time() < metadata.get("expiresAtEpoch", 0) and valid_version
            result = {"symbol": symbol, "status": "ready" if fresh else "expired", "cached": bool(fresh), **external}
            if metadata.get("expiresAt"):
                result["expiresAt"] = metadata["expiresAt"]
            return result

    def _cached_record(self, symbol: str) -> dict[str, Any] | None:
        with self._lock:
            record = self._memory.get(symbol)
            if record and record["metadata"].get("expiresAtEpoch", 0) > time.time():
                if record["metadata"].get("sklearnVersion") == sklearn.__version__:
                    return record
            model_path, metadata_path = self._paths(symbol)
            metadata = self._disk_metadata(symbol)
            if not metadata or metadata.get("expiresAtEpoch", 0) <= time.time() or metadata.get("sklearnVersion") != sklearn.__version__:
                return None
            try:
                bundle = joblib.load(model_path)
                if not isinstance(bundle, dict) or not isinstance(bundle.get("metadata"), dict):
                    raise ValueError("invalid model artifact")
                if bundle["metadata"].get("trainedAtEpoch") != metadata.get("trainedAtEpoch"):
                    raise ValueError("model metadata mismatch")
                model = bundle.get("model")
                if not hasattr(model, "predict_proba"):
                    raise ValueError("invalid model estimator")
                record = {"model": model, "metadata": metadata}
                self._memory[symbol] = record
                return record
            except Exception:
                for path in (model_path, metadata_path):
                    try:
                        path.unlink()
                    except OSError:
                        pass
                return None

    def get(self, symbol: str, force: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
        with self._train_lock:
            if not force:
                record = self._cached_record(symbol)
                if record:
                    return record["model"], record["metadata"]
            candles = self.market.candles(symbol, "1d", "max", adjusted=True)
            try:
                model, summary = train_model(candles)
            except ModelDataError as exc:
                raise ServiceError(422, "INSUFFICIENT_HISTORY", str(exc)) from exc
            now = time.time()
            metadata = {
                **summary,
                "schema": CACHE_SCHEMA,
                "trainedAtEpoch": now,
                "expiresAtEpoch": now + MODEL_TTL_SECONDS,
                "expiresAt": datetime.fromtimestamp(now + MODEL_TTL_SECONDS, timezone.utc).isoformat().replace("+00:00", "Z"),
            }
            record = {"model": model, "metadata": metadata}
            model_path, metadata_path = self._paths(symbol)
            temp_model: str | None = None
            temp_metadata: str | None = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.directory, delete=False, suffix=".joblib") as output:
                    temp_model = output.name
                joblib.dump(record, temp_model, compress=3)
                os.replace(temp_model, model_path)
                with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.directory, delete=False) as output:
                    temp_metadata = output.name
                    json.dump(metadata, output, allow_nan=False, separators=(",", ":"))
                os.replace(temp_metadata, metadata_path)
            except (OSError, TypeError, ValueError):
                for path in (temp_model, temp_metadata):
                    if path:
                        try:
                            os.unlink(path)
                        except OSError:
                            pass
            with self._lock:
                self._memory[symbol] = record
            return model, metadata


class MarketData:
    def __init__(self, cache: JsonTTLCache):
        self.cache = cache

    @staticmethod
    def _ticker(symbol: str) -> yf.Ticker:
        if time.monotonic() < _YAHOO_RETRY_AT:
            raise ServiceError(429, "YAHOO_RATE_LIMITED", "Yahoo Finance rate limit reached; wait at least one minute before retrying")
        return yf.Ticker(symbol, session=_YAHOO_SESSION)

    @staticmethod
    def _single_ticker_frame(frame: pd.DataFrame, symbol: str) -> pd.DataFrame:
        if isinstance(frame.columns, pd.MultiIndex):
            try:
                frame = frame.xs(symbol, axis=1, level=-1, drop_level=True)
            except (KeyError, ValueError):
                frame.columns = [column[0] for column in frame.columns]
        return frame

    @classmethod
    def _normalize_history(cls, frame: pd.DataFrame, symbol: str) -> list[dict[str, Any]]:
        if frame is None or frame.empty:
            raise ServiceError(404, "NO_MARKET_DATA", f"Yahoo Finance returned no price history for {symbol}")
        frame = cls._single_ticker_frame(frame, symbol)
        columns = {str(column).lower(): column for column in frame.columns}
        required = ("open", "high", "low", "close")
        if any(name not in columns for name in required):
            raise ServiceError(502, "INVALID_YAHOO_DATA", "Yahoo Finance returned malformed price history")
        candles: dict[str, dict[str, Any]] = {}
        for index, row in frame.iterrows():
            try:
                timestamp = pd.Timestamp(index)
                if pd.isna(timestamp):
                    continue
                day = timestamp.date().isoformat()
                ohlc = {name: _json_number(row[columns[name]]) for name in required}
            except (TypeError, ValueError, OverflowError):
                continue
            if any(value is None for value in ohlc.values()) or any(value <= 0 for value in ohlc.values()):
                continue
            if ohlc["high"] < max(ohlc["open"], ohlc["close"]) or ohlc["low"] > min(ohlc["open"], ohlc["close"]):
                continue
            volume = _json_number(row[columns["volume"]]) if "volume" in columns else 0
            candles[day] = {"time": day, **ohlc, "volume": max(0, volume or 0)}
        result = [candles[key] for key in sorted(candles)]
        if not result:
            raise ServiceError(404, "NO_MARKET_DATA", f"Yahoo Finance returned no valid price history for {symbol}")
        return result

    @classmethod
    def _fetch_candles(cls, symbol: str, interval: str, period: str, adjusted: bool = False) -> list[dict[str, Any]]:
        try:
            with _YAHOO_LOCK:
                frame = cls._ticker(symbol).history(
                    period=period,
                    interval=interval,
                    auto_adjust=adjusted,
                    actions=False,
                    timeout=YAHOO_TIMEOUT_SECONDS,
                    raise_errors=True,
                )
            return cls._normalize_history(frame, symbol)
        except ServiceError:
            raise
        except Exception as exc:
            raise _provider_error(exc) from exc

    def candles(self, symbol: str, interval: str, period: str, adjusted: bool = False) -> list[dict[str, Any]]:
        key = f"history:{symbol}:{interval}:{period}" + (":adjusted" if adjusted else "")
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        candles = self._fetch_candles(symbol, interval, period, adjusted=adjusted)
        self.cache.set(key, candles, 900 if interval == "1d" else 3600)
        return candles

    def history(self, symbol: str, interval: str, period: str) -> dict[str, Any]:
        if interval not in HISTORY_INTERVALS:
            raise ServiceError(400, "INVALID_INTERVAL", "interval must be 1d, 1wk, or 1mo")
        if period not in HISTORY_PERIODS:
            raise ServiceError(400, "INVALID_PERIOD", "period must be 6mo, 1y, 2y, 5y, or max")
        candles = self.candles(symbol, interval, period)
        return {"symbol": symbol, "interval": interval, "candles": candles, "asOf": candles[-1]["time"], "source": "Yahoo Finance"}

    def _quote_uncached(self, symbol: str) -> dict[str, Any]:
        try:
            with _YAHOO_LOCK:
                frame = self._ticker(symbol).history(
                    period="5d", interval="1m", auto_adjust=False, actions=False,
                    timeout=YAHOO_TIMEOUT_SECONDS, raise_errors=True,
                )
        except yf.exceptions.YFPricesMissingError:
            frame = None
        except Exception as exc:
            raise _provider_error(exc) from exc

        price = previous = None
        as_of = None
        if frame is not None and not frame.empty:
            frame = self._single_ticker_frame(frame, symbol)
            close_column = next((column for column in frame.columns if str(column).lower() == "close"), None)
            if close_column is not None:
                rows = []
                for index, value in frame[close_column].items():
                    close = _json_number(value)
                    timestamp = pd.Timestamp(index)
                    if close is not None and close > 0 and not pd.isna(timestamp):
                        rows.append((timestamp, close))
                rows.sort(key=lambda row: row[0])
                if rows:
                    latest_time, price = rows[-1]
                    as_of = latest_time.isoformat()
                    latest_day = latest_time.date().isoformat()
                    prior_day_closes: dict[str, float] = {}
                    for timestamp, close in rows:
                        day = timestamp.date().isoformat()
                        if day < latest_day:
                            prior_day_closes[day] = close
                    if prior_day_closes:
                        previous = prior_day_closes[max(prior_day_closes)]

        if price is None or previous is None:
            bars = self._fetch_candles(symbol, "1d", "5d")
            if len(bars) < 2:
                raise ServiceError(404, "NO_QUOTE", f"Yahoo Finance returned no usable quote for {symbol}")
            if price is None:
                price = bars[-1]["close"]
                as_of = bars[-1]["time"]
            if previous is None:
                quote_day = as_of[:10] if as_of else bars[-1]["time"]
                prior_bars = [bar for bar in bars if bar["time"] < quote_day]
                previous = prior_bars[-1]["close"] if prior_bars else bars[-2]["close"]

        if price <= 0 or previous <= 0 or as_of is None:
            raise ServiceError(404, "NO_QUOTE", f"Yahoo Finance returned no usable quote for {symbol}")
        change = price - previous
        change_percent = change / previous * 100
        if not math.isfinite(change) or not math.isfinite(change_percent):
            raise ServiceError(502, "INVALID_YAHOO_DATA", "Yahoo Finance returned an invalid quote")
        return {
            "symbol": symbol,
            "price": price,
            "previousClose": previous,
            "change": change,
            "changePercent": change_percent,
            "asOf": as_of,
            "fetchedAt": _iso_now(),
        }

    def quote(self, symbol: str) -> dict[str, Any]:
        key = f"quote:v2:{symbol}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        try:
            quote = self._quote_uncached(symbol)
        except ServiceError:
            raise
        except Exception as exc:
            raise _provider_error(exc) from exc
        self.cache.set(key, quote, 30)
        return quote

    def quotes(self, symbols: list[str]) -> dict[str, Any]:
        unique = list(dict.fromkeys(_symbol(item) for item in symbols if item.strip()))
        if not unique:
            raise ServiceError(400, "MISSING_SYMBOLS", "symbols must contain at least one ticker")
        if len(unique) > QUOTE_LIMIT:
            raise ServiceError(400, "TOO_MANY_SYMBOLS", f"at most {QUOTE_LIMIT} symbols are allowed")
        quotes: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        for symbol in unique:
            try:
                quotes.append(self.quote(symbol))
            except ServiceError as exc:
                errors.append({"symbol": symbol, "error": exc.message})
        result: dict[str, Any] = {"quotes": quotes}
        if errors:
            result["errors"] = errors
        return result

    def search(self, query: str) -> dict[str, Any]:
        query = query.strip()
        if len(query) > 100:
            raise ServiceError(400, "INVALID_QUERY", "search query cannot exceed 100 characters")
        if not query or not os.environ.get("FINNHUB_API_KEY"):
            return {"results": []}
        key = f"search:{query.casefold()}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        url = "https://finnhub.io/api/v1/search?" + urlencode({"q": query, "token": os.environ["FINNHUB_API_KEY"]})
        try:
            request = Request(url, headers={"Accept": "application/json", "User-Agent": "StockAnalysisPlatform/1.0"})
            with urlopen(request, timeout=YAHOO_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read(1_000_001).decode("utf-8"))
        except Exception as exc:
            message = f"{type(exc).__name__} {exc}".lower()
            if isinstance(exc, (TimeoutError, socket.timeout)) or "timed out" in message or "timeout" in message:
                raise ServiceError(504, "FINNHUB_TIMEOUT", "Finnhub search timed out; try again") from exc
            raise ServiceError(502, "FINNHUB_UNAVAILABLE", "Finnhub search is unavailable; try again later") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("result"), list):
            raise ServiceError(502, "INVALID_FINNHUB_DATA", "Finnhub returned malformed search results")
        results = []
        for item in payload["result"]:
            if isinstance(item, dict) and isinstance(item.get("symbol"), str) and isinstance(item.get("description"), str):
                results.append({"symbol": item["symbol"], "description": item["description"]})
                if len(results) == 10:
                    break
        result = {"results": results}
        self.cache.set(key, result, 300)
        return result

    @staticmethod
    def _dividend_yield(info: dict[str, Any]) -> float | None:
        annual_rate = _json_number(info.get("dividendRate"))
        prices = (_json_number(info.get("regularMarketPrice")), _json_number(info.get("currentPrice")))
        price = next((value for value in prices if value is not None and value > 0), None)
        if annual_rate is not None and annual_rate >= 0 and price is not None:
            ratio = annual_rate / price
            if math.isfinite(ratio):
                return ratio
        trailing_ratio = _json_number(info.get("trailingAnnualDividendYield"))
        return trailing_ratio if trailing_ratio is not None and trailing_ratio >= 0 else None

    def fundamentals(self, symbol: str) -> dict[str, Any]:
        key = f"fundamentals:v2:{symbol}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        try:
            with _YAHOO_LOCK:
                ticker = self._ticker(symbol)
                info = ticker.get_info()
            if not isinstance(info, dict) or not info:
                raise ServiceError(404, "NO_FUNDAMENTALS", f"Yahoo Finance returned no fundamentals for {symbol}")
        except ServiceError:
            raise
        except Exception as exc:
            raise _provider_error(exc) from exc
        result = {
            "symbol": symbol,
            "name": info.get("shortName") or info.get("longName") or None,
            "currency": info.get("currency") or None,
            "marketCap": _json_number(info.get("marketCap")),
            "trailingPE": _json_number(info.get("trailingPE")),
            "forwardPE": _json_number(info.get("forwardPE")),
            "trailingEps": _json_number(info.get("trailingEps")),
            "dividendYield": self._dividend_yield(info),
            "sector": info.get("sector") or None,
            "industry": info.get("industry") or None,
            "beta": _json_number(info.get("beta")),
            "fiftyTwoWeekLow": _json_number(info.get("fiftyTwoWeekLow")),
            "fiftyTwoWeekHigh": _json_number(info.get("fiftyTwoWeekHigh")),
            "averageVolume": _json_number(info.get("averageVolume")),
        }
        self.cache.set(key, result, 6 * 60 * 60)
        return result


class AnalysisService:
    def __init__(self, cache_dir: Path | None = None):
        root = cache_dir or Path(os.environ.get("ANALYSIS_CACHE_DIR", Path(__file__).resolve().parent / ".cache"))
        self.market = MarketData(JsonTTLCache(root / "market"))
        self.models = ModelStore(root / "models", self.market)

    def prediction(self, symbol: str, force: bool = False) -> dict[str, Any]:
        candles = self.market.candles(symbol, "1d", "max", adjusted=True)
        model, metadata = self.models.get(symbol, force=force)
        try:
            _, _, _, latest = prepare_data(candles)
            result = predict_model(model, latest)
        except ModelDataError as exc:
            raise ServiceError(422, "INSUFFICIENT_HISTORY", str(exc)) from exc
        training = {key: metadata[key] for key in ("trainedAt", "samples", "accuracy", "trainSamples", "testSamples", "gapBars")}
        return {"symbol": symbol, **result, "training": training}


SERVICE = AnalysisService()


class Handler(BaseHTTPRequestHandler):
    server_version = "AnalysisService/1.0"

    def _send(self, status: int, data: Any, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(data, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _error(self, error: ServiceError) -> None:
        self._send(error.status, {"error": error.message, "code": error.code})

    def _request_path(self) -> tuple[str, dict[str, list[str]]]:
        parsed = urlsplit(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            path = path[4:]
        return path, parse_qs(parsed.query, keep_blank_values=True)

    def _body(self) -> Any:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ServiceError(400, "INVALID_BODY", "Content-Length is required")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ServiceError(400, "INVALID_BODY", "Content-Length must be an integer") from exc
        if length < 0:
            raise ServiceError(400, "INVALID_BODY", "Content-Length cannot be negative")
        if length > BODY_LIMIT:
            raise ServiceError(413, "BODY_TOO_LARGE", f"request body cannot exceed {BODY_LIMIT} bytes")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ServiceError(400, "INVALID_JSON", "request body must be valid JSON") from exc

    def do_GET(self) -> None:
        try:
            path, query = self._request_path()
            if path == "/health":
                return self._send(200, {"status": "ok", "service": "analysis"})
            if path == "/quotes":
                return self._send(200, SERVICE.market.quotes(query.get("symbols", [""])[0].split(",")))
            if path == "/search":
                return self._send(200, SERVICE.market.search(query.get("q", [""])[0]))
            match = re.fullmatch(r"/(history|fundamentals|prediction|models)/([^/]+)", path)
            if match:
                endpoint, raw_symbol = match.groups()
                symbol = _symbol(unquote(raw_symbol))
                if endpoint == "history":
                    interval = query.get("interval", ["1d"])[0]
                    period = query.get("period", ["1y"])[0]
                    return self._send(200, SERVICE.market.history(symbol, interval, period))
                if endpoint == "fundamentals":
                    return self._send(200, SERVICE.market.fundamentals(symbol))
                if endpoint == "prediction":
                    return self._send(200, SERVICE.prediction(symbol))
                return self._send(200, SERVICE.models.status(symbol))
            raise ServiceError(404, "NOT_FOUND", "analysis endpoint not found")
        except ServiceError as exc:
            self._error(exc)
        except Exception:
            logging.exception("Unhandled analysis GET error")
            self._error(ServiceError(500, "INTERNAL_ERROR", "analysis request failed"))

    def do_POST(self) -> None:
        try:
            path, _ = self._request_path()
            if path == "/backtest":
                request = self._body()
                try:
                    config = validate_request(request)
                except BacktestError as exc:
                    raise ServiceError(400, "INVALID_BACKTEST", str(exc)) from exc
                symbol = _symbol(config["symbol"])
                candles = SERVICE.market.candles(symbol, config["interval"], config["period"])
                try:
                    return self._send(200, run_backtest(candles, request))
                except BacktestError as exc:
                    raise ServiceError(400, "INVALID_BACKTEST", str(exc)) from exc
            match = re.fullmatch(r"/models/([^/]+)/retrain", path)
            if match:
                symbol = _symbol(unquote(match.group(1)))
                if self.headers.get("Content-Length", "0") != "0":
                    body = self._body()
                    if body not in ({}, None):
                        raise ServiceError(400, "INVALID_BODY", "retrain does not accept options")
                return self._send(200, SERVICE.prediction(symbol, force=True))
            raise ServiceError(404, "NOT_FOUND", "analysis endpoint not found")
        except ServiceError as exc:
            self._error(exc)
        except Exception:
            logging.exception("Unhandled analysis POST error")
            self._error(ServiceError(500, "INTERNAL_ERROR", "analysis request failed"))

    def do_PUT(self) -> None:
        self._method_not_allowed()

    def do_PATCH(self) -> None:
        self._method_not_allowed()

    def do_DELETE(self) -> None:
        self._method_not_allowed()

    def _method_not_allowed(self) -> None:
        self._send(405, {"error": "method not allowed", "code": "METHOD_NOT_ALLOWED"}, {"Allow": "GET, POST"})

    def log_message(self, format: str, *args: Any) -> None:
        logging.info("%s - %s", self.address_string(), format % args)


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    try:
        port = int(os.environ.get("ANALYSIS_PORT", "8000"))
    except ValueError as exc:
        raise SystemExit("ANALYSIS_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise SystemExit("ANALYSIS_PORT must be between 1 and 65535")
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    logging.info("Analysis service listening on http://127.0.0.1:%d", port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
