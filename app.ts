/**
 * app.ts — Entry point and service layer.
 *
 * This file is intentionally thin: it owns only the async service functions
 * that bridge the DOM modules (state, render, analytics-panel, event-handlers)
 * with the server API and localStorage.  All state definitions, rendering
 * logic, analytics charts, and DOM event bindings live in their own modules.
 *
 * Wiring order in bootstrap():
 *   1. Wire forward references (setSaveStateRef, setLoad…Ref, …) so that the
 *      other modules can call back into these service functions without a
 *      circular import.
 *   2. Load contenders JSON → populate state.ts category/seed data.
 *   3. Load profiles, then localStorage state, then API state.
 *   4. Bind all DOM event listeners (event-handlers).
 *   5. Kick off background polling + SSE stream.
 */

import LZString from "lz-string";
import { clamp } from "./forecast-utils.js";
import type { Strength } from "./types.js";
import { initScoringWasm } from "./scoring-wasm.js";
import { contenderFilmSchema } from "./schemas.js";

// ── State module ───────────────────────────────────────────────────────────────
import {
  state,
  trendHistory,
  comparePayloadCache,
  compareInflightMap,
  projectionsCache,
  bootstrapCIByCategory,
  profileAuthMap,
  profileOptions,
  backendOfflineMode,
  compareProfileId,
  DATA_DRIVEN_PRESET,
  STORAGE_KEY,
  API_PROFILE_LIST_URL,
  API_FORECAST_BASE_URL,
  EXTERNAL_SIGNALS_URL,
  EXTERNAL_SIGNALS_POLL_MS,
  TREND_HISTORY_LIMIT,
  TREND_WINDOW_OPTIONS,
  categories,
  projectionCacheVersion,
  applyExternalSignalSnapshot,
  serializeStatePayload,
  applyStatePayload,
  createSeedFilms,
  loadUserPresets,
  setCategories,
  setCategorySeeds,
  setScheduledFilms,
  setPriorCategoryWins,
  setRecentWinnerPenalty,
  setOverdueNarrativeBoost,
  setProfileOptions,
  setResolveUnlock,
  setUnlockProfileId,
  setIsBootstrapping,
  setUserPresets,
  setJointProbData,
  setBootstrapSamples,
  setProjectionCacheVersion,
} from "./state.js";
import type { ContendersData, JointProbData, StatePayload, TrendSnapshot } from "./state.js";

// ── Render module ──────────────────────────────────────────────────────────────
import {
  render,
  saveState as renderSaveState,
  setSaveStateRef,
  setAppNotice,
  setBackendOfflineMode,
  setPanelsBusy,
  initTheme,
  updateLockButton,
  openAuthDialog,
  renderProfileOptions,
  renderWeightPresets,
  scraperHealthBadge,
} from "./render.js";

// ── Analytics panel ────────────────────────────────────────────────────────────
import { loadBacktest } from "./analytics-panel.js";

// ── Event handlers ─────────────────────────────────────────────────────────────
import {
  setLoadStateRef,
  setLoadStateFromApiRef,
  setLoadProfilesRef,
  setRefreshAuthStatusRef,
  setPromptUnlockRef,
  setFetchAndRenderCompareRef,
  setSaveStateToApiRef,
  setGetLocalStorageKeyForProfileRef,
  setGetForecastApiUrlRef,
  setCsrfTokenRef,
  reportClientError,
  bindWindowErrorHandlers,
  bindWeightSliders,
  bindSavePresetButton,
  bindWeightPresets,
  bindThemeToggle,
  bindOddsModeToggle,
  bindLockNomineesButton,
  bindUndoToast,
  bindSurpriseMe,
  bindConsensusImport,
  bindBuzzSync,
  bindCsvControls,
  bindSearchControls,
  bindTrendControls,
  bindPrintControls,
  bindSnapshotCompareControls,
  bindCompareControls,
  bindProfileLockButton,
  bindProfileControls,
  bindShareControls,
} from "./event-handlers.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const SCRAPE_OBSERVABILITY_URL = "/api/scrape-observability";
const SCRAPE_STALE_THRESHOLD_MINUTES = 120;

// ── Service helpers ───────────────────────────────────────────────────────────

function getLocalStorageKeyForProfile(profileId = state.profileId): string {
  return `${STORAGE_KEY}.${profileId}`;
}

function getForecastApiUrl(profileId = state.profileId): string {
  return `${API_FORECAST_BASE_URL}/${encodeURIComponent(profileId)}`;
}

