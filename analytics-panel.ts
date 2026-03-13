import {
  esc,
  featureImportanceData,
  setFeatureImportanceData,
  brierDecompData,
  setBrierDecompData,
  abTestData,
  setAbTestData,
  prRocData,
  setPrRocData,
  rollingErrorData,
  setRollingErrorData,
} from "./state.js";
import type {
  BacktestApiResult,
  BacktestCategorySummary,
  BacktestYearRow,
  BacktestOverall,
  FeatureImportanceData,
  BrierDecompData,
  AbTestData,
  PrRocData,
  RollingErrorData,
} from "./state.js";
import {
  backtestStatus,
  backtestOverview,
  backtestStatGrid,
  backtestCategoryBody,
  backtestYearBody,
  backtestCategoryFilter,
} from "./render.js";

// ── Backtest category labels ───────────────────────────────────────────────────

const BACKTEST_CATEGORY_LABELS: Record<string, string> = {
  "picture": "Best Picture",
  "director": "Best Director",
  "actor": "Best Actor",
  "actress": "Best Actress",
  "supporting-actor": "Best Supporting Actor",
  "supporting-actress": "Best Supporting Actress"
};

const BACKTEST_CAT_LABELS: Record<string, string> = {
  "picture":           "Best Picture",
  "director":          "Best Director",
  "actor":             "Best Actor",
  "actress":           "Best Actress",
  "supporting-actor":  "Best Supporting Actor",
  "supporting-actress":"Best Supporting Actress",
};

// ── SVG dimensions for PR/ROC charts ─────────────────────────────────────────

const PR_W = 300, PR_H = 280;
const PR_PAD = { top: 10, right: 16, bottom: 44, left: 44 };
const PR_IW = PR_W - PR_PAD.left - PR_PAD.right;
const PR_IH = PR_H - PR_PAD.top  - PR_PAD.bottom;

// ── SVG dimensions for Rolling Error charts ──────────────────────────────────

const RE_W = 420, RE_H = 240;
const RE_PAD = { top: 14, right: 20, bottom: 46, left: 54 };
const RE_IW = RE_W - RE_PAD.left - RE_PAD.right;
const RE_IH = RE_H - RE_PAD.top  - RE_PAD.bottom;

// Suppress unused-variable warnings for the dimension consts that are only
// used implicitly through the scale helpers below.
void PR_W; void PR_H; void RE_W; void RE_H;

// ── Backtest rendering ────────────────────────────────────────────────────────

export function renderBacktestStatGrid(overall: BacktestOverall): void {
  if (!backtestStatGrid) return;
  const stats = [
    {
      label: "Nom. Accuracy",
      value: `${(overall.nominationAccuracyAvg * 100).toFixed(1)}%`,
      sub: "avg across categories"
    },
    {
      label: "Winner Accuracy",
      value: `${overall.winnerAccuracyPct.toFixed(1)}%`,
      sub: "top pick = actual winner"
    },
    {
      label: "Nom. Brier Score",
      value: overall.nominationBrierAvg.toFixed(3),
      sub: "lower is better"
    },
    {
      label: "Win. Brier Score",
      value: overall.winnerBrierAvg.toFixed(3),
      sub: "lower is better"
    }
  ];
  backtestStatGrid.innerHTML = stats
    .map(
      (s) => `<div class="backtest-stat-card">
        <span class="backtest-stat-label">${s.label}</span>
        <span class="backtest-stat-value">${s.value}</span>
        <span class="backtest-stat-sub">${s.sub}</span>
      </div>`
    )
    .join("");
}

export function renderBacktestCategoryTable(cats: BacktestCategorySummary[]): void {
  if (!backtestCategoryBody) return;
  backtestCategoryBody.innerHTML = cats
    .map((cat) => {
      const label = BACKTEST_CATEGORY_LABELS[cat.categoryId] ?? cat.categoryId;
      return `<tr>
        <td>${label}</td>
        <td class="backtest-num">${(cat.nominationAccuracyAvg * 100).toFixed(1)}%</td>
        <td class="backtest-num">${cat.winnerAccuracyPct.toFixed(1)}%</td>
        <td class="backtest-num">${cat.nominationBrierAvg.toFixed(3)}</td>
        <td class="backtest-num">${cat.winnerBrierAvg.toFixed(3)}</td>
      </tr>`;
    })
    .join("");
}

