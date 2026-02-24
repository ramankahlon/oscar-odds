import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
});

test("homepage loads with default content", async ({ page }) => {
  // Profile dropdown exists and has the default option selected
  const profileSelect = page.locator("#profileSelect");
  await expect(profileSelect).toBeVisible();
  await expect(profileSelect).toHaveValue("default");

  // Category select is rendered inside #categoryTabs
  const categorySelect = page.locator("#categoryTabs .category-select");
  await expect(categorySelect).toBeVisible();

  // Results table has at least one row
  const rows = page.locator("#resultsBody tr.results-row");
  await expect(rows.first()).toBeVisible();
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
});

test("category navigation updates results and title", async ({ page }) => {
  const categorySelect = page.locator("#categoryTabs .category-select");
  const categoryTitle = page.locator("#categoryTitle");

  // Get all option values and labels in one DOM evaluation
  const allOptions = await categorySelect.locator("option").evaluateAll((opts) =>
    opts.map((o) => ({ value: (o as HTMLOptionElement).value, label: o.textContent?.trim() ?? "" }))
  );
  expect(allOptions.length).toBeGreaterThan(1);

  const currentValue = await categorySelect.inputValue();

  // Find an option that is different from the currently selected one
  const target = allOptions.find((o) => o.value !== currentValue) ?? allOptions[allOptions.length - 1];

  await categorySelect.selectOption(target.value);
  await page.waitForLoadState("networkidle");

  // Title should match the chosen category's label
  const newTitle = await categoryTitle.textContent();
  expect(newTitle?.trim()).toBe(target.label);

  // Table should have rows for the new category
  const rows = page.locator("#resultsBody tr.results-row");
  await expect(rows.first()).toBeVisible();
});

test("search filtering shows cross-category results", async ({ page }) => {
  const searchInput = page.locator("#contenderSearch");
  const clearButton = page.locator("#contenderSearchClear");

  // Type a common short word likely to appear across categories
  await searchInput.fill("The");
  await page.waitForLoadState("networkidle");

  // Clear button should now be visible
  await expect(clearButton).toBeVisible();

  // Rows are displayed
  const rows = page.locator("#resultsBody tr.results-row");
  await expect(rows.first()).toBeVisible();

  // At least some rows should show a category label badge (cross-category search)
  const categoryLabels = page.locator("#resultsBody .results-category-label");
  const labelCount = await categoryLabels.count();
  expect(labelCount).toBeGreaterThan(0);
});

test("clear button resets search", async ({ page }) => {
  const searchInput = page.locator("#contenderSearch");
  const clearButton = page.locator("#contenderSearchClear");

  // Populate search
  await searchInput.fill("The");
  await page.waitForLoadState("networkidle");
  await expect(clearButton).toBeVisible();

  // Click the clear button
  await clearButton.click();
  await page.waitForLoadState("networkidle");

  // Input should be empty and clear button hidden
  await expect(searchInput).toHaveValue("");
  await expect(clearButton).toBeHidden();

  // Table should be restored — normal category view has rows
  const restoredCount = await page.locator("#resultsBody tr.results-row").count();
  expect(restoredCount).toBeGreaterThan(0);
});

test("switching categories clears active search", async ({ page }) => {
  const searchInput = page.locator("#contenderSearch");
  const clearButton = page.locator("#contenderSearchClear");
  const categorySelect = page.locator("#categoryTabs .category-select");

  // Start a search
  await searchInput.fill("The");
  await page.waitForLoadState("networkidle");
  await expect(clearButton).toBeVisible();

  // Switch to a new category
  const options = await categorySelect.locator("option").all();
  const secondValue = await options[1].getAttribute("value");
  await categorySelect.selectOption(secondValue!);
  await page.waitForLoadState("networkidle");

  // Search input should be empty and clear button hidden
  await expect(searchInput).toHaveValue("");
  await expect(clearButton).toBeHidden();
});

test("clicking a row selects it and updates detail panel", async ({ page }) => {
  const rows = page.locator("#resultsBody tr.results-row");
  await expect(rows.first()).toBeVisible();

  // Record the detail title before clicking
  const detailTitle = page.locator("#movieDetailTitle");
  const initialTitle = await detailTitle.textContent();

  // Click the first row to ensure it's selected, then click the second row
  const firstRow = rows.nth(0);
  const secondRow = rows.nth(1);
  await firstRow.click();
  await page.waitForLoadState("networkidle");

  await secondRow.click();
  await page.waitForLoadState("networkidle");

  // Second row should now be active and aria-selected
  await expect(secondRow).toHaveClass(/active/);
  await expect(secondRow).toHaveAttribute("aria-selected", "true");

  // First row should no longer be active
  await expect(firstRow).not.toHaveClass(/active/);
  await expect(firstRow).toHaveAttribute("aria-selected", "false");

  // Detail panel title should have changed to reflect the second film
  const newTitle = await detailTitle.textContent();
  expect(newTitle?.trim()).not.toBe("");
  expect(newTitle?.trim()).not.toBe(initialTitle?.trim());
});