/** Reads the CSRF token from the `oscar_csrf` cookie set by the server on HTML delivery. */
function getCsrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)oscar_csrf=([^;]+)/);
  return m?.[1] ?? "";
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function refreshAuthStatus(profileId: string): Promise<void> {
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/auth-status`);
    if (!res.ok) return;
    const data = await res.json() as { hasPassphrase: boolean; authenticated: boolean };
    profileAuthMap.set(profileId, data);
    updateLockButton();
  } catch { /* ignore */ }
}

function promptUnlock(profileId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    setResolveUnlock(resolve);
    setUnlockProfileId(profileId);
    openAuthDialog("unlock");
  });
}

// ── Profile management ────────────────────────────────────────────────────────

async function loadProfiles(): Promise<void> {
  try {
    const response = await fetch(API_PROFILE_LIST_URL, { cache: "no-store" });
    if (!response.ok) {
      setBackendOfflineMode(true);
      renderProfileOptions();
      return;
    }
    setBackendOfflineMode(Boolean(response.headers.get("X-Sw-Cached")));
    const doc = await response.json();
    const entries: Array<{ id?: unknown; hasPassphrase?: unknown }> = Array.isArray(doc.profiles) ? doc.profiles : [];
    const ids: string[] = entries.map((e) => String(e.id || "")).filter(Boolean);
    if (!ids.length) ids.push("default");
    setProfileOptions([...new Set(ids)]);
    for (const entry of entries) {
      const id = String(entry.id || "");
      if (id) profileAuthMap.set(id, { hasPassphrase: !!entry.hasPassphrase, authenticated: profileAuthMap.get(id)?.authenticated ?? false });
    }
    if (typeof doc.activeProfileId === "string" && profileOptions.includes(doc.activeProfileId)) {
      state.profileId = doc.activeProfileId;
    } else if (!profileOptions.includes(state.profileId)) {
      state.profileId = profileOptions[0];
    }
    renderProfileOptions();
    await refreshAuthStatus(state.profileId);
  } catch {
    setBackendOfflineMode(true);
    renderProfileOptions();
  }
}

// ── State persistence ─────────────────────────────────────────────────────────

async function saveStateToApi(): Promise<boolean> {
  try {
    const response = await fetch(getForecastApiUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrfToken() },
      body: JSON.stringify(serializeStatePayload()),
    });
    if (response.status === 401) {
      const ok = await promptUnlock(state.profileId);
      if (ok) {
        const retryOk = await saveStateToApi();
        if (!retryOk) setAppNotice("Save failed after unlock — changes may not be persisted.", "error");
      }
      return false;
    }
    if (!response.ok) {
      setBackendOfflineMode(true);
      return false;
    }
    setBackendOfflineMode(false);
    return true;
  } catch {
    setBackendOfflineMode(true);
    return false;
  }
}

async function mergeServerHistory(profileId: string): Promise<void> {
  try {
    const res = await fetch(
      `${API_FORECAST_BASE_URL}/${encodeURIComponent(profileId)}/history`,
      { cache: "no-store" }
    );
    if (!res.ok) return;
    const doc = await res.json();
    if (!doc || !Array.isArray(doc.snapshots) || doc.snapshots.length === 0) return;

    const existingDates = new Set<string>();
    for (const snap of trendHistory.snapshots) {
      existingDates.add(`${snap.categoryId}::${snap.capturedAt.slice(0, 10)}`);
    }

    const serverSnaps: TrendSnapshot[] = [];
    for (const raw of doc.snapshots as unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const snap = raw as Record<string, unknown>;
      const categoryId = typeof snap.categoryId === "string" ? snap.categoryId : null;
      const snappedAt  = typeof snap.snappedAt  === "string" ? snap.snappedAt  : null;
      const entries    = Array.isArray(snap.entries) ? snap.entries : [];
      if (!categoryId || !snappedAt) continue;
      if (existingDates.has(`${categoryId}::${snappedAt}`)) continue;
      serverSnaps.push({
        categoryId,
        capturedAt: `${snappedAt}T12:00:00.000Z`,
        sourceSnapshotId: null,
        entries: (entries as unknown[]).flatMap((e) => {
          if (!e || typeof e !== "object") return [];
          const entry = e as Record<string, unknown>;
          const key   = typeof entry.key === "string" ? entry.key : null;
          if (!key) return [];
          return [{
            key,
            title:      typeof entry.title   === "string" ? entry.title   : "",
            nomination: typeof entry.nomPct  === "number" ? entry.nomPct  : 0,
            winner:     typeof entry.winPct  === "number" ? entry.winPct  : 0,
          }];
        }),
      });
    }

    if (serverSnaps.length === 0) return;
    trendHistory.snapshots = [...serverSnaps, ...trendHistory.snapshots]
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .slice(-TREND_HISTORY_LIMIT);
  } catch {
    // Non-blocking — server history is best-effort.
  }
}

async function loadStateFromApi(): Promise<void> {
  const profileId = state.profileId;
  setAppNotice("Syncing…", "loading");
  try {
    const response = await fetch(getForecastApiUrl(profileId), { cache: "no-store" });
    if (!response.ok) {
      setBackendOfflineMode(true);
      return;
    }
    const doc = await response.json();
    if (!doc || typeof doc !== "object" || !doc.payload) return;
    setBackendOfflineMode(Boolean(response.headers.get("X-Sw-Cached")));
    applyStatePayload(doc.payload);
    await mergeServerHistory(profileId);
  } catch {
    setBackendOfflineMode(true);
  } finally {
    setAppNotice("");
  }
}

function saveState(): void {
  try {
    localStorage.setItem(getLocalStorageKeyForProfile(), JSON.stringify(serializeStatePayload()));
  } catch {
    // Ignore storage failures (private mode or blocked storage).
  }

  comparePayloadCache.delete(state.profileId);
  setProjectionCacheVersion(projectionCacheVersion + 1);
  projectionsCache.clear();
  bootstrapCIByCategory.clear();

  void saveStateToApi();
}

function loadState(): void {
  try {
    const raw = localStorage.getItem(getLocalStorageKeyForProfile());
    if (!raw) return;
    applyStatePayload(JSON.parse(raw));
  } catch {
    // Ignore malformed state.
  }
}

// ── Compare ───────────────────────────────────────────────────────────────────

async function fetchComparePayload(profileId: string): Promise<StatePayload | null> {
  if (comparePayloadCache.has(profileId)) return comparePayloadCache.get(profileId) ?? null;
  if (compareInflightMap.has(profileId)) return compareInflightMap.get(profileId)!;

  const promise = (async () => {
    try {
      const res = await fetch(getForecastApiUrl(profileId), { cache: "no-store" });
      if (!res.ok) {
        setBackendOfflineMode(true);
        return null;
      }
      const doc = await res.json();
      setBackendOfflineMode(false);
      if (comparePayloadCache.size >= 20) comparePayloadCache.delete(comparePayloadCache.keys().next().value!);
      // Cache even when payload is null (fresh profile) so renderActiveView
      // knows the load is complete and renders compare columns (with "—" deltas).
      const payload = doc?.payload ?? {} as StatePayload;
      comparePayloadCache.set(profileId, payload);
      return payload;
    } catch {
      setBackendOfflineMode(true);
      return null;
    } finally {
      compareInflightMap.delete(profileId);
    }
  })();

  compareInflightMap.set(profileId, promise);
  return promise;
}

async function fetchAndRenderCompare(): Promise<void> {
  if (!compareProfileId) return;
  setAppNotice("Loading comparison profile…", "loading");
  await fetchComparePayload(compareProfileId);
  setAppNotice("");
  render();
}

// ── External signal polling ───────────────────────────────────────────────────

async function fetchAndApplyExternalSignals(): Promise<void> {
  try {
    const response = await fetch(`${EXTERNAL_SIGNALS_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      setAppNotice("External source snapshot unavailable. Showing latest saved forecast.", "error");
      return;
    }
    const snapshot = await response.json();
    const changed = applyExternalSignalSnapshot(snapshot);
    if (!changed) {
      // Background sync found no new data — leave any existing notice undisturbed.
      return;
    }
    saveState();
    render();
    setAppNotice(`Applied source refresh from ${new Date((snapshot as { generatedAt?: string }).generatedAt || Date.now()).toLocaleString()}.`);
  } catch (err) {
    // External signals are best-effort; don't surface network errors in the UI,
    // but log so developers can diagnose connectivity issues.
    console.warn("[external-signals] fetch failed:", err);
  }
}