export function renderBacktestYearTable(rows: BacktestYearRow[], filterCategoryId: string): void {
  if (!backtestYearBody) return;
  const filtered = filterCategoryId === "all"
    ? rows
    : rows.filter((r) => r.categoryId === filterCategoryId);
  if (filtered.length === 0) {
    backtestYearBody.innerHTML = `<tr><td class="results-empty" colspan="5">No data for selected category.</td></tr>`;
    return;
  }
  backtestYearBody.innerHTML = filtered
    .map((r) => {
      const correctClass = r.winnerCorrect ? "backtest-correct" : "backtest-miss";
      const correctLabel = r.winnerCorrect ? "✓" : "✗";
      return `<tr>
        <td>${r.year}</td>
        <td>${esc(r.topPredicted)}</td>
        <td>${esc(r.actualWinner)}</td>
        <td class="backtest-num">${(r.nominationAccuracy * 100).toFixed(1)}%</td>
        <td class="backtest-num ${correctClass}">${correctLabel}</td>
      </tr>`;
    })
    .join("");
}

export function populateBacktestFilter(cats: BacktestCategorySummary[]): void {
  if (!backtestCategoryFilter) return;
  backtestCategoryFilter.innerHTML =
    `<option value="all">All Categories</option>` +
    cats
      .map((cat) => {
        const label = BACKTEST_CATEGORY_LABELS[cat.categoryId] ?? cat.categoryId;
        return `<option value="${cat.categoryId}">${label}</option>`;
      })
      .join("");
}

// ── Brier decomposition ────────────────────────────────────────────────────────

export function renderBrierDecomposition(): void {
  const section  = document.getElementById("brierDecompSection");
  const vizDiv   = document.getElementById("brierDecompViz");
  const catBody  = document.getElementById("brierDecompCatBody");
  if (!section || !vizDiv || !catBody || !brierDecompData) return;

  const w = brierDecompData.winner;
  const unc = w.uncertainty;

  // ── Component bar: each piece shown as % of Uncertainty (the "budget") ──────
  // BS = Unc − Res + Rel, so the bar decomposes as:
  //   Skill portion  = Resolution / Unc
  //   Wasted portion = Reliability / Unc
  //   Base portion   = 1 − skill + wasted  (= BS / Unc)
  const resPct = unc > 0 ? Math.min(100, (w.resolution  / unc) * 100) : 0;
  const relPct = unc > 0 ? Math.min(100, (w.reliability / unc) * 100) : 0;
  const bssPct = Math.max(0, w.bss * 100);

  vizDiv.innerHTML =
    `<div class="bd-headline">` +
      `<span class="bd-bss" title="Brier Skill Score: fraction of climatological uncertainty removed by the model">` +
        `BSS&nbsp;${bssPct.toFixed(1)}%` +
      `</span>` +
      `<span class="bd-bss-sub">skill vs climatology</span>` +
    `</div>` +
    `<div class="bd-bar-section">` +
      `<div class="bd-row">` +
        `<span class="bd-label bd-label--res">Resolution</span>` +
        `<div class="bd-track"><div class="bd-fill bd-fill--res" style="width:${resPct.toFixed(1)}%"></div></div>` +
        `<span class="bd-value">${w.resolution.toFixed(4)} <span class="bd-hint">(↑ better)</span></span>` +
      `</div>` +
      `<div class="bd-row">` +
        `<span class="bd-label bd-label--rel">Reliability</span>` +
        `<div class="bd-track"><div class="bd-fill bd-fill--rel" style="width:${relPct.toFixed(1)}%"></div></div>` +
        `<span class="bd-value">${w.reliability.toFixed(4)} <span class="bd-hint">(↓ better)</span></span>` +
      `</div>` +
      `<div class="bd-row">` +
        `<span class="bd-label">Uncertainty</span>` +
        `<div class="bd-track"><div class="bd-fill bd-fill--unc" style="width:100%"></div></div>` +
        `<span class="bd-value">${w.uncertainty.toFixed(4)} <span class="bd-hint">(fixed)</span></span>` +
      `</div>` +
      `<div class="bd-row">` +
        `<span class="bd-label">Brier Score</span>` +
        `<div class="bd-track"><div class="bd-fill bd-fill--bs" style="width:${Math.min(100, (w.brierScore / unc) * 100).toFixed(1)}%"></div></div>` +
        `<span class="bd-value">${w.brierScore.toFixed(4)}</span>` +
      `</div>` +
    `</div>` +
    `<p class="bd-formula">BS&nbsp;=&nbsp;Reliability&nbsp;−&nbsp;Resolution&nbsp;+&nbsp;Uncertainty` +
      `&nbsp;&nbsp;≡&nbsp;&nbsp;${w.reliability.toFixed(4)}&nbsp;−&nbsp;${w.resolution.toFixed(4)}&nbsp;+&nbsp;${w.uncertainty.toFixed(4)}` +
      `&nbsp;&nbsp;=&nbsp;&nbsp;${w.brierScore.toFixed(4)}</p>`;

  // ── Per-category table ─────────────────────────────────────────────────────
  const catIds = ["picture","director","actor","actress","supporting-actor","supporting-actress"];
  catBody.innerHTML = catIds.map((catId) => {
    const d = brierDecompData!.byCategory[catId]?.winner;
    if (!d) return "";
    const bssClass = d.bss > 0 ? "backtest-correct" : "backtest-miss";
    return (
      `<tr>` +
        `<td>${esc(BACKTEST_CAT_LABELS[catId] ?? catId)}</td>` +
        `<td class="backtest-num">${d.brierScore.toFixed(4)}</td>` +
        `<td class="backtest-num">${d.reliability.toFixed(4)}</td>` +
        `<td class="backtest-num">${d.resolution.toFixed(4)}</td>` +
        `<td class="backtest-num">${d.uncertainty.toFixed(4)}</td>` +
        `<td class="backtest-num ${bssClass}">${(d.bss * 100).toFixed(1)}%</td>` +
      `</tr>`
    );
  }).join("");

  section.hidden = false;
}