test("keyboard navigation moves selection through rows", async ({ page }) => {
  const rows = page.locator("#resultsBody tr.results-row");
  await expect(rows.first()).toBeVisible();

  // Click the first row to ensure it is the active selection
  const firstRow = rows.nth(0);
  await firstRow.click();
  await page.waitForLoadState("networkidle");
  await expect(firstRow).toHaveAttribute("aria-selected", "true");

  // Focus the first row so keyboard events are dispatched to it
  await firstRow.focus();

  // Press ArrowDown — second row should become active
  await page.keyboard.press("ArrowDown");
  await page.waitForLoadState("networkidle");

  // After render(), DOM is replaced; use locators to find updated rows
  const secondRow = rows.nth(1);
  await expect(secondRow).toHaveAttribute("aria-selected", "true");
  await expect(firstRow).toHaveAttribute("aria-selected", "false");

  // Re-focus the now-active second row (render() moves focus to body)
  await secondRow.focus();

  // Press ArrowUp — first row should be active again
  await page.keyboard.press("ArrowUp");
  await page.waitForLoadState("networkidle");

  await expect(firstRow).toHaveAttribute("aria-selected", "true");
  await expect(secondRow).toHaveAttribute("aria-selected", "false");
});

test("app loads and renders a table", async ({ page }) => {
  // Table headers are visible
  await expect(page.locator("#thNomination")).toBeVisible();
  await expect(page.locator("#thWinner")).toBeVisible();

  // Table has the grid role for accessibility
  await expect(page.locator("table[role='grid']")).toBeVisible();

  // Results body contains at least one row
  const rows = page.locator("#resultsBody tr.results-row");
  await expect(rows.first()).toBeVisible();
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
});

test("share URL round-trip restores sliders", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // Change the first number input in the candidate panel to 42
  const input = page.locator("#candidateCards input[type='number']").first();
  await expect(input).toBeVisible();
  await input.fill("42");
  await input.dispatchEvent("input");
  await page.waitForLoadState("networkidle");

  // Click the Share button
  await page.locator("#shareButton").click();
  await page.waitForLoadState("networkidle");

  // Get the share URL from the clipboard or (fallback) address bar
  let shareUrl: string;
  const currentUrl = page.url();
  if (currentUrl.includes("?share=")) {
    shareUrl = currentUrl;
  } else {
    shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  }
  expect(shareUrl).toContain("?share=");

  // Navigate to the share URL in a fresh page load
  await page.goto(shareUrl);
  await page.waitForLoadState("networkidle");

  // App should display the "Shared forecast loaded." notice
  await expect(page.locator("#appStateNotice")).toContainText("Shared forecast loaded.");

  // The slider value should be restored to 42
  const restoredInput = page.locator("#candidateCards input[type='number']").first();
  await expect(restoredInput).toHaveValue("42");
});

test("leaderboard shows at least one row", async ({ page }) => {
  const rows = page.locator("#leaderboardBody tr.leaderboard-row");
  await expect(rows.first()).toBeVisible();

  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);

  // Film title cell should be non-empty text
  const firstTitle = rows.first().locator(".leaderboard-title");
  const titleText = await firstTitle.textContent();
  expect(titleText?.trim().length).toBeGreaterThan(0);

  // Nominations column should be a positive integer
  const firstNomCell = rows.first().locator("td.leaderboard-num").first();
  const nomText = await firstNomCell.textContent();
  expect(parseInt(nomText ?? "0", 10)).toBeGreaterThan(0);
});

test.describe("compare mode", () => {
  const compareProfileId = "e2e-compare";

  test.beforeAll(async ({ request }) => {
    await request.put(`http://localhost:3000/api/forecast/${compareProfileId}`, { data: {} });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`http://localhost:3000/api/forecast/${compareProfileId}`);
  });

  test("compare mode toggle adds delta columns", async ({ page }) => {
    // beforeEach already loaded the page; the seeded profile is available
    const compareToggle = page.locator("#compareToggleButton");
    const thCompareB = page.locator("#thCompareB");
    const thDelta = page.locator("#thDelta");

    // Before toggling: headers hidden, button not pressed
    await expect(thCompareB).toBeHidden();
    await expect(thDelta).toBeHidden();
    await expect(compareToggle).toHaveAttribute("aria-pressed", "false");

    // Enable compare mode — wait for the compare header to appear (async fetch completes)
    await compareToggle.click();
    await expect(thCompareB).toBeVisible();

    // Button should now be pressed
    await expect(compareToggle).toHaveAttribute("aria-pressed", "true");

    // Extra headers should appear
    await expect(thDelta).toBeVisible();

    // Delta cells should be present in the table
    const deltaCells = page.locator(`td[data-label="Δ"]`);
    const deltaCellCount = await deltaCells.count();
    expect(deltaCellCount).toBeGreaterThan(0);

    // Toggle off — headers should hide again
    await compareToggle.click();
    await expect(compareToggle).toHaveAttribute("aria-pressed", "false");
    await expect(thCompareB).toBeHidden();
    await expect(thDelta).toBeHidden();
  });
});