function startExternalSignalPolling(): void {
  void fetchAndApplyExternalSignals();
  setInterval(() => { void fetchAndApplyExternalSignals(); }, EXTERNAL_SIGNALS_POLL_MS);
}

// ── Scraper health ────────────────────────────────────────────────────────────

async function checkScraperHealth(): Promise<void> {
  if (!scraperHealthBadge) return;
  try {
    const res = await fetch(SCRAPE_OBSERVABILITY_URL, { cache: "no-store" });
    if (!res.ok) return;
    const obs = await res.json();
    const sources = (obs as Record<string, unknown>)?.sources as Record<string, unknown> || {};
    const now = Date.now();
    const staleSourceNames = Object.entries(sources)
      .filter(([, rawMetrics]) => {
        const metrics = rawMetrics as { consecutiveFailures?: number; lastSuccessAt?: string; attempts?: number };
        if ((metrics.consecutiveFailures ?? 0) > 0) return true;
        if (metrics.lastSuccessAt) {
          const ageMinutes = (now - Date.parse(metrics.lastSuccessAt)) / 60000;
          if (ageMinutes > SCRAPE_STALE_THRESHOLD_MINUTES) return true;
        } else if ((metrics.attempts ?? 0) > 0) {
          return true;
        }
        return false;
      })
      .map(([id]) => id);

    if (staleSourceNames.length > 0) {
      scraperHealthBadge.textContent = `Sources stale: ${staleSourceNames.join(", ")}`;
      scraperHealthBadge.hidden = false;
    } else {
      scraperHealthBadge.hidden = true;
    }
  } catch {
    // Fail silently — badge is informational only
  }
}