// ── Feature importance ─────────────────────────────────────────────────────────

export function renderFeatureImportance(): void {
  const section = document.getElementById("featureImportanceSection");
  const barsDiv = document.getElementById("featureImportanceBars");
  if (!section || !barsDiv || !featureImportanceData) return;

  const { features, baseline } = featureImportanceData;
  const sorted = [...features].sort(
    (a, b) => b.importance.winnerAccuracy.drop - a.importance.winnerAccuracy.drop
  );
  const maxDrop = sorted[0]?.importance.winnerAccuracy.drop ?? 1;

  barsDiv.innerHTML = sorted.map((f) => {
    const imp  = f.importance.winnerAccuracy;
    const drop = imp.drop * 100;
    const std  = imp.std  * 100;
    const barW = maxDrop > 0 ? (imp.drop / maxDrop) * 100 : 0;
    const wPct = (f.weightFraction * 100).toFixed(0);
    const label =
      f.name === "precursor" ? "Precursor Momentum"
      : f.name === "history" ? "Historical Fit"
      : "Buzz";
    // Relative importance ratio (drop / baseline accuracy)
    const relPct = (imp.drop / baseline.winnerAccuracy * 100).toFixed(0);

    return (
      `<div class="fi-row">` +
        `<div class="fi-label">` +
          `<span class="fi-name">${esc(label)}</span>` +
          `<span class="fi-weight">${wPct}% weight</span>` +
        `</div>` +
        `<div class="fi-bar-wrap">` +
          `<div class="fi-bar" style="--fi-w:${barW.toFixed(1)}%"></div>` +
          `<span class="fi-bar-label">` +
            `−${drop.toFixed(1)}% ±${std.toFixed(1)}%` +
            ` <span class="fi-rel">(${relPct}% of baseline)</span>` +
          `</span>` +
        `</div>` +
      `</div>`
    );
  }).join("");

  section.hidden = false;
}

// ── A/B test ───────────────────────────────────────────────────────────────────

