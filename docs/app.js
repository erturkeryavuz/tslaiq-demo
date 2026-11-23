(function () {
  "use strict";

  const DATA = window.TSLAIQ_DATA;
  if (!DATA || !Array.isArray(DATA.series)) {
    return;
  }

  // Column indices matching DATA.columns:
  // [0:Date, 1:Open, 2:High, 3:Low, 4:Close, 5:Volume, 6:RSI, 7:EMA20, 8:EMA50, 9:MACD, 10:MACD_Signal, 11:OBV]
  const COL = {
    DATE: 0,
    OPEN: 1,
    HIGH: 2,
    LOW: 3,
    CLOSE: 4,
    VOL: 5,
    RSI: 6,
    EMA20: 7,
    EMA50: 8,
    MACD: 9,
    SIG: 10,
    OBV: 11,
  };

  const RUN_COLORS = ["#38BDF8", "#FF4D6A", "#A78BFA", "#F59E0B"];

  const state = {
    activeTab: "overview",
    overviewRange: "1Y",
    overviewHoverIdx: null,
    showEma20: true,
    showEma50: true,
    showSplit: true,
    indRange: "1Y",
    indHoverIdx: null,
    activeBenchmarks: { persistence: true, ema20_lag: true },
    benchHoverIdx: null,
    sandboxRefIdx: DATA.series.length - 1,
    sandboxThreshold: 5.0,
    sandboxDrift: 2.5,
    sandboxSwing: 2.0,
  };

  // ---------- Formatters ----------
  function fmtUsd(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtNum(v, dec) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function fmtCompact(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + "K";
    return sign + String(Math.round(abs));
  }

  function getRangeSlice(rangeCode) {
    const all = DATA.series;
    const total = all.length;
    const counts = { "3M": 63, "1Y": 252, "3Y": 756, "5Y": 1260, ALL: total };
    const n = counts[rangeCode] || total;
    const start = Math.max(0, total - n);
    return { rows: all.slice(start), offset: start };
  }

  // ---------- High-DPI Canvas Helper ----------
  function setupCanvas(canvas) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(260, Math.floor(rect.width));
    const height = Math.max(140, Math.floor(rect.height));
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  function drawGrid(ctx, pad, plotW, plotH, minY, maxY, ySteps, formatLabel) {
    ctx.strokeStyle = "rgba(34, 48, 73, 0.72)";
    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = "#8ca0bf";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= ySteps; i++) {
      const frac = i / ySteps;
      const y = pad.top + frac * plotH;
      const val = maxY - frac * (maxY - minY);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillText(formatLabel(val), pad.left - 8, y);
    }
  }

  function drawDateTicks(ctx, rows, pad, plotW, height) {
    if (!rows.length) return;
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = "#8ca0bf";
    ctx.textBaseline = "top";
    const tickCount = plotW < 380 ? 3 : plotW < 560 ? 4 : 6;
    for (let i = 0; i < tickCount; i++) {
      const frac = tickCount === 1 ? 0 : i / (tickCount - 1);
      const idx = Math.min(rows.length - 1, Math.round(frac * (rows.length - 1)));
      const x = pad.left + frac * plotW;
      ctx.textAlign = i === 0 ? "left" : i === tickCount - 1 ? "right" : "center";
      ctx.fillText(rows[idx][COL.DATE], x, height - pad.bottom + 8);
    }
  }

  function drawLineSeries(ctx, rows, colIdx, xForIdx, yForVal, color, lineWidth) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][colIdx];
      if (v === null || v === undefined) {
        started = false;
        continue;
      }
      const x = xForIdx(i);
      const y = yForVal(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  // ---------- Populate Static KPIs & Tables ----------
  function hydrateMetadata() {
    const m = DATA.meta;
    const latest = m.latest;
    const ext = m.extremes;
    const lf = DATA.baseline.leak_free_protocol;

    document.getElementById("banner-end-date").textContent = m.end_date;
    document.getElementById("banner-last-close").textContent = fmtUsd(latest.close);
    document.getElementById("banner-count").textContent = m.trading_days.toLocaleString("en-US");

    document.getElementById("kpi-close").textContent = fmtUsd(latest.close);
    const chgSign = latest.daily_change_pct >= 0 ? "+" : "";
    document.getElementById("kpi-close-sub").textContent =
      `${latest.date} (${chgSign}${latest.daily_change_pct.toFixed(2)}% vs prior day)`;
    document.getElementById("kpi-ath").textContent = fmtUsd(ext.all_time_high_close);
    document.getElementById("kpi-ath-sub").textContent = `${ext.all_time_high_close_date} (SYNTH-EQ synthetic)`;
    document.getElementById("kpi-days").textContent = m.trading_days.toLocaleString("en-US");
    document.getElementById("kpi-span-sub").textContent = `${m.start_date} → ${m.end_date}`;
    document.getElementById("kpi-baseline-rmse").textContent = fmtUsd(lf.usd_rmse);
    document.getElementById("kpi-baseline-sub").textContent =
      `SYNTH-EQ leak-free val (${lf.val_sequences} days)`;
    document.getElementById("kpi-rsi").textContent = fmtNum(latest.rsi, 2);
    document.getElementById("kpi-rsi-sub").textContent = `SYNTH-EQ ${latest.date} (14d Wilder)`;

    // Indicator summary table
    document.getElementById("ind-tbl-rsi").textContent = fmtNum(latest.rsi, 4);
    document.getElementById("ind-tbl-ema20").textContent = fmtUsd(latest.ema20);
    document.getElementById("ind-tbl-ema50").textContent = fmtUsd(latest.ema50);
    document.getElementById("ind-tbl-macd").textContent = fmtNum(latest.macd, 4);
    document.getElementById("ind-tbl-sig").textContent = fmtNum(latest.macd_signal, 4);
    document.getElementById("ind-tbl-obv").textContent = Number(latest.obv).toLocaleString("en-US");

    // Yearly summary table (newest first)
    const yBody = document.getElementById("yearly-table-body");
    yBody.innerHTML = "";
    DATA.yearly
      .slice()
      .reverse()
      .forEach(function (yr) {
        const tr = document.createElement("tr");
        const cls = yr.return_pct >= 0 ? "pos" : "neg";
        const sign = yr.return_pct >= 0 ? "+" : "";
        tr.innerHTML =
          `<td class="mono">${yr.year}</td>` +
          `<td class="num mono">${yr.days}</td>` +
          `<td class="num mono">${fmtUsd(yr.open_close)}</td>` +
          `<td class="num mono">${fmtUsd(yr.end_close)}</td>` +
          `<td class="num mono">${fmtUsd(yr.low_close)} / ${fmtUsd(yr.high_close)}</td>` +
          `<td class="num mono ${cls}">${sign}${yr.return_pct.toFixed(1)}%</td>`;
        yBody.appendChild(tr);
      });

    // Synthetic benchmark toggles (Panel 3)
    const runToggles = document.getElementById("run-toggles");
    if (runToggles && DATA.synthetic_benchmarks && DATA.synthetic_benchmarks.series) {
      runToggles.innerHTML = "";
      DATA.synthetic_benchmarks.series.forEach(function (ser, idx) {
        const lbl = document.createElement("label");
        lbl.className = "toggle-chip";
        const color = idx === 0 ? "#10B981" : "#38BDF8";
        lbl.innerHTML =
          `<input type="checkbox" data-bench-id="${ser.id}" checked />` +
          `<span class="swatch" style="background:${color}"></span>` +
          `${ser.label} ($${ser.overall_usd_rmse.toFixed(2)} RMSE)`;
        lbl.querySelector("input").addEventListener("change", function (ev) {
          state.activeBenchmarks[ser.id] = ev.target.checked;
          renderTrainingChart();
        });
        runToggles.appendChild(lbl);
      });
    }

    // Historical research summary list (explicitly separated archival prose)
    const histList = document.getElementById("historical-summary-list");
    if (histList && DATA.historical_research_summary && DATA.historical_research_summary.key_findings) {
      histList.innerHTML = "";
      DATA.historical_research_summary.key_findings.forEach(function (txt) {
        const li = document.createElement("li");
        li.textContent = txt;
        histList.appendChild(li);
      });
    }

    // Sandbox date selector (last 60 historical days)
    const sbSelect = document.getElementById("sb-date");
    sbSelect.innerHTML = "";
    const startIdx = Math.max(0, DATA.series.length - 60);
    for (let i = DATA.series.length - 1; i >= startIdx; i--) {
      const row = DATA.series[i];
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `${row[COL.DATE]} — Close ${fmtUsd(row[COL.CLOSE])}`;
      sbSelect.appendChild(opt);
    }
  }

  // ---------- Overview Chart ----------
  function updateOverviewReadout(row) {
    if (!row) return;
    document.getElementById("ro-date").textContent = row[COL.DATE];
    document.getElementById("ro-open").textContent = fmtUsd(row[COL.OPEN]);
    document.getElementById("ro-high").textContent = fmtUsd(row[COL.HIGH]);
    document.getElementById("ro-low").textContent = fmtUsd(row[COL.LOW]);
    document.getElementById("ro-close").textContent = fmtUsd(row[COL.CLOSE]);
    document.getElementById("ro-vol").textContent = fmtCompact(row[COL.VOL]);
    document.getElementById("ro-ema20").textContent = fmtUsd(row[COL.EMA20]);
    document.getElementById("ro-ema50").textContent = fmtUsd(row[COL.EMA50]);
    document.getElementById("overview-scrubber-label").textContent = row[COL.DATE];
  }

  function renderOverviewChart() {
    const canvas = document.getElementById("chart-overview");
    if (!canvas || document.getElementById("panel-overview").hidden) return;

    const { rows } = getRangeSlice(state.overviewRange);
    const scrubber = document.getElementById("overview-scrubber");
    scrubber.max = String(Math.max(0, rows.length - 1));
    const activeIdx =
      state.overviewHoverIdx !== null
        ? Math.min(rows.length - 1, Math.max(0, state.overviewHoverIdx))
        : rows.length - 1;
    scrubber.value = String(activeIdx);
    updateOverviewReadout(rows[activeIdx]);

    const { ctx, width, height } = setupCanvas(canvas);
    const pad = { top: 18, right: 18, bottom: 28, left: 64 };
    const plotW = width - pad.left - pad.right;
    const totalH = height - pad.top - pad.bottom;
    const priceH = Math.floor(totalH * 0.74);
    const volTop = pad.top + priceH + 14;
    const volH = totalH - priceH - 14;

    let minP = Infinity;
    let maxP = -Infinity;
    let maxV = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r[COL.CLOSE] < minP) minP = r[COL.CLOSE];
      if (r[COL.CLOSE] > maxP) maxP = r[COL.CLOSE];
      if (state.showEma20 && r[COL.EMA20] !== null) {
        if (r[COL.EMA20] < minP) minP = r[COL.EMA20];
        if (r[COL.EMA20] > maxP) maxP = r[COL.EMA20];
      }
      if (state.showEma50 && r[COL.EMA50] !== null) {
        if (r[COL.EMA50] < minP) minP = r[COL.EMA50];
        if (r[COL.EMA50] > maxP) maxP = r[COL.EMA50];
      }
      if (r[COL.VOL] > maxV) maxV = r[COL.VOL];
    }
    const spanP = Math.max(1e-6, maxP - minP);
    minP = Math.max(0, minP - spanP * 0.06);
    maxP = maxP + spanP * 0.06;

    const xFor = (i) => pad.left + (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * plotW);
    const yForP = (v) => pad.top + ((maxP - v) / (maxP - minP)) * priceH;

    drawGrid(ctx, pad, plotW, priceH, minP, maxP, 4, (v) => "$" + v.toFixed(v < 10 ? 2 : 0));
    drawDateTicks(ctx, rows, pad, plotW, height);

    // Validation split marker (2022-07-12 leak-free / 2022-07-11 historical)
    if (state.showSplit) {
      const splitDate = DATA.baseline.leak_free_protocol.val_date_range[0];
      const splitIdx = rows.findIndex((r) => r[COL.DATE] >= splitDate);
      if (splitIdx > 0 && splitIdx < rows.length) {
        const sx = xFor(splitIdx);
        ctx.fillStyle = "rgba(245, 158, 11, 0.06)";
        ctx.fillRect(sx, pad.top, pad.left + plotW - sx, priceH);
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "rgba(245, 158, 11, 0.85)";
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(sx, pad.top);
        ctx.lineTo(sx, pad.top + priceH);
        ctx.stroke();
        ctx.restore();
        ctx.font = '10.5px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillStyle = "#fcd34d";
        ctx.textAlign = sx > pad.left + plotW - 140 ? "right" : "left";
        ctx.fillText("VAL SPLIT (" + splitDate + ")", sx + (sx > pad.left + plotW - 140 ? -6 : 6), pad.top + 12);
      }
    }

    // Volume bars
    const barW = Math.max(1, Math.min(4, plotW / Math.max(1, rows.length) * 0.72));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const x = xFor(i);
      const bh = maxV > 0 ? (r[COL.VOL] / maxV) * volH : 0;
      const isUp = r[COL.CLOSE] >= r[COL.OPEN];
      ctx.fillStyle = isUp ? "rgba(16, 185, 129, 0.42)" : "rgba(255, 77, 106, 0.42)";
      ctx.fillRect(x - barW / 2, volTop + volH - bh, barW, bh);
    }
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = "#8ca0bf";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("VOL MAX " + fmtCompact(maxV), pad.left + 6, volTop - 2);

    // Subtle area fill under Close price
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + priceH);
    grad.addColorStop(0, "rgba(255, 77, 106, 0.22)");
    grad.addColorStop(1, "rgba(255, 77, 106, 0.0)");
    ctx.beginPath();
    ctx.moveTo(xFor(0), pad.top + priceH);
    for (let i = 0; i < rows.length; i++) {
      ctx.lineTo(xFor(i), yForP(rows[i][COL.CLOSE]));
    }
    ctx.lineTo(xFor(rows.length - 1), pad.top + priceH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Price & EMA lines
    if (state.showEma50) drawLineSeries(ctx, rows, COL.EMA50, xFor, yForP, "#A78BFA", 1.35);
    if (state.showEma20) drawLineSeries(ctx, rows, COL.EMA20, xFor, yForP, "#38BDF8", 1.35);
    drawLineSeries(ctx, rows, COL.CLOSE, xFor, yForP, "#F8FAFC", 1.85);

    // Crosshair for active/hovered index
    const hx = xFor(activeIdx);
    const hy = yForP(rows[activeIdx][COL.CLOSE]);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, pad.top);
    ctx.lineTo(hx, height - pad.bottom);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(hx, hy, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = "#FF4D6A";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ---------- Technical Indicator Charts ----------
  function updateIndicatorReadout(row) {
    if (!row) return;
    document.getElementById("iro-date").textContent = row[COL.DATE];
    document.getElementById("iro-close").textContent = fmtUsd(row[COL.CLOSE]);
    document.getElementById("iro-rsi").textContent = fmtNum(row[COL.RSI], 2);
    document.getElementById("iro-macd").textContent = fmtNum(row[COL.MACD], 2);
    document.getElementById("iro-sig").textContent = fmtNum(row[COL.SIG], 2);
    document.getElementById("iro-obv").textContent = fmtCompact(row[COL.OBV]);
  }

  function renderIndicatorCharts() {
    if (document.getElementById("panel-indicators").hidden) return;
    const { rows } = getRangeSlice(state.indRange);
    const activeIdx =
      state.indHoverIdx !== null
        ? Math.min(rows.length - 1, Math.max(0, state.indHoverIdx))
        : rows.length - 1;
    updateIndicatorReadout(rows[activeIdx]);

    const pad = { top: 14, right: 18, bottom: 24, left: 64 };

    // 1. RSI(14)
    (function () {
      const canvas = document.getElementById("chart-rsi");
      const { ctx, width, height } = setupCanvas(canvas);
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      const xFor = (i) => pad.left + (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * plotW);
      const yFor = (v) => pad.top + ((100 - v) / 100) * plotH;

      // 30-70 neutral band
      ctx.fillStyle = "rgba(56, 189, 248, 0.05)";
      ctx.fillRect(pad.left, yFor(70), plotW, yFor(30) - yFor(70));

      drawGrid(ctx, pad, plotW, plotH, 0, 100, 4, (v) => v.toFixed(0));
      drawDateTicks(ctx, rows, pad, plotW, height);

      [70, 30].forEach((lvl) => {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = lvl === 70 ? "rgba(255, 77, 106, 0.6)" : "rgba(16, 185, 129, 0.6)";
        ctx.beginPath();
        ctx.moveTo(pad.left, yFor(lvl));
        ctx.lineTo(pad.left + plotW, yFor(lvl));
        ctx.stroke();
        ctx.restore();
      });

      drawLineSeries(ctx, rows, COL.RSI, xFor, yFor, "#38BDF8", 1.65);
      const hx = xFor(activeIdx);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + plotH);
      ctx.stroke();
    })();

    // 2. MACD + Signal + Histogram
    (function () {
      const canvas = document.getElementById("chart-macd");
      const { ctx, width, height } = setupCanvas(canvas);
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      let minM = 0;
      let maxM = 0;
      for (let i = 0; i < rows.length; i++) {
        const m = rows[i][COL.MACD];
        const s = rows[i][COL.SIG];
        if (m !== null) { minM = Math.min(minM, m); maxM = Math.max(maxM, m); }
        if (s !== null) { minM = Math.min(minM, s); maxM = Math.max(maxM, s); }
      }
      const absMax = Math.max(1, Math.max(Math.abs(minM), Math.abs(maxM)) * 1.12);
      const xFor = (i) => pad.left + (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * plotW);
      const yFor = (v) => pad.top + ((absMax - v) / (2 * absMax)) * plotH;

      drawGrid(ctx, pad, plotW, plotH, -absMax, absMax, 4, (v) => v.toFixed(1));
      drawDateTicks(ctx, rows, pad, plotW, height);

      const zeroY = yFor(0);
      const barW = Math.max(1, Math.min(3.5, plotW / Math.max(1, rows.length) * 0.7));
      for (let i = 0; i < rows.length; i++) {
        const m = rows[i][COL.MACD];
        const s = rows[i][COL.SIG];
        if (m === null || s === null) continue;
        const diff = m - s;
        const y = yFor(diff);
        ctx.fillStyle = diff >= 0 ? "rgba(16, 185, 129, 0.45)" : "rgba(255, 77, 106, 0.45)";
        ctx.fillRect(xFor(i) - barW / 2, Math.min(zeroY, y), barW, Math.abs(y - zeroY));
      }

      drawLineSeries(ctx, rows, COL.MACD, xFor, yFor, "#10B981", 1.5);
      drawLineSeries(ctx, rows, COL.SIG, xFor, yFor, "#F59E0B", 1.35);

      const hx = xFor(activeIdx);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + plotH);
      ctx.stroke();
    })();

    // 3. OBV
    (function () {
      const canvas = document.getElementById("chart-obv");
      const { ctx, width, height } = setupCanvas(canvas);
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      let minO = Infinity;
      let maxO = -Infinity;
      for (let i = 0; i < rows.length; i++) {
        const o = rows[i][COL.OBV];
        if (o < minO) minO = o;
        if (o > maxO) maxO = o;
      }
      const span = Math.max(1, maxO - minO);
      minO -= span * 0.06;
      maxO += span * 0.06;
      const xFor = (i) => pad.left + (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * plotW);
      const yFor = (v) => pad.top + ((maxO - v) / (maxO - minO)) * plotH;

      drawGrid(ctx, pad, plotW, plotH, minO, maxO, 3, (v) => fmtCompact(v));
      drawDateTicks(ctx, rows, pad, plotW, height);
      drawLineSeries(ctx, rows, COL.OBV, xFor, yFor, "#A78BFA", 1.65);

      const hx = xFor(activeIdx);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + plotH);
      ctx.stroke();
    })();
  }

  // ---------- Synthetic Validation Rolling RMSE Chart (SYNTH-EQ) ----------
  function renderTrainingChart() {
    const canvas = document.getElementById("chart-training");
    if (!canvas || document.getElementById("panel-research").hidden) return;

    const sb = DATA.synthetic_benchmarks;
    const dates = sb.dates || [];
    if (!dates.length) return;

    const { ctx, width, height } = setupCanvas(canvas);
    const pad = { top: 20, right: 20, bottom: 30, left: 68 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const visibleSeries = sb.series.filter((s) => state.activeBenchmarks[s.id]);
    let maxRmse = 5;
    visibleSeries.forEach((s) => {
      s.rolling_rmse.forEach((v) => {
        if (v > maxRmse) maxRmse = v;
      });
    });
    maxRmse = maxRmse * 1.12;
    const minRmse = 0;

    const xFor = (i) => pad.left + (i / Math.max(1, dates.length - 1)) * plotW;
    const yFor = (v) => pad.top + ((maxRmse - v) / Math.max(1e-9, maxRmse - minRmse)) * plotH;

    drawGrid(ctx, pad, plotW, plotH, minRmse, maxRmse, 5, (v) => "$" + v.toFixed(1));

    ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = "#8ca0bf";
    ctx.textBaseline = "top";
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const idx = Math.round((i / xTicks) * (dates.length - 1));
      ctx.textAlign = i === 0 ? "left" : i === xTicks ? "right" : "center";
      ctx.fillText(dates[idx], xFor(idx), height - pad.bottom + 8);
    }

    const overallPersist = DATA.baseline.leak_free_protocol.usd_rmse;
    const baseY = yFor(overallPersist);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#10B981";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(pad.left, baseY);
    ctx.lineTo(pad.left + plotW, baseY);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#6ee7b7";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("OVERALL SYNTH-EQ NAIVE RMSE: $" + overallPersist.toFixed(2), pad.left + plotW - 6, baseY - 5);

    const colors = { persistence: "#10B981", ema20_lag: "#38BDF8" };
    sb.series.forEach(function (ser) {
      if (!state.activeBenchmarks[ser.id]) return;
      ctx.strokeStyle = colors[ser.id] || "#F59E0B";
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ser.rolling_rmse.forEach(function (val, i) {
        const x = xFor(i);
        const y = yFor(val);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    if (state.benchHoverIdx !== null) {
      const idx = Math.max(0, Math.min(dates.length - 1, state.benchHoverIdx));
      const hx = xFor(idx);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.7)";
      ctx.beginPath();
      ctx.moveTo(hx, pad.top);
      ctx.lineTo(hx, pad.top + plotH);
      ctx.stroke();
      ctx.restore();

      const parts = [`<span>20d Ending: <strong>${dates[idx]}</strong></span>`];
      sb.series.forEach((ser) => {
        if (state.activeBenchmarks[ser.id]) {
          parts.push(`<span>${ser.label}: <strong>$${ser.rolling_rmse[idx].toFixed(2)}</strong></span>`);
        }
      });
      document.getElementById("loss-readout").innerHTML = parts.join("");
    }
  }

  // ---------- Signal Sandbox (Illustrative Only) ----------
  function renderSandbox() {
    const refRow = DATA.series[state.sandboxRefIdx] || DATA.series[DATA.series.length - 1];
    const basePrice = Number(refRow[COL.CLOSE]);
    const refDate = refRow[COL.DATE];
    const thresh = state.sandboxThreshold;
    const drift = state.sandboxDrift;
    const swing = state.sandboxSwing;

    document.getElementById("sb-threshold-val").textContent = thresh.toFixed(1) + "%";
    document.getElementById("sb-drift-val").textContent = (drift >= 0 ? "+" : "") + drift.toFixed(1) + "%";
    document.getElementById("sb-swing-val").textContent = swing.toFixed(1) + "%";

    // Deterministic synthetic 7-day path purely driven by user sliders
    const path = [];
    for (let day = 1; day <= 7; day++) {
      const progress = day / 7;
      const wave = Math.sin((day / 7) * Math.PI * 2) * (swing / 100);
      const pct = progress * (drift / 100) + wave;
      path.push(Number((basePrice * (1 + pct)).toFixed(2)));
    }

    const upper = basePrice * (1 + thresh / 100);
    const lower = basePrice * (1 - thresh / 100);
    const fMax = Math.max.apply(null, path);
    const fMin = Math.min.apply(null, path);
    const fMean = path.reduce((a, b) => a + b, 0) / path.length;

    let code = "BEKLE";
    let cls = "sig-bekle";
    let msg = "";
    if (fMax > upper) {
      code = "AL";
      cls = "sig-al";
      msg = `Hypothetical peak ${fmtUsd(fMax)} exceeds +${thresh.toFixed(1)}% band (${fmtUsd(upper)}). Illustrative rule trigger only.`;
    } else if (fMin < lower) {
      code = "SAT";
      cls = "sig-sat";
      msg = `Hypothetical trough ${fmtUsd(fMin)} breaches -${thresh.toFixed(1)}% band (${fmtUsd(lower)}). Illustrative rule trigger only.`;
    } else {
      msg = `Hypothetical range [${fmtUsd(fMin)}, ${fmtUsd(fMax)}] stays inside ±${thresh.toFixed(1)}% (mean ${fmtUsd(fMean)}).`;
    }

    const banner = document.getElementById("sb-signal-banner");
    banner.className = "signal-banner " + cls;
    document.getElementById("sb-signal-code").textContent = code;
    document.getElementById("sb-signal-msg").textContent = msg;

    document.getElementById("sb-rule-trace").innerHTML =
      `Reference (${refDate}): P0 = ${fmtUsd(basePrice)} &middot; Upper (+${thresh.toFixed(1)}%): ${fmtUsd(upper)} &middot; Lower (-${thresh.toFixed(1)}%): ${fmtUsd(lower)}<br>` +
      `Hypothetical 7d series: [${path.map((p) => "$" + p.toFixed(2)).join(", ")}]<br>` +
      `Check 1: max(${fmtUsd(fMax)}) > ${fmtUsd(upper)} &rarr; ${fMax > upper} | ` +
      `Check 2: min(${fmtUsd(fMin)}) < ${fmtUsd(lower)} &rarr; ${fMin < lower}`;

    // Draw sandbox chart
    const canvas = document.getElementById("chart-sandbox");
    if (!canvas || document.getElementById("panel-sandbox").hidden) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const pad = { top: 16, right: 18, bottom: 26, left: 64 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const allPts = [basePrice].concat(path);
    const minY = Math.min(lower, fMin, basePrice) * 0.985;
    const maxY = Math.max(upper, fMax, basePrice) * 1.015;
    const xFor = (i) => pad.left + (i / 7) * plotW;
    const yFor = (v) => pad.top + ((maxY - v) / (maxY - minY)) * plotH;

    drawGrid(ctx, pad, plotW, plotH, minY, maxY, 4, (v) => "$" + v.toFixed(0));

    // Threshold band fill
    ctx.fillStyle = "rgba(245, 158, 11, 0.06)";
    ctx.fillRect(pad.left, yFor(upper), plotW, yFor(lower) - yFor(upper));

    // Upper & lower dashed bands
    [
      { val: upper, color: "rgba(16, 185, 129, 0.75)", label: "+TH" },
      { val: lower, color: "rgba(255, 77, 106, 0.75)", label: "-TH" },
    ].forEach((b) => {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(pad.left, yFor(b.val));
      ctx.lineTo(pad.left + plotW, yFor(b.val));
      ctx.stroke();
      ctx.restore();
    });

    // Day labels
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = "#8ca0bf";
    ctx.textBaseline = "top";
    for (let i = 0; i <= 7; i++) {
      ctx.textAlign = i === 0 ? "left" : i === 7 ? "right" : "center";
      ctx.fillText(i === 0 ? "Ref" : "+D" + i, xFor(i), height - pad.bottom + 8);
    }

    // Hypothetical line
    ctx.strokeStyle = "#38BDF8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    allPts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(xFor(i), yFor(p));
      else ctx.lineTo(xFor(i), yFor(p));
    });
    ctx.stroke();

    allPts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(xFor(i), yFor(p), i === 0 ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? "#ffffff" : p > upper ? "#10B981" : p < lower ? "#FF4D6A" : "#38BDF8";
      ctx.fill();
    });
  }

  // ---------- Event Binding ----------
  function activateTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.setAttribute("tabindex", active ? "0" : "-1");
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      const active = panel.id === "panel-" + tabName;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    requestAnimationFrame(renderActiveTabCharts);
  }

  function renderActiveTabCharts() {
    if (state.activeTab === "overview") renderOverviewChart();
    else if (state.activeTab === "indicators") renderIndicatorCharts();
    else if (state.activeTab === "research") renderTrainingChart();
    else if (state.activeTab === "sandbox") renderSandbox();
  }

  function bindPointerScrub(canvas, getLength, padLeft, padRight, onIndex) {
    function handle(clientX) {
      const rect = canvas.getBoundingClientRect();
      const plotW = Math.max(1, rect.width - padLeft - padRight);
      const frac = Math.min(1, Math.max(0, (clientX - rect.left - padLeft) / plotW));
      const len = getLength();
      const idx = Math.round(frac * Math.max(0, len - 1));
      onIndex(idx);
    }
    canvas.addEventListener("mousemove", (e) => handle(e.clientX));
    canvas.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches && e.touches[0]) handle(e.touches[0].clientX);
      },
      { passive: true }
    );
  }

  function initEvents() {
    // Tabs + keyboard arrow/Home/End navigation
    const tabs = Array.from(document.querySelectorAll(".tab-btn"));
    tabs.forEach((btn, idx) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.tab));
      btn.addEventListener("keydown", (ev) => {
        let next = null;
        if (ev.key === "ArrowRight") next = (idx + 1) % tabs.length;
        else if (ev.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
        else if (ev.key === "Home") next = 0;
        else if (ev.key === "End") next = tabs.length - 1;
        if (next !== null) {
          ev.preventDefault();
          tabs[next].focus();
          activateTab(tabs[next].dataset.tab);
        }
      });
    });

    // Overview controls
    document.querySelectorAll("[data-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-range]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.overviewRange = btn.dataset.range;
        state.overviewHoverIdx = null;
        renderOverviewChart();
      });
    });

    document.getElementById("toggle-ema20").addEventListener("change", (e) => {
      state.showEma20 = e.target.checked;
      renderOverviewChart();
    });
    document.getElementById("toggle-ema50").addEventListener("change", (e) => {
      state.showEma50 = e.target.checked;
      renderOverviewChart();
    });
    document.getElementById("toggle-split").addEventListener("change", (e) => {
      state.showSplit = e.target.checked;
      renderOverviewChart();
    });
    document.getElementById("overview-scrubber").addEventListener("input", (e) => {
      state.overviewHoverIdx = Number(e.target.value);
      renderOverviewChart();
    });

    bindPointerScrub(
      document.getElementById("chart-overview"),
      () => getRangeSlice(state.overviewRange).rows.length,
      64,
      18,
      (idx) => {
        state.overviewHoverIdx = idx;
        renderOverviewChart();
      }
    );

    // Indicator range buttons & synchronized scrub
    document.querySelectorAll("[data-ind-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-ind-range]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.indRange = btn.dataset.indRange;
        state.indHoverIdx = null;
        renderIndicatorCharts();
      });
    });
    ["chart-rsi", "chart-macd", "chart-obv"].forEach((id) => {
      bindPointerScrub(
        document.getElementById(id),
        () => getRangeSlice(state.indRange).rows.length,
        64,
        18,
        (idx) => {
          state.indHoverIdx = idx;
          renderIndicatorCharts();
        }
      );
    });

    // Synthetic benchmark chart scrub
    bindPointerScrub(
      document.getElementById("chart-training"),
      () => (DATA.synthetic_benchmarks && DATA.synthetic_benchmarks.dates ? DATA.synthetic_benchmarks.dates.length : 1),
      68,
      20,
      (idx) => {
        state.benchHoverIdx = idx;
        renderTrainingChart();
      }
    );

    // Sandbox controls
    document.getElementById("sb-date").addEventListener("change", (e) => {
      state.sandboxRefIdx = Number(e.target.value);
      renderSandbox();
    });
    document.getElementById("sb-threshold").addEventListener("input", (e) => {
      state.sandboxThreshold = Number(e.target.value);
      renderSandbox();
    });
    document.getElementById("sb-drift").addEventListener("input", (e) => {
      state.sandboxDrift = Number(e.target.value);
      renderSandbox();
    });
    document.getElementById("sb-swing").addEventListener("input", (e) => {
      state.sandboxSwing = Number(e.target.value);
      renderSandbox();
    });
    document.querySelectorAll("[data-sb-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.sbPreset;
        if (p === "bull") { state.sandboxDrift = 7.0; state.sandboxSwing = 2.0; }
        else if (p === "flat") { state.sandboxDrift = 0.5; state.sandboxSwing = 1.5; }
        else if (p === "bear") { state.sandboxDrift = -8.0; state.sandboxSwing = 2.0; }
        document.getElementById("sb-drift").value = String(state.sandboxDrift);
        document.getElementById("sb-swing").value = String(state.sandboxSwing);
        renderSandbox();
      });
    });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderActiveTabCharts, 80);
    });
  }

  hydrateMetadata();
  initEvents();
  renderOverviewChart();
})();