function startScraperEventStream(): void {
  void checkScraperHealth();
  const evtSource = new EventSource("/api/scraper-events");
  evtSource.onmessage = () => { void checkScraperHealth(); };
}

// ── Contenders loader ─────────────────────────────────────────────────────────

async function loadContenders(): Promise<void> {
  const res = await fetch("/api/contenders");
  if (!res.ok) throw new Error(`Failed to load contenders: ${res.status}`);
  const data = await res.json() as ContendersData;

  setScheduledFilms(data.scheduledFilms);
  const seeds = Object.fromEntries(
    Object.entries(data.categorySeeds).map(([id, films]) => [
      id,
      (films as unknown[]).flatMap((f) => {
        const result = contenderFilmSchema.safeParse(f);
        if (!result.success) {
          console.warn(`[loadContenders] dropping invalid film in "${id}":`, result.error.issues);
          return [];
        }
        return [result.data];
      }),
    ])
  );
  setCategorySeeds(seeds);
  setCategories(data.categoryDefinitions.map((cat) => ({
    ...cat,
    // Deep-copy each film so that categorySeeds remains an immutable baseline
    // for serializeSharePayload() comparisons.  A shallow [...array] copy shares
    // the underlying film objects with categorySeeds, causing mutations made via
    // the UI to silently zero-out the comparison delta.
    films: seeds[cat.id] ? seeds[cat.id].map((f) => ({ ...f })) : createSeedFilms(),
  })));
  setPriorCategoryWins(data.experienceConfig.priorCategoryWins);
  setRecentWinnerPenalty(data.experienceConfig.recentWinnerPenalty);
  setOverdueNarrativeBoost(data.experienceConfig.overdueNarrativeBoost);

  if (!state.categoryId && categories.length > 0) {
    state.categoryId = categories[0].id;
  }
}

// ── Share param ───────────────────────────────────────────────────────────────

