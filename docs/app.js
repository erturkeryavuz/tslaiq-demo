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
      resizeTimer = setTimeout(() => {
        renderActiveTabCharts();
        handleTutorialViewportChange();
      }, 80);
    });

    if (window.visualViewport && typeof window.visualViewport.addEventListener === "function") {
      window.visualViewport.addEventListener("resize", () => {
        handleTutorialViewportChange();
      });
    }
  }

  // ---------- Interactive Watch Tutorial & Responsive Analytical Workspace ----------
  const tutorial = {
    active: false,
    playing: false,
    completed: false,
    stageIndex: 0,
    subActionDone: false,
    secondSubActionDone: false,
    stageToken: 0,
    subTimers: [],
    advanceTimer: null,
    resizeSettleTimer: null,
    driving: false,
    userScrolledAway: false,
    lastGuidedScrollY: 0,
    programmaticScrollUntil: 0,
    resizeIgnoreScrollUntil: 0,
    userScrollIntentUntil: 0,
    lastViewportW: window.innerWidth || 0,
    lastViewportH: window.innerHeight || 0,
    activeTargetSelector: null,
    subFocusSelector: null,
    resolvedFocusSelector: null,
  };

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function clearTutorialTimers() {
    while (tutorial.subTimers.length > 0) {
      clearTimeout(tutorial.subTimers.pop());
    }
    if (tutorial.advanceTimer !== null) {
      clearTimeout(tutorial.advanceTimer);
      tutorial.advanceTimer = null;
    }
  }

  function clearSpotlight() {
    document.querySelectorAll(".tutorial-spotlight").forEach((el) => {
      el.classList.remove("tutorial-spotlight");
    });
  }

  function setOverviewRangeUI(rangeCode) {
    state.overviewRange = rangeCode;
    state.overviewHoverIdx = null;
    document.querySelectorAll("[data-range]").forEach((b) => {
      b.classList.toggle("active", b.dataset.range === rangeCode);
    });
    renderOverviewChart();
  }

  function setIndicatorRangeUI(rangeCode) {
    state.indRange = rangeCode;
    state.indHoverIdx = null;
    document.querySelectorAll("[data-ind-range]").forEach((b) => {
      b.classList.toggle("active", b.dataset.indRange === rangeCode);
    });
    renderIndicatorCharts();
  }

  function resetOverviewControlsToDefault() {
    state.showEma20 = true;
    state.showEma50 = true;
    state.showSplit = true;
    const e20 = document.getElementById("toggle-ema20");
    const e50 = document.getElementById("toggle-ema50");
    const sp = document.getElementById("toggle-split");
    if (e20) e20.checked = true;
    if (e50) e50.checked = true;
    if (sp) sp.checked = true;
    setOverviewRangeUI("1Y");
  }

  function resetBenchmarksToDefault() {
    state.activeBenchmarks = { persistence: true, ema20_lag: true };
    state.benchHoverIdx = null;
    document.querySelectorAll("#run-toggles input[type='checkbox']").forEach((cb) => {
      cb.checked = true;
    });
    const lr = document.getElementById("loss-readout");
    if (lr && DATA.baseline && DATA.baseline.leak_free_protocol) {
      const lf = DATA.baseline.leak_free_protocol;
      const emaSer = (DATA.synthetic_benchmarks && DATA.synthetic_benchmarks.series || []).find((s) => s.id === "ema20_lag");
      const emaRmse = emaSer ? emaSer.overall_usd_rmse.toFixed(2) : "14.65";
      const emaMse = emaSer && typeof emaSer.overall_scaled_mse === "number" ? emaSer.overall_scaled_mse.toFixed(6) : "0.022101";
      lr.innerHTML =
        `<span class="c-baseline">SYNTH-EQ Naive Persistence: <strong>$${lf.usd_rmse.toFixed(2)} RMSE (${lf.scaled_mse.toFixed(6)} scaled MSE)</strong></span>` +
        `<span>SYNTH-EQ Lagged EMA20: <strong>$${emaRmse} RMSE (${emaMse} scaled MSE)</strong></span>` +
        `<span>Neural Network on SYNTH-EQ: <strong>NOT TRAINED</strong></span>`;
    }
  }

  function resetSandboxToDefault() {
    state.sandboxRefIdx = DATA.series.length - 1;
    state.sandboxThreshold = 5.0;
    state.sandboxDrift = 2.5;
    state.sandboxSwing = 2.0;
    const sbDate = document.getElementById("sb-date");
    const sbThresh = document.getElementById("sb-threshold");
    const sbDrift = document.getElementById("sb-drift");
    const sbSwing = document.getElementById("sb-swing");
    if (sbDate) sbDate.value = String(state.sandboxRefIdx);
    if (sbThresh) sbThresh.value = "5";
    if (sbDrift) sbDrift.value = "2.5";
    if (sbSwing) sbSwing.value = "2";
  }

  const TUTORIAL_STAGES = [
    {
      id: "intro-provenance",
      tab: "overview",
      targetSelector: "#overview-kpis",
      compactTargetSelector: "#overview-kpis",
      title: "Synthetic Dataset Provenance & KPIs",
      narration:
        "TSLAIQ runs offline on a 100% synthetic daily series (SYNTH-EQ, 1,500 weekday sessions, fixed seed 20261123) with zero real Tesla or Yahoo Finance market data.",
      durationMs: 3600,
      enter() {
        activateTab("overview");
        resetOverviewControlsToDefault();
      },
    },
    {
      id: "overview-chart",
      tab: "overview",
      targetSelector: "#overview-chart-card",
      compactTargetSelector: "#overview-readout",
      tightCompactSelector: "#overview-chart-stage",
      checkVisibleSelector: "#overview-chart-stage",
      title: "Interactive Price, Volume & Range Presets",
      narration:
        "Explore the synthetic Close price, EMA20/EMA50 overlays, and daily volume bars. Next, the tutorial widens the range from 1Y to 3Y to reveal the chronological validation split.",
      durationMs: 4200,
      subDelayMs: 1500,
      enter() {
        activateTab("overview");
        resetOverviewControlsToDefault();
      },
      subAction() {
        setOverviewRangeUI("3Y");
      },
    },
    {
      id: "overview-scrub",
      tab: "overview",
      targetSelector: "#overview-chart-card",
      compactTargetSelector: "#overview-readout",
      tightCompactSelector: "#overview-chart-stage",
      checkVisibleSelector: "#overview-chart-stage",
      title: "Session Scrubber & Numerical Readouts",
      narration:
        "Every session can be inspected via pointer hover or the keyboard scrubber. Watch the crosshair jump to the synthetic peak close ($338.84 on 2025-03-20) and update live OHLCV values.",
      durationMs: 4200,
      subDelayMs: 1400,
      enter() {
        activateTab("overview");
        setOverviewRangeUI("3Y");
      },
      subAction() {
        const { rows } = getRangeSlice("3Y");
        const peakDate = DATA.meta && DATA.meta.extremes ? DATA.meta.extremes.all_time_high_close_date : "2025-03-20";
        let idx = rows.findIndex((r) => r[COL.DATE] === peakDate);
        if (idx < 0) idx = Math.floor(rows.length * 0.65);
        state.overviewHoverIdx = idx;
        renderOverviewChart();
      },
    },
    {
      id: "indicators",
      tab: "indicators",
      targetSelector: "#indicators-chart-card",
      compactTargetSelector: "#ind-block-rsi",
      checkVisibleSelector: "#ind-block-rsi",
      title: "Synchronized Technical Indicator Stack",
      narration:
        "Inspect RSI(14), MACD(12,26,9) + histogram, and cumulative OBV computed deterministically on SYNTH-EQ. The walkthrough zooms into 3M and steps across the indicator stack.",
      durationMs: 4800,
      subDelayMs: 1400,
      enter() {
        activateTab("indicators");
        setIndicatorRangeUI("1Y");
      },
      subAction() {
        setIndicatorRangeUI("3M");
        const { rows } = getRangeSlice("3M");
        state.indHoverIdx = Math.floor(rows.length * 0.5);
        renderIndicatorCharts();
        focusSubTargetIfNeeded("#ind-block-macd", "#indicators-chart-card");
      },
      secondSubDelayMs: 2900,
      secondSubAction() {
        focusSubTargetIfNeeded("#ind-block-obv", "#indicators-chart-card");
      },
    },
    {
      id: "benchmarks",
      tab: "research",
      targetSelector: "#research-chart-card",
      compactTargetSelector: "#loss-readout",
      tightCompactSelector: "#research-chart-stage",
      checkVisibleSelector: "#research-chart-stage",
      title: "Part A — Leak-Free Synthetic Baselines",
      narration:
        "Part A plots 20-day rolling USD RMSE on the 278-day chronological split (train-only scaling): Naive Persistence ($5.83 RMSE) outperforms Lagged EMA20 ($14.65 RMSE). No neural network is trained on SYNTH-EQ.",
      durationMs: 4400,
      subDelayMs: 1500,
      enter() {
        activateTab("research");
        resetBenchmarksToDefault();
        renderTrainingChart();
      },
      subAction() {
        const len = DATA.synthetic_benchmarks && DATA.synthetic_benchmarks.dates ? DATA.synthetic_benchmarks.dates.length : 0;
        if (len > 0) {
          state.benchHoverIdx = Math.floor(len * 0.55);
          renderTrainingChart();
        }
      },
    },
    {
      id: "archival-research",
      tab: "research",
      targetSelector: "#research-comparison-grid",
      compactTargetSelector: "#research-archival-card",
      checkVisibleSelector: "#research-archival-card",
      title: "Part B — Honest Archival Research Record",
      narration:
        "Part B is strictly separated from SYNTH-EQ: in the original private engineering project on real historical equity data, none of the logged Keras LSTM models beat trivial naive persistence.",
      durationMs: 4200,
      enter() {
        activateTab("research");
        resetBenchmarksToDefault();
        renderTrainingChart();
      },
    },
    {
      id: "sandbox",
      tab: "sandbox",
      targetSelector: "#sandbox-grid",
      compactTargetSelector: "#sandbox-inputs-card",
      tightCompactSelector: ".preset-row",
      checkVisibleSelector: "#sb-signal-banner",
      title: "Illustrative Hypothetical Rule Sandbox",
      narration:
        "The Signal Sandbox tests deterministic ±% threshold rules on user-controlled hypothetical paths (not ML predictions or trading advice). Watch the +7% Upward preset shift BEKLE to AL.",
      durationMs: 5200,
      subDelayMs: 1400,
      enter() {
        activateTab("sandbox");
        resetSandboxToDefault();
        renderSandbox();
      },
      subAction() {
        const bullBtn = document.querySelector('[data-sb-preset="bull"]');
        if (bullBtn) {
          tutorial.driving = true;
          try {
            bullBtn.click();
          } finally {
            tutorial.driving = false;
          }
        }
        focusSubTargetIfNeeded("#sb-signal-banner", "#sandbox-result-card");
      },
    },
    {
      id: "inspector",
      tab: "inspector",
      targetSelector: "#inspector-arch-grid",
      compactTargetSelector: "#inspector-arch-card",
      checkVisibleSelector: "#inspector-arch-card",
      title: "Engineering Inspector & Safe Architecture",
      narration:
        "Inspect the private-repo hardening summary: TrainOnlyMinMaxScaler, serializable custom Attention-LSTM layers replacing anonymous Lambda bytecode, and offline verification gates.",
      durationMs: 4600,
      subDelayMs: 1600,
      enter() {
        activateTab("inspector");
      },
      subAction() {
        tutorial.activeTargetSelector = "#inspector-gates-card";
        tutorial.subFocusSelector = "#inspector-gates-card";
        applyStageSpotlight("#inspector-gates-card");
        if (!tutorial.userScrolledAway) {
          positionTutorialWorkspace("#inspector-gates-card", { instant: prefersReducedMotion(), force: false });
        }
      },
    },
    {
      id: "finish",
      tab: "overview",
      targetSelector: "#overview-chart-card",
      compactTargetSelector: "#overview-readout",
      tightCompactSelector: "#overview-chart-stage",
      checkVisibleSelector: "#overview-chart-stage",
      title: "Walkthrough Complete — Explore Manually",
      narration:
        "You have toured TSLAIQ's synthetic charts, synchronized indicators, leak-free baselines, archival research record, hypothetical sandbox, and Inspector. Click Replay or Exit to explore freely.",
      durationMs: 0,
      enter() {
        resetSandboxToDefault();
        resetBenchmarksToDefault();
        activateTab("overview");
        resetOverviewControlsToDefault();
      },
    },
  ];

  function getDockClearanceMetrics(dock) {
    const vh = window.innerHeight || 768;
    const vw = window.innerWidth || 1280;
    const stickyTop = vh <= 620 ? 4 : vw <= 680 ? 6 : 8;
    const gap = vh <= 620 ? 8 : 12;
    const dockH = dock ? dock.getBoundingClientRect().height || 0 : 0;
    const topEdge = stickyTop + dockH + gap;
    const availH = Math.max(80, vh - topEdge - 6);
    return { vh, vw, stickyTop, gap, dockH, topEdge, availH };
  }

  function isElementMeaningfullyVisible(dock, el) {
    if (!el || !dock) return false;
    const vh = window.innerHeight || 768;
    const dr = dock.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const visibleTop = Math.max(er.top, dr.bottom + 2);
    const visibleBottom = Math.min(er.bottom, vh - 2);
    const visibleH = Math.max(0, visibleBottom - visibleTop);
    if (er.height <= vh - dr.bottom - 12) {
      return er.top >= dr.bottom + 2 && er.bottom <= vh - 2;
    }
    return visibleH >= Math.min(er.height * 0.7, (vh - dr.bottom) * 0.6);
  }

  function focusSubTargetIfNeeded(focusSelector, spotlightSelector) {
    tutorial.subFocusSelector = focusSelector;
    tutorial.resolvedFocusSelector = focusSelector;
    if (spotlightSelector) {
      applyStageSpotlight(spotlightSelector);
    }
    if (tutorial.userScrolledAway) return;
    const dock = document.getElementById("tutorialDock");
    const targetEl = document.querySelector(focusSelector);
    if (!dock || !targetEl) return;
    if (!isElementMeaningfullyVisible(dock, targetEl)) {
      positionTutorialWorkspace(focusSelector, { instant: prefersReducedMotion(), force: true });
    }
  }

  function resolveGuidedFocusSelector(dock) {
    const stage = TUTORIAL_STAGES[tutorial.stageIndex];
    if (!stage) return tutorial.activeTargetSelector;
    if (tutorial.subFocusSelector) {
      const subEl = document.querySelector(tutorial.subFocusSelector);
      if (subEl) return tutorial.subFocusSelector;
    }

    const primarySel = tutorial.activeTargetSelector || stage.targetSelector;
    const compactSel = stage.compactTargetSelector || null;
    if (!primarySel || !compactSel || compactSel === primarySel) return primarySel;

    const primaryEl = document.querySelector(primarySel);
    const compactEl = document.querySelector(compactSel);
    if (!primaryEl || !compactEl) return primarySel;

    const { availH } = getDockClearanceMetrics(dock);
    const pRect = primaryEl.getBoundingClientRect();
    const checkEl = stage.checkVisibleSelector ? document.querySelector(stage.checkVisibleSelector) : compactEl;
    const cRect = (checkEl || compactEl).getBoundingClientRect();

    // If the entire primary card fits, or its key demonstrated content fits cleanly beneath the dock when aligned to primary top, keep the full primary card framed.
    const keyBottomFromPrimaryTop = cRect.bottom - pRect.top;
    if (pRect.height <= availH || keyBottomFromPrimaryTop <= availH) {
      return primarySel;
    }

    // If an even tighter compact selector is defined (e.g. .preset-row inside #sandbox-inputs-card, or #overview-chart-stage on 320x480), use it only when compactEl pushes that key child below a usable visibility threshold.
    if (stage.tightCompactSelector) {
      const tightEl = document.querySelector(stage.tightCompactSelector);
      if (tightEl) {
        const compRect = compactEl.getBoundingClientRect();
        const tightRect = tightEl.getBoundingClientRect();
        const visibleTight = availH - (tightRect.top - compRect.top);
        const minNeeded = Math.min(tightRect.height, Math.max(80, tightRect.height * 0.6));
        if (visibleTight < minNeeded) {
          return stage.tightCompactSelector;
        }
      }
    }

    return compactSel;
  }

  function applyStageSpotlight(selector) {
    clearSpotlight();
    if (!selector) return;
    const el = document.querySelector(selector);
    if (el) el.classList.add("tutorial-spotlight");
  }

  function computeGuidedScrollY(dock, target) {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const { vh, stickyTop, topEdge } = getDockClearanceMetrics(dock);
    const maxScrollY = Math.max(0, (document.documentElement.scrollHeight || 0) - vh);
    const dockRect = dock.getBoundingClientRect();

    if (!target) {
      const dockDocTop = dockRect.top + scrollY;
      return Math.max(0, Math.min(maxScrollY, Math.round(dockDocTop - stickyTop)));
    }

    const targetRect = target.getBoundingClientRect();
    const targetDocTop = targetRect.top + scrollY;
    const desired = targetDocTop - topEdge;
    return Math.max(0, Math.min(maxScrollY, Math.round(desired)));
  }

  function isTargetWellFramed(dock, target) {
    const vh = window.innerHeight || 768;
    const dockRect = dock.getBoundingClientRect();
    const dockVisible = dockRect.top >= -1 && dockRect.bottom <= vh + 1;
    if (!dockVisible) return false;
    if (!target) return true;
    const targetRect = target.getBoundingClientRect();
    const availH = vh - dockRect.bottom - 10;
    if (targetRect.height <= availH) {
      return targetRect.top >= dockRect.bottom + 2 && targetRect.bottom <= vh - 2;
    }
    return targetRect.top >= dockRect.bottom + 2 && targetRect.top <= dockRect.bottom + 20;
  }

  function positionTutorialWorkspace(explicitSelector, options) {
    const opts = options || {};
    if (!tutorial.active) return;
    if (tutorial.userScrolledAway && !opts.force) return;
    const dock = document.getElementById("tutorialDock");
    if (!dock || dock.hidden) return;

    const selector = explicitSelector || resolveGuidedFocusSelector(dock);
    tutorial.resolvedFocusSelector = selector;
    const target = selector ? document.querySelector(selector) : null;

    if (!opts.force && isTargetWellFramed(dock, target)) {
      tutorial.lastGuidedScrollY = Math.round(window.scrollY || 0);
      return;
    }

    const targetY = computeGuidedScrollY(dock, target);
    const currentY = Math.round(window.scrollY || 0);
    if (Math.abs(targetY - currentY) <= 2) {
      tutorial.lastGuidedScrollY = currentY;
      return;
    }

    const useInstant = Boolean(opts.instant || prefersReducedMotion());
    const now = Date.now();
    tutorial.lastGuidedScrollY = targetY;
    tutorial.programmaticScrollUntil = now + (useInstant ? 180 : 650);
    window.scrollTo({
      top: targetY,
      behavior: useInstant ? "auto" : "smooth",
    });
  }

  function renderTutorialDockUI() {
    const stage = TUTORIAL_STAGES[tutorial.stageIndex];
    const total = TUTORIAL_STAGES.length;
    const dock = document.getElementById("tutorialDock");
    const watchBtn = document.getElementById("btnWatchTutorial");
    const stepBadge = document.getElementById("tutorialStepBadge");
    const stateBadge = document.getElementById("tutorialStateBadge");
    const titleEl = document.getElementById("tutorialStageTitle");
    const narrEl = document.getElementById("tutorialNarration");
    const progEl = document.getElementById("tutorialProgress");
    const fillEl = document.getElementById("tutorialProgressFill");
    const prevBtn = document.getElementById("btnTutPrev");
    const playBtn = document.getElementById("btnTutPlayPause");
    const nextBtn = document.getElementById("btnTutNext");
    const srEl = document.getElementById("srAnnouncer");

    if (dock) dock.hidden = !tutorial.active;
    if (watchBtn) watchBtn.setAttribute("aria-expanded", tutorial.active ? "true" : "false");
    document.body.classList.toggle("tutorial-active", tutorial.active);

    if (!tutorial.active || !stage) return;

    const stepNum = tutorial.stageIndex + 1;
    const pct = Math.round((stepNum / total) * 100);
    if (stepBadge) stepBadge.textContent = `Stage ${stepNum} / ${total}`;
    if (titleEl) titleEl.textContent = stage.title;
    if (narrEl) narrEl.textContent = stage.narration;
    if (progEl) {
      progEl.setAttribute("aria-valuemax", String(total));
      progEl.setAttribute("aria-valuenow", String(stepNum));
    }
    if (fillEl) fillEl.style.width = `${pct}%`;

    if (stateBadge) {
      stateBadge.classList.remove("is-paused", "is-complete");
      if (tutorial.completed) {
        stateBadge.textContent = "Complete";
        stateBadge.classList.add("is-complete");
      } else if (tutorial.playing) {
        stateBadge.textContent = "Playing";
      } else {
        stateBadge.textContent = "Paused";
        stateBadge.classList.add("is-paused");
      }
    }

    if (prevBtn) prevBtn.disabled = tutorial.stageIndex === 0;
    if (nextBtn) nextBtn.disabled = tutorial.stageIndex >= total - 1;
    if (playBtn) {
      if (tutorial.completed) {
        playBtn.textContent = "Replay";
        playBtn.setAttribute("aria-pressed", "false");
      } else if (tutorial.playing) {
        playBtn.textContent = "Pause";
        playBtn.setAttribute("aria-pressed", "true");
      } else {
        playBtn.textContent = "Play";
        playBtn.setAttribute("aria-pressed", "false");
      }
    }

    if (srEl) {
      srEl.textContent = `Stage ${stepNum} of ${total}: ${stage.title}`;
    }
  }

  function scheduleCurrentStageTimers() {
    clearTutorialTimers();
    if (!tutorial.active || !tutorial.playing || tutorial.completed) return;
    const stage = TUTORIAL_STAGES[tutorial.stageIndex];
    if (!stage || stage.durationMs <= 0) return;

    const token = tutorial.stageToken;
    const reduced = prefersReducedMotion();
    const subDelay = reduced ? Math.min(stage.subDelayMs || 0, 500) : stage.subDelayMs || 0;
    const totalDuration = reduced ? Math.min(stage.durationMs, 1800) : stage.durationMs;

    if (typeof stage.subAction === "function" && !tutorial.subActionDone) {
      const tid = setTimeout(() => {
        tutorial.subTimers = tutorial.subTimers.filter((id) => id !== tid);
        if (!tutorial.active || !tutorial.playing || tutorial.stageToken !== token) return;
        tutorial.subActionDone = true;
        tutorial.driving = true;
        try {
          stage.subAction();
        } finally {
          tutorial.driving = false;
        }
      }, subDelay);
      tutorial.subTimers.push(tid);
    }

    if (typeof stage.secondSubAction === "function" && !tutorial.secondSubActionDone) {
      const secondDelay = reduced
        ? Math.min(stage.secondSubDelayMs || 1000, 1000)
        : stage.secondSubDelayMs || 2800;
      const tid2 = setTimeout(() => {
        tutorial.subTimers = tutorial.subTimers.filter((id) => id !== tid2);
        if (!tutorial.active || !tutorial.playing || tutorial.stageToken !== token) return;
        tutorial.secondSubActionDone = true;
        tutorial.driving = true;
        try {
          stage.secondSubAction();
        } finally {
          tutorial.driving = false;
        }
      }, secondDelay);
      tutorial.subTimers.push(tid2);
    }

    tutorial.advanceTimer = setTimeout(() => {
      tutorial.advanceTimer = null;
      if (!tutorial.active || !tutorial.playing || tutorial.stageToken !== token) return;
      if (tutorial.stageIndex + 1 < TUTORIAL_STAGES.length) {
        goToTutorialStage(tutorial.stageIndex + 1, { autoplay: true });
      }
    }, totalDuration);
  }

  function goToTutorialStage(index, options) {
    const opts = options || {};
    const clamped = Math.max(0, Math.min(TUTORIAL_STAGES.length - 1, index));
    clearTutorialTimers();
    tutorial.stageToken += 1;
    tutorial.stageIndex = clamped;
    tutorial.subActionDone = false;
    tutorial.secondSubActionDone = false;
    tutorial.subFocusSelector = null;

    const stage = TUTORIAL_STAGES[clamped];
    const isFinal = clamped === TUTORIAL_STAGES.length - 1;
    tutorial.completed = isFinal;
    tutorial.playing = isFinal ? false : Boolean(opts.autoplay);
    tutorial.activeTargetSelector = stage.targetSelector || null;

    tutorial.driving = true;
    try {
      if (typeof stage.enter === "function") stage.enter();
    } finally {
      tutorial.driving = false;
    }

    applyStageSpotlight(tutorial.activeTargetSelector);
    renderTutorialDockUI();

    requestAnimationFrame(() => {
      renderActiveTabCharts();
      positionTutorialWorkspace(null, {
        instant: Boolean(opts.instant),
        force: Boolean(opts.forceScroll),
      });
    });

    if (tutorial.playing) {
      scheduleCurrentStageTimers();
    }
  }

  function startTutorial() {
    tutorial.active = true;
    tutorial.userScrolledAway = false;
    tutorial.lastViewportW = window.innerWidth || 0;
    tutorial.lastViewportH = window.innerHeight || 0;
    goToTutorialStage(0, { autoplay: true, forceScroll: true });
    const playBtn = document.getElementById("btnTutPlayPause");
    if (playBtn && typeof playBtn.focus === "function") {
      try {
        playBtn.focus({ preventScroll: true });
      } catch (e) {
        playBtn.focus();
      }
    }
  }

  function pauseTutorial() {
    if (!tutorial.active || !tutorial.playing) return;
    tutorial.playing = false;
    clearTutorialTimers();
    renderTutorialDockUI();
  }

  function resumeTutorial() {
    if (!tutorial.active) return;
    if (tutorial.completed) {
      restartTutorial();
      return;
    }
    tutorial.playing = true;
    renderTutorialDockUI();
    scheduleCurrentStageTimers();
  }

  function restartTutorial() {
    if (!tutorial.active) {
      startTutorial();
      return;
    }
    tutorial.userScrolledAway = false;
    goToTutorialStage(0, { autoplay: true, forceScroll: true });
  }

  function exitTutorial(options) {
    const opts = options || {};
    clearTutorialTimers();
    if (tutorial.resizeSettleTimer !== null) {
      clearTimeout(tutorial.resizeSettleTimer);
      tutorial.resizeSettleTimer = null;
    }
    tutorial.active = false;
    tutorial.playing = false;
    tutorial.completed = false;
    tutorial.subActionDone = false;
    tutorial.secondSubActionDone = false;
    tutorial.userScrolledAway = false;
    tutorial.activeTargetSelector = null;
    tutorial.subFocusSelector = null;
    tutorial.resolvedFocusSelector = null;
    tutorial.stageToken += 1;
    clearSpotlight();
    renderTutorialDockUI();
    requestAnimationFrame(renderActiveTabCharts);
    if (opts.restoreFocus !== false) {
      const watchBtn = document.getElementById("btnWatchTutorial");
      if (watchBtn && typeof watchBtn.focus === "function") {
        try {
          watchBtn.focus({ preventScroll: true });
        } catch (e) {
          watchBtn.focus();
        }
      }
    }
  }

  function handleTutorialViewportChange() {
    const now = Date.now();
    const curW = window.innerWidth || 0;
    const curH = window.innerHeight || 0;
    tutorial.lastViewportW = curW;
    tutorial.lastViewportH = curH;
    tutorial.resizeIgnoreScrollUntil = now + 450;

    if (!tutorial.active) return;

    const reposition = () => {
      if (!tutorial.active) return;
      renderActiveTabCharts();
      if (!tutorial.userScrolledAway) {
        positionTutorialWorkspace(null, { instant: true, force: true });
      }
    };

    requestAnimationFrame(reposition);
    if (tutorial.resizeSettleTimer !== null) {
      clearTimeout(tutorial.resizeSettleTimer);
    }
    tutorial.resizeSettleTimer = setTimeout(() => {
      tutorial.resizeSettleTimer = null;
      reposition();
    }, 120);
  }

  function initTutorialEvents() {
    const watchBtn = document.getElementById("btnWatchTutorial");
    const prevBtn = document.getElementById("btnTutPrev");
    const playBtn = document.getElementById("btnTutPlayPause");
    const nextBtn = document.getElementById("btnTutNext");
    const restartBtn = document.getElementById("btnTutRestart");
    const exitBtn = document.getElementById("btnTutExit");

    if (watchBtn) {
      watchBtn.addEventListener("click", () => {
        if (tutorial.active) {
          restartTutorial();
        } else {
          startTutorial();
        }
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (!tutorial.active || tutorial.stageIndex <= 0) return;
        goToTutorialStage(tutorial.stageIndex - 1, { autoplay: false });
      });
    }
    if (playBtn) {
      playBtn.addEventListener("click", () => {
        if (!tutorial.active) return;
        if (tutorial.completed) {
          restartTutorial();
        } else if (tutorial.playing) {
          pauseTutorial();
        } else {
          resumeTutorial();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        if (!tutorial.active || tutorial.stageIndex >= TUTORIAL_STAGES.length - 1) return;
        goToTutorialStage(tutorial.stageIndex + 1, { autoplay: false });
      });
    }
    if (restartBtn) {
      restartBtn.addEventListener("click", () => restartTutorial());
    }
    if (exitBtn) {
      exitBtn.addEventListener("click", () => exitTutorial({ restoreFocus: true }));
    }

    // Escape key cleanly exits tutorial
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && tutorial.active) {
        ev.preventDefault();
        exitTutorial({ restoreFocus: true });
      }
      if (tutorial.active) {
        const tag = ev.target && ev.target.tagName ? ev.target.tagName.toUpperCase() : "";
        if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") {
          if (ev.key === "PageDown" || ev.key === "PageUp" || ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Home" || ev.key === "End" || ev.key === " ") {
            tutorial.programmaticScrollUntil = 0;
            tutorial.userScrollIntentUntil = Date.now() + 900;
          }
        }
      }
    });

    // Genuine user scroll intent tracking (wheel & touchmove)
    window.addEventListener(
      "wheel",
      () => {
        if (tutorial.active) {
          tutorial.programmaticScrollUntil = 0;
          tutorial.userScrollIntentUntil = Date.now() + 900;
        }
      },
      { passive: true }
    );
    window.addEventListener(
      "touchmove",
      () => {
        if (tutorial.active) {
          tutorial.programmaticScrollUntil = 0;
          tutorial.userScrollIntentUntil = Date.now() + 900;
        }
      },
      { passive: true }
    );

    // Pre/post-resize scroll discrimination
    window.addEventListener(
      "scroll",
      () => {
        if (!tutorial.active) return;
        const now = Date.now();
        const curW = window.innerWidth || 0;
        const curH = window.innerHeight || 0;
        if (curW !== tutorial.lastViewportW || curH !== tutorial.lastViewportH) {
          tutorial.lastViewportW = curW;
          tutorial.lastViewportH = curH;
          tutorial.resizeIgnoreScrollUntil = now + 450;
          return;
        }
        if (now < tutorial.resizeIgnoreScrollUntil || now < tutorial.programmaticScrollUntil) {
          return;
        }
        if (now <= tutorial.userScrollIntentUntil) {
          const curY = Math.round(window.scrollY || 0);
          if (Math.abs(curY - tutorial.lastGuidedScrollY) > 20) {
            tutorial.userScrolledAway = true;
          }
        }
      },
      { passive: true }
    );

    // Manual dashboard interactions safely pause autoplay without fighting the user
    const mainEl = document.getElementById("main-content");
    if (mainEl) {
      mainEl.addEventListener("pointerdown", (ev) => {
        if (!tutorial.active || !tutorial.playing || tutorial.driving) return;
        const dock = document.getElementById("tutorialDock");
        if (dock && dock.contains(ev.target)) return;
        pauseTutorial();
      });
    }
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (tutorial.active && tutorial.playing && !tutorial.driving) {
          pauseTutorial();
        }
      });
    });
  }

  // Read-only verification & inspection API
  window.__TSLAIQ_TUTORIAL__ = {
    getState() {
      const stage = TUTORIAL_STAGES[tutorial.stageIndex];
      const sbCode = document.getElementById("sb-signal-code");
      return {
        active: tutorial.active,
        playing: tutorial.playing,
        completed: tutorial.completed,
        stageIndex: tutorial.stageIndex,
        stageId: stage ? stage.id : null,
        totalStages: TUTORIAL_STAGES.length,
        subActionDone: tutorial.subActionDone,
        hasPendingTimers: tutorial.subTimers.length > 0 || tutorial.advanceTimer !== null,
        userScrolledAway: tutorial.userScrolledAway,
        lastGuidedScrollY: tutorial.lastGuidedScrollY,
        activeTargetSelector: tutorial.activeTargetSelector,
        resolvedFocusSelector: tutorial.resolvedFocusSelector,
        activeTab: state.activeTab,
        overviewRange: state.overviewRange,
        overviewHoverIdx: state.overviewHoverIdx,
        indRange: state.indRange,
        indHoverIdx: state.indHoverIdx,
        benchHoverIdx: state.benchHoverIdx,
        sandboxDrift: state.sandboxDrift,
        sandboxSignal: sbCode ? sbCode.textContent.trim() : null,
      };
    },
    stages: TUTORIAL_STAGES.map((s) => ({
      id: s.id,
      tab: s.tab,
      targetSelector: s.targetSelector,
      title: s.title,
      hasSubAction: typeof s.subAction === "function",
    })),
  };

  hydrateMetadata();
  initEvents();
  initTutorialEvents();
  renderOverviewChart();
})();
