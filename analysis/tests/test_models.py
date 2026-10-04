import math
import unittest
from datetime import date, timedelta

import numpy as np

from analysis.models import GAP_BARS, LABEL_HORIZON, ModelDataError, _chronological_split, prepare_data, predict, train_model


def candles(closes):
    result = []
    for index, close in enumerate(closes):
        result.append({
            "time": (date(2020, 1, 1) + timedelta(days=index)).isoformat(),
            "open": close,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "volume": 100_000 + index * 10,
        })
    return result


class ModelTests(unittest.TestCase):
    def test_labels_use_exactly_22_future_bars_and_drop_unknown_tail(self):
        bars = candles([100.0] * 260)
        target = 210 + LABEL_HORIZON
        bars[target]["close"] = 105.0  # exactly +5% is not BUY
        bars[target]["high"] = 106.0
        x, y, positions, _ = prepare_data(bars)
        sample = int(np.flatnonzero(positions == 210)[0])
        self.assertEqual(int(y.iloc[sample]), 0)
        self.assertEqual(int(positions[-1]), len(bars) - LABEL_HORIZON - 1)
        self.assertFalse(np.any(positions + LABEL_HORIZON >= len(bars)))

    def test_future_change_cannot_change_features_but_does_change_label(self):
        original = candles([100.0] * 260)
        changed = [dict(bar) for bar in original]
        target = 210 + LABEL_HORIZON
        changed[target]["close"] = 120.0
        changed[target]["high"] = 121.0
        x1, y1, positions1, _ = prepare_data(original)
        x2, y2, positions2, _ = prepare_data(changed)
        row1 = int(np.flatnonzero(positions1 == 210)[0])
        row2 = int(np.flatnonzero(positions2 == 210)[0])
        np.testing.assert_array_equal(x1.iloc[row1].to_numpy(), x2.iloc[row2].to_numpy())
        self.assertEqual(int(y1.iloc[row1]), 0)
        self.assertEqual(int(y2.iloc[row2]), 1)

    def test_chronological_split_purges_full_22_raw_bars(self):
        closes = [100 + index * 0.025 + 5 * math.sin(index / 8) + 3 * math.sin(index / 3) for index in range(600)]
        x, y, positions, latest = prepare_data(candles(closes))
        train, test = _chronological_split(positions)
        first_test_bar = int(positions[test[0]])
        last_train_bar = int(positions[train[-1]])
        self.assertGreaterEqual(first_test_bar - last_train_bar - 1, GAP_BARS)
        self.assertLess(last_train_bar + LABEL_HORIZON, first_test_bar)
        self.assertEqual(int(positions[test[0]]), first_test_bar)
        self.assertTrue(latest.notna().all())
        self.assertEqual(set(y.unique()), {0, 1})

    def test_random_forest_holdout_and_prediction_metadata(self):
        closes = [100 + index * 0.025 + 5 * math.sin(index / 8) + 3 * math.sin(index / 3) for index in range(600)]
        bars = candles(closes)
        model, metadata = train_model(bars)
        _, _, _, latest = prepare_data(bars)
        result = predict(model, latest)
        self.assertEqual(model.max_depth, 15)
        self.assertEqual(model.min_samples_split, 10)
        self.assertEqual(model.class_weight, "balanced")
        self.assertEqual(model.n_features_in_, 16)
        x, y, positions, _ = prepare_data(bars)
        train, test = _chronological_split(positions)
        from sklearn.ensemble import RandomForestClassifier
        reference = RandomForestClassifier(n_estimators=200, max_depth=15,
            min_samples_split=10, min_samples_leaf=5, random_state=42, class_weight="balanced")
        reference.fit(x.iloc[train], y.iloc[train])
        np.testing.assert_array_equal(model.predict_proba(x), reference.predict_proba(x))
        self.assertEqual(metadata["gapBars"], 22)
        self.assertGreaterEqual(metadata["trainSamples"], 100)
        self.assertGreaterEqual(metadata["testSamples"], 20)
        self.assertIn(result["signal"], ("BUY", "SELL"))
        self.assertAlmostEqual(sum(result["probabilities"].values()), 1.0)
        self.assertTrue(0 <= result["confidence"] <= 1)

    def test_reference_features_and_single_class_history(self):
        bars = candles([100.0 + index for index in range(600)])
        x, _, positions, latest = prepare_data(bars)
        self.assertEqual(int(positions[0]), 66)
        self.assertEqual(latest["Week_Price_Range"], 6)
        self.assertEqual(latest["Month_Price_Range"], 23)
        self.assertEqual(latest["Price_Change_3M"], round(66 / 633 * 100, 2))
        self.assertTrue((latest.iloc[:9] == 1).all())
        flat = candles([100.0] * 260)
        model, _ = train_model(flat)
        result = predict(model, prepare_data(flat)[3])
        self.assertEqual(result["probabilities"], {"BUY": 0.0, "SELL": 1.0})

    def test_insufficient_history_is_explicit(self):
        with self.assertRaises(ModelDataError):
            train_model(candles([100.0] * 100))


if __name__ == "__main__":
    unittest.main()