function applyShareParam(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const compressed = params.get("share");
    if (!compressed) return;

    const json = LZString.decompressFromEncodedURIComponent(compressed);
    if (!json) return;

    const p = JSON.parse(json) as Record<string, unknown>;

    if (typeof p.c === "string" && categories.some((cat) => cat.id === p.c))
      state.categoryId = p.c;

    if (Array.isArray(p.w) && p.w.length === 3) {
      state.weights.precursor = clamp(Number(p.w[0]), 1, 95);
      state.weights.history   = clamp(Number(p.w[1]), 1, 95);
      state.weights.buzz      = clamp(Number(p.w[2]), 1, 95);
    }

    if (TREND_WINDOW_OPTIONS.includes(Number(p.t))) state.trendWindow = Number(p.t);

    if (p.s && typeof p.s === "object") {
      const sliders = p.s as Record<string, Record<string, unknown>>;
      for (const cat of categories) {
        const catSliders = sliders[cat.id];
        if (!catSliders || typeof catSliders !== "object") continue;
        for (const film of cat.films) {
          const vals = catSliders[film.title];
          if (Array.isArray(vals) && vals.length === 3) {
            film.precursor = clamp(Number(vals[0]), 0, 100);
            film.history   = clamp(Number(vals[1]), 0, 100);
            film.buzz      = clamp(Number(vals[2]), 0, 100);
          }
        }
      }
    }

    window.history.replaceState(null, "", window.location.pathname);
    setAppNotice("Shared forecast loaded.", "");
    setTimeout(() => setAppNotice(""), 4000);
  } catch {
    // Malformed or corrupted share param — silently ignore
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // Wire forward references before any bind functions run so they can safely
  // call back into service functions defined in this module.
  setSaveStateRef(saveState);
  setLoadStateRef(loadState);
  setLoadStateFromApiRef(loadStateFromApi);
  setLoadProfilesRef(loadProfiles);
  setRefreshAuthStatusRef(refreshAuthStatus);
  setPromptUnlockRef(promptUnlock);
  setFetchAndRenderCompareRef(fetchAndRenderCompare);
  setSaveStateToApiRef(saveStateToApi);
  setGetLocalStorageKeyForProfileRef(getLocalStorageKeyForProfile);
  setGetForecastApiUrlRef(getForecastApiUrl);
  setCsrfTokenRef(getCsrfToken);

  bindWindowErrorHandlers();

  initTheme();
  setPanelsBusy(true);
  setAppNotice("Loading forecast workspace...", "loading");

  await loadContenders();

  void initScoringWasm("/wasm/scoring.wasm").catch(() => {
    // WASM unavailable — JS fallback handles all scoring silently.
  });

  await loadProfiles();
  loadState();
  await loadStateFromApi();
  setUserPresets(loadUserPresets());

  // Helper: fetch an analytics JSON endpoint.
  // 404 → null (file not generated yet, expected).
  // Any other non-ok status or network/parse error → null + console.warn so
  // developers can diagnose without showing noise in the user-facing UI.
  async function fetchAnalytics(endpoint: string): Promise<unknown> {
    try {
      const r = await fetch(endpoint);
      if (r.status === 404) return null;               // not generated yet — expected
      if (!r.ok) {
        console.warn(`[bootstrap] ${endpoint} returned HTTP ${r.status}`);
        return null;
      }
      return await r.json();
    } catch (err) {
      console.warn(`[bootstrap] ${endpoint} failed:`, err);
      return null;
    }
  }

  // Populate the Data-Driven preset with ML-learned weights if available.
  void fetchAnalytics("/api/learned-weights").then((data: unknown) => {
    if (!data || typeof data !== "object") return;
    const w = (data as Record<string, unknown>).weights as Record<string, unknown> | undefined;
    if (typeof w?.precursor !== "number" || typeof w?.history !== "number" || typeof w?.buzz !== "number") return;
    const p = Math.round((w.precursor as number) * 100);
    const h = Math.round((w.history   as number) * 100);
    const b = Math.round((w.buzz      as number) * 100);
    if (p + h + b < 98 || p + h + b > 102) return;
    DATA_DRIVEN_PRESET.precursor = p;
    DATA_DRIVEN_PRESET.history   = h;
    DATA_DRIVEN_PRESET.buzz      = b;
    DATA_DRIVEN_PRESET.name = `Data-Driven (${p}/${h}/${b})`;
    renderWeightPresets();
  });

  // Fetch joint-probability correlation data for sweep analysis.
  void fetchAnalytics("/api/joint-probability").then((data: unknown) => {
    if (!data || typeof data !== "object") return;
    const d = data as Record<string, unknown>;
    if (!Array.isArray(d.categories) || typeof d.condRates !== "object") return;
    setJointProbData(data as JointProbData);
    render();
  });

  // Fetch bootstrap weight samples for per-film confidence intervals.
  void fetchAnalytics("/api/bootstrap-ci").then((data: unknown) => {
    if (!data || typeof data !== "object") return;
    const samples = (data as Record<string, unknown>).samples;
    if (!Array.isArray(samples) || !samples.length) return;
    setBootstrapSamples(samples as Array<[number, number, number]>);
    bootstrapCIByCategory.clear();
    render();
  });

  bindProfileControls();
  bindProfileLockButton();
  bindTrendControls();
  bindCsvControls();
  bindLockNomineesButton();
  bindSnapshotCompareControls();
  bindSurpriseMe();
  bindUndoToast();
  bindConsensusImport();
  bindBuzzSync();
  bindWeightSliders();
  bindSavePresetButton();
  bindWeightPresets();
  bindOddsModeToggle();
  bindThemeToggle();
  bindPrintControls();
  bindSearchControls();
  bindCompareControls();
  bindShareControls();

  setIsBootstrapping(false);
  setPanelsBusy(false);
  if (backendOfflineMode) {
    setAppNotice("Offline mode — data loaded from local storage.", "error");
  } else {
    setAppNotice("");
  }
  applyShareParam();
  render();
  startExternalSignalPolling();
  startScraperEventStream();
  void loadBacktest();
}

void bootstrap().catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  reportClientError({
    message: error.message,
    stack:   error.stack,
    context: `bootstrap:${window.location.pathname}`,
  });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // SW registration is best-effort; failure doesn't affect core functionality.
  });
}

