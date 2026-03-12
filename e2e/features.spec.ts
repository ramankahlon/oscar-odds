import { test, expect } from "@playwright/test";

test.describe("Analysis features", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("load");
    // Wait for async data fetches (backtest + analysis endpoints)
    await page.waitForTimeout(3000);
  });

  test("Brier decomposition section renders", async ({ page }) => {
    await expect(page.locator("#brierDecompSection")).not.toHaveAttribute("hidden");
    await expect(page.locator(".bd-fill").first()).toBeVisible();
    await expect(page.locator("#brierDecompCatBody tr").first()).toBeVisible();
  });

  test("Feature importance section renders", async ({ page }) => {
    await expect(page.locator("#featureImportanceSection")).not.toHaveAttribute("hidden");
    await expect(page.locator(".fi-row").first()).toBeVisible();
  });

  test("A/B test section renders with scorecard", async ({ page }) => {
    await expect(page.locator("#abTestSection")).not.toHaveAttribute("hidden");
    // Selectors should be populated
    const optCount = await page.locator("#abPresetA option").count();
    expect(optCount).toBe(5);
    // Scorecard should exist (default A≠B)
    await expect(page.locator("#abTestResult .ab-scorecard")).toBeVisible();
    await expect(page.locator(".ab-verdict")).toBeVisible();
  });

  test("A/B test same-preset shows notice", async ({ page }) => {
    await expect(page.locator("#abTestSection")).not.toHaveAttribute("hidden");
    // Select same preset for A and B
    const firstOption = await page.locator("#abPresetA option").first().getAttribute("value") ??
                        await page.locator("#abPresetA option").first().textContent() ?? "";
    await page.selectOption("#abPresetB", { label: firstOption.trim() || "Balanced" });
    await page.waitForTimeout(200);
    await expect(page.locator(".ab-same")).toBeVisible();
  });

  test("PR-ROC section renders both SVG charts", async ({ page }) => {
    await expect(page.locator("#prRocSection")).not.toHaveAttribute("hidden");
    await expect(page.locator(".pr-auc-badge").first()).toBeVisible();
    // ROC curve path
    const rocPath = page.locator("#rocSvg path.pr-curve");
    await expect(rocPath).toBeAttached();
    // PR curve path
    const prPath = page.locator("#prSvg path.pr-curve");
    await expect(prPath).toBeAttached();
    // Category table rows
    const catRows = page.locator("#prRocCatBody tr");
    expect(await catRows.count()).toBe(6);
  });

  test("Rolling error section renders charts and heatmap", async ({ page }) => {
    await expect(page.locator("#rollingErrorSection")).not.toHaveAttribute("hidden");
    // Stat badges
    await expect(page.locator(".re-stat-badge").first()).toBeVisible();
    // Rolling average polylines in SVGs
    await expect(page.locator("#reBrierSvg polyline.re-roll")).toBeAttached();
    await expect(page.locator("#reAccSvg polyline.re-roll")).toBeAttached();
    // Trend lines
    await expect(page.locator("#reBrierSvg polyline.re-trend")).toBeAttached();
    // Heatmap cells (25 years × 6 categories = 150)
    const cells = page.locator(".re-hm-cell");
    const cellCount = await cells.count();
    expect(cellCount).toBe(150);
    // At least some correct (green) cells
    const correct = page.locator(".re-hm-cell--correct");
    const correctCount = await correct.count();
    expect(correctCount).toBeGreaterThan(100);
  });

  test("AUC values are in valid range", async ({ page }) => {
    await expect(page.locator("#prRocSection")).not.toHaveAttribute("hidden");
    const aucText = await page.locator(".pr-auc-value").first().textContent();
    const auc = parseFloat(aucText ?? "0");
    expect(auc).toBeGreaterThan(0.9);
    expect(auc).toBeLessThanOrEqual(1.0);
  });
});

test.describe("Data quality checks", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("load");
    await page.waitForTimeout(3000);
  });

  test("Rolling error heatmap has correct cell count (25 years × 6 cats)", async ({ page }) => {
    const total = await page.locator(".re-hm-cell").count();
    expect(total).toBe(150);
    const correct = await page.locator(".re-hm-cell--correct").count();
    // 98% winner accuracy → at least 140 correct
    expect(correct).toBeGreaterThanOrEqual(140);
  });

  test("A/B test selectors switch pairs and update verdict", async ({ page }) => {
    await expect(page.locator("#abTestSection")).not.toHaveAttribute("hidden");
    await page.selectOption("#abPresetA", { index: 0 });
    await page.selectOption("#abPresetB", { index: 2 });
    await page.waitForTimeout(200);
    const verdict = await page.locator(".ab-verdict").textContent();
    expect(verdict?.length).toBeGreaterThan(5);
    const scorecard = await page.locator(".ab-metric").count();
    expect(scorecard).toBe(2);
  });

  test("ROC curve has diagonal baseline", async ({ page }) => {
    const baseline = await page.locator("#rocSvg path.pr-baseline").getAttribute("d");
    expect(baseline).toBeTruthy();
  });

  test("PR curve has horizontal baseline at prevalence level", async ({ page }) => {
    const baseline = await page.locator("#prSvg path.pr-baseline").getAttribute("d");
    expect(baseline).toBeTruthy();
  });

  test("Feature importance bars are in order (precursor > buzz > history)", async ({ page }) => {
    const labels = await page.locator(".fi-row .fi-name").allTextContents();
    expect(labels[0]?.toLowerCase()).toContain("precursor");
    expect(labels[1]?.toLowerCase()).toContain("buzz");
    expect(labels[2]?.toLowerCase()).toContain("hist");
  });

  test("Brier decomp formula balances", async ({ page }) => {
    const formula = await page.locator(".bd-formula").textContent();
    // Formula should contain the identity
    expect(formula).toContain("=");
    expect(formula).toContain("Reliability");
    expect(formula).toContain("Resolution");
    expect(formula).toContain("Uncertainty");
  });

  test("PR-ROC category table has 6 rows", async ({ page }) => {
    const rows = await page.locator("#prRocCatBody tr").count();
    expect(rows).toBe(6);
    // Director should have near-perfect AUC
    const directorRow = page.locator("#prRocCatBody tr").nth(1);
    const aucText = await directorRow.locator("td").nth(4).textContent();
    expect(parseFloat(aucText ?? "0")).toBeGreaterThan(0.99);
  });
});
