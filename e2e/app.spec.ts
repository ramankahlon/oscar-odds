import { test, expect, type Page } from "@playwright/test";
import LZString from "lz-string";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Intercept the SSE endpoint and several fire-and-forget endpoints that
 * are not exercised by any test but count heavily against the server's
 * per-minute rate limit (200 req/min).  Stubbing them here keeps the total
 * well below the threshold even when the full 11-test suite runs back-to-back.
 *
 * Endpoints stubbed:
 *   • /api/scraper-events — persistent SSE keeps networkidle from resolving
 *   • sw.js              — prevents SW from adding X-Sw-Cached → offline mode
 *   • /api/backtest      — CPU-heavy; cached but first call is slow
 *   • /api/feature-importance, /api/learned-weights,
 *     /api/joint-probability, /api/bootstrap-ci — fire-and-forget analytics
 *   • /api/tmdb-poster   — TMDB look-up not exercised by any assertion
 *   • /api/scrape-observability — scraper health badge, not asserted in tests
 *   • /api/external-signals — background sync not asserted in tests
 */
async function stubSse(page: Page): Promise<void> {
  const empty200 = (ct = "application/json", body = "{}") =>
    (route: import("@playwright/test").Route) =>
      route.fulfill({ status: 200, headers: { "Content-Type": ct }, body });

  // SSE: close immediately so networkidle can settle in other scenarios.
  await page.route("**/api/scraper-events", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "close",
      },
      body: ": connected\n\n",
    })
  );

  // Service worker: serve empty JS so SW never intercepts API requests.
  await page.route("**/sw.js", empty200("application/javascript", ""));

  // Fire-and-forget analytics endpoints — not asserted by any test.
  await page.route("**/api/backtest", empty200());
  await page.route("**/api/feature-importance", empty200());
  await page.route("**/api/learned-weights", empty200());
  await page.route("**/api/joint-probability", empty200());
  await page.route("**/api/bootstrap-ci", empty200());
  await page.route("**/api/scrape-observability", empty200());
  await page.route("**/api/external-signals**", empty200());
  await page.route("**/api/tmdb-poster**", empty200());
}

/**
 * Wait for the app to be fully interactive:
 *   1. HTML and static assets parsed (domcontentloaded)
 *   2. Bootstrap has run and rendered at least one results row
 *
 * This is a reliable readiness signal that doesn't depend on network
 * quiescence — it proves the JS has parsed contenders, loaded profiles,
 * and rendered the UI.
 */
async function waitForApp(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("#profileSelect")).toBeVisible();
  await expect(page.locator("#resultsBody tr.results-row").first()).toBeVisible();
}

// ── Shared setup ──────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await stubSse(page);
  await page.goto("/");
  await waitForApp(page);
});

// ══════════════════════════════════════════════════════════════════════════════
// Core page load
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
// Category navigation
// ══════════════════════════════════════════════════════════════════════════════

test("category navigation updates results and title", async ({ page }) => {
  const categorySelect = page.locator("#categoryTabs .category-select");
  const categoryTitle = page.locator("#categoryTitle");

  // Collect all option values and labels from the DOM.
  const allOptions = await categorySelect.locator("option").evaluateAll((opts) =>
    opts.map((o) => ({
      value: (o as HTMLOptionElement).value,
      label: o.textContent?.trim() ?? "",
    }))
  );
  expect(allOptions.length).toBeGreaterThan(1);

  const currentValue = await categorySelect.inputValue();
  const target = allOptions.find((o) => o.value !== currentValue) ?? allOptions[allOptions.length - 1];

  await categorySelect.selectOption(target.value);

  // Title should update to the chosen category's base name.
  // Option text has completion suffixes (✓ ◑ ○) appended by renderTabs(); strip them.
  const baseName = target.label.replace(/\s+[✓◑○]$/, "").trim();
  await expect(categoryTitle).toHaveText(baseName);

  // Results rows should be present for the new category.
  const rows = page.locator("#resultsBody tr.results-row");
  await expect(rows.first()).toBeVisible();
});

// ══════════════════════════════════════════════════════════════════════════════
// Search
// ══════════════════════════════════════════════════════════════════════════════

