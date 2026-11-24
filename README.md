# TSLAIQ

[![TSLAIQ — Equity Time-Series Analytics and Forecasting Research](media/tslaiq-readme-hero.png)](https://erturkeryavuz.github.io/tslaiq-demo/)

**TSLAIQ** is a quantitative equity time-series analytics and forecasting research project built with Python and Keras. It combines technical indicator computation, leak-free chronological validation, persistence benchmarking, and Attention-LSTM sequence modeling to evaluate whether recurrent neural networks improve next-step equity price forecasting over simple baselines.

This public repository provides an interactive browser preview running offline on a self-contained synthetic daily equity series (`SYNTH-EQ`), allowing visitors to explore the charts, indicators, validation baselines, threshold rule sandbox, and architecture without running Python or redistributing third-party market data.

**Live Interactive Demo:** [https://erturkeryavuz.github.io/tslaiq-demo/](https://erturkeryavuz.github.io/tslaiq-demo/)

## Core Capabilities

- **Interactive Price & Volume Analysis:** Inspect 1,500 daily OHLCV sessions (`2020-01-02` to `2025-10-01`) with `3M`–`ALL` range presets, `EMA20`/`EMA50` moving-average overlays, chronological validation-split markers, pointer crosshairs, keyboard scrubbing, and annual summary metrics.
- **Synchronized Technical Indicators:** Compute and align `RSI(14)` (Wilder smoothing), `EMA20`, `EMA50`, `MACD(12,26)`, `Signal(9)`, and cumulative `OBV` across synchronized time axes with documented warm-up windows.
- **Leak-Free Validation Baselines:** Evaluate next-step forecasting on a chronological `80/20` train/validation split (1,113 training sequences, 278 held-out validation sequences) with train-only scaling, comparing **Naive Persistence** (`$5.83` USD RMSE, `0.003497` scaled MSE) against a **Lagged EMA20** reference (`$14.65` USD RMSE, `0.022101` scaled MSE) on `SYNTH-EQ`.
- **Illustrative Threshold Rule Sandbox:** Explore how deterministic `±%` decision rules (`AL` / `SAT` / `BEKLE`) respond to user-controlled hypothetical 7-day price paths, illustrating multi-step threshold behavior without running live model inference.
- **System Architecture & Modeling Pipeline:** Review the preprocessing pipeline (`TrainOnlyMinMaxScaler`), 60-step 6-feature Attention-LSTM architecture, and model-serialization safety design implemented in the private Python/Keras codebase.

## Technology Stack

- **Original Research Codebase (Private Repository):** Python, TensorFlow/Keras (LSTM and Attention-LSTM sequence modeling), NumPy/Pandas, and custom leak-free preprocessing utilities.
- **Synthetic Data Generator (`scripts/`):** Zero-dependency Python standard library (`random.Random(20261123)` multi-regime geometric random walk with mean-reverting stochastic volatility).
- **Public Browser Preview (`docs/`):** Vanilla HTML5, CSS3, ES6+ JavaScript, and High-DPI HTML5 Canvas charts with local system typography and zero external runtime network dependencies.

## Architecture & Methodology

To address common pitfalls in financial time-series machine learning, the private Python/Keras engineering codebase applies four methodological and security practices:

- **Leak-Free Chronological Splitting:** Splits sequences chronologically before scaling (`TrainOnlyMinMaxScaler` fitted strictly on training dates, with zero validation look-ahead).
- **Exact Indicator Conventions:** Computes `RSI(14)`, `EMA20`, `EMA50`, `MACD(12,26,9)`, and `OBV` deterministically with explicit post-warmup completeness (`1,451` complete rows, `0` post-warmup `NaN`s on `SYNTH-EQ`).
- **Naive Baseline Discipline:** Benchmarks forecasting models directly against the next-day persistence baseline (`y[t] = y[t-1]`) to verify whether sequence models add genuine predictive skill.
- **Safe Model Serialization:** Replaces anonymous Keras `Lambda` layers with explicit serializable custom attention layers and inspects `.keras` ZIP/JSON archives statically before loading.

## Historical Model Evaluation Summary

In the separate private TSLAIQ research repository (conducted on real historical equity data, not `SYNTH-EQ`), four Keras LSTM and Attention-LSTM training runs were logged:

- **Primary Finding:** None of the historically logged LSTM or Attention-LSTM checkpoints outperformed the trivial naive persistence baseline (`y[t] = y[t-1]`) on held-out validation.
- **Retraining Status:** Fresh TensorFlow/Keras retraining under the updated leak-free split and serializable custom attention architecture remains unrun locally.
- **Public Preview Boundary:** No neural network has been trained on `SYNTH-EQ`, and no live model training or inference executes in the browser preview.

## Exploring the Preview

Open the [live demo](https://erturkeryavuz.github.io/tslaiq-demo/) to explore all five workspace tabs manually—**Overview**, **Technical Indicators**, **Benchmarks & Research**, **Signal Sandbox**, and **Technical Inspector**—or select **Watch Tutorial** in the top bar for a guided 9-stage walkthrough supporting Play/Pause, Previous/Next, Restart, Replay, keyboard navigation, and reduced-motion preferences.

## Data Provenance, Limitations & Source Availability

- **Synthetic Browser Dataset (`SYNTH-EQ`):** Every price, volume, indicator, and RMSE chart on the live site is computed exclusively on the fictional `SYNTH-EQ` dataset generated by `scripts/generate_synthetic_data.py` (1,500 weekday sessions, `2020-01-02` to `2025-10-01`, seed `20261123`). Zero Yahoo Finance (`yfinance`) rows and zero real Tesla market observations are included.
- **Private Source Repository:** The original Python/Keras source code, historical market datasets, training logs, and model archives remain private. This public repository contains only the synthetic data generator, generated CSV (`data/synthetic_ohlcv.csv`), static browser preview (`docs/`), cover artwork (`media/`), notices, and offline tests.
- **Financial & Research Disclaimer:** Not affiliated with Tesla, Inc. or Yahoo Finance. Displayed prices and scenarios are synthetic and illustrative—not live market data, executable trading signals, or financial advice.

## Testing & Reproducibility

- **8/8** offline reproducibility, OHLCV-invariant, zero-real-data, safety, and JavaScript syntax checks (`tests/verify_demo.py`).
- **7/7** tutorial lifecycle, responsive positioning, adaptive viewport chart-fitting, and visibility regression tests (`tests/test_tutorial.py`).

```bash
# Regenerate data/synthetic_ohlcv.csv and docs/data.js byte-for-byte
python3 -B scripts/generate_synthetic_data.py

# Run offline reproducibility, data-invariant, safety, and syntax checks
python3 -B tests/verify_demo.py

# Run tutorial lifecycle and responsive chart-fitting regression tests
python3 -B -m unittest discover -s tests -v

# Serve the static preview locally
python3 -m http.server 8080 --directory docs
# Open http://127.0.0.1:8080/
```

## Attribution & Licensing

- All cover artwork (`media/tslaiq-readme-hero.png`, `media/tslaiq-social-preview.png`) and editable SVG sources (`media/src/`) are original vector graphics authored for this repository using grounded `SYNTH-EQ` metrics, with no third-party logos, photographs, or real market charts.
- Full provenance and notices:
  - [docs/THIRD-PARTY-NOTICES.md](docs/THIRD-PARTY-NOTICES.md)
  - [https://erturkeryavuz.github.io/tslaiq-demo/notices.html](https://erturkeryavuz.github.io/tslaiq-demo/notices.html)
