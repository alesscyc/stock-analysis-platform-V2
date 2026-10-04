"""Leakage-aware daily Random Forest training and inference."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
from sklearn.utils.validation import check_is_fitted
import sklearn

LABEL_HORIZON = 22
GAP_BARS = 22
BUY_THRESHOLD = 0.05
MIN_TRAIN_SAMPLES = 18
MIN_TEST_SAMPLES = 10
FEATURE_COLUMNS = (
    "MA50_above_MA150", "MA150_above_MA200", "Price_above_MA50",
    "Volume_20MA_uptrend", "MA200_uptrend_past_month", "MA200_uptrend_past_6months",
    "MA200_uptrend_past_year", "Price_above_52week_low_30pct",
    "Price_within_25pct_of_52week_high", "Week_Price_Range", "Month_Price_Range",
    "Price_Change_1D", "Price_Change_1W", "Price_Change_1M", "Price_Change_3M",
    "Price_more_rise_than_fall_month",
)


class ModelDataError(ValueError):
    pass


def _number_column(frame: pd.DataFrame, name: str) -> pd.Series:
    if name not in frame:
        raise ModelDataError(f"daily candles missing {name}")
    return pd.to_numeric(frame[name], errors="coerce").astype(float)


def prepare_data(candles: list[dict[str, Any]]) -> tuple[pd.DataFrame, pd.Series, np.ndarray, pd.Series]:
    """Build causal features, known 22-bar labels, raw bar positions, and latest feature row."""
    if not isinstance(candles, list) or not candles:
        raise ModelDataError("Yahoo Finance returned no daily candles")
    frame = pd.DataFrame(candles)
    close = _number_column(frame, "close")
    high = _number_column(frame, "high")
    low = _number_column(frame, "low")
    volume = _number_column(frame, "volume")
    if (close.dropna() <= 0).any():
        raise ModelDataError("daily close prices must be positive")

    # Match stock_analysis_platform, including false binary flags during warmup
    # and two-decimal continuous inputs at its history serialization boundary.
    features = pd.DataFrame(index=frame.index)
    ma50, ma150, ma200 = (close.rolling(period).mean() for period in (50, 150, 200))
    features["MA50_above_MA150"] = (ma50 > ma150).astype(int)
    features["MA150_above_MA200"] = (ma150 > ma200).astype(int)
    features["Price_above_MA50"] = (close > ma50).astype(int)
    volume_up = (volume.rolling(20).mean().diff() > 0).astype(int)
    features["Volume_20MA_uptrend"] = (volume_up.rolling(10).sum() >= 7).astype(int)
    ma_up = (ma200.diff() > 0).astype(int)
    for name, period, threshold in (("month", 22, 20), ("6months", 132, 119), ("year", 252, 227)):
        features[f"MA200_uptrend_past_{name}"] = (ma_up.rolling(period).sum() >= threshold).astype(int)
    low52, high52 = close.rolling(252).min(), close.rolling(252).max()
    features["Price_above_52week_low_30pct"] = ((close - low52) / low52 >= 0.30).astype(int)
    features["Price_within_25pct_of_52week_high"] = ((high52 - close) / high52 <= 0.25).astype(int)
    for name, period in (("Week", 5), ("Month", 22)):
        features[f"{name}_Price_Range"] = (high.rolling(period).max() - low.rolling(period).min()).map(lambda value: round(value, 2))
    for name, period in (("1D", 1), ("1W", 5), ("1M", 22), ("3M", 66)):
        previous = close.shift(period)
        features[f"Price_Change_{name}"] = ((close - previous) / previous * 100).map(lambda value: round(value, 2))
    delta = close.diff()
    rise = (delta > 0).astype(int).rolling(22).sum()
    fall = (delta < 0).astype(int).rolling(22).sum()
    features["Price_more_rise_than_fall_month"] = (rise > fall).astype(int)
    features = features.replace([np.inf, -np.inf], np.nan).loc[:, FEATURE_COLUMNS]

    future_close = close.shift(-LABEL_HORIZON)
    # Strict >5% threshold: exactly +5% belongs to SELL/other class.
    labels = (future_close > close * (1 + BUY_THRESHOLD)).astype("int8")
    known_label = future_close.notna() & close.notna()
    valid_features = features.notna().all(axis=1)
    mask = known_label & valid_features
    positions = np.flatnonzero(mask.to_numpy())
    x = features.loc[mask].reset_index(drop=True)
    y = labels.loc[mask].reset_index(drop=True)
    latest = features.iloc[-1]
    return x, y, positions, latest


def _chronological_split(positions: np.ndarray, gap_bars: int = GAP_BARS) -> tuple[np.ndarray, np.ndarray]:
    if len(positions) < MIN_TRAIN_SAMPLES + MIN_TEST_SAMPLES + gap_bars:
        raise ModelDataError("insufficient labeled daily history for purged evaluation")
    test_count = max(MIN_TEST_SAMPLES, math.ceil(len(positions) * 0.2))
    test_start_index = len(positions) - test_count
    test_positions = positions[test_start_index:]
    first_test_bar = int(test_positions[0])
    # Purge samples whose forward-label window could touch the held-out period.
    train_indices = np.flatnonzero(positions <= first_test_bar - gap_bars - 1)
    test_indices = np.arange(test_start_index, len(positions))
    if len(train_indices) < MIN_TRAIN_SAMPLES:
        raise ModelDataError("insufficient training samples after 22-bar purge")
    if len(test_indices) < MIN_TEST_SAMPLES:
        raise ModelDataError("insufficient chronological test samples")
    if first_test_bar - int(positions[train_indices[-1]]) - 1 < gap_bars:
        raise ModelDataError("22-bar purge invariant failed")
    if int(positions[train_indices[-1]]) + LABEL_HORIZON >= first_test_bar:
        raise ModelDataError("training labels overlap held-out period")
    return train_indices, test_indices


def train_model(candles: list[dict[str, Any]]) -> tuple[RandomForestClassifier, dict[str, Any]]:
    x, y, positions, latest = prepare_data(candles)
    if not latest.notna().all():
        raise ModelDataError("latest daily candle lacks complete model features")
    train_indices, test_indices = _chronological_split(positions)
    x_train, y_train = x.iloc[train_indices], y.iloc[train_indices]
    x_test, y_test = x.iloc[test_indices], y.iloc[test_indices]
    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=15,
        min_samples_split=10,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
    )
    # Serve the evaluated training-window estimator, as in the reference repo.
    model.fit(x_train, y_train)
    accuracy = float(accuracy_score(y_test, model.predict(x_test)))
    check_is_fitted(model)
    trained_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    metadata = {
        "trainedAt": trained_at,
        "samples": int(len(y)),
        "accuracy": accuracy,
        "trainSamples": int(len(train_indices)),
        "testSamples": int(len(test_indices)),
        "gapBars": GAP_BARS,
        "featureNames": list(FEATURE_COLUMNS),
        "sklearnVersion": sklearn.__version__,
    }
    return model, metadata


def predict(model: RandomForestClassifier, features: pd.Series) -> dict[str, Any]:
    if not features.notna().all():
        raise ModelDataError("latest daily candle lacks complete model features")
    row = features.loc[list(FEATURE_COLUMNS)].to_frame().T
    raw = model.predict_proba(row)[0]
    probabilities = {"BUY": 0.0, "SELL": 0.0}
    for label, probability in zip(model.classes_, raw):
        probabilities["BUY" if int(label) == 1 else "SELL"] = float(probability)
    total = sum(probabilities.values())
    if not math.isfinite(total) or total <= 0:
        raise ModelDataError("model returned invalid probabilities")
    probabilities = {key: value / total for key, value in probabilities.items()}
    signal = "BUY" if probabilities["BUY"] > probabilities["SELL"] else "SELL"
    confidence = max(probabilities.values())
    return {"signal": signal, "confidence": confidence, "probabilities": probabilities}