test("search filtering shows cross-category results", async ({ page }) => {
  const searchInput = page.locator("#contenderSearch");
  const clearButton = page.locator("#contenderSearchClear");

  await searchInput.fill("The");
  // Search is a synchronous render; the clear button appears immediately.
  await expect(clearButton).toBeVisible();

  // Rows are displayed
  const rows = page.locator("#resultsBody tr.results-row");
  await expect(rows.first()).toBeVisible();

  // Cross-category search shows category label badges.
  // render() is debounced 150 ms after input — wait for at least one label to appear.
  const categoryLabels = page.locator("#resultsBody .results-category-label");
  await expect(categoryLabels.first()).toBeVisible();
  const labelCount = await categoryLabels.count();
  expect(labelCount).toBeGreaterThan(0);
});

test("clear button resets search", async ({ page }) => {
  const searchInput = page.locator("#contenderSearch");
  const clearButton = page.locator("#contenderSearchClear");

  await searchInput.fill("The");
  await expect(clearButton).toBeVisible();

  await clearButton.click();

  // Input clears synchronously; clear button hides.
  await expect(searchInput).toHaveValue("");
  await expect(clearButton).toBeHidden();

  // Normal category view is restored.
  const restoredCount = await page.locator("#resultsBody tr.results-row").count();
  expect(restoredCount).toBeGreaterThan(0);
});

test("switching categories clears active search", async ({ page }) => {
  const searchInput = page.locator("#contenderSearch");
  const clearButton = page.locator("#contenderSearchClear");
  const categorySelect = page.locator("#categoryTabs .category-select");

  await searchInput.fill("The");
  await expect(clearButton).toBeVisible();

  // Switch to the second category option.
  const options = await categorySelect.locator("option").all();
  const secondValue = await options[1].getAttribute("value");
  await categorySelect.selectOption(secondValue!);

  // Search should be cleared after a category switch.
  await expect(searchInput).toHaveValue("");
  await expect(clearButton).toBeHidden();
});

// ══════════════════════════════════════════════════════════════════════════════
// Row interaction
// ══════════════════════════════════════════════════════════════════════════════

test("clicking a row selects it and updates detail panel", async ({ page }) => {
  const rows = page.locator("#resultsBody tr.results-row");
  await expect(rows.first()).toBeVisible();

  const detailTitle = page.locator("#movieDetailTitle");
  const initialTitle = await detailTitle.textContent();

  const firstRow = rows.nth(0);
  const secondRow = rows.nth(1);

  await firstRow.click();
  // Row click is a synchronous render; aria-selected updates immediately.
  await expect(firstRow).toHaveAttribute("aria-selected", "true");

  await secondRow.click();
  await expect(secondRow).toHaveClass(/active/);
  await expect(secondRow).toHaveAttribute("aria-selected", "true");
  await expect(firstRow).not.toHaveClass(/active/);
  await expect(firstRow).toHaveAttribute("aria-selected", "false");

  // Detail panel title should have changed.
  const newTitle = await detailTitle.textContent();
  expect(newTitle?.trim()).not.toBe("");
  expect(newTitle?.trim()).not.toBe(initialTitle?.trim());
});

test("keyboard navigation moves selection through rows", async ({ page }) => {
  const rows = page.locator("#resultsBody tr.results-row");
  await expect(rows.first()).toBeVisible();

  const firstRow = rows.nth(0);
  await firstRow.click();
  await expect(firstRow).toHaveAttribute("aria-selected", "true");

  await firstRow.focus();
  await page.keyboard.press("ArrowDown");

  // Second row becomes active after ArrowDown.
  const secondRow = rows.nth(1);
  await expect(secondRow).toHaveAttribute("aria-selected", "true");
  await expect(firstRow).toHaveAttribute("aria-selected", "false");

  // Focus the now-active second row and press ArrowUp.
  await secondRow.focus();
  await page.keyboard.press("ArrowUp");

  await expect(firstRow).toHaveAttribute("aria-selected", "true");
  await expect(secondRow).toHaveAttribute("aria-selected", "false");
});

// ══════════════════════════════════════════════════════════════════════════════
// Share URL
// ══════════════════════════════════════════════════════════════════════════════

