import unittest
from datetime import date, timedelta

from analysis.backtest import BacktestError, run_backtest


def candles(closes, dates=None):
    dates = dates or [date(2024, 1, 1) + timedelta(days=i) for i in range(len(closes))]
    return [{"time": day.isoformat(), "close": close} for day, close in zip(dates, closes)]


def request(**overrides):
    value = {
        "symbol": "TEST",
        "interval": "1d",
        "period": "1y",
        "initialCapital": 100,
        "entry": {"left": {"type": "close"}, "operator": ">", "right": {"type": "number", "value": 10}},
        "exit": {"left": {"type": "close"}, "operator": ">", "right": {"type": "number", "value": 13}},
        "frequency": "daily",
        "exitMode": "immediate",
        "exitPeriods": 3,
        "exitFrequency": "weekly",
    }
    value.update(overrides)
    return value


class BacktestTests(unittest.TestCase):
    def test_daily_requires_transition_and_liquidates_open_position(self):
        result = run_backtest(candles([9, 11, 12, 14, 12, 9, 12, 13]), request())
        self.assertEqual([action["side"] for action in result["actions"]], ["BUY", "SELL", "BUY", "SELL"])
        self.assertEqual(result["actions"][0]["price"], 11)
        self.assertEqual(result["actions"][1]["reason"], "exit_condition")
        self.assertEqual(result["actions"][-1]["reason"], "end_of_data")
        self.assertAlmostEqual(result["metrics"]["totalReturn"], (14 / 11) * (13 / 12) - 1)
        self.assertEqual(result["metrics"]["tradeCount"], 2)
        self.assertEqual(len(result["equity"]), 8)

    def test_daily_does_not_treat_initial_true_condition_as_a_transition(self):
        result = run_backtest(candles([11, 12, 13]), request())
        self.assertEqual(result["actions"], [])

    def test_monthly_checks_first_bar_even_when_condition_already_true(self):
        dates = [date(2024, 1, 2), date(2024, 1, 3), date(2024, 2, 1), date(2024, 2, 2)]
        result = run_backtest(
            candles([11, 12, 12, 12], dates),
            request(frequency="monthly", exit={"left": {"type": "close"}, "operator": ">", "right": {"type": "number", "value": 100}}),
        )
        self.assertEqual(result["actions"][0]["side"], "BUY")
        self.assertEqual(result["actions"][0]["time"], "2024-01-02")
        self.assertEqual(sum(action["side"] == "BUY" for action in result["actions"]), 1)
        self.assertEqual(result["actions"][-1]["reason"], "end_of_data")

    def test_staged_exit_sells_on_signal_then_week_boundaries(self):
        dates = [
            date(2024, 1, 5),  # Friday entry
            date(2024, 1, 8), date(2024, 1, 9),  # exit signal
            date(2024, 1, 15), date(2024, 1, 16),
            date(2024, 1, 22),
        ]
        result = run_backtest(
            candles([9, 11, 14, 15, 15, 15], dates),
            request(exitMode="staged", exitPeriods=3, exitFrequency="weekly"),
        )
        sells = [action for action in result["actions"] if action["side"] == "SELL"]
        self.assertEqual([action["time"] for action in sells], ["2024-01-09", "2024-01-15", "2024-01-22"])
        self.assertEqual([action["reason"] for action in sells], ["exit_condition", "staged_exit", "staged_exit"])
        self.assertEqual(result["metrics"]["tradeCount"], 3)
        self.assertTrue(all(action["quantity"] > 0 for action in sells))

    def test_weekly_bars_define_each_bar_and_calendar_month_evaluation(self):
        dates = [date(2024, 1, 5), date(2024, 1, 12), date(2024, 1, 19), date(2024, 2, 2), date(2024, 2, 9)]
        bars = candles([9, 11, 9, 11, 12], dates)
        daily = run_backtest(bars, request(interval="1wk", frequency="daily", exit={"left": {"type": "close"}, "operator": ">", "right": {"type": "number", "value": 100}}))
        monthly = run_backtest(bars, request(interval="1wk", frequency="monthly", exit={"left": {"type": "close"}, "operator": ">", "right": {"type": "number", "value": 100}}))
        daily_buy = next(action for action in daily["actions"] if action["side"] == "BUY")
        monthly_buy = next(action for action in monthly["actions"] if action["side"] == "BUY")
        self.assertEqual(daily["interval"], "1wk")
        self.assertEqual(daily_buy["time"], "2024-01-12")
        self.assertEqual(monthly_buy["time"], "2024-02-02")

    def test_monthly_bars_support_monthly_staged_exits(self):
        dates = [date(2024, month, 1) for month in range(1, 6)]
        result = run_backtest(
            candles([9, 11, 14, 15, 15], dates),
            request(interval="1mo", frequency="monthly", exitMode="staged", exitPeriods=2, exitFrequency="monthly"),
        )
        sells = [action for action in result["actions"] if action["side"] == "SELL"]
        self.assertEqual(result["interval"], "1mo")
        self.assertEqual([action["time"] for action in sells], ["2024-03-01", "2024-04-01"])

    def test_no_trade_metrics_are_null_and_single_bar_does_not_open(self):
        result = run_backtest(candles([11]), request())
        self.assertEqual(result["actions"], [])
        self.assertEqual(result["metrics"]["tradeCount"], 0)
        for key in ("winRate", "averageReturn", "averageLoss", "profitFactor", "sharpe", "cagr"):
            self.assertIsNone(result["metrics"][key])
        self.assertEqual(result["metrics"]["totalReturn"], 0)

    def test_validation_rejects_bad_rules_and_nonchronological_data(self):
        with self.assertRaises(BacktestError):
            run_backtest(candles([10, 11]), request(period=[]))
        with self.assertRaises(BacktestError):
            run_backtest(candles([10, 11]), request(entry={"left": {"type": "ma", "period": 1}, "operator": ">", "right": {"type": "close"}}))
        with self.assertRaises(BacktestError):
            run_backtest(candles([10, 11], [date(2024, 1, 2), date(2024, 1, 1)]), request())


if __name__ == "__main__":
    unittest.main()
