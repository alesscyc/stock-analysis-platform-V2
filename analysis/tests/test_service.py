import json
import os
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen
from http.server import ThreadingHTTPServer
from io import BytesIO

import pandas as pd

from analysis.stock_data import Handler, JsonTTLCache, MarketData, ModelStore, ServiceError, sklearn
from analysis import stock_data


class DummyModel:
    def predict_proba(self, _):
        return [[0.75, 0.25]]


class FakeFundamentalTicker:
    def __init__(self, info):
        self.info = info

    def get_info(self):
        return self.info


class FakeTicker:
    def __init__(self, intraday, daily=None):
        self.intraday = intraday
        self.daily = daily
        self.calls = []

    def history(self, **kwargs):
        self.calls.append(kwargs)
        return self.intraday if kwargs["interval"] == "1m" else self.daily


class DummyMarket:
    def candles(self, *_, **kwargs):
        return []


class ServiceTests(unittest.TestCase):
    def test_history_normalization_filters_bad_bars_and_preserves_contract(self):
        frame = pd.DataFrame(
            [
                [10, 12, 9, 11, 100],
                [11, 12, 8, float("nan"), 200],
                [12, 13, 11, 12, None],
            ],
            index=pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"]),
            columns=["Open", "High", "Low", "Close", "Volume"],
        )
        bars = MarketData._normalize_history(frame, "TEST")
        self.assertEqual(len(bars), 2)
        self.assertEqual(set(bars[0]), {"time", "open", "high", "low", "close", "volume"})
        self.assertEqual(bars[0], {"time": "2024-01-02", "open": 10, "high": 12, "low": 9, "close": 11, "volume": 100})
        self.assertEqual(bars[1]["volume"], 0)

    def test_model_prices_are_adjusted_and_cached_separately(self):
        daily = pd.DataFrame({"Open": [100], "High": [102], "Low": [99], "Close": [101], "Volume": [10]},
                             index=pd.to_datetime(["2024-01-01"]))
        ticker = FakeTicker(None, daily)
        with TemporaryDirectory() as directory, patch.object(MarketData, "_ticker", return_value=ticker):
            market = MarketData(JsonTTLCache(Path(directory)))
            market.candles("TEST", "1d", "max")
            market.candles("TEST", "1d", "max", adjusted=True)
            market.candles("TEST", "1d", "max", adjusted=True)
        self.assertEqual([call["auto_adjust"] for call in ticker.calls], [False, True])
        self.assertFalse(ModelStore._valid_metadata({"schema": 1, "trainedAtEpoch": 123}))

    def test_fundamental_dividend_yield_is_normalized_to_fraction(self):
        info = {
            "NVDA": {"dividendYield": 0.44, "dividendRate": 1.0, "regularMarketPrice": 230.134, "trailingAnnualDividendYield": 0.001244},
            "FALLBACK": {"dividendYield": 0.44, "trailingAnnualDividendYield": 0.001244},
            "CURRENT": {"dividendRate": 2.0, "regularMarketPrice": 0, "currentPrice": 100.0},
            "MISSING": {"dividendYield": 0.44, "dividendRate": -1, "trailingAnnualDividendYield": -0.1},
        }
        with TemporaryDirectory() as directory:
            market = MarketData(JsonTTLCache(Path(directory)))
            with patch.object(MarketData, "_ticker", side_effect=lambda symbol: FakeFundamentalTicker(info[symbol])):
                nvda = market.fundamentals("NVDA")
                fallback = market.fundamentals("FALLBACK")
                current = market.fundamentals("CURRENT")
                missing = market.fundamentals("MISSING")
        self.assertAlmostEqual(nvda["dividendYield"], 1.0 / 230.134)
        self.assertAlmostEqual(fallback["dividendYield"], 0.001244)
        self.assertAlmostEqual(current["dividendYield"], 0.02)
        self.assertIsNone(missing["dividendYield"])

    def test_cached_quote_keeps_provider_asof_and_separate_fetched_at(self):
        index = pd.to_datetime(["2024-01-04 15:59", "2024-01-05 09:30", "2024-01-05 09:31"]).tz_localize("America/New_York")
        frame = pd.DataFrame({"Close": [100.0, 102.0, 103.0]}, index=index)
        ticker = FakeTicker(frame)
        with TemporaryDirectory() as directory:
            market = MarketData(JsonTTLCache(Path(directory)))
            with patch.object(MarketData, "_ticker", return_value=ticker):
                first = market.quote("TEST")
                second = market.quote("TEST")
        self.assertEqual(first["price"], 103)
        self.assertEqual(first["previousClose"], 100)
        self.assertEqual(first["changePercent"], 3)
        self.assertEqual(first["asOf"], "2024-01-05T09:31:00-05:00")
        self.assertIn("T", first["fetchedAt"])
        self.assertEqual(second["asOf"], first["asOf"])
        self.assertEqual(second["fetchedAt"], first["fetchedAt"])
        self.assertEqual(len(ticker.calls), 1)

    def test_daily_quote_fallback_does_not_stamp_fetch_time_as_provider_time(self):
        index = pd.to_datetime(["2024-01-04", "2024-01-05"])
        daily = pd.DataFrame(
            {"Open": [99.0, 100.0], "High": [101.0, 102.0], "Low": [98.0, 99.0], "Close": [100.0, 101.0], "Volume": [10, 20]},
            index=index,
        )
        ticker = FakeTicker(pd.DataFrame(), daily)
        with TemporaryDirectory() as directory, patch.object(MarketData, "_ticker", return_value=ticker):
            quote = MarketData(JsonTTLCache(Path(directory))).quote("TEST")
        self.assertEqual(quote["price"], 101)
        self.assertEqual(quote["previousClose"], 100)
        self.assertEqual(quote["asOf"], "2024-01-05")
        self.assertNotEqual(quote["asOf"], quote["fetchedAt"][:10] + "T00:00:00Z")

    def test_search_returns_empty_without_finnhub_and_normalizes_configured_results(self):
        with TemporaryDirectory() as directory:
            market = MarketData(JsonTTLCache(Path(directory)))
            with patch.dict(os.environ, {"FINNHUB_API_KEY": ""}):
                self.assertEqual(market.search("AAPL"), {"results": []})
            payload = {"result": [{"symbol": f"TICKER{i}", "description": f"Company {i}"} for i in range(12)]}
            with patch.dict(os.environ, {"FINNHUB_API_KEY": "offline-test-key"}):
                with patch("analysis.stock_data.urlopen", return_value=BytesIO(json.dumps(payload).encode())):
                    results = market.search("test")
            self.assertEqual(len(results["results"]), 10)
            self.assertEqual(results["results"][0], {"symbol": "TICKER0", "description": "Company 0"})

    def test_yahoo_rate_limit_reports_429_and_blocks_new_provider_calls_during_cooldown(self):
        with patch.object(stock_data, "_YAHOO_RETRY_AT", 0), \
                patch("analysis.stock_data.time.monotonic", return_value=100) as clock, \
                patch("analysis.stock_data.yf.Ticker") as ticker:
            error = stock_data._provider_error(stock_data.yf.exceptions.YFRateLimitError())
            self.assertEqual(error.status, 429)
            self.assertEqual(error.code, "YAHOO_RATE_LIMITED")
            self.assertIs(stock_data._provider_error(error), error)
            with self.assertRaises(ServiceError) as raised:
                MarketData._ticker("AAPL")
            self.assertEqual(raised.exception.status, 429)
            ticker.assert_not_called()
            clock.return_value = 160
            MarketData._ticker("AAPL")
            ticker.assert_called_once()

    def test_finnhub_timeout_has_explicit_gateway_error(self):
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"FINNHUB_API_KEY": "offline-test-key"}):
            market = MarketData(JsonTTLCache(Path(directory)))
            with patch("analysis.stock_data.urlopen", side_effect=TimeoutError("offline timeout")):
                with self.assertRaises(ServiceError) as raised:
                    market.search("test")
            self.assertEqual(raised.exception.status, 504)
            self.assertEqual(raised.exception.code, "FINNHUB_TIMEOUT")

    def test_model_cache_persists_estimator_and_four_hour_metadata(self):
        summary = {
            "trainedAt": "2024-01-01T00:00:00Z",
            "samples": 200,
            "accuracy": 0.6,
            "trainSamples": 130,
            "testSamples": 40,
            "gapBars": 22,
            "featureNames": [],
            "sklearnVersion": sklearn.__version__,
        }
        with TemporaryDirectory() as directory:
            first = ModelStore(Path(directory), DummyMarket())
            with patch("analysis.stock_data.train_model", return_value=(DummyModel(), summary)):
                first.get("TEST")
            second = ModelStore(Path(directory), DummyMarket())
            loaded, metadata = second.get("TEST")
            self.assertIsInstance(loaded, DummyModel)
            self.assertEqual(metadata["samples"], 200)
            self.assertEqual(second.status("TEST")["status"], "ready")

    def test_loopback_routes_return_json_contract_errors_without_yahoo_calls(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        root = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(root + "/api/health") as response:
                self.assertEqual(json.load(response), {"status": "ok", "service": "analysis"})
            with self.assertRaises(HTTPError) as raised:
                urlopen(root + "/api/history/AAPL?interval=5m")
            self.assertEqual(raised.exception.code, 400)
            self.assertEqual(json.load(raised.exception)["code"], "INVALID_INTERVAL")
            with self.assertRaises(HTTPError) as raised:
                urlopen(root + "/api/quotes?symbols=")
            self.assertEqual(raised.exception.code, 400)
            self.assertEqual(json.load(raised.exception)["code"], "MISSING_SYMBOLS")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
