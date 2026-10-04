"""Deterministic long-only simulation over daily, weekly, or monthly bars."""

from __future__ import annotations

import math
import statistics
from datetime import date
from typing import Any

OPERATORS = (">", "<", ">=", "<=")
PERIODS = ("1y", "2y", "5y", "max")
INTERVALS = ("1d", "1wk", "1mo")
FREQUENCIES = ("daily", "monthly")


class BacktestError(ValueError):
    pass


def _finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BacktestError(f"{field} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise BacktestError(f"{field} must be a finite number") from exc
    if not math.isfinite(number):
        raise BacktestError(f"{field} must be a finite number")
    return number


def _operand(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("type") not in ("close", "ma", "number"):
        raise BacktestError(f"{field}.type must be close, ma, or number")
    kind = value["type"]
    if kind == "ma":
        period = value.get("period")
        if isinstance(period, bool) or not isinstance(period, int) or not 2 <= period <= 500:
            raise BacktestError(f"{field}.period must be an integer from 2 to 500")
        return {"type": kind, "period": period}
    if kind == "number":
        if "value" not in value:
            raise BacktestError(f"{field}.value is required")
        return {"type": kind, "value": _finite_number(value["value"], f"{field}.value")}
    return {"type": kind}


def validate_request(request: Any) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise BacktestError("request body must be an object")
    symbol = request.get("symbol")
    if not isinstance(symbol, str) or not symbol.strip():
        raise BacktestError("symbol is required")
    interval = request.get("interval", "1d")
    if interval not in INTERVALS:
        raise BacktestError("interval must be 1d, 1wk, or 1mo")
    period = request.get("period")
    if period not in PERIODS:
        raise BacktestError("period must be 1y, 2y, 5y, or max")
    capital = _finite_number(request.get("initialCapital"), "initialCapital")
    if not 0 < capital <= 1_000_000_000_000:
        raise BacktestError("initialCapital must be greater than 0 and at most 1,000,000,000,000")

    rules: dict[str, Any] = {}
    for name in ("entry", "exit"):
        rule = request.get(name)
        if not isinstance(rule, dict):
            raise BacktestError(f"{name} must be an object")
        operator = rule.get("operator")
        if operator not in OPERATORS:
            raise BacktestError(f"{name}.operator must be >, <, >=, or <=")
        rules[name] = {
            "left": _operand(rule.get("left"), f"{name}.left"),
            "operator": operator,
            "right": _operand(rule.get("right"), f"{name}.right"),
        }

    frequency = request.get("frequency")
    if frequency not in FREQUENCIES:
        raise BacktestError("frequency must be daily or monthly")
    exit_mode = request.get("exitMode")
    if exit_mode not in ("immediate", "staged"):
        raise BacktestError("exitMode must be immediate or staged")
    exit_periods = request.get("exitPeriods", 3)
    if isinstance(exit_periods, bool) or not isinstance(exit_periods, int) or not 1 <= exit_periods <= 100:
        raise BacktestError("exitPeriods must be an integer from 1 to 100")
    exit_frequency = request.get("exitFrequency", "monthly")
    if exit_frequency not in ("weekly", "monthly"):
        raise BacktestError("exitFrequency must be weekly or monthly")

    return {
        "symbol": symbol.strip().upper(),
        "interval": interval,
        "period": period,
        "initialCapital": capital,
        **rules,
        "frequency": frequency,
        "exitMode": exit_mode,
        "exitPeriods": exit_periods,
        "exitFrequency": exit_frequency,
    }


def _value(operand: dict[str, Any], index: int, closes: list[float], moving_averages: dict[int, list[float]]) -> float | None:
    kind = operand["type"]
    if kind == "close":
        return closes[index]
    if kind == "number":
        return operand["value"]
    result = moving_averages[operand["period"]][index]
    return result if math.isfinite(result) else None


def _condition(rule: dict[str, Any], index: int, closes: list[float], moving_averages: dict[int, list[float]]) -> bool:
    left = _value(rule["left"], index, closes, moving_averages)
    right = _value(rule["right"], index, closes, moving_averages)
    if left is None or right is None:
        return False
    operator = rule["operator"]
    return {">": left > right, "<": left < right, ">=": left >= right, "<=": left <= right}[operator]


def _bar_date(value: Any) -> date:
    if not isinstance(value, str):
        raise BacktestError("each candle needs an ISO date in time")
    try:
        return date.fromisoformat(value[:10])
    except ValueError as exc:
        raise BacktestError("each candle needs an ISO date in time") from exc


def _next_exit_bar(dates: list[date], index: int, frequency: str) -> int | None:
    current = dates[index]
    for candidate in range(index + 1, len(dates)):
        next_date = dates[candidate]
        if frequency == "weekly":
            if (current.isocalendar().year, current.isocalendar().week) != (next_date.isocalendar().year, next_date.isocalendar().week):
                return candidate
        elif (current.year, current.month) != (next_date.year, next_date.month):
            return candidate
    return None


def _safe(value: float | None) -> float | None:
    return float(value) if value is not None and math.isfinite(value) else None


def _mean(values: list[float]) -> float | None:
    try:
        return _safe(statistics.mean(values))
    except (OverflowError, ValueError):
        return None


def run_backtest(candles: list[dict[str, Any]], request: Any) -> dict[str, Any]:
    """Run close-on-signal, fractional-share, long-only simulation; see README for full semantics."""
    config = validate_request(request)
    if not isinstance(candles, list) or not candles:
        raise BacktestError("Yahoo Finance returned no daily candles")

    closes: list[float] = []
    dates: list[date] = []
    times: list[str] = []
    for candle in candles:
        if not isinstance(candle, dict):
            raise BacktestError("candle must be an object")
        close = _finite_number(candle.get("close"), "candle.close")
        if close <= 0:
            raise BacktestError("candle.close must be greater than 0")
        time = candle.get("time")
        bar_date = _bar_date(time)
        if dates and bar_date <= dates[-1]:
            raise BacktestError("candles must be unique and chronological")
        closes.append(close)
        dates.append(bar_date)
        times.append(time)

    periods = {operand["period"] for rule in (config["entry"], config["exit"]) for operand in (rule["left"], rule["right"]) if operand["type"] == "ma"}
    moving_averages = {
        period: [
            (sum(closes[index - period + 1:index + 1]) / period) if index + 1 >= period else math.nan
            for index in range(len(closes))
        ]
        for period in periods
    }
    monthly_checks: set[int] = set()
    seen_months: set[tuple[int, int]] = set()
    for index, bar_date in enumerate(dates):
        month = (bar_date.year, bar_date.month)
        if month not in seen_months:
            monthly_checks.add(index)
            seen_months.add(month)
    checks = range(len(closes)) if config["frequency"] == "daily" else monthly_checks

    actions: list[dict[str, Any]] = []
    equity_curve: list[dict[str, Any]] = []
    initial = config["initialCapital"]
    cash = initial
    quantity = 0.0
    entry_price = 0.0
    staged_left = 0
    staged_quantity = 0.0
    next_stage: int | None = None
    sale_returns: list[float] = []
    sale_pnls: list[float] = []
    previous_entry: bool | None = None
    check_set = set(checks)

    def sell(index: int, qty: float, reason: str) -> None:
        nonlocal cash, quantity, staged_left, staged_quantity, next_stage
        qty = min(qty, quantity)
        if qty <= 0:
            return
        proceeds = closes[index] * qty
        pnl = (closes[index] - entry_price) * qty
        trade_return = closes[index] / entry_price - 1
        if not all(math.isfinite(value) for value in (proceeds, pnl, trade_return, cash + proceeds)):
            raise BacktestError("trade calculation exceeded numeric range")
        quantity -= qty
        cash += proceeds
        sale_returns.append(trade_return)
        sale_pnls.append(pnl)
        actions.append({"time": times[index], "side": "SELL", "price": closes[index], "quantity": qty, "reason": reason, "pnl": pnl})
        if quantity <= 0:
            quantity = 0.0
            staged_left = 0
            staged_quantity = 0.0
            next_stage = None

    for index, price in enumerate(closes):
        acted = False
        entry_now = _condition(config["entry"], index, closes, moving_averages) if index in check_set else False
        entry_transition = entry_now and previous_entry is False
        if index in check_set:
            previous_entry = entry_now
        if quantity > 0 and staged_left:
            if next_stage == index:
                tranche = quantity if staged_left == 1 else min(staged_quantity, quantity)
                remaining_stages = staged_left - 1
                sell(index, tranche, "staged_exit")
                acted = True
                if quantity > 0:
                    staged_left = remaining_stages
                    next_stage = _next_exit_bar(dates, index, config["exitFrequency"])
        elif quantity > 0 and index in check_set and _condition(config["exit"], index, closes, moving_averages):
            acted = True
            if config["exitMode"] == "immediate" or config["exitPeriods"] == 1:
                sell(index, quantity, "exit_condition")
            else:
                staged_left = config["exitPeriods"]
                staged_quantity = quantity / staged_left
                remaining_stages = staged_left - 1
                sell(index, staged_quantity, "exit_condition")
                if quantity > 0:
                    staged_left = remaining_stages
                    next_stage = _next_exit_bar(dates, index, config["exitFrequency"])
        elif quantity == 0 and not acted and index < len(closes) - 1 and index in check_set:
            should_enter = entry_now and (config["frequency"] == "monthly" or entry_transition)
            if should_enter and cash > 0:
                quantity = cash / price
                if not math.isfinite(quantity):
                    raise BacktestError("position size exceeded numeric range")
                entry_price = price
                cash = 0.0
                actions.append({"time": times[index], "side": "BUY", "price": price, "quantity": quantity, "reason": "entry_condition"})
                acted = True

        equity = cash + quantity * price
        if not math.isfinite(equity):
            raise BacktestError("equity calculation exceeded numeric range")
        equity_curve.append({"time": times[index], "value": equity})

    if quantity > 0:
        sell(len(closes) - 1, quantity, "end_of_data")
        equity_curve[-1]["value"] = cash

    final_equity = cash
    total_return = final_equity / initial - 1
    elapsed_days = (dates[-1] - dates[0]).days
    cagr = None
    if elapsed_days > 0 and final_equity > 0:
        try:
            cagr = math.expm1(math.log(final_equity / initial) * 365.25 / elapsed_days)
        except (OverflowError, ValueError):
            pass

    peak = initial
    max_drawdown = 0.0
    previous_equity = initial
    daily_returns: list[float] = []
    for point in equity_curve:
        value = point["value"]
        peak = max(peak, value)
        max_drawdown = min(max_drawdown, value / peak - 1)
        daily_returns.append(value / previous_equity - 1)
        previous_equity = value
    sharpe = None
    if len(daily_returns) >= 2 and all(math.isfinite(value) for value in daily_returns):
        try:
            deviation = statistics.stdev(daily_returns)
            average_daily_return = statistics.mean(daily_returns)
            if 0 < deviation < math.inf:
                sharpe = average_daily_return / deviation * math.sqrt(252)
        except (OverflowError, ValueError):
            pass

    winners = [pnl for pnl in sale_pnls if pnl > 0]
    losers = [pnl for pnl in sale_pnls if pnl < 0]
    metrics = {
        "totalReturn": _safe(total_return),
        "cagr": _safe(cagr),
        "sharpe": _safe(sharpe),
        "maxDrawdown": _safe(max_drawdown),
        "winRate": _safe(sum(value > 0 for value in sale_returns) / len(sale_returns)) if sale_returns else None,
        "tradeCount": len(sale_returns),
        "averageReturn": _mean(sale_returns) if sale_returns else None,
        "averageLoss": _mean([value for value in sale_returns if value < 0]) if losers else None,
        "profitFactor": _safe(sum(winners) / abs(sum(losers))) if losers else None,
    }
    return {"symbol": config["symbol"], "interval": config["interval"], "period": config["period"], "metrics": metrics, "actions": actions, "equity": equity_curve}