export function renderAbTest(): void {
  const section  = document.getElementById("abTestSection");
  const resultEl = document.getElementById("abTestResult");
  const selA     = document.getElementById("abPresetA") as HTMLSelectElement | null;
  const selB     = document.getElementById("abPresetB") as HTMLSelectElement | null;
  if (!section || !resultEl || !selA || !selB || !abTestData) return;

  // Populate selectors once (idempotent — clear + refill)
  const names = abTestData.presets.map(p => p.name);
  if (selA.options.length !== names.length) {
    selA.innerHTML = names.map(n => `<option>${n}</option>`).join("");
    selB.innerHTML = names.map(n => `<option>${n}</option>`).join("");
    // Default: first two presets
    selB.selectedIndex = Math.min(1, names.length - 1);
    selA.addEventListener("change", renderAbTest);
    selB.addEventListener("change", renderAbTest);
  }

  const nameA = selA.value;
  const nameB = selB.value;

  if (nameA === nameB) {
    resultEl.innerHTML = `<p class="ab-same">Select two different presets to compare.</p>`;
    section.hidden = false;
    return;
  }

  // Find pair — may be stored as A vs B or B vs A
  let pair = abTestData.pairwise.find(p => p.a === nameA && p.b === nameB);
  let flipped = false;
  if (!pair) {
    pair = abTestData.pairwise.find(p => p.a === nameB && p.b === nameA);
    flipped = true;
  }
  if (!pair) {
    resultEl.innerHTML = `<p class="ab-same">Pair not found.</p>`;
    section.hidden = false;
    return;
  }

  // Normalise so "A" always refers to the left selector's preset
  const wa = flipped ? pair.winnerAccuracy.bPct   : pair.winnerAccuracy.aPct;
  const wb = flipped ? pair.winnerAccuracy.aPct   : pair.winnerAccuracy.bPct;
  const bsA = flipped ? pair.winnerBrier.bMean     : pair.winnerBrier.aMean;
  const bsB = flipped ? pair.winnerBrier.aMean     : pair.winnerBrier.bMean;
  const bsDelta = bsB - bsA;   // positive → B worse Brier

  const mcP  = pair.winnerAccuracy.mcnemar.pValue;
  const tP   = pair.winnerBrier.pairedT.pValue;
  const wP   = pair.winnerBrier.wilcoxon.pValue;
  const cohenD = flipped
    ? -pair.winnerBrier.pairedT.cohenD
    : pair.winnerBrier.pairedT.cohenD;

  const sig = (p: number) => p < 0.05;

  // Determine verdict
  let verdict = "No statistically significant difference between these presets.";
  let verdictClass = "ab-verdict--tie";
  if (sig(tP) || sig(wP)) {
    if (bsDelta > 0) {
      verdict = `<strong>${nameA}</strong> has significantly lower (better) Brier Score.`;
      verdictClass = "ab-verdict--a";
    } else {
      verdict = `<strong>${nameB}</strong> has significantly lower (better) Brier Score.`;
      verdictClass = "ab-verdict--b";
    }
  }

  const pFmt = (p: number) => p < 0.001 ? "<0.001" : p.toFixed(3);
  const sigBadge = (p: number) => sig(p)
    ? `<span class="ab-sig">✓ sig</span>`
    : `<span class="ab-ns">ns</span>`;

  resultEl.innerHTML = `
    <div class="ab-scorecard">
      <div class="ab-metric">
        <div class="ab-metric-label">Winner Accuracy</div>
        <div class="ab-metric-values">
          <span class="ab-metric-a">${wa.toFixed(1)}%</span>
          <span class="ab-metric-sep">vs</span>
          <span class="ab-metric-b">${wb.toFixed(1)}%</span>
        </div>
        <div class="ab-metric-delta ${(wb - wa) >= 0 ? "ab-delta--pos" : "ab-delta--neg"}">
          Δ ${(wb - wa) >= 0 ? "+" : ""}${(wb - wa).toFixed(1)}pp
        </div>
        <div class="ab-metric-test">McNemar p = ${pFmt(mcP)} ${sigBadge(mcP)}</div>
      </div>
      <div class="ab-metric">
        <div class="ab-metric-label">Winner Brier Score</div>
        <div class="ab-metric-values">
          <span class="ab-metric-a">${bsA.toFixed(5)}</span>
          <span class="ab-metric-sep">vs</span>
          <span class="ab-metric-b">${bsB.toFixed(5)}</span>
        </div>
        <div class="ab-metric-delta ${bsDelta <= 0 ? "ab-delta--pos" : "ab-delta--neg"}">
          Δ ${bsDelta >= 0 ? "+" : ""}${bsDelta.toFixed(5)}
        </div>
        <div class="ab-metric-test">
          t-test p = ${pFmt(tP)} ${sigBadge(tP)} &nbsp;
          Wilcoxon p = ${pFmt(wP)} ${sigBadge(wP)} &nbsp;
          Cohen's d = ${Math.abs(cohenD).toFixed(2)}
        </div>
      </div>
    </div>
    <div class="ab-verdict ${verdictClass}">${verdict}</div>
    <p class="ab-meta">n = ${pair.n} (year, category) pairs · α = ${abTestData.alpha}</p>
  `;
  section.hidden = false;
}

// ── SVG helpers for PR/ROC charts ─────────────────────────────────────────────

