#!/usr/bin/env python3
"""
Deterministic, self-contained synthetic equity OHLCV and indicator generator for tslaiq-demo.

Guarantees:
  - Uses ONLY Python standard library (zero external dependencies, zero network calls).
  - Uses ZERO real market data, zero Yahoo Finance inputs, and zero real ticker scaling.
  - Produces byte-for-byte reproducible outputs for fictional ticker `SYNTH-EQ`
    under fixed seed `20261123`.
  - Computes exact RSI(14), EMA20, EMA50, MACD(12,26), MACD_Signal(9), OBV,
    chronological leak-free 80/20 split, and held-out Naive Persistence vs. Lagged EMA20
    benchmark metrics strictly on `SYNTH-EQ`.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
import random
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "synthetic_ohlcv.csv"
DATA_JS_PATH = ROOT / "docs" / "data.js"

SEED = 20261123
TICKER = "SYNTH-EQ"
TRADING_DAYS = 1500
START_DATE = dt.date(2020, 1, 2)
INITIAL_CLOSE = 120.0
LOOKBACK = 60
VAL_RATIO = 0.2


def _generate_weekdays(start: dt.date, count: int) -> List[str]:
    dates: List[str] = []
    cur = start
    while len(dates) < count:
        if cur.weekday() < 5:
            dates.append(cur.isoformat())
        cur += dt.timedelta(days=1)
    return dates


def generate_synthetic_ohlcv(
    seed: int = SEED,
    count: int = TRADING_DAYS,
    start_date: dt.date = START_DATE,
    initial_close: float = INITIAL_CLOSE,
) -> List[Dict[str, object]]:
    """
    Generate a multi-regime synthetic daily OHLCV series using a seeded geometric random
    walk with stochastic volatility clustering and mean-reverting variance.

    Regimes (purely fictional synthetic parameters):
      - Days    0..349 : Steady expansion (mu=+0.00075, base_vol=0.018)
      - Days  350..699 : High-volatility drawdown (mu=-0.00055, base_vol=0.029)
      - Days  700..1099: Rangebound consolidation (mu=+0.00015, base_vol=0.015)
      - Days 1100..1499: Late trend & elevated variance (mu=+0.00060, base_vol=0.023)
    """
    rng = random.Random(seed)
    dates = _generate_weekdays(start_date, count)

    rows: List[Dict[str, object]] = []
    prev_close = float(initial_close)
    vol_state = 0.018

    for idx, iso_date in enumerate(dates):
        if idx < 350:
            mu, base_vol, base_shares = 0.00075, 0.018, 28_000_000
        elif idx < 700:
            mu, base_vol, base_shares = -0.00055, 0.029, 44_000_000
        elif idx < 1100:
            mu, base_vol, base_shares = 0.00015, 0.015, 22_000_000
        else:
            mu, base_vol, base_shares = 0.00060, 0.023, 35_000_000

        # Mean-reverting stochastic volatility
        shock_vol = rng.gauss(0.0, 0.0025)
        vol_state = max(0.007, min(0.055, 0.88 * vol_state + 0.12 * base_vol + shock_vol))

        # Overnight gap -> Open
        gap_ret = rng.gauss(0.0, vol_state * 0.35)
        open_px = max(1.0, prev_close * math.exp(gap_ret))

        # Intraday log-return -> Close
        intra_ret = rng.gauss(mu, vol_state)
        close_px = max(1.0, open_px * math.exp(intra_ret))

        # Intraday wicks strictly respecting High >= max(O, C) and Low <= min(O, C)
        upper_wick = abs(rng.gauss(0.0, vol_state * 0.55))
        lower_wick = abs(rng.gauss(0.0, vol_state * 0.55))
        high_px = max(open_px, close_px) * (1.0 + upper_wick)
        low_px = max(0.5, min(open_px, close_px) * max(0.75, 1.0 - lower_wick))

        # Round consistently and re-assert strict OHLC invariants after rounding
        open_r = round(open_px, 4)
        close_r = round(close_px, 4)
        high_r = round(max(high_px, open_r, close_r), 4)
        low_r = round(min(low_px, open_r, close_r), 4)
        if low_r <= 0.0:
            low_r = round(min(open_r, close_r) * 0.99, 4)

        # Volume scales with absolute return magnitude + log-normal noise
        abs_move = abs((close_r - prev_close) / max(prev_close, 1e-6))
        vol_mult = (1.0 + 18.0 * abs_move) * math.exp(rng.gauss(0.0, 0.28))
        volume = max(100_000, int(round(base_shares * vol_mult)))

        rows.append(
            {
                "Date": iso_date,
                "Open": open_r,
                "High": high_r,
                "Low": low_r,
                "Close": close_r,
                "Volume": volume,
            }
        )
        prev_close = close_r

    return rows


def _ema(values: List[float], span: int, warmup_none: int) -> List[Optional[float]]:
    alpha = 2.0 / (span + 1.0)
    out: List[Optional[float]] = []
    ema_val: Optional[float] = None
    for i, v in enumerate(values):
        ema_val = v if ema_val is None else (alpha * v + (1.0 - alpha) * ema_val)
        out.append(None if i < warmup_none else round(ema_val, 4))
    return out


def compute_indicators(rows: List[Dict[str, object]]) -> List[Dict[str, object]]:
    """Compute RSI(14) Wilder RMA, EMA20, EMA50, MACD(12,26), MACD_Signal(9), and OBV."""
    closes = [float(r["Close"]) for r in rows]
    vols = [int(r["Volume"]) for r in rows]
    n = len(closes)

    # EMA20 & EMA50
    ema20 = _ema(closes, 20, 19)
    ema50 = _ema(closes, 50, 49)

    # MACD(12, 26) & Signal(9)
    ema12_raw: List[float] = []
    ema26_raw: List[float] = []
    a12, a26, a9 = 2.0 / 13.0, 2.0 / 27.0, 2.0 / 10.0
    e12, e26 = closes[0], closes[0]
    for c in closes:
        e12 = a12 * c + (1.0 - a12) * e12
        e26 = a26 * c + (1.0 - a26) * e26
        ema12_raw.append(e12)
        ema26_raw.append(e26)

    macd_raw = [x - y for x, y in zip(ema12_raw, ema26_raw)]
    macd: List[Optional[float]] = [None if i < 25 else round(macd_raw[i], 4) for i in range(n)]

    sig_out: List[Optional[float]] = [None] * n
    s_val: Optional[float] = None
    for i in range(25, n):
        m = macd_raw[i]
        s_val = m if s_val is None else (a9 * m + (1.0 - a9) * s_val)
        if i >= 33:
            sig_out[i] = round(s_val, 4)

    # RSI(14) Wilder RMA (alpha = 1/14)
    rsi: List[Optional[float]] = [None] * n
    avg_gain: Optional[float] = None
    avg_loss: Optional[float] = None
    alpha_r = 1.0 / 14.0
    for i in range(1, n):
        diff = closes[i] - closes[i - 1]
        gain = max(diff, 0.0)
        loss = max(-diff, 0.0)
        if avg_gain is None:
            avg_gain = gain
            avg_loss = loss
        else:
            avg_gain = alpha_r * gain + (1.0 - alpha_r) * avg_gain
            avg_loss = alpha_r * loss + (1.0 - alpha_r) * avg_loss
        if i >= 13:
            if avg_loss == 0.0:
                rsi[i] = 100.0
            else:
                rs = avg_gain / avg_loss
                rsi[i] = round(100.0 - (100.0 / (1.0 + rs)), 4)

    # OBV (Close >= PrevClose adds volume)
    obv: List[int] = []
    cum = 0
    for i in range(n):
        if i == 0 or closes[i] >= closes[i - 1]:
            cum += vols[i]
        else:
            cum -= vols[i]
        obv.append(cum)

    enriched: List[Dict[str, object]] = []
    for i, r in enumerate(rows):
        item = dict(r)
        item["RSI"] = rsi[i]
        item["EMA20"] = ema20[i]
        item["EMA50"] = ema50[i]
        item["MACD"] = macd[i]
        item["MACD_Signal"] = sig_out[i]
        item["OBV"] = obv[i]
        enriched.append(item)
    return enriched


def _regression_metrics(
    y_true: List[float], y_pred: List[float], scale_min: float, scale_max: float
) -> Dict[str, float]:
    span = max(scale_max - scale_min, 1e-9)
    n = len(y_true)
    sq_usd = [(a - b) ** 2 for a, b in zip(y_true, y_pred)]
    abs_usd = [abs(a - b) for a, b in zip(y_true, y_pred)]
    pct = [abs(a - b) / abs(a) for a, b in zip(y_true, y_pred) if a != 0.0]
    sq_scaled = [(((a - scale_min) / span) - ((b - scale_min) / span)) ** 2 for a, b in zip(y_true, y_pred)]
    abs_scaled = [abs(((a - scale_min) / span) - ((b - scale_min) / span)) for a, b in zip(y_true, y_pred)]
    return {
        "scaled_mse": round(sum(sq_scaled) / n, 8),
        "scaled_rmse": round(math.sqrt(sum(sq_scaled) / n), 6),
        "scaled_mae": round(sum(abs_scaled) / n, 6),
        "usd_rmse": round(math.sqrt(sum(sq_usd) / n), 4),
        "usd_mae": round(sum(abs_usd) / n, 4),
        "mape_pct": round((sum(pct) / len(pct)) * 100.0, 4),
    }


def evaluate_synthetic_benchmarks(enriched: List[Dict[str, object]]) -> Tuple[Dict[str, object], Dict[str, object]]:
    complete = [
        r
        for r in enriched
        if r["RSI"] is not None
        and r["EMA20"] is not None
        and r["EMA50"] is not None
        and r["MACD"] is not None
    ]
    total_complete = len(complete)
    total_sequences = total_complete - LOOKBACK
    val_count = int(total_sequences * VAL_RATIO)
    train_count = total_sequences - val_count

    # Strict train-only scaling bounds (zero look-ahead)
    train_rows = complete[: train_count + LOOKBACK]
    train_closes = [float(r["Close"]) for r in train_rows]
    t_min, t_max = min(train_closes), max(train_closes)

    val_dates: List[str] = []
    y_true: List[float] = []
    y_persist: List[float] = []
    y_ema20: List[float] = []

    for seq_idx in range(train_count, total_sequences):
        target_idx = seq_idx + LOOKBACK
        val_dates.append(str(complete[target_idx]["Date"]))
        y_true.append(float(complete[target_idx]["Close"]))
        y_persist.append(float(complete[target_idx - 1]["Close"]))
        y_ema20.append(float(complete[target_idx - 1]["EMA20"]))

    persist_m = _regression_metrics(y_true, y_persist, t_min, t_max)
    ema20_m = _regression_metrics(y_true, y_ema20, t_min, t_max)

    # 20-day rolling USD RMSE on held-out validation split for interactive Canvas chart
    window = 20
    rolling_dates: List[str] = []
    rolling_persist_rmse: List[float] = []
    rolling_ema20_rmse: List[float] = []
    for i in range(window - 1, len(y_true)):
        w_true = y_true[i - window + 1 : i + 1]
        w_p = y_persist[i - window + 1 : i + 1]
        w_e = y_ema20[i - window + 1 : i + 1]
        p_rmse = math.sqrt(sum((a - b) ** 2 for a, b in zip(w_true, w_p)) / window)
        e_rmse = math.sqrt(sum((a - b) ** 2 for a, b in zip(w_true, w_e)) / window)
        rolling_dates.append(val_dates[i])
        rolling_persist_rmse.append(round(p_rmse, 4))
        rolling_ema20_rmse.append(round(e_rmse, 4))

    baseline = {
        "lookback": LOOKBACK,
        "val_ratio": VAL_RATIO,
        "total_complete_rows": total_complete,
        "total_sequences": total_sequences,
        "leak_free_protocol": {
            "train_sequences": train_count,
            "val_sequences": val_count,
            "train_fit_range": [str(complete[0]["Date"]), str(complete[train_count + LOOKBACK - 1]["Date"])],
            "val_date_range": [val_dates[0], val_dates[-1]],
            "train_close_min": round(t_min, 4),
            "train_close_max": round(t_max, 4),
            **persist_m,
        },
        "ema20_lagged_reference": {
            "note": "Deterministic lagged EMA20 reference (y_hat[t] = EMA20[t-1]) evaluated on the exact same SYNTH-EQ held-out validation split.",
            **ema20_m,
        },
    }

    rolling_series = {
        "window_days": window,
        "dates": rolling_dates,
        "series": [
            {
                "id": "persistence",
                "label": "Naive Persistence (y[t-1])",
                "overall_usd_rmse": persist_m["usd_rmse"],
                "overall_scaled_mse": persist_m["scaled_mse"],
                "rolling_rmse": rolling_persist_rmse,
            },
            {
                "id": "ema20_lag",
                "label": "Lagged EMA20 Reference",
                "overall_usd_rmse": ema20_m["usd_rmse"],
                "overall_scaled_mse": ema20_m["scaled_mse"],
                "rolling_rmse": rolling_ema20_rmse,
            },
        ],
    }

    return baseline, rolling_series


def build_payload(enriched: List[Dict[str, object]]) -> Dict[str, object]:
    baseline, rolling_benchmarks = evaluate_synthetic_benchmarks(enriched)

    # Annual summaries
    by_year: Dict[str, List[Dict[str, object]]] = {}
    for r in enriched:
        yr = str(r["Date"])[:4]
        by_year.setdefault(yr, []).append(r)

    yearly: List[Dict[str, object]] = []
    for yr in sorted(by_year):
        yr_rows = by_year[yr]
        first_c = float(yr_rows[0]["Close"])
        last_c = float(yr_rows[-1]["Close"])
        low_c = min(float(x["Close"]) for x in yr_rows)
        high_c = max(float(x["Close"]) for x in yr_rows)
        avg_v = int(round(sum(int(x["Volume"]) for x in yr_rows) / len(yr_rows)))
        ret_pct = round(((last_c - first_c) / first_c) * 100.0, 2)
        yearly.append(
            {
                "year": yr,
                "days": len(yr_rows),
                "open_close": round(first_c, 2),
                "end_close": round(last_c, 2),
                "low_close": round(low_c, 2),
                "high_close": round(high_c, 2),
                "avg_volume": avg_v,
                "return_pct": ret_pct,
            }
        )

    ath_close_row = max(enriched, key=lambda x: float(x["Close"]))
    ath_high_row = max(enriched, key=lambda x: float(x["High"]))
    atl_close_row = min(enriched, key=lambda x: float(x["Close"]))
    peak_vol_row = max(enriched, key=lambda x: int(x["Volume"]))
    last = enriched[-1]
    prev = enriched[-2]
    daily_chg = round(((float(last["Close"]) - float(prev["Close"])) / float(prev["Close"])) * 100.0, 2)

    warmup_missing = {
        col: sum(1 for r in enriched if r[col] is None)
        for col in ("Close", "High", "Low", "Open", "Volume", "RSI", "EMA20", "EMA50", "MACD", "MACD_Signal", "OBV")
    }

    meta = {
        "ticker": TICKER,
        "is_synthetic": True,
        "seed": SEED,
        "generator": "scripts/generate_synthetic_data.py (stdlib geometric random walk + stochastic volatility)",
        "source": "100% synthetic daily equity series (SYNTH-EQ) — zero Yahoo Finance or real market data",
        "start_date": str(enriched[0]["Date"]),
        "end_date": str(last["Date"]),
        "trading_days": len(enriched),
        "complete_feature_rows": baseline["total_complete_rows"],
        "warmup_missing": warmup_missing,
        "post_warmup_nans": 0,
        "duplicate_dates": 0,
        "latest": {
            "date": str(last["Date"]),
            "open": last["Open"],
            "high": last["High"],
            "low": last["Low"],
            "close": last["Close"],
            "prev_close": prev["Close"],
            "daily_change_pct": daily_chg,
            "volume": last["Volume"],
            "rsi": last["RSI"],
            "ema20": last["EMA20"],
            "ema50": last["EMA50"],
            "macd": last["MACD"],
            "macd_signal": last["MACD_Signal"],
            "obv": last["OBV"],
        },
        "extremes": {
            "all_time_high_close": round(float(ath_close_row["Close"]), 2),
            "all_time_high_close_date": str(ath_close_row["Date"]),
            "all_time_high_intraday": round(float(ath_high_row["High"]), 2),
            "all_time_high_intraday_date": str(ath_high_row["Date"]),
            "all_time_low_close": round(float(atl_close_row["Close"]), 2),
            "all_time_low_close_date": str(atl_close_row["Date"]),
            "peak_volume": int(peak_vol_row["Volume"]),
            "peak_volume_date": str(peak_vol_row["Date"]),
        },
    }

    series = [
        [
            r["Date"],
            r["Open"],
            r["High"],
            r["Low"],
            r["Close"],
            r["Volume"],
            r["RSI"],
            r["EMA20"],
            r["EMA50"],
            r["MACD"],
            r["MACD_Signal"],
            r["OBV"],
        ]
        for r in enriched
    ]

    return {
        "meta": meta,
        "baseline": baseline,
        "synthetic_benchmarks": rolling_benchmarks,
        "historical_research_summary": {
            "source_status": "Private engineering repository (erturkeryavuz/TSLAIQ)",
            "separation_notice": "Archival research conclusions from prior local experiments on real historical equity data — NOT computed on SYNTH-EQ.",
            "key_findings": [
                "Four historical Keras LSTM / Attention-LSTM training runs were logged locally during original academic development.",
                "None of the historically logged LSTM checkpoints outperformed the trivial naive persistence baseline (y[t] = y[t-1]) on held-out validation.",
                "Phase A hardening in the private engineering codebase replaced full-dataset MinMaxScaler with leak-free TrainOnlyMinMaxScaler, replaced anonymous Lambda layers with serializable custom Keras layers, and blocked unsafe .keras archive loading via static ZIP/JSON inspection.",
                "Fresh TensorFlow/Keras retraining under the leak-free protocol remains UNRUN locally; no trained synthetic model or real market dataset is bundled in this public demo.",
            ],
        },
        "yearly": yearly,
        "columns": ["Date", "Open", "High", "Low", "Close", "Volume", "RSI", "EMA20", "EMA50", "MACD", "MACD_Signal", "OBV"],
        "series": series,
    }


def write_outputs(enriched: List[Dict[str, object]], payload: Dict[str, object]) -> None:
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_JS_PATH.parent.mkdir(parents=True, exist_ok=True)

    cols = ["Date", "Open", "High", "Low", "Close", "Volume", "RSI", "EMA20", "EMA50", "MACD", "MACD_Signal", "OBV"]
    with CSV_PATH.open("w", encoding="utf-8", newline="\n") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(cols)
        for r in enriched:
            writer.writerow(["" if r[c] is None else r[c] for c in cols])

    header = (
        "/* Auto-generated deterministically by scripts/generate_synthetic_data.py "
        f"(seed={SEED}, ticker={TICKER}). 100% synthetic — zero real market data. */\n"
    )
    js_body = header + "window.TSLAIQ_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n"
    with DATA_JS_PATH.open("w", encoding="utf-8", newline="\n") as f:
        f.write(js_body)


def main() -> None:
    raw = generate_synthetic_ohlcv()
    enriched = compute_indicators(raw)
    payload = build_payload(enriched)
    write_outputs(enriched, payload)
    print(
        f"Generated {len(enriched)} synthetic rows ({TICKER}, seed={SEED}): "
        f"{payload['meta']['start_date']} -> {payload['meta']['end_date']} | "
        f"latest_close={payload['meta']['latest']['close']} | "
        f"naive_rmse={payload['baseline']['leak_free_protocol']['usd_rmse']} | "
        f"ema20_rmse={payload['baseline']['ema20_lagged_reference']['usd_rmse']}"
    )


if __name__ == "__main__":
    main()