test("share URL round-trip restores sliders", async ({ page, context, request }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // Reset stored state so accumulated API values don't affect which film ranks
  // first; seeds are the baseline for the share-URL comparison.
  await request.put("http://localhost:3000/api/forecast/default", { data: {} });
  await page.reload();
  await waitForApp(page);

  // Capture the first visible film's title, then raise its precursor by a few
  // points so it stays the top-ranked film even after weights or values change
  // (dropping it to e.g. 42 would push it out of the top display slots).
  const { filmTitle, newPrecursor } = await page.evaluate(() => {
    const card = document.querySelector("#candidateCards .candidate-card") as HTMLElement;
    const title = card?.querySelector("h3")?.textContent?.trim() ?? "";
    const input = card?.querySelector("input[type='number']") as HTMLInputElement;
    const current = Number(input?.value ?? 0);
    const next = Math.min(current + 3, 95); // raise slightly so it stays visible
    if (input) {
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return { filmTitle: title, newPrecursor: next };
  });

  // Click the Share button — triggers async clipboard write and re-render.
  await page.locator("#shareButton").click();
  // Wait for the notice that confirms the clipboard write completed (or for the
  // address bar to be updated in the clipboard-blocked fallback path).
  await expect(page.locator("#appStateNotice")).toContainText(/Share link copied|copy the URL/);

  // Resolve share URL from clipboard or address bar (whichever path succeeded).
  let shareUrl: string;
  const currentUrl = page.url();
  if (currentUrl.includes("?share=")) {
    shareUrl = currentUrl;
  } else {
    shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  }
  expect(shareUrl).toContain("?share=");

  // Navigate to the share URL in the same page (fresh load).
  await stubSse(page); // re-stub: page.route() is cleared after navigation
  await page.goto(shareUrl);
  await waitForApp(page);

  // App should display the "Shared forecast loaded." notice.
  await expect(page.locator("#appStateNotice")).toContainText("Shared forecast loaded.");

  // The modified precursor value should be restored on the specific film card,
  // looked up by title (projection order may differ under restored weights).
  const restoredValue = await page.evaluate((title: string) => {
    for (const card of document.querySelectorAll("#candidateCards .candidate-card")) {
      if (card.querySelector("h3")?.textContent?.trim() === title) {
        const input = card.querySelector("input[type='number']") as HTMLInputElement | null;
        return input?.value ?? null;
      }
    }
    return null;
  }, filmTitle);
  expect(restoredValue).toBe(String(newPrecursor));
});

test("share URL with complex state restores weights and film scores across categories", async ({ page, context, request }) => {
  // Reset stored profile state so that accumulated film values from previous
  // test runs don't appear as "overrides" in the share URL baseline check.
  await request.put("http://localhost:3000/api/forecast/default", { data: {} });
  await page.reload();
  await waitForApp(page);

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // 1. Set weight sliders to non-default values via JS (fill() is unreliable for
  //    range inputs; dispatching a real "input" event is the robust approach).
  await page.evaluate(() => {
    const setSlider = (id: string, value: number) => {
      const el = document.getElementById(id) as HTMLInputElement;
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setSlider("precursorSlider", 75);
    setSlider("historySlider", 15);
    setSlider("buzzSlider", 10);
  });
  // Confirm the display label updated — this is the cheapest signal that the
  // slider event handler ran and updated state.weights.
  await expect(page.locator("#precursorDisplay")).toContainText("75");

  // 2. Collect category IDs before touching films.
  const categorySelect = page.locator("#categoryTabs .category-select");
  const options = await categorySelect.locator("option").evaluateAll(
    (opts) => opts.map((o) => (o as HTMLOptionElement).value)
  );
  expect(options.length).toBeGreaterThan(1);

  // 3. Edit the first film's three inputs in the active (first) category.
  //    Candidate cards render in projection-ranked order, and fill() fires a
  //    "change" event which triggers render() and rebuilds the DOM — so each
  //    subsequent nth(i) would hit a different card.  To avoid this, batch all
  //    three changes in a single evaluate() call that dispatches only "input"
  //    events (state-update, no re-render) for all three inputs atomically.
  //    We also record the film title so we can look it up by name later — the
  //    projection order will differ after weights change, so DOM position alone
  //    is not a reliable key.
  await expect(page.locator("#candidateCards input[type='number']").first()).toBeVisible();
  const cat0FilmTitle = await page.evaluate(() => {
    const card = document.querySelector("#candidateCards .candidate-card") as HTMLElement | null;
    const title = card?.querySelector("h3")?.textContent?.trim() ?? "";
    const inputs = Array.from(
      document.querySelectorAll("#candidateCards input[type='number']")
    ) as HTMLInputElement[];
    const setInput = (input: HTMLInputElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    // Raise the top film's scores by modest amounts — keeping the film well within
    // the category's 10-film display limit post-navigation under the new weights.
    setInput(inputs[0], "91");   // precursor (was ~88 at seed)
    setInput(inputs[1], "87");   // history
    setInput(inputs[2], "90");   // buzz
    return title;
  });
  expect(cat0FilmTitle.length).toBeGreaterThan(0);

  // 4. Switch to the second category and edit the first film's precursor there.
  await categorySelect.selectOption(options[1]);
  await expect(page.locator("#candidateCards input[type='number']").first()).toBeVisible();
  const cat1FilmTitle = await page.evaluate(() => {
    const card = document.querySelector("#candidateCards .candidate-card") as HTMLElement | null;
    const title = card?.querySelector("h3")?.textContent?.trim() ?? "";
    const inputs = Array.from(
      document.querySelectorAll("#candidateCards input[type='number']")
    ) as HTMLInputElement[];
    inputs[0].value = "55";
    inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    return title;
  });
  expect(cat1FilmTitle.length).toBeGreaterThan(0);

  // 5. Generate the share URL (active category is now options[1]).
  await page.locator("#shareButton").click();
  await expect(page.locator("#appStateNotice")).toContainText(/Share link copied|copy the URL/);

  let shareUrl: string;
  const currentUrl = page.url();
  if (currentUrl.includes("?share=")) {
    shareUrl = currentUrl;
  } else {
    shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  }
  expect(shareUrl).toContain("?share=");


  // 6. Assert URL fits within the 2000-character safe limit for browsers and
  //    HTTP/1.1 proxies (LZ-string compression should comfortably achieve this).
  expect(
    shareUrl.length,
    `Share URL length (${shareUrl.length}) exceeds 2000-character browser-safe limit`
  ).toBeLessThan(2000);

  // 7. Navigate to the share URL in a fresh page load.
  await stubSse(page);
  await page.goto(shareUrl);
  await waitForApp(page);

  // 8. App should signal that the shared state was applied.
  await expect(page.locator("#appStateNotice")).toContainText("Shared forecast loaded.");

  // 9. Weights should be restored.
  await expect(page.locator("#precursorSlider")).toHaveValue("75");
  await expect(page.locator("#historySlider")).toHaveValue("15");
  await expect(page.locator("#buzzSlider")).toHaveValue("10");

  // 10. Film scores in the second category (currently active) should be restored.
  //     Look up the specific film by title — projection order may differ under
  //     the restored weights and should not be assumed to match setup order.
  await expect(page.locator("#candidateCards .candidate-card").first()).toBeVisible();
  const cat1Restored = await page.evaluate((title: string) => {
    for (const card of document.querySelectorAll("#candidateCards .candidate-card")) {
      if (card.querySelector("h3")?.textContent?.trim() === title) {
        return Array.from(card.querySelectorAll("input[type='number']"))
          .map((i) => (i as HTMLInputElement).value);
      }
    }
    return null;
  }, cat1FilmTitle);
  expect(cat1Restored?.[0]).toBe("55");

  // 11. Switch back to the first category and verify its film scores too.
  //     The modified film has higher-than-seed scores so it stays within the
  //     10-film display limit even after weights change to 75/15/10.
  await page.locator("#categoryTabs .category-select").selectOption(options[0]);
  await expect(page.locator("#candidateCards .candidate-card").first()).toBeVisible();
  const cat0Restored = await page.evaluate((title: string) => {
    for (const card of document.querySelectorAll("#candidateCards .candidate-card")) {
      if (card.querySelector("h3")?.textContent?.trim() === title) {
        return Array.from(card.querySelectorAll("input[type='number']"))
          .map((i) => (i as HTMLInputElement).value);
      }
    }
    return null;
  }, cat0FilmTitle);
  expect(cat0Restored).toEqual(["91", "87", "90"]);
});

test("share URL stays under 2000 characters with all categories fully modified", async ({ request }) => {
  // Fetch the live contenders data so the payload reflects exactly what the
  // app would serialise (real category IDs, real film titles, real counts).
  const res = await request.get("http://localhost:3000/api/contenders");
  expect(res.ok()).toBe(true);
  const data = await res.json() as {
    categoryDefinitions: Array<{ id: string }>;
    categorySeeds: Record<string, Array<{ title: string }>>;
  };

  // Build a worst-case CompactShare: every film in every category has unique,
  // non-round-number slider values to maximise payload entropy before compression.
  const sliders: Record<string, Record<string, [number, number, number]>> = {};
  let counter = 0;
  for (const { id } of data.categoryDefinitions) {
    sliders[id] = {};
    for (const film of (data.categorySeeds[id] ?? [])) {
      sliders[id][film.title] = [
        counter % 101,
        (counter + 33) % 101,
        (counter + 67) % 101,
      ];
      counter++;
    }
  }

  const payload = {
    v: 1,
    c: data.categoryDefinitions[0]?.id ?? "",
    w: [75, 15, 10] as [number, number, number],
    t: 15,
    s: sliders,
  };
  const json = JSON.stringify(payload);
  const compressed = LZString.compressToEncodedURIComponent(json);
  const url = `http://localhost:3000/?share=${compressed}`;

  // 4000 chars is a conservative ceiling: nginx/Apache default to ~8 KB URL
  // limits and all modern browsers support far more.  The threshold still
  // catches regressions (e.g. adding large fields to the share payload without
  // checking URL length) while tolerating the true worst-case data size.
  expect(
    url.length,
    `Worst-case share URL (${url.length} chars) exceeds the 4000-character safe limit — ` +
    `the share payload may have grown; consider trimming or increasing compression`
  ).toBeLessThan(4000);
});

// ══════════════════════════════════════════════════════════════════════════════
// Compare mode
// ══════════════════════════════════════════════════════════════════════════════

test.describe("compare mode", () => {
  const compareProfileId = "e2e-compare";

  test.beforeAll(async ({ request }) => {
    // Create the compare profile (PUT also sets it as the active profile).
    await request.put(`http://localhost:3000/api/forecast/${compareProfileId}`, { data: {} });
    // Restore 'default' as the active profile so other tests are unaffected.
    const defRes = await request.get(`http://localhost:3000/api/forecast/default`);
    const defDoc = await defRes.json() as { payload: Record<string, unknown> | null };
    await request.put(`http://localhost:3000/api/forecast/default`, { data: defDoc.payload ?? {} });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`http://localhost:3000/api/forecast/${compareProfileId}`);
    // The DELETE handler automatically resets active_profile_id to 'default'
    // when the active profile is deleted — no extra step needed.
  });

  test("compare mode toggle adds delta columns", async ({ page }) => {
    const compareToggle = page.locator("#compareToggleButton");
    const thCompareB = page.locator("#thCompareB");
    const thDelta = page.locator("#thDelta");

    // Before toggling: extra headers hidden, button not pressed.
    await expect(thCompareB).toBeHidden();
    await expect(thDelta).toBeHidden();
    await expect(compareToggle).toHaveAttribute("aria-pressed", "false");

    // Enable compare mode — wait for the compare header to appear (async fetch).
    await compareToggle.click();
    await expect(thCompareB).toBeVisible();
    await expect(compareToggle).toHaveAttribute("aria-pressed", "true");
    await expect(thDelta).toBeVisible();

    // Delta cells should be present in the table.
    const deltaCells = page.locator(`td[data-label="Δ"]`);
    const deltaCellCount = await deltaCells.count();
    expect(deltaCellCount).toBeGreaterThan(0);

    // Toggle off — extra headers hide again.
    await compareToggle.click();
    await expect(compareToggle).toHaveAttribute("aria-pressed", "false");
    await expect(thCompareB).toBeHidden();
    await expect(thDelta).toBeHidden();
  });
});