export function svgLine(
  points: Array<[number, number]>,
  xScale: (v: number) => number,
  yScale: (v: number) => number,
  cls: string
): string {
  if (points.length < 2) return "";
  const d = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${xScale(x).toFixed(1)},${yScale(y).toFixed(1)}`)
    .join(" ");
  return `<path class="${cls}" d="${d}" fill="none"/>`;
}

export function svgAxes(xLabel: string, yLabel: string): string {
  const ox = PR_PAD.left, oy = PR_PAD.top;
  const bx = ox + PR_IW,  by = oy + PR_IH;
  // Ticks at 0, 0.2, 0.4, 0.6, 0.8, 1.0
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  let s = `<line class="pr-axis" x1="${ox}" y1="${oy}" x2="${ox}" y2="${by}"/>`;
  s    += `<line class="pr-axis" x1="${ox}" y1="${by}" x2="${bx}" y2="${by}"/>`;
  for (const t of ticks) {
    const px = (ox + t * PR_IW).toFixed(1);
    const py = (oy + (1 - t) * PR_IH).toFixed(1);
    s += `<line class="pr-tick" x1="${px}" y1="${by}" x2="${px}" y2="${(+by + 4).toFixed(1)}"/>`;
    s += `<line class="pr-tick" x1="${ox}" y1="${py}" x2="${(+ox - 4).toFixed(1)}" y2="${py}"/>`;
    s += `<text class="pr-tick-lbl" x="${px}" y="${(+by + 14).toFixed(1)}" text-anchor="middle">${t === 0 ? "0" : t === 1 ? "1" : t.toFixed(1)}</text>`;
    s += `<text class="pr-tick-lbl" x="${(+ox - 8).toFixed(1)}" y="${(+py + 4).toFixed(1)}" text-anchor="end">${t === 0 ? "0" : t === 1 ? "1" : t.toFixed(1)}</text>`;
  }
  const midX = (ox + bx) / 2, midY = (oy + by) / 2;
  s += `<text class="pr-axis-lbl" x="${midX.toFixed(1)}" y="${(+by + 34).toFixed(1)}" text-anchor="middle">${xLabel}</text>`;
  s += `<text class="pr-axis-lbl" x="${(-midY).toFixed(1)}" y="${(ox - 28).toFixed(1)}" text-anchor="middle" transform="rotate(-90)">${yLabel}</text>`;
  return s;
}

export function renderPrRocSvg(
  svgId: string,
  overallPoints: Array<[number, number]>,
  baselinePoints: Array<[number, number]>,
  xLabel: string,
  yLabel: string,
  aucLabel: string,
  aucValue: number,
): void {
  const el = document.getElementById(svgId);
  if (!el) return;
  const ox = PR_PAD.left, oy = PR_PAD.top;
  const xS = (v: number) => ox + v * PR_IW;
  const yS = (v: number) => oy + (1 - v) * PR_IH;

  el.innerHTML =
    svgAxes(xLabel, yLabel) +
    svgLine(baselinePoints, xS, yS, "pr-baseline") +
    svgLine(overallPoints,  xS, yS, "pr-curve") +
    `<text class="pr-auc-lbl" x="${(ox + PR_IW - 4).toFixed(1)}" y="${(oy + 18).toFixed(1)}" text-anchor="end">${aucLabel} = ${aucValue.toFixed(4)}</text>`;
}

export function renderPrRoc(): void {
  const section  = document.getElementById("prRocSection");
  const aucRow   = document.getElementById("prAucRow");
  const catBody  = document.getElementById("prRocCatBody");
  if (!section || !aucRow || !catBody || !prRocData) return;

  const { overall, byCategory } = prRocData;

  // AUC badges
  aucRow.innerHTML =
    `<div class="pr-auc-badge">
      <div class="pr-auc-label">AUC-ROC</div>
      <div class="pr-auc-value">${overall.aucRoc.toFixed(4)}</div>
      <div class="pr-auc-sub">vs 0.5 baseline</div>
    </div>` +
    `<div class="pr-auc-badge">
      <div class="pr-auc-label">AUC-PR</div>
      <div class="pr-auc-value">${overall.aucPr.toFixed(4)}</div>
      <div class="pr-auc-sub">vs ${(overall.prevalence * 100).toFixed(1)}% baseline</div>
    </div>` +
    `<div class="pr-auc-badge">
      <div class="pr-auc-label">Samples</div>
      <div class="pr-auc-value">${overall.n.toLocaleString()}</div>
      <div class="pr-auc-sub">${overall.positives} positives (${(overall.prevalence * 100).toFixed(1)}%)</div>
    </div>`;

  // ROC curve SVG
  const rocPts = overall.roc.map(p => [p.fpr, p.tpr] as [number, number]);
  renderPrRocSvg("rocSvg", rocPts, [[0, 0], [1, 1]], "FPR", "TPR", "AUC-ROC", overall.aucRoc);

  // PR curve SVG
  const prPts = overall.pr.map(p => [p.recall, p.precision] as [number, number]);
  renderPrRocSvg("prSvg", prPts, [[0, overall.prevalence], [1, overall.prevalence]], "Recall", "Precision", "AUC-PR", overall.aucPr);

  // Category table
  const CAT_LABELS: Record<string, string> = {
    picture: "Best Picture", director: "Director", actor: "Actor", actress: "Actress",
    "supporting-actor": "Supporting Actor", "supporting-actress": "Supporting Actress",
  };
  catBody.innerHTML = Object.entries(byCategory).map(([catId, c]) => {
    const rocClass = c.aucRoc >= 0.99 ? "backtest-correct" : c.aucRoc >= 0.9 ? "" : "backtest-miss";
    const prClass  = c.aucPr  >= 0.99 ? "backtest-correct" : c.aucPr  >= 0.9 ? "" : "backtest-miss";
    return `<tr>
      <td class="backtest-str">${CAT_LABELS[catId] ?? catId}</td>
      <td class="backtest-num">${c.n}</td>
      <td class="backtest-num">${c.positives}</td>
      <td class="backtest-num">${(c.prevalence * 100).toFixed(1)}%</td>
      <td class="backtest-num ${rocClass}">${c.aucRoc.toFixed(4)}</td>
      <td class="backtest-num ${prClass}">${c.aucPr.toFixed(4)}</td>
    </tr>`;
  }).join("");

  section.hidden = false;
}

// ── Rolling Error charts ───────────────────────────────────────────────────────

export function reXScale(yearIndex: number, n: number): number {
  return RE_PAD.left + (yearIndex / Math.max(1, n - 1)) * RE_IW;
}

export function reYScale(v: number, lo: number, hi: number): number {
  const range = hi - lo || 1e-6;
  return RE_PAD.top + RE_IH - ((v - lo) / range) * RE_IH;
}

export function reSvgAxes(years: number[], yLo: number, yHi: number, yFmt: (v: number) => string): string {
  const ox = RE_PAD.left, oy = RE_PAD.top;
  const bx = ox + RE_IW,  by = oy + RE_IH;
  let s = `<line class="pr-axis" x1="${ox}" y1="${oy}" x2="${ox}" y2="${by}"/>`;
  s    += `<line class="pr-axis" x1="${ox}" y1="${by}" x2="${bx}" y2="${by}"/>`;

  // X ticks: every 5 years
  for (let i = 0; i < years.length; i++) {
    if (years[i] % 5 !== 0 && i !== 0 && i !== years.length - 1) continue;
    const px = reXScale(i, years.length).toFixed(1);
    s += `<line class="pr-tick" x1="${px}" y1="${by}" x2="${px}" y2="${(+by + 4).toFixed(1)}"/>`;
    s += `<text class="pr-tick-lbl re-year-lbl" x="${px}" y="${(+by + 16).toFixed(1)}" text-anchor="middle" transform="rotate(-45,${px},${+by + 16})">${years[i]}</text>`;
  }

  // Y ticks: 5 evenly spaced
  for (let k = 0; k <= 4; k++) {
    const v = yLo + (k / 4) * (yHi - yLo);
    const py = reYScale(v, yLo, yHi).toFixed(1);
    s += `<line class="pr-tick" x1="${ox}" y1="${py}" x2="${(ox - 4).toFixed(1)}" y2="${py}"/>`;
    s += `<text class="pr-tick-lbl" x="${(ox - 7).toFixed(1)}" y="${(+py + 3.5).toFixed(1)}" text-anchor="end">${yFmt(v)}</text>`;
  }
  return s;
}

export function reSvgPolyline(
  vals: number[], years: number[], yLo: number, yHi: number, cls: string
): string {
  const pts = vals
    .map((v, i) => `${reXScale(i, years.length).toFixed(1)},${reYScale(v, yLo, yHi).toFixed(1)}`)
    .join(" ");
  return `<polyline class="${cls}" points="${pts}" fill="none"/>`;
}

export function reSvgDots(
  vals: number[], years: number[], yLo: number, yHi: number, colorFn: ((v: number, i: number) => string) | null
): string {
  return vals.map((v, i) => {
    const cx = reXScale(i, years.length).toFixed(1);
    const cy = reYScale(v, yLo, yHi).toFixed(1);
    const cls = colorFn ? colorFn(v, i) : "re-dot";
    return `<circle class="${cls}" cx="${cx}" cy="${cy}" r="3"><title>${years[i]}: ${v.toFixed(5)}</title></circle>`;
  }).join("");
}

export function reDots(
  rawVals: number[],
  _rollVals: number[],
  years: number[],
  yLo: number,
  yHi: number,
  colorFn: ((v: number, i: number) => string) | null,
): string {
  return reSvgDots(rawVals, years, yLo, yHi, colorFn);
}

export function renderRollingChart(
  svgId: string,
  rawVals: number[],
  rollVals: number[],
  trendVals: number[],
  years: number[],
  yFmt: (v: number) => string,
  dotColorFn: ((v: number, i: number) => string) | null,
): void {
  const el = document.getElementById(svgId);
  if (!el) return;
  const allVals = [...rawVals, ...rollVals, ...trendVals];
  const margin = (Math.max(...allVals) - Math.min(...allVals)) * 0.12 || 0.005;
  const yLo = Math.min(...allVals) - margin;
  const yHi = Math.max(...allVals) + margin;

  el.innerHTML =
    reSvgAxes(years, yLo, yHi, yFmt) +
    reSvgPolyline(trendVals, years, yLo, yHi, "re-trend") +
    reSvgPolyline(rollVals,  years, yLo, yHi, "re-roll") +
    reDots(rawVals, rollVals, years, yLo, yHi, dotColorFn);
}

export function renderRollingError(): void {
  const section  = document.getElementById("rollingErrorSection");
  const statRow  = document.getElementById("reStatRow");
  const heatmap  = document.getElementById("reHeatmap");
  if (!section || !statRow || !heatmap || !rollingErrorData) return;

  const { years, trend, byCategory } = rollingErrorData;
  const yearNums = years.map(r => r.year);

  // Stat badges
  const wbSlope = trend.winnerBrier.slope;
  const wbR2    = trend.winnerBrier.r2;
  const waSlope = trend.winnerAccuracy.slope;
  const slopeDir = (s: number) => s < 0 ? "▼" : "▲";
  const slopeClass = (s: number, lowerIsBetter: boolean) =>
    (s < 0) === lowerIsBetter ? "re-stat--good" : "re-stat--bad";

  statRow.innerHTML =
    `<div class="re-stat-badge ${slopeClass(wbSlope, true)}">
       <div class="re-stat-label">Brier Score Trend</div>
       <div class="re-stat-value">${slopeDir(wbSlope)} ${Math.abs(wbSlope * 1000).toFixed(3)}<span class="re-stat-unit">×10⁻³/yr</span></div>
       <div class="re-stat-sub">R² = ${wbR2.toFixed(3)}</div>
     </div>` +
    `<div class="re-stat-badge ${slopeClass(waSlope, false)}">
       <div class="re-stat-label">Accuracy Trend</div>
       <div class="re-stat-value">${slopeDir(waSlope)} ${Math.abs(waSlope).toFixed(3)}<span class="re-stat-unit">pp/yr</span></div>
       <div class="re-stat-sub">R² = ${trend.winnerAccuracy.r2.toFixed(3)}</div>
     </div>` +
    `<div class="re-stat-badge">
       <div class="re-stat-label">Mean Win Brier</div>
       <div class="re-stat-value">${(years.reduce((s, r) => s + r.winnerBrierAvg, 0) / years.length).toFixed(5)}</div>
       <div class="re-stat-sub">${years.length} ceremonies</div>
     </div>`;

  // Brier chart
  renderRollingChart(
    "reBrierSvg",
    years.map(r => r.winnerBrierAvg),
    years.map(r => r.roll3WinnerBrier),
    years.map(r => r.trendWinnerBrier),
    yearNums,
    v => v.toFixed(4),
    null,
  );

  // Accuracy chart
  renderRollingChart(
    "reAccSvg",
    years.map(r => r.winnerAccuracyPct),
    years.map(r => r.roll3WinnerAccuracy),
    years.map(r => r.trendWinnerAccuracy),
    yearNums,
    v => `${v.toFixed(0)}%`,
    (v) => v >= 100 ? "re-dot re-dot--correct" : v >= 83 ? "re-dot re-dot--near" : "re-dot re-dot--miss",
  );

  // Heatmap: year columns × category rows
  const CAT_LABELS: Record<string, string> = {
    picture: "Best Picture", director: "Director", actor: "Actor", actress: "Actress",
    "supporting-actor": "Supp. Actor", "supporting-actress": "Supp. Actress",
  };
  const catIds = ["picture", "director", "actor", "actress", "supporting-actor", "supporting-actress"];

  const colW = Math.max(20, Math.floor(560 / yearNums.length));
  let html = `<div class="re-heatmap">`;
  // Year header
  html += `<div class="re-hm-header">`;
  html += `<div class="re-hm-cat-label"></div>`;
  for (const y of yearNums) {
    html += `<div class="re-hm-year" style="width:${colW}px">${String(y).slice(2)}</div>`;
  }
  html += `</div>`;
  // Category rows
  for (const catId of catIds) {
    const catRows = byCategory[catId] ?? [];
    const rowByYear = new Map(catRows.map(r => [r.year, r]));
    html += `<div class="re-hm-row">`;
    html += `<div class="re-hm-cat-label">${CAT_LABELS[catId] ?? catId}</div>`;
    for (const y of yearNums) {
      const r = rowByYear.get(y);
      const cls = !r ? "re-hm-cell re-hm-cell--na"
        : r.winnerCorrect ? "re-hm-cell re-hm-cell--correct"
        : "re-hm-cell re-hm-cell--miss";
      const tip = r ? `${y}: ${r.winnerCorrect ? "✓" : "✗"} BS=${r.winnerBrier.toFixed(4)}` : y.toString();
      html += `<div class="${cls}" style="width:${colW}px" title="${tip}"></div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  heatmap.innerHTML = html;

  section.hidden = false;
}

