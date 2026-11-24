"""Behavioral regression tests for TSLAIQ Watch Tutorial & responsive workspace."""

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"


def _run_node_harness(script_body: str) -> dict:
    harness = f"""
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class FakeClassList {{
  constructor(initial = []) {{ this.set = new Set(initial); }}
  add(...xs) {{ xs.forEach((x) => this.set.add(x)); }}
  remove(...xs) {{ xs.forEach((x) => this.set.delete(x)); }}
  toggle(x, force) {{
    if (force === undefined) {{
      if (this.set.has(x)) {{ this.set.delete(x); return false; }}
      this.set.add(x); return true;
    }}
    if (force) this.set.add(x); else this.set.delete(x);
    return !!force;
  }}
  contains(x) {{ return this.set.has(x); }}
}}

function makeEl(tag, id = "", classes = [], attrs = {{}}) {{
  const listeners = {{}};
  const el = {{
    tagName: tag.toUpperCase(),
    id,
    className: classes.join(" "),
    classList: new FakeClassList(classes),
    dataset: {{}},
    attrs: Object.assign({{}}, attrs),
    style: {{}},
    children: [],
    hidden: false,
    disabled: false,
    checked: false,
    value: "",
    textContent: "",
    _innerHTML: "",
    parentElement: null,
    _docTop: 0,
    _height: 400,
    _width: 960,
    get innerHTML() {{ return this._innerHTML; }},
    set innerHTML(v) {{ this._innerHTML = String(v); this.children = []; }},
    appendChild(child) {{ child.parentElement = el; this.children.push(child); return child; }},
    contains(node) {{
      if (node === el) return true;
      return this.children.some((c) => c === node || (c.contains && c.contains(node)));
    }},
    setAttribute(k, v) {{ this.attrs[k] = String(v); }},
    getAttribute(k) {{ return k in this.attrs ? this.attrs[k] : null; }},
    addEventListener(type, fn) {{ (listeners[type] = listeners[type] || []).push(fn); }},
    dispatchEvent(ev) {{
      ev.target = ev.target || el;
      ev.preventDefault = ev.preventDefault || (() => {{}});
      (listeners[ev.type] || []).forEach((fn) => fn(ev));
    }},
    click() {{ this.dispatchEvent({{ type: "click", target: el }}); }},
    focus(opts) {{ env.lastFocused = el.id || el.tagName; env.lastFocusOpts = opts || null; }},
    querySelector(sel) {{
      if (sel === "input") return this.children.find((c) => c.tagName === "INPUT") || null;
      if (sel === ".chart-stage-sm") return this.children.find((c) => c.classList && c.classList.contains("chart-stage-sm")) || null;
      return null;
    }},
    querySelectorAll(sel) {{
      if (sel === ".chart-stage-sm") return this.children.filter((c) => c.classList && c.classList.contains("chart-stage-sm"));
      return [];
    }},
    getBoundingClientRect() {{
      return {{
        top: this._docTop - env.window.scrollY,
        bottom: this._docTop + this._height - env.window.scrollY,
        left: 0,
        right: this._width,
        width: this._width,
        height: this._height,
      }};
    }},
    getContext() {{
      return new Proxy({{}}, {{
        get(t, prop) {{
          if (prop === "createLinearGradient") return () => ({{ addColorStop() {{}} }});
          return () => {{}};
        }},
        set() {{ return true; }}
      }});
    }},
    width: 600,
    height: 300,
  }};
  Object.keys(attrs).forEach((k) => {{
    if (k.startsWith("data-")) {{
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      el.dataset[camel] = attrs[k];
    }}
  }});
  return el;
}}

let nowMs = 10000;
let nextTimerId = 1;
const timers = new Map();
const env = {{
  lastFocused: null,
  lastFocusOpts: null,
  scrollCalls: [],
  reducedMotion: false,
}};

const byId = new Map();
const allEls = [];
function reg(el) {{
  if (el.id) byId.set(el.id, el);
  allEls.push(el);
  return el;
}}

// Register required DOM skeleton matching docs/index.html
["banner-end-date","banner-last-close","banner-count","kpi-close","kpi-close-sub",
 "kpi-ath","kpi-ath-sub","kpi-days","kpi-span-sub","kpi-baseline-rmse","kpi-baseline-sub",
 "kpi-rsi","kpi-rsi-sub","ind-tbl-rsi","ind-tbl-ema20","ind-tbl-ema50","ind-tbl-macd",
 "ind-tbl-sig","ind-tbl-obv","yearly-table-body","run-toggles","historical-summary-list",
 "sb-date","ro-date","ro-open","ro-high","ro-low","ro-close","ro-vol","ro-ema20","ro-ema50",
 "overview-scrubber-label","iro-date","iro-close","iro-rsi","iro-macd","iro-sig","iro-obv",
 "loss-readout","sb-threshold-val","sb-drift-val","sb-swing-val","sb-signal-banner",
 "sb-signal-code","sb-signal-msg","sb-rule-trace","tutorialStepBadge","tutorialStateBadge",
 "tutorialStageTitle","tutorialNarration","tutorialProgress","tutorialProgressFill","srAnnouncer"
].forEach((id) => reg(makeEl("div", id)));

const btnWatch = reg(makeEl("button", "btnWatchTutorial", ["btn-tutorial"]));
const dock = reg(makeEl("section", "tutorialDock", ["tutorial-dock"]));
dock.hidden = true;
dock._docTop = 260;
dock._height = 96;
dock.getBoundingClientRect = function () {{
  const top = Math.max(8, this._docTop - env.window.scrollY);
  return {{ top, bottom: top + this._height, left: 0, right: this._width, width: this._width, height: this._height }};
}};
const btnPrev = reg(makeEl("button", "btnTutPrev", ["tut-btn"]));
const btnPlay = reg(makeEl("button", "btnTutPlayPause", ["tut-btn"]));
const btnNext = reg(makeEl("button", "btnTutNext", ["tut-btn"]));
const btnRestart = reg(makeEl("button", "btnTutRestart", ["tut-btn"]));
const btnExit = reg(makeEl("button", "btnTutExit", ["tut-btn"]));
[btnPrev, btnPlay, btnNext, btnRestart, btnExit].forEach((b) => dock.appendChild(b));

const mainEl = reg(makeEl("main", "main-content"));
const tabNames = ["overview", "indicators", "research", "sandbox", "inspector"];
const tabBtns = tabNames.map((t, i) => reg(makeEl("button", "tab-" + t, i === 0 ? ["tab-btn", "active"] : ["tab-btn"], {{ "data-tab": t }})));
const tabPanels = tabNames.map((t, i) => {{
  const p = reg(makeEl("section", "panel-" + t, i === 0 ? ["tab-panel", "active"] : ["tab-panel"]));
  p.hidden = i !== 0;
  return p;
}});

// Stage targets with realistic vertical positions
const targets = {{
  "overview-kpis": {{ top: 372, h: 112 }},
  "overview-chart-card": {{ top: 502, h: 640 }},
  "overview-chart-stage": {{ top: 760, h: 220 }},
  "indicators-chart-card": {{ top: 372, h: 920 }},
  "ind-block-rsi": {{ top: 520, h: 210 }},
  "ind-block-macd": {{ top: 750, h: 210 }},
  "ind-block-obv": {{ top: 980, h: 210 }},
  "research-chart-card": {{ top: 446, h: 520 }},
  "research-chart-stage": {{ top: 680, h: 210 }},
  "research-comparison-grid": {{ top: 980, h: 740 }},
  "research-archival-card": {{ top: 1380, h: 320 }},
  "sandbox-grid": {{ top: 446, h: 920 }},
  "sandbox-inputs-card": {{ top: 446, h: 520 }},
  "sandbox-result-card": {{ top: 984, h: 380 }},
  "inspector-arch-grid": {{ top: 372, h: 780 }},
  "inspector-arch-card": {{ top: 760, h: 380 }},
  "inspector-gates-card": {{ top: 1180, h: 260 }},
}};
Object.entries(targets).forEach(([id, g]) => {{
  const el = reg(makeEl("article", id, ["panel-card"]));
  el._docTop = g.top;
  el._height = g.h;
  mainEl.appendChild(el);
}});
// Give key readouts & banners realistic stacked mobile geometry
const overviewReadout = reg(makeEl("div", "overview-readout"));
overviewReadout._docTop = 660;
overviewReadout._height = 84;
const sbBanner = byId.get("sb-signal-banner");
sbBanner._docTop = 1040;
sbBanner._height = 128;
const presetRow = reg(makeEl("div", "", ["preset-row"]));
presetRow._docTop = 870;
presetRow._height = 74;

// Canvases with parent boxes
["chart-overview", "chart-rsi", "chart-macd", "chart-obv", "chart-training", "chart-sandbox"].forEach((id) => {{
  const wrap = makeEl("div", "", ["chart-stage"]);
  wrap._width = 960;
  wrap._height = 360;
  const cv = reg(makeEl("canvas", id));
  wrap.appendChild(cv);
}});

// Controls
const rangeBtns = ["3M","1Y","3Y","5Y","ALL"].map((r) => reg(makeEl("button", "", r === "1Y" ? ["seg-btn","active"] : ["seg-btn"], {{ "data-range": r }})));
const indRangeBtns = ["3M","1Y","3Y","5Y","ALL"].map((r) => reg(makeEl("button", "", r === "1Y" ? ["seg-btn","active"] : ["seg-btn"], {{ "data-ind-range": r }})));
["toggle-ema20","toggle-ema50","toggle-split"].forEach((id) => {{ const c = reg(makeEl("input", id)); c.checked = true; }});
reg(makeEl("input", "overview-scrubber"));
["sb-threshold","sb-drift","sb-swing"].forEach((id) => reg(makeEl("input", id)));
const sbPresets = ["bull","flat","bear"].map((p) => reg(makeEl("button", "", ["btn-chip"], {{ "data-sb-preset": p }})));

const winListeners = {{}};
const docListeners = {{}};
const vvListeners = {{}};

const body = makeEl("body");
const rootCssVars = {{}};
const docEl = {{
  scrollHeight: 2400,
  style: {{
    setProperty(k, v) {{ rootCssVars[k] = String(v); }},
    removeProperty(k) {{ delete rootCssVars[k]; }},
    getPropertyValue(k) {{ return rootCssVars[k] || ""; }},
  }},
}};
const overviewControls = reg(makeEl("div", "mock-overview-controls", ["controls-group"]));
overviewControls._docTop = 530;
overviewControls._height = 32;
const overviewScrubberRow = reg(makeEl("div", "mock-scrubber-row", ["scrubber-row"]));
overviewScrubberRow._docTop = 1000;
overviewScrubberRow._height = 22;
const overviewScrubberLabel = byId.get("overview-scrubber-label");
overviewScrubberLabel._docTop = 1000;
overviewScrubberLabel._height = 20;
const indStagesMock = [0, 1, 2].map((i) => {{
  const st = makeEl("div", "", ["chart-stage", "chart-stage-sm"]);
  st._height = 188;
  byId.get("indicators-chart-card").appendChild(st);
  return st;
}});
const sbStageMock = makeEl("div", "", ["chart-stage", "chart-stage-sm"]);
sbStageMock._docTop = 1180;
sbStageMock._height = 188;
byId.get("sandbox-result-card").appendChild(sbStageMock);
const document = {{
  body,
  documentElement: docEl,
  getElementById: (id) => byId.get(id) || null,
  createElement: (tag) => {{
    const el = makeEl(tag);
    // Support run-toggles checkbox creation
    const origDesc = Object.getOwnPropertyDescriptor(el, "innerHTML");
    Object.defineProperty(el, "innerHTML", {{
      get() {{ return origDesc.get.call(this); }},
      set(v) {{
        origDesc.set.call(this, v);
        if (String(v).includes("<input")) {{
          const inp = makeEl("input");
          inp.type = "checkbox";
          inp.checked = true;
          this.appendChild(inp);
        }}
      }}
    }});
    return el;
  }},
  querySelector(sel) {{
    if (sel.startsWith("#") && !sel.includes(" ")) return byId.get(sel.slice(1)) || null;
    if (sel === '[data-sb-preset="bull"]') return sbPresets[0];
    if (sel === ".preset-row") return presetRow;
    if (sel === "#overview-chart-card .controls-group") return overviewControls;
    if (sel === "#overview-chart-card .scrubber-row") return overviewScrubberRow;
    if (sel === "#sandbox-result-card .chart-stage-sm") return sbStageMock;
    if (sel === "#indicators-chart-card .segmented") return indRangeBtns[0];
    return null;
  }},
  querySelectorAll(sel) {{
    if (sel === ".tab-btn") return tabBtns;
    if (sel === ".tab-panel") return tabPanels;
    if (sel === "[data-range]") return rangeBtns;
    if (sel === "[data-ind-range]") return indRangeBtns;
    if (sel === "[data-sb-preset]") return sbPresets;
    if (sel === "#indicators-chart-card .chart-stage-sm") return indStagesMock;
    if (sel === ".tutorial-spotlight") return allEls.filter((e) => e.classList.contains("tutorial-spotlight"));
    if (sel === "#run-toggles input[type='checkbox']") {{
      const rt = byId.get("run-toggles");
      return rt ? rt.children.map((l) => l.querySelector("input")).filter(Boolean) : [];
    }}
    return [];
  }},
  addEventListener(type, fn) {{ (docListeners[type] = docListeners[type] || []).push(fn); }},
  dispatchEvent(ev) {{
    ev.preventDefault = ev.preventDefault || (() => {{}});
    (docListeners[ev.type] || []).forEach((fn) => fn(ev));
  }},
}};

const windowObj = {{
  innerWidth: 1366,
  innerHeight: 768,
  devicePixelRatio: 1,
  scrollY: 0,
  pageYOffset: 0,
  document,
  visualViewport: {{
    addEventListener(type, fn) {{ (vvListeners[type] = vvListeners[type] || []).push(fn); }},
    dispatch(type) {{ (vvListeners[type] || []).forEach((fn) => fn({{ type }})); }},
  }},
  matchMedia(q) {{
    return {{ matches: q.includes("prefers-reduced-motion") ? env.reducedMotion : false }};
  }},
  scrollTo(arg) {{
    const top = typeof arg === "object" ? arg.top : arg;
    const behavior = typeof arg === "object" ? arg.behavior : "auto";
    env.scrollCalls.push({{ top, behavior, at: nowMs }});
    windowObj.scrollY = top;
    windowObj.pageYOffset = top;
    windowObj.dispatchEvent({{ type: "scroll" }});
  }},
  addEventListener(type, fn) {{ (winListeners[type] = winListeners[type] || []).push(fn); }},
  dispatchEvent(ev) {{ (winListeners[ev.type] || []).forEach((fn) => fn(ev)); }},
}};
env.window = windowObj;

const origDateNow = Date.now;
const FakeDate = class extends Date {{
  static now() {{ return nowMs; }}
}};

function setTimeoutFake(fn, ms) {{
  const id = nextTimerId++;
  timers.set(id, {{ fn, runAt: nowMs + Math.max(0, Number(ms) || 0) }});
  return id;
}}
function clearTimeoutFake(id) {{ timers.delete(id); }}
function advanceTime(ms) {{
  const end = nowMs + ms;
  while (true) {{
    let earliest = null;
    for (const [id, t] of timers.entries()) {{
      if (t.runAt <= end && (!earliest || t.runAt < earliest.t.runAt)) {{
        earliest = {{ id, t }};
      }}
    }}
    if (!earliest) break;
    nowMs = earliest.t.runAt;
    timers.delete(earliest.id);
    earliest.t.fn();
  }}
  nowMs = end;
}}

const sandbox = {{
  window: windowObj,
  document,
  Date: FakeDate,
  setTimeout: setTimeoutFake,
  clearTimeout: clearTimeoutFake,
  requestAnimationFrame: (fn) => fn(),
  console,
  Math,
  Number,
  String,
  Array,
  Object,
  Boolean,
  JSON,
  Set,
  Map,
}};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const dataJs = fs.readFileSync({json.dumps(str(DOCS / "data.js"))}, "utf8");
const appJs = fs.readFileSync({json.dumps(str(DOCS / "app.js"))}, "utf8");
vm.runInContext(dataJs, sandbox);
vm.runInContext(appJs, sandbox);

const api = windowObj.__TSLAIQ_TUTORIAL__;
const out = (function() {{
{script_body}
}})();
console.log(JSON.stringify(out));
"""
    res = subprocess.run(["node", "-e", harness], capture_output=True, text=True)
    if res.returncode != 0:
        raise AssertionError(f"Node harness failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}")
    return json.loads(res.stdout.strip().splitlines()[-1])