// ── loadBacktest ───────────────────────────────────────────────────────────────

export async function loadBacktest(): Promise<void> {
  if (backtestStatus) {
    backtestStatus.textContent = "Loading accuracy data…";
    backtestStatus.className = "app-notice loading";
  }
  try {
    const res = await fetch("/api/backtest", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as BacktestApiResult;
    if (backtestStatus) { backtestStatus.textContent = ""; backtestStatus.className = "app-notice"; }
    if (backtestOverview) backtestOverview.hidden = false;
    renderBacktestStatGrid(data.overall);
    renderBacktestCategoryTable(data.byCategory);
    populateBacktestFilter(data.byCategory);
    renderBacktestYearTable(data.byYear, "all");
    backtestCategoryFilter?.addEventListener("change", () => {
      renderBacktestYearTable(data.byYear, backtestCategoryFilter!.value);
    });
    // Load feature importance alongside backtest — both live in the same panel.
    fetch("/api/feature-importance")
      .then(r => r.ok ? r.json() : null)
      .then((fi: unknown) => {
        if (!fi || typeof fi !== "object") return;
        const d = fi as Record<string, unknown>;
        if (!Array.isArray(d.features) || typeof d.baseline !== "object") return;
        setFeatureImportanceData(fi as FeatureImportanceData);
        renderFeatureImportance();
      })
      .catch(() => { /* feature-importance.json not generated yet */ });
    // Load Brier decomposition alongside backtest.
    fetch("/api/brier-decomposition")
      .then(r => r.ok ? r.json() : null)
      .then((bd: unknown) => {
        if (!bd || typeof bd !== "object") return;
        const d = bd as Record<string, unknown>;
        if (typeof d.winner !== "object" || typeof d.byCategory !== "object") return;
        setBrierDecompData(bd as BrierDecompData);
        renderBrierDecomposition();
      })
      .catch(() => { /* brier-decomposition.json not generated yet */ });
    // Load A/B test data alongside backtest.
    fetch("/api/ab-test")
      .then(r => r.ok ? r.json() : null)
      .then((ab: unknown) => {
        if (!ab || typeof ab !== "object") return;
        const d = ab as Record<string, unknown>;
        if (!Array.isArray(d.presets) || !Array.isArray(d.pairwise)) return;
        setAbTestData(ab as AbTestData);
        renderAbTest();
      })
      .catch(() => { /* ab-test.json not generated yet */ });
    // Load PR/ROC data alongside backtest.
    fetch("/api/pr-roc")
      .then(r => r.ok ? r.json() : null)
      .then((pr: unknown) => {
        if (!pr || typeof pr !== "object") return;
        const d = pr as Record<string, unknown>;
        if (typeof d.overall !== "object" || typeof d.byCategory !== "object") return;
        setPrRocData(pr as PrRocData);
        renderPrRoc();
      })
      .catch(() => { /* pr-roc.json not generated yet */ });
    // Load rolling error data alongside backtest.
    fetch("/api/rolling-error")
      .then(r => r.ok ? r.json() : null)
      .then((re: unknown) => {
        if (!re || typeof re !== "object") return;
        const d = re as Record<string, unknown>;
        if (!Array.isArray(d.years) || typeof d.trend !== "object") return;
        setRollingErrorData(re as RollingErrorData);
        renderRollingError();
      })
      .catch(() => { /* rolling-error.json not generated yet */ });
  } catch {
    if (backtestStatus) {
      backtestStatus.textContent = "Failed to load backtest data.";
      backtestStatus.className = "app-notice error";
    }
  }
}