class TSLAIQTutorialTests(unittest.TestCase):
    def test_html_and_css_tutorial_contract_preserves_five_tabs_and_disclosures(self):
        html = (DOCS / "index.html").read_text(encoding="utf-8")
        css = (DOCS / "styles.css").read_text(encoding="utf-8")

        for tab_id in ("tab-overview", "tab-indicators", "tab-research", "tab-sandbox", "tab-inspector"):
            self.assertIn(f'id="{tab_id}"', html)
        for req_id in (
            "btnWatchTutorial",
            "tutorialDock",
            "tutorialStepBadge",
            "tutorialStateBadge",
            "tutorialStageTitle",
            "btnTutPrev",
            "btnTutPlayPause",
            "btnTutNext",
            "btnTutRestart",
            "btnTutExit",
            "tutorialProgress",
            "tutorialNarration",
            "overview-kpis",
            "overview-chart-card",
            "indicators-chart-card",
            "research-chart-card",
            "research-comparison-grid",
            "sandbox-grid",
            "inspector-arch-grid",
            "inspector-gates-card",
        ):
            self.assertIn(f'id="{req_id}"', html)

        # No artificial phone frame introduced for desktop dashboard
        self.assertNotIn("phone-bezel", html)
        self.assertNotIn("phone-scale-box", css)

        # Synthetic & honest archival disclosures preserved
        self.assertIn("100% SYNTHETIC DATA", html)
        self.assertIn("Archival Private Research Summary", html)
        self.assertIn("NOT TRAINED", html)

    def test_tutorial_lifecycle_playthrough_controls_pause_and_cleanup(self):
        out = _run_node_harness(
            """
            const result = {};
            btnWatch.click();
            result.stage0 = api.getState();

            // Advance into Stage 2 (overview-chart): subAction switches 1Y -> 3Y at 1500ms
            advanceTime(3700);
            result.stage1BeforeSub = api.getState();
            advanceTime(1600);
            result.stage1AfterSub = api.getState();

            // Advance to Stage 3 (overview-scrub) and immediately PAUSE before 1400ms subAction!
            advanceTime(2700);
            result.stage2Entered = api.getState();
            btnPlay.click(); // Pause
            advanceTime(5000);
            result.stage2AfterPauseWait = api.getState();

            // Resume -> runs Stage 3 subAction (peak close scrub) and plays all the way to finish
            btnPlay.click();
            advanceTime(1500);
            result.stage2AfterResumeSub = api.getState();
            result.peakDateReadout = byId.get("ro-date").textContent;

            // Step through remaining stages up to Sandbox (Stage 7, index 6) and let subAction trigger bull preset
            btnNext.click(); // Stage 4 indicators
            result.stage3 = api.getState();
            btnNext.click(); // Stage 5 benchmarks
            result.stage4 = api.getState();
            btnNext.click(); // Stage 6 archival-research
            result.stage5 = api.getState();
            btnNext.click(); // Stage 7 sandbox (paused)
            result.stage6Paused = api.getState();
            btnPlay.click(); // Resume so bull preset fires
            advanceTime(1600);
            result.stage6AfterBull = api.getState();

            // Step to Stage 8 inspector, then Stage 9 finish
            btnNext.click(); // Stage 8
            result.stage7 = api.getState();
            btnNext.click(); // Stage 9 finish
            result.stage8Finish = api.getState();
            result.finishPlayLabel = btnPlay.textContent;

            // Replay from finish -> restarts at stage 0 playing
            btnPlay.click();
            result.afterReplay = api.getState();

            // Manual tab click while playing pauses tutorial safely
            tabBtns[2].click();
            result.afterManualTabClick = api.getState();

            // Escape exits cleanly and cancels all timers
            document.dispatchEvent({ type: "keydown", key: "Escape" });
            advanceTime(10000);
            result.afterEscape = api.getState();
            result.dockHiddenAfterEscape = dock.hidden;
            result.remainingTimers = timers.size;
            return result;
            """
        )

        self.assertTrue(out["stage0"]["active"])
        self.assertEqual(out["stage0"]["stageId"], "intro-provenance")
        self.assertEqual(out["stage0"]["totalStages"], 9)

        self.assertEqual(out["stage1BeforeSub"]["stageId"], "overview-chart")
        self.assertEqual(out["stage1BeforeSub"]["overviewRange"], "1Y")
        self.assertEqual(out["stage1AfterSub"]["overviewRange"], "3Y")
        self.assertTrue(out["stage1AfterSub"]["subActionDone"])

        # Pause BEFORE subDelayMs must block scheduled subAction and leave zero pending timers
        self.assertEqual(out["stage2Entered"]["stageId"], "overview-scrub")
        self.assertFalse(out["stage2AfterPauseWait"]["playing"])
        self.assertFalse(out["stage2AfterPauseWait"]["subActionDone"])
        self.assertFalse(out["stage2AfterPauseWait"]["hasPendingTimers"])
        self.assertIsNone(out["stage2AfterPauseWait"]["overviewHoverIdx"])

        # Resuming triggers peak close scrub (2025-03-20)
        self.assertTrue(out["stage2AfterResumeSub"]["subActionDone"])
        self.assertEqual(out["peakDateReadout"], "2025-03-20")

        # Sandbox real preset transitions BEKLE -> AL
        self.assertEqual(out["stage6Paused"]["stageId"], "sandbox")
        self.assertEqual(out["stage6Paused"]["sandboxSignal"], "BEKLE")
        self.assertEqual(out["stage6AfterBull"]["sandboxSignal"], "AL")
        self.assertEqual(out["stage6AfterBull"]["sandboxDrift"], 7.0)

        # Finish stage & Replay & Manual-tab pause & Escape exit
        self.assertEqual(out["stage8Finish"]["stageId"], "finish")
        self.assertTrue(out["stage8Finish"]["completed"])
        self.assertEqual(out["finishPlayLabel"], "Replay")
        self.assertEqual(out["afterReplay"]["stageId"], "intro-provenance")
        self.assertTrue(out["afterReplay"]["playing"])
        self.assertFalse(out["afterManualTabClick"]["playing"])
        self.assertFalse(out["afterEscape"]["active"])
        self.assertTrue(out["dockHiddenAfterEscape"])
        self.assertEqual(out["remainingTimers"], 0)

    def test_responsive_workspace_positioning_and_resize_scroll_discrimination(self):
        out = _run_node_harness(
            """
            const chain = [
              [1366, 768], [1280, 768], [1024, 768], [960, 768], [800, 900],
              [390, 844], [430, 844], [390, 800], [1366, 768], [1440, 900]
            ];
            btnWatch.click();
            btnNext.click(); // overview-chart (paused)
            advanceTime(800);

            const steps = [];
            for (const [w, h] of chain) {
              // Simulate browser firing scroll anchoring BEFORE resize event
              windowObj.innerWidth = w;
              windowObj.innerHeight = h;
              windowObj.scrollY = Math.max(0, windowObj.scrollY - 60);
              windowObj.dispatchEvent({ type: "scroll" });
              windowObj.dispatchEvent({ type: "resize" });
              windowObj.visualViewport.dispatch("resize");
              advanceTime(250);
              steps.push({ w, h, userAway: api.getState().userScrolledAway, scrollY: windowObj.scrollY });
            }

            // Now simulate genuine user wheel scroll away from guided position
            advanceTime(600);
            windowObj.dispatchEvent({ type: "wheel" });
            windowObj.scrollY = 0;
            windowObj.dispatchEvent({ type: "scroll" });
            const afterWheel = api.getState().userScrolledAway;

            // Resize must preserve genuine manual scroll opt-out
            windowObj.innerWidth = 390;
            windowObj.innerHeight = 844;
            windowObj.dispatchEvent({ type: "resize" });
            advanceTime(250);
            const afterResizeWithOptOut = api.getState().userScrolledAway;

            // Restart resets opt-out and re-positions
            btnRestart.click();
            advanceTime(300);
            const afterRestart = api.getState().userScrolledAway;

            return { steps, afterWheel, afterResizeWithOptOut, afterRestart };
            """
        )
        self.assertEqual(len(out["steps"]), 10)
        self.assertTrue(all(s["userAway"] is False for s in out["steps"]))
        self.assertTrue(out["afterWheel"])
        self.assertTrue(out["afterResizeWithOptOut"])
        self.assertFalse(out["afterRestart"])

    def test_reduced_motion_mode_completes_cleanly(self):
        out = _run_node_harness(
            """
            env.reducedMotion = true;
            btnWatch.click();
            const behaviors = env.scrollCalls.map((c) => c.behavior);
            // Walk full reduced-motion autoplay to completion
            advanceTime(20000);
            return {
              behaviors,
              finalState: api.getState(),
              remainingTimers: timers.size,
            };
            """
        )
        self.assertTrue(all(b == "auto" for b in out["behaviors"]))
        self.assertTrue(out["finalState"]["completed"])
        self.assertEqual(out["finalState"]["stageId"], "finish")
        self.assertFalse(out["finalState"]["hasPendingTimers"])
        self.assertEqual(out["remainingTimers"], 0)

    def test_stage_specific_content_visibility_on_mobile_and_compact_viewports(self):
        out = _run_node_harness(
            """
            // 1. Mobile 390x844 Stage 7 Sandbox: initially shows inputs, then guides to #sb-signal-banner on BEKLE -> AL
            windowObj.innerWidth = 390;
            windowObj.innerHeight = 844;
            dock._height = 200;
            btnWatch.click();
            for (let i = 0; i < 6; i++) btnNext.click(); // Stage 7 sandbox (paused)
            const s7Before = {
              focus: api.getState().resolvedFocusSelector,
              signal: api.getState().sandboxSignal,
              scrollY: windowObj.scrollY,
            };
            btnPlay.click(); // resume Stage 7
            advanceTime(1500);
            const s7After = {
              focus: api.getState().resolvedFocusSelector,
              signal: api.getState().sandboxSignal,
              scrollY: windowObj.scrollY,
              bannerTopInViewport: sbBanner.getBoundingClientRect().top,
              bannerBottomInViewport: sbBanner.getBoundingClientRect().bottom,
            };

            // 2. Manual scroll opt-out prevents Stage 4 sequential indicator scrolling from hijacking user
            btnPrev.click(); btnPrev.click(); btnPrev.click(); // Stage 4 indicators (paused)
            advanceTime(700);
            windowObj.dispatchEvent({ type: "wheel" });
            windowObj.scrollY = 120;
            windowObj.dispatchEvent({ type: "scroll" });
            const scrollBeforePlay = windowObj.scrollY;
            btnPlay.click();
            advanceTime(3200);
            const s4WithOptOut = {
              userAway: api.getState().userScrolledAway,
              scrollY: windowObj.scrollY,
              unchanged: windowObj.scrollY === scrollBeforePlay,
            };

            // 3. Stage 4 without opt-out sequentially reveals RSI -> MACD -> OBV, and Pause cancels OBV timer
            btnRestart.click();
            for (let i = 0; i < 3; i++) btnNext.click(); // Stage 4 indicators (paused)
            const s4InitialFocus = api.getState().resolvedFocusSelector;
            const s4RsiBottom = byId.get("ind-block-rsi").getBoundingClientRect().bottom;
            btnPlay.click();
            advanceTime(1500);
            const s4MacdFocus = api.getState().resolvedFocusSelector;
            btnPlay.click(); // Pause BEFORE OBV secondSubDelayMs (2900ms)!
            advanceTime(3000);
            const s4PausedBeforeObv = {
              focus: api.getState().resolvedFocusSelector,
              hasPendingTimers: api.getState().hasPendingTimers,
            };
            btnPlay.click(); // Resume -> runs OBV focus
            advanceTime(3000);
            const s4AfterObvFocus = api.getState().resolvedFocusSelector;

            // 4. Compact 320x480 Stage 2 aligns directly to chart/readout rather than clipping canvas below fold
            btnRestart.click();
            windowObj.innerWidth = 320;
            windowObj.innerHeight = 480;
            dock._height = 148;
            btnNext.click(); // Stage 2 overview-chart
            const s2Compact = {
              focus: api.getState().resolvedFocusSelector,
              canvasTop: byId.get("overview-chart-stage").getBoundingClientRect().top,
            };

            // 5. Stacked Stage 6 archival-research targets #research-archival-card directly
            for (let i = 0; i < 4; i++) btnNext.click(); // Stage 6 archival-research
            const s6CompactFocus = api.getState().resolvedFocusSelector;

            btnExit.click();
            return {
              s7Before, s7After, s4WithOptOut, s4InitialFocus, s4RsiBottom, s4MacdFocus,
              s4PausedBeforeObv, s4AfterObvFocus, s2Compact, s6CompactFocus,
              remainingTimers: timers.size,
            };
            """
        )

        self.assertEqual(out["s7Before"]["focus"], "#sandbox-inputs-card")
        self.assertEqual(out["s7Before"]["signal"], "BEKLE")
        self.assertEqual(out["s7After"]["focus"], "#sb-signal-banner")
        self.assertEqual(out["s7After"]["signal"], "AL")
        self.assertGreater(out["s7After"]["scrollY"], out["s7Before"]["scrollY"])
        self.assertGreaterEqual(out["s7After"]["bannerTopInViewport"], 200)
        self.assertLessEqual(out["s7After"]["bannerBottomInViewport"], 844)

        self.assertTrue(out["s4WithOptOut"]["userAway"])
        self.assertTrue(out["s4WithOptOut"]["unchanged"])

        self.assertIn(out["s4InitialFocus"], ("#indicators-chart-card", "#ind-block-rsi"))
        self.assertLessEqual(out["s4RsiBottom"], 844)
        self.assertEqual(out["s4MacdFocus"], "#ind-block-macd")
        self.assertEqual(out["s4PausedBeforeObv"]["focus"], "#ind-block-macd")
        self.assertFalse(out["s4PausedBeforeObv"]["hasPendingTimers"])
        self.assertEqual(out["s4AfterObvFocus"], "#ind-block-obv")

        self.assertIn(out["s2Compact"]["focus"], ("#overview-readout", "#overview-chart-stage"))
        self.assertLess(out["s2Compact"]["canvasTop"], 400)
        self.assertEqual(out["s6CompactFocus"], "#research-archival-card")
        self.assertEqual(out["remainingTimers"], 0)

    def test_adaptive_viewport_fitting_indicators_stack_and_exit_restoration(self):
        out = _run_node_harness(
            """
            // Configure realistic desktop card overheads for adaptive layout math
            const ovCard = byId.get("overview-chart-card");
            const ovStage = byId.get("overview-chart-stage");
            ovCard._docTop = 470;
            ovCard._height = 494; // 138px chrome + 356px stage
            ovStage._docTop = 580;
            ovStage._height = 356;

            const indCard = byId.get("indicators-chart-card");
            indCard._docTop = 470;
            indCard._height = 733; // 169px chrome + 3 * 188px stages

            windowObj.innerWidth = 1280;
            windowObj.innerHeight = 650;
            dock._height = 80;

            btnWatch.click(); // Stage 1 intro-provenance
            const s1 = {
              density: body.dataset.tutorialDensity,
              kpisMode: body.dataset.tutorialKpis,
              stageAttr: body.dataset.tutorialStage,
            };

            // Stage 2 overview-chart at 1280x650: compact density, KPIs collapsed, price chart adapted
            btnNext.click();
            const s2Compact650 = {
              density: body.dataset.tutorialDensity,
              kpisMode: body.dataset.tutorialKpis,
              priceVar: rootCssVars["--tut-price-chart-h"],
              adaptive: api.getState().adaptiveLayout,
            };

            // Height-only resize down to 1280x540 -> price chart shrinks proportionally below 356px without opt-out
            windowObj.innerHeight = 540;
            windowObj.dispatchEvent({ type: "resize" });
            advanceTime(250);
            const s2Tight540 = {
              density: body.dataset.tutorialDensity,
              priceVar: rootCssVars["--tut-price-chart-h"],
              priceH: api.getState().adaptiveLayout.priceChartH,
              userAway: api.getState().userScrolledAway,
            };

            // Tall desktop 1440x900 -> standard density, KPIs in ribbon mode, full 356px chart
            windowObj.innerWidth = 1440;
            windowObj.innerHeight = 900;
            dock._height = 97;
            windowObj.dispatchEvent({ type: "resize" });
            advanceTime(250);
            const s2Tall900 = {
              density: body.dataset.tutorialDensity,
              kpisMode: body.dataset.tutorialKpis,
              priceH: api.getState().adaptiveLayout.priceChartH,
            };

            // Stage 4 indicators at 1280x650 -> simultaneous 3-indicator stack enabled (per-chart >= 112px)
            windowObj.innerWidth = 1280;
            windowObj.innerHeight = 650;
            dock._height = 80;
            btnNext.click(); // Stage 3
            btnNext.click(); // Stage 4 indicators
            const s4Desktop650 = {
              indVar: rootCssVars["--tut-ind-chart-h"],
              indH: api.getState().adaptiveLayout.indChartH,
              simultaneous: api.getState().adaptiveLayout.indicatorsSimultaneous,
            };

            // Narrow mobile 390x844 -> simultaneous disabled so sequential RSI->MACD->OBV takes over
            windowObj.innerWidth = 390;
            windowObj.innerHeight = 844;
            dock._height = 220;
            windowObj.dispatchEvent({ type: "resize" });
            advanceTime(250);
            const s4Mobile = {
              simultaneous: api.getState().adaptiveLayout.indicatorsSimultaneous,
              indH: api.getState().adaptiveLayout.indChartH,
            };

            // Exit restores original layout and removes all tutorial attributes and CSS custom properties
            btnExit.click();
            const afterExit = {
              activeClass: body.classList.contains("tutorial-active"),
              datasetKeys: Object.keys(body.dataset).filter((k) => k.startsWith("tutorial")),
              cssVarsRemaining: Object.keys(rootCssVars),
              remainingTimers: timers.size,
            };

            return { s1, s2Compact650, s2Tight540, s2Tall900, s4Desktop650, s4Mobile, afterExit };
            """
        )

        self.assertEqual(out["s1"]["density"], "compact")
        self.assertEqual(out["s1"]["kpisMode"], "full")
        self.assertEqual(out["s1"]["stageAttr"], "intro-provenance")

        self.assertEqual(out["s2Compact650"]["density"], "compact")
        self.assertEqual(out["s2Compact650"]["kpisMode"], "collapsed")
        self.assertEqual(out["s2Compact650"]["priceVar"], "356px")

        self.assertEqual(out["s2Tight540"]["density"], "tight")
        self.assertLess(out["s2Tight540"]["priceH"], 356)
        self.assertGreaterEqual(out["s2Tight540"]["priceH"], 184)
        self.assertFalse(out["s2Tight540"]["userAway"])

        self.assertEqual(out["s2Tall900"]["density"], "standard")
        self.assertEqual(out["s2Tall900"]["kpisMode"], "ribbon")
        self.assertEqual(out["s2Tall900"]["priceH"], 356)

        self.assertTrue(out["s4Desktop650"]["simultaneous"])
        self.assertGreaterEqual(out["s4Desktop650"]["indH"], 112)
        self.assertLessEqual(out["s4Desktop650"]["indH"], 188)
        self.assertEqual(out["s4Desktop650"]["indVar"], f"{out['s4Desktop650']['indH']}px")

        self.assertFalse(out["s4Mobile"]["simultaneous"])
        self.assertEqual(out["s4Mobile"]["indH"], 186)

        self.assertFalse(out["afterExit"]["activeClass"])
        self.assertEqual(out["afterExit"]["datasetKeys"], [])
        self.assertEqual(out["afterExit"]["cssVarsRemaining"], [])
        self.assertEqual(out["afterExit"]["remainingTimers"], 0)

    def test_visibility_acceptance_rejects_partial_clipping_and_stale_stage1_scroll(self):
        out = _run_node_harness(
            """
            // Reproduce owner Stage 3 1280x650 scenario: chart card fits within availH once scrolled,
            // but Stage 1 leaves scrollY positioned so KPIs sit above and canvas/scrubber extend below 650px.
            windowObj.innerWidth = 1280;
            windowObj.innerHeight = 650;
            dock._height = 80;

            const ovCard = byId.get("overview-chart-card");
            const ovStage = byId.get("overview-chart-stage");
            ovCard._docTop = 520;
            ovCard._height = 492;
            overviewControls._docTop = 532;
            overviewControls._height = 32;
            overviewReadout._docTop = 572;
            overviewReadout._height = 30;
            ovStage._docTop = 610;
            ovStage._height = 356;
            overviewScrubberRow._docTop = 974;
            overviewScrubberRow._height = 22;
            overviewScrubberLabel._docTop = 974;
            overviewScrubberLabel._height = 20;

            btnWatch.click(); // Stage 1 (scrolls to KPIs)
            const s1ScrollY = windowObj.scrollY;
            btnNext.click();  // Stage 2
            btnNext.click();  // Stage 3 overview-scrub
            const s3State = api.getState();

            return {
              s1ScrollY,
              s3ScrollY: windowObj.scrollY,
              resolvedFocus: s3State.resolvedFocusSelector,
              reqVis: s3State.requiredVisibility,
              scrubberBottom: overviewScrubberRow.getBoundingClientRect().bottom,
              canvasBottom: ovStage.getBoundingClientRect().bottom,
            };
            """
        )

        self.assertGreater(out["s3ScrollY"], out["s1ScrollY"])
        self.assertEqual(out["resolvedFocus"], "#overview-chart-card")
        self.assertTrue(out["reqVis"]["allFullyVisible"])
        self.assertLessEqual(out["canvasBottom"], 650)
        self.assertLessEqual(out["scrubberBottom"], 650)


if __name__ == "__main__":
    unittest.main(verbosity=2)
