import { clamp } from "./forecast-utils.js";
import {
  esc,
  state,
  categories,
  lockedCategories,
  surpriseBuzzUndo,
  searchQuery,
  compareMode,
  compareProfileId,
  snapshotCompareMode,
  snapshotDateA,
  snapshotDateB,
  oddsMode,
  comparePayloadCache,
  projectionCacheVersion,
  jointProbData,
  summaryCardMap,
  activeSummaryCard,
  summaryBarBuiltAtVersion,
  profileAuthMap,
  explainSelectionByCategory,
  activePosterRequestId,
  posterFallbackActive,
  backendOfflineMode,
  lastOddsRecalculatedAt,
  lastSourceSyncAt,
  userPresets,
  BUILTIN_PRESETS,
  CATEGORY_SHORT_NAMES,
  MOMENTUM_STABLE_THRESHOLD,
  MOMENTUM_STRONG_THRESHOLD,
  isBootstrapping,
  getActiveCategory,
  getCategoryCompletion,
  getDisplayLimit,
  getPrimaryColumnLabel,
  getSelectedFilmTitle,
  trendKeyForEntry,
  captureTrendSnapshot,
  pointsForEntryTrend,
  computeMomentum,
  computeCategoryMomentum,
  momentumBadgeHtml,
  getSnapshotDays,
  getSnapshotForDay,
  getContenderOddsFromSnapshot,
  formatSnapshotDay,
  formatTrendStamp,
  buildPolylinePath,
  buildProjections,
  getCachedProjections,
  getCategoryBootstrapCI,
  getActivePreset,
  normalizeMovieDetailKey,
  getTmdbSearchUrl,
  normalizePosterRenderUrl,
  buildPosterFallbackDataUrl,
  parseFilmRecord,
  findBuzzSyncTargets,
  profileOptions,
  setActiveSummaryCard,
  setSummaryBarBuiltAtVersion,
  setActivePosterRequestId,
  setPosterFallbackActive,
  setSearchQuery,
  setCompareProfileId,
  setSnapshotDateA,
  setSnapshotDateB,
  setPendingBuzzSync,
  setPendingUndo,
  setUndoToastTimer,
  setAuthDialogMode,
  setLastOddsRecalculatedAt,
  setBackendOfflineMode as setBackendOfflineModeState,
  movieDetailsIndex,
  DATA_DRIVEN_PRESET,
  formatTimestamp,
  CompletionState,
  OddsMode,
  StatePayload,
  TrendPoint,
} from "./state.js";
import type { Category, Film, NormalizedWeights, Projection, Strength } from "./types.js";

// ── All module-level DOM references ──────────────────────────────────────────

export const categoryTabs = document.querySelector<HTMLElement>("#categoryTabs")!;
export const categorySummaryBar = document.querySelector<HTMLElement>("#categorySummaryBar");
export const leaderboardBody = document.querySelector<HTMLTableSectionElement>("#leaderboardBody");
export const categoryTitle = document.querySelector<HTMLElement>("#categoryTitle")!;
export const candidateCards = document.querySelector<HTMLElement>("#candidateCards")!;
export const resultsBody = document.querySelector<HTMLTableSectionElement>("#resultsBody")!;
export const resultsPrimaryHeader = document.querySelector<HTMLElement>("#resultsPrimaryHeader");
export const oddsLastUpdated = document.querySelector<HTMLElement>("#oddsLastUpdated");
export const explainTitle = document.querySelector<HTMLElement>("#explainTitle")!;
export const explainMeta = document.querySelector<HTMLElement>("#explainMeta")!;
export const explainDelta = document.querySelector<HTMLElement>("#explainDelta")!;
export const explainBreakdown = document.querySelector<HTMLElement>("#explainBreakdown")!;
export const explainNotes = document.querySelector<HTMLElement>("#explainNotes")!;
export const trendTitle = document.querySelector<HTMLElement>("#trendTitle")!;
export const trendMeta = document.querySelector<HTMLElement>("#trendMeta")!;
export const trendChart = document.querySelector<SVGElement>("#trendChart");
export const trendSourceMoves = document.querySelector<HTMLElement>("#trendSourceMoves");
export const trendWindowSelect = document.querySelector<HTMLSelectElement>("#trendWindowSelect");
export const trendWindowControl = document.querySelector<HTMLElement>("#trendWindowControl");
export const snapshotCompareToggle = document.querySelector<HTMLButtonElement>("#snapshotCompareToggle");
export const snapshotCompareControls = document.querySelector<HTMLElement>("#snapshotCompareControls");
export const snapshotDateASelect = document.querySelector<HTMLSelectElement>("#snapshotDateA");
export const snapshotDateBSelect = document.querySelector<HTMLSelectElement>("#snapshotDateB");
export const appStateNotice = document.querySelector<HTMLElement>("#appStateNotice");
export const scraperHealthBadge = document.querySelector<HTMLElement>("#scraperHealthBadge");
export const contenderSearch = document.querySelector<HTMLInputElement>("#contenderSearch");
export const contenderSearchClear = document.querySelector<HTMLElement>("#contenderSearchClear");
export const compareToggleButton = document.querySelector<HTMLButtonElement>("#compareToggleButton");
export const compareControls = document.querySelector<HTMLElement>("#compareControls");
export const compareProfileSelect = document.querySelector<HTMLSelectElement>("#compareProfileSelect");
export const thNomination = document.querySelector<HTMLElement>("#thNomination");
export const thWinner = document.querySelector<HTMLElement>("#thWinner");
export const thCompareB = document.querySelector<HTMLElement>("#thCompareB");
export const thDelta = document.querySelector<HTMLElement>("#thDelta");
export const oddsModeToggle = document.querySelector<HTMLButtonElement>("#oddsModeToggle");
export const thLeaderboardNominations = document.querySelector<HTMLElement>("#thLeaderboardNominations");
export const thLeaderboardWins = document.querySelector<HTMLElement>("#thLeaderboardWins");
export const resultsPanel = document.querySelector<HTMLElement>("#resultsPanel");
export const movieDetailTitle = document.querySelector<HTMLElement>("#movieDetailTitle")!;
export const movieDetailDirector = document.querySelector<HTMLElement>("#movieDetailDirector")!;
export const movieDetailStars = document.querySelector<HTMLElement>("#movieDetailStars")!;
export const movieDetailGenre = document.querySelector<HTMLElement>("#movieDetailGenre")!;
export const movieDetailDescription = document.querySelector<HTMLElement>("#movieDetailDescription")!;
export const posterSkeleton = document.querySelector<HTMLElement>("#posterSkeleton");
export const movieDetailPoster = document.querySelector<HTMLImageElement>("#movieDetailPoster")!;
export const movieDetailPosterLink = document.querySelector<HTMLAnchorElement>("#movieDetailPosterLink")!;
export const exportCsvButton = document.querySelector<HTMLButtonElement>("#exportCsvButton")!;
export const importCsvButton = document.querySelector<HTMLButtonElement>("#importCsvButton")!;
export const lockNomineesButton  = document.querySelector<HTMLButtonElement>("#lockNomineesButton");
export const surpriseMeButton    = document.querySelector<HTMLButtonElement>("#surpriseMeButton");
export const consensusImportButton   = document.querySelector<HTMLButtonElement>("#consensusImportButton");
export const consensusImportDialog   = document.querySelector<HTMLDialogElement>("#consensusImportDialog");
export const consensusImportInput    = document.querySelector<HTMLTextAreaElement>("#consensusImportInput");
export const consensusImportStatus   = document.querySelector<HTMLElement>("#consensusImportStatus");
export const consensusImportCategory = document.querySelector<HTMLElement>("#consensusImportCategory");
export const consensusImportApply    = document.querySelector<HTMLButtonElement>("#consensusImportApply");
export const consensusImportCancel   = document.querySelector<HTMLButtonElement>("#consensusImportCancel");
export const buzzSyncBanner  = document.querySelector<HTMLElement>("#buzzSyncBanner");
export const buzzSyncMessage = document.querySelector<HTMLElement>("#buzzSyncMessage");
export const buzzSyncApply   = document.querySelector<HTMLButtonElement>("#buzzSyncApply");
export const buzzSyncDismiss = document.querySelector<HTMLButtonElement>("#buzzSyncDismiss");
export const restoreBuzzButton   = document.querySelector<HTMLButtonElement>("#restoreBuzzButton");
export const undoToast        = document.querySelector<HTMLElement>("#undoToast");
export const undoToastMessage = document.querySelector<HTMLElement>("#undoToastMessage");
export const undoToastButton  = document.querySelector<HTMLButtonElement>("#undoToastButton");
export const undoToastDismiss = document.querySelector<HTMLButtonElement>("#undoToastDismiss");
export const precursorSlider  = document.querySelector<HTMLInputElement>("#precursorSlider");
export const historySlider    = document.querySelector<HTMLInputElement>("#historySlider");
export const buzzSlider       = document.querySelector<HTMLInputElement>("#buzzSlider");
export const precursorDisplay = document.querySelector<HTMLElement>("#precursorDisplay");
export const historyDisplay   = document.querySelector<HTMLElement>("#historyDisplay");
export const buzzDisplay      = document.querySelector<HTMLElement>("#buzzDisplay");
export const weightPresetsEl  = document.querySelector<HTMLElement>("#weightPresets");
export const savePresetButton = document.querySelector<HTMLButtonElement>("#savePresetButton");
export const csvFileInput = document.querySelector<HTMLInputElement>("#csvFileInput")!;
export const csvStatus = document.querySelector<HTMLElement>("#csvStatus")!;
export const profileSelect = document.querySelector<HTMLSelectElement>("#profileSelect")!;
export const newProfileButton = document.querySelector<HTMLButtonElement>("#newProfileButton")!;
export const renameProfileButton = document.querySelector<HTMLButtonElement>("#renameProfileButton");
export const deleteProfileButton = document.querySelector<HTMLButtonElement>("#deleteProfileButton");
export const profileLockButton       = document.querySelector<HTMLButtonElement>("#profileLockButton");
export const authDialog              = document.querySelector<HTMLDialogElement>("#authDialog");
export const authDialogTitle         = document.querySelector<HTMLElement>("#authDialogTitle");
export const authDialogDesc          = document.querySelector<HTMLElement>("#authDialogDesc");
export const authDialogForm          = document.querySelector<HTMLElement>("#authDialogForm");
export const authPassphraseInput     = document.querySelector<HTMLInputElement>("#authPassphraseInput");
export const authPassphraseConfirm   = document.querySelector<HTMLInputElement>("#authPassphraseConfirm");
export const authConfirmLabel        = document.querySelector<HTMLElement>("#authConfirmLabel");
export const authDialogError         = document.querySelector<HTMLElement>("#authDialogError");
export const authDialogSubmit        = document.querySelector<HTMLButtonElement>("#authDialogSubmit");
export const authDialogCancel        = document.querySelector<HTMLButtonElement>("#authDialogCancel");
export const authSecurityOptions     = document.querySelector<HTMLElement>("#authSecurityOptions");
export const authChangePassphraseBtn = document.querySelector<HTMLButtonElement>("#authChangePassphraseBtn");
export const authRemovePassphraseBtn = document.querySelector<HTMLButtonElement>("#authRemovePassphraseBtn");
export const authLogoutBtn           = document.querySelector<HTMLButtonElement>("#authLogoutBtn");
export const authSecurityClose       = document.querySelector<HTMLButtonElement>("#authSecurityClose");
export const printPdfButton = document.querySelector<HTMLButtonElement>("#printPdfButton");
export const themeToggleButton = document.querySelector<HTMLButtonElement>("#themeToggleButton");
export const printMeta = document.querySelector<HTMLElement>("#printMeta");
export const backtestStatus         = document.querySelector<HTMLElement>("#backtestStatus");
export const backtestOverview       = document.querySelector<HTMLElement>("#backtestOverview");
export const backtestStatGrid       = document.querySelector<HTMLElement>("#backtestStatGrid");
export const backtestCategoryBody   = document.querySelector<HTMLTableSectionElement>("#backtestCategoryBody");
export const backtestYearBody       = document.querySelector<HTMLTableSectionElement>("#backtestYearBody");
export const backtestCategoryFilter = document.querySelector<HTMLSelectElement>("#backtestCategoryFilter");

export const momentumStatsEl  = document.querySelector<HTMLElement>("#momentumStats");
export const momentumMoversEl = document.querySelector<HTMLElement>("#momentumMovers");
export const momentumMoversBody = document.querySelector<HTMLElement>("#momentumMoversBody");

// ── Theme ─────────────────────────────────────────────────────────────────────

const THEME_STORAGE_KEY = "oscar-odds:theme";
type Theme = "dark" | "light";

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  if (themeToggleButton) {
    themeToggleButton.textContent = theme === "dark" ? "Light mode" : "Dark mode";
    themeToggleButton.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
}

export function initTheme(): void {
  const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
  const osDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effective: Theme = stored ?? (osDark ? "dark" : "light");
  if (stored) document.documentElement.dataset.theme = stored;
  if (themeToggleButton) {
    themeToggleButton.textContent = effective === "dark" ? "Light mode" : "Dark mode";
    themeToggleButton.setAttribute("aria-label", effective === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
}

// ── Notice / status helpers ───────────────────────────────────────────────────

export function setAppNotice(message = "", type = ""): void {
  if (!appStateNotice) return;
  if (!message && backendOfflineMode) {
    appStateNotice.textContent = "Offline mode — data loaded from local storage.";
    appStateNotice.className = "app-notice error";
    return;
  }
  appStateNotice.textContent = message;
  appStateNotice.className = `app-notice${type ? ` ${type}` : ""}`;
}

export function setBackendOfflineMode(isOffline: boolean): void {
  setBackendOfflineModeState(isOffline);
  if (isOffline) {
    setAppNotice("Offline mode — data loaded from local storage.", "error");
    return;
  }
  if (appStateNotice?.textContent === "Offline mode — data loaded from local storage.") {
    setAppNotice("");
  }
}

export function setPanelsBusy(isBusy: boolean): void {
  const busyValue = isBusy ? "true" : "false";
  if (resultsPanel) resultsPanel.setAttribute("aria-busy", busyValue);
  if (candidateCards) candidateCards.setAttribute("aria-busy", busyValue);
}

export function setCsvStatus(message: string, type = ""): void {
  csvStatus.textContent = message;
  csvStatus.className = `tool-status${type ? ` ${type}` : ""}`;
}

export function setConsensusImportStatus(msg: string, isError: boolean): void {
  if (!consensusImportStatus) return;
  consensusImportStatus.textContent = msg;
  consensusImportStatus.className = `consensus-import-status${isError ? " error" : ""}`;
  consensusImportStatus.hidden = false;
}

export function showBuzzSyncBanner(film: Film, sourceCategory: Category): void {
  const targets = findBuzzSyncTargets(film.title, sourceCategory.id);
  if (targets.length === 0) { clearBuzzSyncBanner(); return; }
  setPendingBuzzSync({ title: film.title, buzz: film.buzz, targets });
  if (buzzSyncMessage) {
    const catNames = targets.map(c => c.name).join(", ");
    buzzSyncMessage.textContent = `"${film.title}" buzz → ${film.buzz}. Sync to: ${catNames}?`;
  }
  if (buzzSyncBanner) buzzSyncBanner.hidden = false;
}

export function clearBuzzSyncBanner(): void {
  setPendingBuzzSync(null);
  if (buzzSyncBanner) buzzSyncBanner.hidden = true;
}

export function showUndoToast(message: string, onUndo: () => void, durationMs = 8000): void {
  setPendingUndo(onUndo);
  if (undoToastMessage) undoToastMessage.textContent = message;
  if (undoToast) undoToast.hidden = false;
  const prev = undoToastTimerRef;
  if (prev) clearTimeout(prev);
  const t = setTimeout(dismissUndoToast, durationMs);
  undoToastTimerRef = t;
  setUndoToastTimer(t);
}

// Local ref to the undo toast timer (needed for clearTimeout in this module)
let undoToastTimerRef: ReturnType<typeof setTimeout> | null = null;

export function dismissUndoToast(): void {
  if (undoToast) undoToast.hidden = true;
  if (undoToastTimerRef) { clearTimeout(undoToastTimerRef); undoToastTimerRef = null; setUndoToastTimer(null); }
  setPendingUndo(null);
}

export function updateLockButton(): void {
  if (!profileLockButton) return;
  const auth = profileAuthMap.get(state.profileId);
  if (!auth || !auth.hasPassphrase) {
    profileLockButton.textContent = "Lock";
    profileLockButton.title = "Set a passphrase to protect this profile";
  } else if (!auth.authenticated) {
    profileLockButton.textContent = "Unlock";
    profileLockButton.title = "Enter passphrase to allow editing";
  } else {
    profileLockButton.textContent = "Secured";
    profileLockButton.title = "Passphrase active — click to manage";
  }
}

export function updateOddsModeButton(): void {
  if (!oddsModeToggle) return;
  // In compare mode the table has a different 4-column layout — hide the toggle.
  oddsModeToggle.hidden = compareMode;
  const LABELS: Record<OddsMode, string> = {
    both:       "Both",
    nomination: "Nom. only",
    winner:     "Win. only",
  };
  oddsModeToggle.textContent = LABELS[oddsMode];
  oddsModeToggle.setAttribute("aria-pressed", String(oddsMode !== "both"));
  oddsModeToggle.classList.toggle("action-button--lock-active", oddsMode !== "both");
}

export function updateOddsFreshnessLabel() {
  if (!oddsLastUpdated) return;
  if (!lastOddsRecalculatedAt) {
    oddsLastUpdated.textContent = "";
    return;
  }
  const recalculated = formatTimestamp(lastOddsRecalculatedAt);
  if (!lastSourceSyncAt) {
    oddsLastUpdated.textContent = `Last recalculated: ${recalculated}`;
    return;
  }
  oddsLastUpdated.textContent = `Last recalculated: ${recalculated} • Last source sync: ${formatTimestamp(lastSourceSyncAt)}`;
}

export function updatePrintMeta() {
  if (!printMeta) return;
  const activeCategory = getActiveCategory();
  const stamp = new Date().toLocaleString();
  printMeta.textContent = `Profile: ${state.profileId} | Category: ${activeCategory?.name || "Unknown"} | Generated: ${stamp}`;
}

export function openAuthDialog(mode: "unlock" | "set" | "change"): void {
  if (!authDialog || !authDialogTitle || !authDialogDesc || !authDialogForm || !authSecurityOptions) return;
  setAuthDialogMode(mode);
  authDialogForm.hidden = false;
  authSecurityOptions.hidden = true;

  if (authPassphraseInput) authPassphraseInput.value = "";
  if (authPassphraseConfirm) authPassphraseConfirm.value = "";
  if (authDialogError) authDialogError.textContent = "";

  const showConfirm = mode === "set" || mode === "change";
  if (authConfirmLabel) authConfirmLabel.hidden = !showConfirm;
  if (authPassphraseConfirm) authPassphraseConfirm.hidden = !showConfirm;

  if (mode === "unlock") {
    authDialogTitle.textContent = "Unlock Profile";
    authDialogDesc.textContent = "Enter your passphrase to continue editing.";
    if (authDialogSubmit) authDialogSubmit.textContent = "Unlock";
    if (authPassphraseInput) authPassphraseInput.setAttribute("autocomplete", "current-password");
  } else if (mode === "set") {
    authDialogTitle.textContent = "Set Passphrase";
    authDialogDesc.textContent = "Set a passphrase to protect this profile from unauthorized changes.";
    if (authDialogSubmit) authDialogSubmit.textContent = "Set Passphrase";
    if (authPassphraseInput) authPassphraseInput.setAttribute("autocomplete", "new-password");
  } else {
    authDialogTitle.textContent = "Change Passphrase";
    authDialogDesc.textContent = "Enter and confirm your new passphrase.";
    if (authDialogSubmit) authDialogSubmit.textContent = "Change Passphrase";
    if (authPassphraseInput) authPassphraseInput.setAttribute("autocomplete", "new-password");
  }

  if (!authDialog.open) authDialog.showModal();
  authPassphraseInput?.focus();
}

export function closeAuthDialog(): void {
  if (!authDialog) return;
  setAuthDialogMode(null);
  if (authPassphraseInput) authPassphraseInput.value = "";
  if (authPassphraseConfirm) authPassphraseConfirm.value = "";
  if (authDialogError) authDialogError.textContent = "";
  if (authDialog.open) authDialog.close();
}

// ── Poster helpers ────────────────────────────────────────────────────────────

export function showPosterSkeleton(): void {
  if (posterSkeleton) posterSkeleton.hidden = false;
  if (movieDetailPoster) movieDetailPoster.classList.add("hidden");
  if (movieDetailPosterLink) movieDetailPosterLink.classList.add("hidden");
}

export function hidePosterSkeleton(): void {
  if (posterSkeleton) posterSkeleton.hidden = true;
}

export function setPosterState(posterUrl: string, movieUrl: string): void {
  const title = movieDetailTitle.textContent || "Selected Movie";
  const src = normalizePosterRenderUrl(posterUrl) || buildPosterFallbackDataUrl(title);
  const href = movieUrl || getTmdbSearchUrl(title);
  setPosterFallbackActive(!posterUrl);
  hidePosterSkeleton();
  movieDetailPoster.src = src;
  movieDetailPoster.alt = `${title} poster`;
  movieDetailPoster.classList.remove("hidden");
  movieDetailPosterLink.href = href;
  movieDetailPosterLink.classList.remove("hidden");
}

export async function loadPosterForTitle(title: string): Promise<void> {
  const requestId = activePosterRequestId + 1;
  setActivePosterRequestId(requestId);
  showPosterSkeleton();

  if (!title) {
    setPosterState("", getTmdbSearchUrl(""));
    return;
  }

  try {
    const response = await fetch(`/api/tmdb-poster?title=${encodeURIComponent(title)}`, { cache: "no-store" });
    if (requestId !== activePosterRequestId) return;
    if (!response.ok) {
      setPosterState("", getTmdbSearchUrl(title));
      return;
    }
    const payload = await response.json();
    if (requestId !== activePosterRequestId) return;
    const posterUrl = payload?.result?.posterUrl || "";
    const movieUrl = payload?.result?.movieUrl || "";
    setPosterState(posterUrl, movieUrl || getTmdbSearchUrl(title));
  } catch {
    if (requestId !== activePosterRequestId) return;
    setPosterState("", getTmdbSearchUrl(title));
  }
}

movieDetailPoster?.addEventListener("error", () => {
  if (posterFallbackActive) return;
  setPosterFallbackActive(true);
  const title = movieDetailTitle.textContent || "Selected Movie";
  movieDetailPoster.src = buildPosterFallbackDataUrl(title);
  movieDetailPoster.alt = `${title} poster`;
  movieDetailPosterLink.href = getTmdbSearchUrl(title);
});

// ── Weight presets ────────────────────────────────────────────────────────────

/** Sync slider positions and the % labels to the current state.weights. */
export function renderWeightSliders(): void {
  const total = state.weights.precursor + state.weights.history + state.weights.buzz || 1;
  const pct   = (v: number) => `${Math.round((v / total) * 100)}%`;

  if (precursorSlider)  precursorSlider.value  = String(state.weights.precursor);
  if (historySlider)    historySlider.value    = String(state.weights.history);
  if (buzzSlider)       buzzSlider.value       = String(state.weights.buzz);

  if (precursorDisplay) precursorDisplay.textContent = pct(state.weights.precursor);
  if (historyDisplay)   historyDisplay.textContent   = pct(state.weights.history);
  if (buzzDisplay)      buzzDisplay.textContent      = pct(state.weights.buzz);
}

/** Re-render the preset chips, highlighting whichever matches current weights.
 *  No event listeners are added here — a single delegated listener on
 *  weightPresetsEl (set up once in bindWeightPresets) handles all clicks. */
export function renderWeightPresets(): void {
  if (!weightPresetsEl) return;
  weightPresetsEl.innerHTML = "";

  const activePreset  = getActivePreset();
  const allPresets    = [...BUILTIN_PRESETS, ...userPresets];

  allPresets.forEach((preset, index) => {
    const isActive  = activePreset === preset;
    const isBuiltin = preset.builtin === true;

    const chip = document.createElement("span");
    chip.className = "weight-preset-chip" + (isActive ? " weight-preset-chip--active" : "");
    chip.dataset.presetIndex = String(index);

    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "weight-preset-name";
    nameBtn.textContent = preset.name;
    nameBtn.setAttribute("aria-pressed", String(isActive));
    nameBtn.title = `Precursor ${preset.precursor}  ·  Historical ${preset.history}  ·  Buzz ${preset.buzz}` +
      (preset.dataDriven ? "  ·  Learned via logistic regression (LOYO-CV)" : "");
    chip.appendChild(nameBtn);

    if (preset.dataDriven) {
      const badge = document.createElement("span");
      badge.className = "weight-preset-ml-badge";
      badge.textContent = "ML";
      badge.title = "Weights learned via logistic regression on 25 years of Oscar history";
      chip.appendChild(badge);
    }

    if (!isBuiltin) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "weight-preset-delete";
      del.textContent = "×";
      del.setAttribute("aria-label", `Delete preset "${preset.name}"`);
      chip.appendChild(del);
    }

    weightPresetsEl.appendChild(chip);
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

export function renderTabs(): void {
  categoryTabs.innerHTML = "";

  const select = document.createElement("select");
  select.className = "category-select";
  select.setAttribute("aria-label", "Oscar category");

  // Completion suffixes appended to option text — Unicode chars work in all
  // browsers and are read aloud by screen readers ("check mark", "circle").
  const COMPLETION_SUFFIX: Record<CompletionState, string> = {
    complete:  " ✓",
    partial:   " ◑",
    untouched: " ○",
  };

  categories.forEach((category) => {
    const completion = getCategoryCompletion(category);
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name + COMPLETION_SUFFIX[completion];
    option.selected = category.id === state.categoryId;
    select.appendChild(option);
  });

  select.addEventListener("change", (event) => {
    clearBuzzSyncBanner();
    state.categoryId = (event.target as HTMLSelectElement).value;
    if (searchQuery) {
      setSearchQuery("");
      if (contenderSearch) contenderSearch.value = "";
      if (contenderSearchClear) contenderSearchClear.hidden = true;
    }
    saveState();
    render();
  });

  categoryTabs.appendChild(select);
}

// ── Cards ─────────────────────────────────────────────────────────────────────

export function createCard(category: Category, film: Film, filmIndex: number): HTMLDivElement {
  const isLocked = lockedCategories.has(category.id);
  const isSnubbed = isLocked && !film.nominated;

  const card = document.createElement("div");
  card.className = "candidate-card" + (isSnubbed ? " candidate-card--snubbed" : "");

  const head = document.createElement("div");
  head.className = "candidate-head";

  const title = document.createElement("h3");
  title.textContent = film.title;

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = `${film.studio}`;

  const nominatedLabel = document.createElement("label");
  nominatedLabel.className = "nominated-checkbox-label";
  const nominatedCheckbox = document.createElement("input");
  nominatedCheckbox.type = "checkbox";
  nominatedCheckbox.checked = film.nominated === true;
  nominatedCheckbox.addEventListener("change", () => {
    const cat = categories.find((c) => c.id === category.id);
    if (cat) cat.films[filmIndex].nominated = nominatedCheckbox.checked;
    saveState();
    render();
  });
  nominatedLabel.appendChild(nominatedCheckbox);
  nominatedLabel.append("\u00a0Nom.");

  head.append(title, badge, nominatedLabel);

  const grid = document.createElement("div");
  grid.className = "mini-grid";

  const fields = [
    { key: "precursor", label: "Precursor" },
    { key: "history", label: "Historical" },
    { key: "buzz", label: "Buzz" }
  ];

  fields.forEach((field) => {
    const wrapper = document.createElement("label");
    wrapper.textContent = field.label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = String((film as unknown as Record<string, unknown>)[field.key]);
    input.inputMode = "numeric";
    input.setAttribute("autocomplete", "off");

    input.addEventListener("focus", () => { input.select(); });

    input.addEventListener("input", (event) => {
      (film as unknown as Record<string, number>)[field.key] = clamp(
        Number((event.target as HTMLInputElement).value || 0), 0, 100
      );
      saveState();
    });

    input.addEventListener("change", () => {
      render();
      if (field.key === "buzz") showBuzzSyncBanner(film, category);
    });
    wrapper.appendChild(input);
    grid.appendChild(wrapper);
  });

  const strengthLabel = document.createElement("label");
  strengthLabel.textContent = "Campaign Strength";
  const strengthSelect = document.createElement("select");
  ["Low", "Medium", "High"].forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === film.strength;
    strengthSelect.appendChild(option);
  });
  strengthSelect.addEventListener("change", (event) => {
    const cat = categories.find((c) => c.id === category.id);
    if (cat) cat.films[filmIndex].strength = (event.target as HTMLSelectElement).value as Strength;
    saveState();
    render();
  });
  strengthLabel.appendChild(strengthSelect);
  grid.appendChild(strengthLabel);

  card.append(head, grid);
  return card;
}

// ── Candidates ────────────────────────────────────────────────────────────────

export function renderCandidates(category: Category, projections: Projection[]): void {
  categoryTitle.textContent = category.name;
  candidateCards.innerHTML = "";

  const isLocked = lockedCategories.has(category.id);

  if (lockNomineesButton) {
    lockNomineesButton.textContent = isLocked ? "Unlock Nominees" : "Lock Nominees";
    lockNomineesButton.setAttribute("aria-pressed", String(isLocked));
    lockNomineesButton.classList.toggle("action-button--lock-active", isLocked);
  }

  if (restoreBuzzButton) {
    restoreBuzzButton.hidden = !surpriseBuzzUndo.has(category.id);
  }

  if (isLocked) {
    // Show all films so the user can see which are nominated/snubbed.
    if (category.films.length === 0) {
      const empty = document.createElement("p");
      empty.className = "panel-copy";
      empty.textContent = "No contenders available for this category. Import CSV or adjust source data.";
      candidateCards.appendChild(empty);
      return;
    }
    category.films.forEach((film, filmIndex) => {
      candidateCards.appendChild(createCard(category, film, filmIndex));
    });
  } else {
    const display = projections.slice(0, getDisplayLimit(category));
    if (display.length === 0) {
      const empty = document.createElement("p");
      empty.className = "panel-copy";
      empty.textContent = "No contenders available for this category. Import CSV or adjust source data.";
      candidateCards.appendChild(empty);
      return;
    }
    display.forEach((entry) => {
      candidateCards.appendChild(createCard(category, category.films[entry.index], entry.index));
    });
  }
}

// ── Results table helpers ─────────────────────────────────────────────────────

export function setNormalTableHeaders(category: Category) {
  if (resultsPrimaryHeader) resultsPrimaryHeader.textContent = getPrimaryColumnLabel(category.id);
  if (thNomination) {
    thNomination.hidden = oddsMode === "winner";
    thNomination.classList.toggle("th-focused", oddsMode === "nomination");
  }
  if (thWinner) {
    thWinner.textContent = "Winner %";
    thWinner.hidden = oddsMode === "nomination";
    thWinner.classList.toggle("th-focused", oddsMode === "winner");
  }
  if (thCompareB) thCompareB.hidden = true;
  if (thDelta) thDelta.hidden = true;
}

export function setCompareTableHeaders(category: Category) {
  if (resultsPrimaryHeader) resultsPrimaryHeader.textContent = getPrimaryColumnLabel(category.id);
  if (thNomination) thNomination.hidden = true;
  if (thWinner) { thWinner.textContent = state.profileId; thWinner.setAttribute("aria-label", `Winner % for profile "${state.profileId}"`); }
  if (thCompareB) { thCompareB.textContent = compareProfileId; thCompareB.setAttribute("aria-label", `Winner % for profile "${compareProfileId}"`); thCompareB.hidden = false; }
  if (thDelta) thDelta.hidden = false;
}

export function updateCompareProfileSelect() {
  if (!compareProfileSelect) return;
  compareProfileSelect.innerHTML = "";
  const others = profileOptions.filter((id) => id !== state.profileId);
  others.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    option.selected = id === compareProfileId;
    compareProfileSelect.appendChild(option);
  });
  if (!compareProfileId || !others.includes(compareProfileId)) setCompareProfileId(others[0] ?? null);
}

// ── Profile options ───────────────────────────────────────────────────────────

export function renderProfileOptions() {
  updateLockButton();
  profileSelect.innerHTML = "";
  profileOptions.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    option.selected = id === state.profileId;
    profileSelect.appendChild(option);
  });
  if (deleteProfileButton) deleteProfileButton.disabled = profileOptions.length <= 1;
  if (compareMode) updateCompareProfileSelect();
}

// ── Snapshot compare ──────────────────────────────────────────────────────────

export function renderSnapshotCompareDatePickers(category: Category): void {
  if (!snapshotCompareMode) {
    if (snapshotCompareControls) snapshotCompareControls.hidden = true;
    if (trendWindowControl) trendWindowControl.hidden = false;
    return;
  }
  if (snapshotCompareControls) snapshotCompareControls.hidden = false;
  if (trendWindowControl) trendWindowControl.hidden = true;

  const days = getSnapshotDays(category.id);

  // Populate selects
  [snapshotDateASelect, snapshotDateBSelect].forEach((sel) => {
    if (!sel) return;
    sel.innerHTML = "";
    days.forEach((day) => {
      const opt = document.createElement("option");
      opt.value = day;
      opt.textContent = formatSnapshotDay(day);
      sel.appendChild(opt);
    });
  });

  // Reset dates if no longer valid for this category
  if (snapshotDateA === null || !days.includes(snapshotDateA)) {
    setSnapshotDateA(days[0] ?? null);
  }
  if (snapshotDateB === null || !days.includes(snapshotDateB)) {
    setSnapshotDateB(days[days.length - 1] ?? null);
  }

  if (snapshotDateASelect && snapshotDateA) snapshotDateASelect.value = snapshotDateA;
  if (snapshotDateBSelect && snapshotDateB) snapshotDateBSelect.value = snapshotDateB;
}

export function setSnapshotCompareTableHeaders(category: Category, labelA: string, labelB: string): void {
  if (resultsPrimaryHeader) resultsPrimaryHeader.textContent = getPrimaryColumnLabel(category.id);
  if (thNomination) thNomination.hidden = true;
  if (thWinner) {
    thWinner.textContent = labelA;
    thWinner.setAttribute("aria-label", `Winner % on ${labelA}`);
    thWinner.hidden = false;
  }
  if (thCompareB) {
    thCompareB.textContent = labelB;
    thCompareB.setAttribute("aria-label", `Winner % on ${labelB}`);
    thCompareB.hidden = false;
  }
  if (thDelta) thDelta.hidden = false;
}

export function renderSnapshotCompareResults(category: Category, projections: Projection[]): void {
  const labelA = snapshotDateA ? formatSnapshotDay(snapshotDateA) : "Date A";
  const labelB = snapshotDateB ? formatSnapshotDay(snapshotDateB) : "Date B";
  setSnapshotCompareTableHeaders(category, labelA, labelB);
  resultsBody.innerHTML = "";

  const displayLimit = getDisplayLimit(category);
  const primaryTop = projections.slice(0, displayLimit);

  if (primaryTop.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="results-empty" colspan="4">No projected contenders for this category.</td>`;
    resultsBody.appendChild(row);
    renderExplanation(category, null, []);
    renderMovieDetails(category, null);
    renderTrendAnalytics(category, null);
    return;
  }

  const snapshotA = snapshotDateA ? getSnapshotForDay(category.id, snapshotDateA) : null;
  const snapshotB = snapshotDateB ? getSnapshotForDay(category.id, snapshotDateB) : null;

  const selectedIndex = explainSelectionByCategory[category.id] ?? 0;
  const boundedIndex = clamp(selectedIndex, 0, Math.max(0, primaryTop.length - 1));
  explainSelectionByCategory[category.id] = boundedIndex;

  primaryTop.forEach((entry, index) => {
    const oddsA = getContenderOddsFromSnapshot(snapshotA, entry);
    const oddsB = getContenderOddsFromSnapshot(snapshotB, entry);
    const aWinner = oddsA?.winner ?? null;
    const bWinner = oddsB?.winner ?? null;
    const delta = aWinner !== null && bWinner !== null ? bWinner - aWinner : null;

    let deltaCell;
    if (delta === null) {
      deltaCell = `<td data-label="Δ" class="delta-na">—</td>`;
    } else {
      const cls = delta > 0.5 ? "delta-pos" : delta < -0.5 ? "delta-neg" : "delta-neutral";
      const symbol = delta > 0.5 ? "▲" : delta < -0.5 ? "▼" : "";
      const display = symbol ? `${symbol}${Math.abs(delta).toFixed(1)}pp` : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp`;
      const ariaLabel = delta > 0.5
        ? `up ${delta.toFixed(1)} percentage points`
        : delta < -0.5
        ? `down ${Math.abs(delta).toFixed(1)} percentage points`
        : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} percentage points`;
      deltaCell = `<td data-label="Δ" class="${cls}" aria-label="${ariaLabel}">${display}</td>`;
    }

    const row = document.createElement("tr");
    row.className = `results-row${index === boundedIndex ? " active" : ""}`;
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-selected", index === boundedIndex ? "true" : "false");
    row.setAttribute(
      "aria-label",
      `${entry.title}. ${labelA}: ${aWinner !== null ? aWinner.toFixed(1) + "%" : "no data"}. ${labelB}: ${bWinner !== null ? bWinner.toFixed(1) + "%" : "no data"}.`
    );

    row.addEventListener("click", () => { explainSelectionByCategory[category.id] = index; render(); });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); explainSelectionByCategory[category.id] = index; render(); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); explainSelectionByCategory[category.id] = clamp(index + 1, 0, primaryTop.length - 1); render(); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); explainSelectionByCategory[category.id] = clamp(index - 1, 0, primaryTop.length - 1); render(); }
    });

    row.innerHTML = `
      <td data-label="${getPrimaryColumnLabel(category.id)}"><strong>${esc(entry.title)}</strong></td>
      <td data-label="${labelA}">${aWinner !== null ? aWinner.toFixed(1) + "%" : "—"}</td>
      <td data-label="${labelB}">${bWinner !== null ? bWinner.toFixed(1) + "%" : "—"}</td>
      ${deltaCell}
    `;
    resultsBody.appendChild(row);
  });

  renderExplanation(category, primaryTop[boundedIndex], primaryTop);
  renderMovieDetails(category, primaryTop[boundedIndex]);
  renderTrendAnalytics(category, primaryTop[boundedIndex]);
}

// ── Compare results ───────────────────────────────────────────────────────────

export function buildCompareProjectionsFrom(category: Category, payload: StatePayload | null | undefined): Projection[] | null {
  if (!payload) return null;
  const payloadCategory = Array.isArray(payload.categories)
    ? payload.categories.find((c) => c.id === category.id)
    : null;
  const films = payloadCategory?.films
    ? (payloadCategory.films as unknown[]).map(parseFilmRecord).filter((f): f is Film => f !== null)
    : null;
  if (!films || films.length === 0) return null;
  return buildProjections(category, { films, weights: payload.weights as NormalizedWeights ?? state.weights });
}

export function renderCompareResults(category: Category, primaryProjections: Projection[]) {
  setCompareTableHeaders(category);
  resultsBody.innerHTML = "";

  const displayLimit = getDisplayLimit(category);
  const primaryTop = primaryProjections.slice(0, displayLimit);

  if (primaryTop.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="results-empty" colspan="4">No projected contenders for this category.</td>`;
    resultsBody.appendChild(row);
    renderExplanation(category, null, []);
    renderMovieDetails(category, null);
    renderTrendAnalytics(category, null);
    return;
  }

  const comparePayload = compareProfileId ? (comparePayloadCache.get(compareProfileId) ?? null) : null;
  const compareProjections = buildCompareProjectionsFrom(category, comparePayload);
  const compareMap = new Map();
  if (compareProjections) {
    compareProjections.forEach((entry) => compareMap.set(entry.rawTitle.toLowerCase(), entry));
  }

  const selectedIndex = explainSelectionByCategory[category.id] ?? 0;
  const boundedIndex = clamp(selectedIndex, 0, Math.max(0, primaryTop.length - 1));
  explainSelectionByCategory[category.id] = boundedIndex;

  primaryTop.forEach((entry, index) => {
    const cEntry = compareMap.get(entry.rawTitle.toLowerCase());
    const bWinner = cEntry?.winner ?? null;
    const delta = bWinner !== null ? bWinner - entry.winner : null;

    let deltaCell;
    if (delta === null) {
      deltaCell = `<td data-label="Δ" class="delta-na">—</td>`;
    } else {
      const cls = delta > 0.5 ? "delta-pos" : delta < -0.5 ? "delta-neg" : "delta-neutral";
      const symbol = delta > 0.5 ? "▲" : delta < -0.5 ? "▼" : "";
      const display = symbol ? `${symbol}${Math.abs(delta).toFixed(1)}pp` : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp`;
      const ariaLabel = delta > 0.5
        ? `up ${delta.toFixed(1)} percentage points`
        : delta < -0.5
        ? `down ${Math.abs(delta).toFixed(1)} percentage points`
        : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} percentage points`;
      deltaCell = `<td data-label="Δ" class="${cls}" aria-label="${ariaLabel}">${display}</td>`;
    }

    const row = document.createElement("tr");
    row.className = `results-row${index === boundedIndex ? " active" : ""}`;
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-selected", index === boundedIndex ? "true" : "false");
    row.setAttribute(
      "aria-label",
      `${entry.title}. ${state.profileId}: ${entry.winner.toFixed(1)}%. ${bWinner !== null ? `${compareProfileId}: ${bWinner.toFixed(1)}%.` : "No comparison data."}`
    );

    row.addEventListener("click", () => { explainSelectionByCategory[category.id] = index; render(); });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); explainSelectionByCategory[category.id] = index; render(); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); explainSelectionByCategory[category.id] = clamp(index + 1, 0, primaryTop.length - 1); render(); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); explainSelectionByCategory[category.id] = clamp(index - 1, 0, primaryTop.length - 1); render(); }
    });

    row.innerHTML = `
      <td data-label="${getPrimaryColumnLabel(category.id)}"><strong>${esc(entry.title)}</strong></td>
      <td data-label="${state.profileId}">${entry.winner.toFixed(1)}%</td>
      <td data-label="${compareProfileId}">${bWinner !== null ? bWinner.toFixed(1) + "%" : "—"}</td>
      ${deltaCell}
    `;
    resultsBody.appendChild(row);
  });

  renderExplanation(category, primaryTop[boundedIndex], primaryTop);
  renderMovieDetails(category, primaryTop[boundedIndex]);
  renderTrendAnalytics(category, primaryTop[boundedIndex]);
}

// ── Search results ────────────────────────────────────────────────────────────

export function renderSearchResults(query: string): void {
  if (resultsPrimaryHeader) resultsPrimaryHeader.textContent = "Film";
  if (thNomination) {
    thNomination.hidden = oddsMode === "winner";
    thNomination.classList.toggle("th-focused", oddsMode === "nomination");
  }
  if (thWinner) {
    thWinner.textContent = "Winner %";
    thWinner.hidden = oddsMode === "nomination";
    thWinner.classList.toggle("th-focused", oddsMode === "winner");
  }
  if (thCompareB) thCompareB.hidden = true;
  if (thDelta) thDelta.hidden = true;
  resultsBody.innerHTML = "";

  const normalizedQuery = query.toLowerCase();
  const matches: Array<Projection & { categoryName: string }> = [];

  categories.forEach((category) => {
    const projections = getCachedProjections(category);
    const displayLimit = getDisplayLimit(category);
    projections.slice(0, displayLimit).forEach((entry) => {
      if (
        entry.title.toLowerCase().includes(normalizedQuery) ||
        entry.rawTitle.toLowerCase().includes(normalizedQuery)
      ) {
        matches.push({ ...entry, categoryName: category.name });
      }
    });
  });

  matches.sort((a, b) => b.winner - a.winner);

  if (matches.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="results-empty" colspan="${oddsMode === "both" ? 3 : 2}">No contenders match "${query}".</td>`;
    resultsBody.appendChild(row);
  } else {
    matches.forEach((entry) => {
      const row = document.createElement("tr");
      row.className = "results-row";
      row.setAttribute("tabindex", "0");
      row.setAttribute(
        "aria-label",
        `${entry.title}, ${entry.categoryName}. Nomination ${entry.nomination.toFixed(1)}%. Winner ${entry.winner.toFixed(1)}%.`
      );

      const navigateToEntry = () => {
        setSearchQuery("");
        if (contenderSearch) contenderSearch.value = "";
        if (contenderSearchClear) contenderSearchClear.hidden = true;
        state.categoryId = entry.categoryId;
        const cat = categories.find((c) => c.id === entry.categoryId);
        if (cat) {
          const catProjections = getCachedProjections(cat);
          const foundIdx = catProjections.findIndex((p) => p.rawTitle === entry.rawTitle);
          if (foundIdx >= 0) explainSelectionByCategory[entry.categoryId] = foundIdx;
        }
        saveState();
        render();
      };

      row.addEventListener("click", navigateToEntry);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigateToEntry();
        }
      });

      row.innerHTML = `
        <td data-label="Film">
          <strong>${esc(entry.title)}</strong>
          <span class="results-category-label">${entry.categoryName}</span>
        </td>
        ${oddsMode !== "winner"     ? `<td data-label="Nomination %">${entry.nomination.toFixed(1)}%</td>` : ""}
        ${oddsMode !== "nomination" ? `<td data-label="Winner %">${entry.winner.toFixed(1)}%</td>`      : ""}
      `;
      resultsBody.appendChild(row);
    });
  }

  renderExplanation(getActiveCategory(), null, []);
  renderMovieDetails(getActiveCategory(), null);
  renderTrendAnalytics(getActiveCategory(), null);
}

// ── Results table ─────────────────────────────────────────────────────────────

export function renderResults(category: Category, projections: Projection[]): void {
  if (searchQuery) {
    renderSearchResults(searchQuery);
    return;
  }
  setNormalTableHeaders(category);
  resultsBody.innerHTML = "";
  const displayProjections = projections.slice(0, getDisplayLimit(category));
  if (displayProjections.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="results-empty" colspan="${oddsMode === "both" ? 3 : 2}">No projected contenders for this category.</td>`;
    resultsBody.appendChild(row);
    renderExplanation(category, null, []);
    renderMovieDetails(category, null);
    renderTrendAnalytics(category, null);
    return;
  }

  const selectedIndex = explainSelectionByCategory[category.id] ?? 0;
  const boundedIndex = clamp(selectedIndex, 0, Math.max(0, displayProjections.length - 1));
  explainSelectionByCategory[category.id] = boundedIndex;

  const momentum = computeCategoryMomentum(category, displayProjections);

  displayProjections.forEach((entry, index) => {
    const row = document.createElement("tr");
    row.className = `results-row${index === boundedIndex ? " active" : ""}`;
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-selected", index === boundedIndex ? "true" : "false");
    row.setAttribute("aria-label", `${entry.title}. Nomination ${entry.nomination.toFixed(1)} percent. Winner ${entry.winner.toFixed(1)} percent.`);
    row.addEventListener("click", () => {
      explainSelectionByCategory[category.id] = index;
      render();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        explainSelectionByCategory[category.id] = index;
        render();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        explainSelectionByCategory[category.id] = clamp(index + 1, 0, displayProjections.length - 1);
        render();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        explainSelectionByCategory[category.id] = clamp(index - 1, 0, displayProjections.length - 1);
        render();
      }
    });
    const ci = getCategoryBootstrapCI(category).get(entry.rawTitle);
    const nomCI = ci && (ci.nomHigh - ci.nomLow) > 0.5
      ? ` <span class="ci-range" title="95% bootstrap CI">[${ci.nomLow.toFixed(0)}–${ci.nomHigh.toFixed(0)}]</span>`
      : "";
    const winCI = ci && (ci.winHigh - ci.winLow) > 0.5
      ? ` <span class="ci-range" title="95% bootstrap CI">[${ci.winLow.toFixed(0)}–${ci.winHigh.toFixed(0)}]</span>`
      : "";
    const mKey   = trendKeyForEntry(category.id, entry);
    const mBadge = momentumBadgeHtml(momentum.get(mKey) ?? null);
    row.innerHTML =
      `<td data-label="${getPrimaryColumnLabel(category.id)}"><strong>${esc(entry.title)}</strong></td>` +
      (oddsMode !== "winner"     ? `<td data-label="Nomination %">${entry.nomination.toFixed(1)}%${nomCI}</td>` : "") +
      (oddsMode !== "nomination" ? `<td data-label="Winner %">${entry.winner.toFixed(1)}%${winCI}${mBadge}</td>` : "");
    resultsBody.appendChild(row);
  });

  renderExplanation(category, displayProjections[boundedIndex], displayProjections);
  renderMovieDetails(category, displayProjections[boundedIndex]);
  renderTrendAnalytics(category, displayProjections[boundedIndex]);
}

// ── Explanation panel ─────────────────────────────────────────────────────────

export function renderExplanation(category: Category, entry: Projection | null, fieldEntries: Projection[]): void {
  if (!entry) {
    explainTitle.textContent = "Why this %";
    explainMeta.textContent = "No contender selected.";
    explainDelta.textContent = "";
    explainBreakdown.innerHTML = "";
    explainNotes.textContent = "";
    return;
  }

  explainTitle.textContent = `Why this %: ${entry.title}`;
  explainMeta.textContent = `${category.name} projection factors`;
  const nominationAvg = (fieldEntries.reduce((sum, item) => sum + item.nomination, 0) || 0) / Math.max(fieldEntries.length, 1);
  const winnerAvg = (fieldEntries.reduce((sum, item) => sum + item.winner, 0) || 0) / Math.max(fieldEntries.length, 1);

  const rawContributionTotal =
    entry.precursorContribution + entry.historyContribution + entry.buzzContribution;
  if (rawContributionTotal === 0) {
    explainBreakdown.innerHTML = "";
    explainNotes.textContent = "No score data yet.";
    explainDelta.textContent = "";
    return;
  }
  const contributionTotal = rawContributionTotal;
  const breakdown = [
    { label: "Precursor", value: (entry.precursorContribution / contributionTotal) * 100 },
    { label: "Historical Fit", value: (entry.historyContribution / contributionTotal) * 100 },
    { label: "Buzz", value: (entry.buzzContribution / contributionTotal) * 100 }
  ];
  const avgContribution = fieldEntries.reduce(
    (acc, item) => {
      const total = item.precursorContribution + item.historyContribution + item.buzzContribution || 1;
      acc.precursor += (item.precursorContribution / total) * 100;
      acc.history += (item.historyContribution / total) * 100;
      acc.buzz += (item.buzzContribution / total) * 100;
      return acc;
    },
    { precursor: 0, history: 0, buzz: 0 }
  );
  avgContribution.precursor /= Math.max(fieldEntries.length, 1);
  avgContribution.history /= Math.max(fieldEntries.length, 1);
  avgContribution.buzz /= Math.max(fieldEntries.length, 1);

  explainDelta.textContent = `Delta vs category avg: Nomination ${entry.nomination - nominationAvg >= 0 ? "+" : ""}${(entry.nomination - nominationAvg).toFixed(1)}pp, Winner ${entry.winner - winnerAvg >= 0 ? "+" : ""}${(entry.winner - winnerAvg).toFixed(1)}pp`;

  explainBreakdown.innerHTML = "";
  breakdown.forEach((item) => {
    const avgValue =
      item.label === "Precursor" ? avgContribution.precursor : item.label === "Historical Fit" ? avgContribution.history : avgContribution.buzz;
    const delta = item.value - avgValue;
    const row = document.createElement("div");
    row.className = "explain-row";
    row.innerHTML = `<span>${item.label}</span><div class="explain-bar"><span style="width:${item.value.toFixed(1)}%"></span></div><strong>${item.value.toFixed(0)}% (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp)</strong>`;
    explainBreakdown.appendChild(row);
  });

  explainNotes.textContent = `Strength multiplier ${entry.strengthMultiplier.toFixed(2)}x, winner-history factor ${entry.winnerHistoryMultiplier.toFixed(2)}x.`;
}

// ── Movie details panel ───────────────────────────────────────────────────────

export function renderMovieDetails(category: Category, entry: Projection | null): void {
  if (!entry) {
    setActivePosterRequestId(activePosterRequestId + 1);
    movieDetailTitle.textContent = "Selected Film";
    movieDetailDirector.textContent = "-";
    movieDetailStars.textContent = "-";
    movieDetailGenre.textContent = "-";
    movieDetailDescription.textContent = "Select a contender in Projected Odds to view details.";
    setPosterState(buildPosterFallbackDataUrl("Selected Film"), getTmdbSearchUrl(""));
    return;
  }

  const selectedFilmTitle = getSelectedFilmTitle(category.id, entry);
  loadPosterForTitle(selectedFilmTitle);
  const details = movieDetailsIndex.get(normalizeMovieDetailKey(selectedFilmTitle));
  if (!details) {
    movieDetailTitle.textContent = selectedFilmTitle;
    movieDetailDirector.textContent = "TBD";
    movieDetailStars.textContent = "TBD";
    movieDetailGenre.textContent = "TBD";
    movieDetailDescription.textContent = "No metadata available yet for this selection.";
    return;
  }

  movieDetailTitle.textContent = details.title;
  movieDetailDirector.textContent = details.director;
  movieDetailStars.textContent = details.stars.join(", ");
  movieDetailGenre.textContent = details.genre;
  movieDetailDescription.textContent = details.description;
}

// ── Trend chart ───────────────────────────────────────────────────────────────

export function renderTrendChart(points: TrendPoint[]): void {
  if (!trendChart) return;
  trendChart.innerHTML = "";

  if (!points.length) {
    trendChart.innerHTML = `<text x="20" y="40" fill="#5f554a" font-size="13">No trend data yet for this contender.</text>`;
    return;
  }

  const width = 700;
  const height = 220;
  const padX = 26;
  const padY = 16;
  const chartWidth = width - padX * 2;
  const chartHeight = height - padY * 2;
  const values = points.flatMap((point) => [point.nomination, point.winner]);
  const maxValue = Math.min(100, Math.max(...values, 10) + 4);
  const minValue = Math.max(0, Math.min(...values, 95) - 4);

  const nominationPath = buildPolylinePath(points, "nomination", chartWidth, chartHeight, minValue, maxValue);
  const winnerPath = buildPolylinePath(points, "winner", chartWidth, chartHeight, minValue, maxValue);

  const sourceMarkers = points
    .map((point, index) => {
      if (!point.sourceSnapshotId) return null;
      const previous = points[index - 1];
      if (previous?.sourceSnapshotId === point.sourceSnapshotId) return null;
      return {
        x: padX + (index / Math.max(points.length - 1, 1)) * chartWidth
      };
    })
    .filter((m): m is { x: number } => m !== null);

  const yTicks = [0, 25, 50, 75, 100].filter((tick) => tick >= minValue && tick <= maxValue);
  const grid = yTicks
    .map((tick) => {
      const y = padY + chartHeight - ((tick - minValue) / Math.max(maxValue - minValue, 1)) * chartHeight;
      return `<line x1="${padX}" y1="${y.toFixed(2)}" x2="${(padX + chartWidth).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#eadfce" stroke-width="1"/><text x="4" y="${(y + 4).toFixed(2)}" fill="#7a6d5e" font-size="11">${tick}%</text>`;
    })
    .join("");

  const markerLines = sourceMarkers
    .map(
      (marker) =>
        `<line x1="${marker.x.toFixed(2)}" y1="${padY}" x2="${marker.x.toFixed(2)}" y2="${(padY + chartHeight).toFixed(
          2
        )}" stroke="#5f554a" stroke-width="1" stroke-dasharray="4 4" opacity="0.5"/>`
    )
    .join("");

  trendChart.innerHTML = `
    ${grid}
    ${markerLines}
    <polyline fill="none" stroke="#0f6f5f" stroke-width="3" points="${nominationPath}" />
    <polyline fill="none" stroke="#915c11" stroke-width="3" points="${winnerPath}" />
  `;
}

export function renderSourceMovement(points: TrendPoint[]): void {
  if (!trendSourceMoves) return;
  trendSourceMoves.innerHTML = "";

  const sourcePointIndexes = points
    .map((point, index) => {
      if (!point.sourceSnapshotId) return null;
      const previous = points[index - 1];
      if (previous?.sourceSnapshotId === point.sourceSnapshotId) return null;
      return index;
    })
    .filter((value): value is number => value !== null && Number.isInteger(value));

  if (sourcePointIndexes.length === 0) {
    trendSourceMoves.innerHTML = `<div class="trend-source-row"><span>No source refresh markers in this window.</span><span class="stamp">-</span></div>`;
    return;
  }

  sourcePointIndexes.slice(-3).forEach((index) => {
    const current = points[index];
    const previous = points[Math.max(0, index - 1)];
    const nominationDelta = current.nomination - previous.nomination;
    const winnerDelta = current.winner - previous.winner;
    const row = document.createElement("div");
    row.className = "trend-source-row";
    row.innerHTML = `<span>Source update impact: Nomination ${nominationDelta >= 0 ? "+" : ""}${nominationDelta.toFixed(1)}pp, Winner ${winnerDelta >= 0 ? "+" : ""}${winnerDelta.toFixed(1)}pp</span><span class="stamp">${formatTrendStamp(
      current.capturedAt
    )}</span>`;
    trendSourceMoves.appendChild(row);
  });
}

export function renderTrendAnalytics(category: Category, entry: Projection | null): void {
  const projections = buildProjections(category);
  const displayProjections = projections.slice(0, getDisplayLimit(category));

  if (!entry) {
    trendChart?.setAttribute("aria-label", "Nomination and winner trend chart — no contender selected");
    trendTitle.textContent = "Trend Analytics";
    trendMeta.textContent = "Select a contender to view movement over time.";
    renderTrendChart([]);
    renderSourceMovement([]);
    if (momentumStatsEl)  momentumStatsEl.hidden = true;
    renderMomentumMovers(category, displayProjections, null);
    return;
  }

  trendChart?.setAttribute("aria-label", `Trend for ${entry.title} in ${category.name}`);
  const points = pointsForEntryTrend(category, entry);
  const mom    = computeMomentum(points);
  trendTitle.textContent = `Trend Analytics: ${entry.title}`;

  if (points.length < 2) {
    trendMeta.textContent = "Need at least two snapshots to show movement.";
    if (momentumStatsEl) momentumStatsEl.hidden = true;
  } else {
    const first    = points[0];
    const last     = points[points.length - 1];
    const nomDelta = last.nomination - first.nomination;
    const winDelta = last.winner    - first.winner;
    trendMeta.textContent =
      `Last ${points.length} updates: Nomination ${nomDelta >= 0 ? "+" : ""}${nomDelta.toFixed(1)}pp,` +
      ` Winner ${winDelta >= 0 ? "+" : ""}${winDelta.toFixed(1)}pp.`;

    if (momentumStatsEl && mom) {
      const winSign   = mom.winSlope >= 0 ? "+" : "";
      const nomSign   = mom.nomSlope >= 0 ? "+" : "";
      const direction =
        Math.abs(mom.winSlope) < MOMENTUM_STABLE_THRESHOLD ? "Stable"
        : mom.winSlope > 0 ? (mom.winSlope >= MOMENTUM_STRONG_THRESHOLD ? "Rising fast" : "Rising")
        : (mom.winSlope <= -MOMENTUM_STRONG_THRESHOLD ? "Falling fast" : "Falling");
      momentumStatsEl.innerHTML =
        `<div class="momentum-stat-row">` +
          `<span class="momentum-stat-label">Momentum</span>` +
          `<span class="momentum-stat-value momentum-stat-value--${mom.winSlope >= 0 ? "pos" : "neg"}">${direction}</span>` +
        `</div>` +
        `<div class="momentum-stat-row">` +
          `<span class="momentum-stat-label">Win slope</span>` +
          `<span class="momentum-stat-value">${winSign}${mom.winSlope.toFixed(2)} pp/day</span>` +
        `</div>` +
        `<div class="momentum-stat-row">` +
          `<span class="momentum-stat-label">Nom slope</span>` +
          `<span class="momentum-stat-value">${nomSign}${mom.nomSlope.toFixed(2)} pp/day</span>` +
        `</div>` +
        `<div class="momentum-stat-row">` +
          `<span class="momentum-stat-label">R² (trend fit)</span>` +
          `<span class="momentum-stat-value">${(mom.r2 * 100).toFixed(0)}%</span>` +
        `</div>` +
        `<div class="momentum-stat-row">` +
          `<span class="momentum-stat-label">Data points</span>` +
          `<span class="momentum-stat-value">${mom.snapshots} snapshots</span>` +
        `</div>`;
      momentumStatsEl.hidden = false;
    } else if (momentumStatsEl) {
      momentumStatsEl.hidden = true;
    }
  }

  renderTrendChart(points);
  renderSourceMovement(points);
  renderMomentumMovers(category, displayProjections, entry);
}

/**
 * Show the top 3 risers and top 3 fallers in this category by OLS win-slope.
 * Only films with ≥ 3 snapshots and |slope| ≥ STABLE_THRESHOLD are included.
 */
export function renderMomentumMovers(
  category:     Category,
  projections:  Projection[],
  _selected:    Projection | null,
): void {
  if (!momentumMoversEl || !momentumMoversBody) return;

  type Entry = { title: string; slope: number; r2: number; winner: number };
  const entries: Entry[] = [];

  for (const proj of projections) {
    const pts = pointsForEntryTrend(category, proj);
    const m   = computeMomentum(pts);
    if (!m || m.snapshots < 3 || Math.abs(m.winSlope) < MOMENTUM_STABLE_THRESHOLD) continue;
    entries.push({ title: proj.title, slope: m.winSlope, r2: m.r2, winner: proj.winner });
  }

  if (entries.length === 0) { momentumMoversEl.hidden = true; return; }

  entries.sort((a, b) => b.slope - a.slope);
  const top3    = entries.slice(0, 3);
  const bottom3 = [...entries].sort((a, b) => a.slope - b.slope).slice(0, 3);
  // Deduplicate (can overlap when few films)
  const shown   = new Set<string>();
  const movers  = [...top3, ...bottom3].filter(e => { if (shown.has(e.title)) return false; shown.add(e.title); return true; });

  momentumMoversBody.innerHTML = movers.map(e => {
    const dir  = e.slope >= 0 ? "up" : "dn";
    const sign = e.slope >= 0 ? "+" : "";
    return (
      `<div class="mover-row">` +
        `<span class="mover-badge momentum--${dir}">${e.slope >= 0 ? "↑" : "↓"}</span>` +
        `<span class="mover-title">${esc(e.title)}</span>` +
        `<span class="mover-val">${sign}${e.slope.toFixed(2)} pp/d</span>` +
        `<span class="mover-winner">${e.winner.toFixed(1)}% win</span>` +
      `</div>`
    );
  }).join("");

  momentumMoversEl.hidden = false;
}

// ── Summary bar ───────────────────────────────────────────────────────────────

export function renderSummaryBar() {
  if (!categorySummaryBar) return;

  // Rebuild cards only when projection data has changed (saveState increments the version).
  // On a bare tab switch, projectionCacheVersion is unchanged, so we skip the rebuild
  // and just swap the active class using the stored reference — no querySelector needed.
  if (summaryBarBuiltAtVersion !== projectionCacheVersion) {
    categorySummaryBar.innerHTML = "";
    summaryCardMap.clear();
    setActiveSummaryCard(null);
    setSummaryBarBuiltAtVersion(projectionCacheVersion);

    categories.forEach((category) => {
      const projections = getCachedProjections(category);
      const top = projections[0];
      const second = projections[1];
      if (!top) return;

      const gap = second ? top.winner - second.winner : null;
      const shortName = CATEGORY_SHORT_NAMES[category.id] || category.name;
      const displayName = top.rawTitle;

      let gapClass = "gap-moderate";
      if (gap !== null) {
        if (gap < 5) gapClass = "gap-tight";
        else if (gap >= 15) gapClass = "gap-clear";
      }

      const completion = getCategoryCompletion(category);
      const completionLabel = completion === "complete"
        ? "complete"
        : completion === "partial"
          ? "partially filled"
          : "not yet filled";

      const card = document.createElement("button");
      card.type = "button";
      card.className = "summary-card"; // active class applied below via swap
      card.dataset.completion = completion;
      card.setAttribute(
        "aria-label",
        `${category.name} (${completionLabel}): ${displayName}, ${top.winner.toFixed(1)}% winner odds${gap !== null ? `, +${gap.toFixed(1)}pp lead` : ""}`
      );
      card.setAttribute("aria-pressed", "false");

      card.innerHTML = `
        <span class="summary-card-category">
          ${shortName}<span class="summary-card-completion" aria-hidden="true"></span>
        </span>
        <span class="summary-card-title">${esc(displayName)}</span>
        <span class="summary-card-footer">
          <span class="summary-card-odds">${top.winner.toFixed(1)}%</span>
          ${gap !== null ? `<span class="summary-card-gap ${gapClass}">+${gap.toFixed(1)}pp</span>` : ""}
        </span>
      `;

      card.addEventListener("click", () => {
        if (searchQuery) {
          setSearchQuery("");
          if (contenderSearch) contenderSearch.value = "";
          if (contenderSearchClear) contenderSearchClear.hidden = true;
        }
        state.categoryId = category.id;
        saveState();
        render();
      });

      summaryCardMap.set(category.id, card);
      categorySummaryBar.appendChild(card);
    });
  }

  // Swap active class directly — no querySelector.
  if (activeSummaryCard) {
    activeSummaryCard.classList.remove("active");
    activeSummaryCard.setAttribute("aria-pressed", "false");
  }
  const newActive = summaryCardMap.get(state.categoryId) ?? null;
  if (newActive) {
    newActive.classList.add("active");
    newActive.setAttribute("aria-pressed", "true");
  }
  setActiveSummaryCard(newActive);

  // Scroll the active card into view within the bar.
  if (activeSummaryCard) {
    const bar = categorySummaryBar;
    bar.scrollLeft = activeSummaryCard.offsetLeft - bar.clientWidth / 2 + activeSummaryCard.offsetWidth / 2;
  }
}

// ── Sweep panel ───────────────────────────────────────────────────────────────

const PERSON_CATEGORY_IDS = new Set(["director", "actor", "actress", "supporting-actor", "supporting-actress"]);

// The six Oscar categories tracked in the historical co-win dataset.
const SWEEP_CATEGORY_IDS = ["picture", "director", "actor", "actress", "supporting-actor", "supporting-actress"];

/**
 * Compute P(film wins A AND B) using the historical conditional co-win rate.
 *
 * Model: P(A ∩ B) = p_A × [r(B|A) + (1 − r(B|A)) × p_B]
 * where r(B|A) = P(wins B | same film wins A) from history.
 *
 * When r(B|A) is high (e.g. 64% for picture+director), a strong A-favourite
 * also gets a meaningful boost for B even if their raw p_B is moderate.
 */
function jointWinProb(
  pA: number, pB: number,
  catA: string, catB: string
): number {
  if (!jointProbData) return pA * pB;
  const r = jointProbData.condRates[catA]?.[catB] ?? 0;
  return pA * (r + (1 - r) * pB);
}

export function renderSweepPanel(): void {
  const panel    = document.getElementById("sweepPanel");
  const tbody    = document.getElementById("sweepBody");
  const corrDiv  = document.getElementById("sweepCorrelationTable");
  if (!panel || !tbody || !corrDiv) return;

  if (!jointProbData) { panel.hidden = true; return; }

  // Build win-probability map for each film in each tracked category.
  // filmWins: filmTitle → Map<categoryId, winPct>
  const filmWins = new Map<string, Map<string, number>>();

  for (const cat of categories) {
    if (!SWEEP_CATEGORY_IDS.includes(cat.id)) continue;
    const projs = buildProjections(cat);
    for (const proj of projs) {
      const filmKey = PERSON_CATEGORY_IDS.has(cat.id) ? proj.rawStudio : proj.rawTitle;
      if (!filmKey) continue;
      const existing = filmWins.get(filmKey) ?? new Map<string, number>();
      existing.set(cat.id, proj.winner);
      filmWins.set(filmKey, existing);
    }
  }

  // Only show films competing in ≥ 2 tracked categories.
  type SweepRow = {
    film: string;
    catWins: Map<string, number>;
    expectedWins: number;
    pAtLeastOne: number;
    pPicDir: number | null;
  };

  const rows: SweepRow[] = [];

  for (const [film, catWins] of filmWins) {
    if (catWins.size < 2) continue;

    // Expected wins: Σ p_c (linear — no independence assumption needed)
    const expectedWins = [...catWins.values()].reduce((s, p) => s + p / 100, 0);

    // P(at least 1 win) = 1 − Π(1 − p_c)   [independence approximation]
    const pAtLeastOne = 1 - [...catWins.values()].reduce((prod, p) => prod * (1 - p / 100), 1);

    // P(wins Picture AND Director) — the sweep milestone; only if film is in both.
    const pPic = catWins.get("picture");
    const pDir = catWins.get("director");
    const pPicDir = (pPic != null && pDir != null)
      ? jointWinProb(pPic / 100, pDir / 100, "picture", "director")
      : null;

    rows.push({ film, catWins, expectedWins, pAtLeastOne, pPicDir });
  }

  rows.sort((a, b) => b.expectedWins - a.expectedWins);

  // Show panel only if there are multi-category contenders.
  if (rows.length === 0) { panel.hidden = true; return; }
  panel.hidden = false;

  // Render sweep table.
  tbody.innerHTML = rows.slice(0, 12).map((row) => {
    const exp   = row.expectedWins.toFixed(2);
    const p1    = (row.pAtLeastOne * 100).toFixed(0);
    const picDir = row.pPicDir != null
      ? `${(row.pPicDir * 100).toFixed(0)}%`
      : `<span class="sweep-na">—</span>`;

    // Category badges showing win% in each tracked category.
    const badges = SWEEP_CATEGORY_IDS
      .filter((c) => row.catWins.has(c))
      .map((c) => {
        const pct = row.catWins.get(c)!.toFixed(0);
        const label = c === "supporting-actor" ? "Sup.Actor"
          : c === "supporting-actress" ? "Sup.Actress"
          : c.charAt(0).toUpperCase() + c.slice(1);
        return `<span class="sweep-badge" title="${c}: ${pct}% win odds">${esc(label)} ${pct}%</span>`;
      }).join("");

    return (
      `<tr class="sweep-row">` +
        `<td class="sweep-film">${esc(row.film)}</td>` +
        `<td class="sweep-num">${exp}</td>` +
        `<td class="sweep-num">${p1}%</td>` +
        `<td class="sweep-num">${picDir}</td>` +
        `<td class="sweep-cats">${badges}</td>` +
      `</tr>`
    );
  }).join("");

  // Render correlation table.
  const cats = jointProbData.categories;
  const shortName = (c: string) =>
    c === "supporting-actor" ? "Sup.Actor"
    : c === "supporting-actress" ? "Sup.Actress"
    : c.charAt(0).toUpperCase() + c.slice(1);

  const headerCells = cats.map((c) => `<th>${esc(shortName(c))}</th>`).join("");
  const dataRows = cats.map((a) => {
    const cells = cats.map((b) => {
      if (a === b) return `<td class="corr-self">—</td>`;
      const r = (jointProbData!.coWinRates[a]?.[b] ?? 0) * 100;
      const intensity = Math.round(r / 64 * 100); // 64% is max (pic+dir)
      return `<td class="corr-cell" style="--corr:${intensity}%" title="${a} + ${b}: ${r.toFixed(0)}%">${r.toFixed(0)}%</td>`;
    }).join("");
    return `<tr><th>${esc(shortName(a))}</th>${cells}</tr>`;
  }).join("");

  corrDiv.innerHTML =
    `<table class="corr-table">` +
      `<caption class="sr-only">Historical co-win rates between Oscar categories</caption>` +
      `<thead><tr><th></th>${headerCells}</tr></thead>` +
      `<tbody>${dataRows}</tbody>` +
    `</table>` +
    `<p class="corr-note">Values show the fraction of ceremonies (${jointProbData.totalYears} total) where the same film won both categories.</p>`;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export function renderLeaderboard(): void {
  if (!leaderboardBody) return;
  leaderboardBody.innerHTML = "";

  // nominations = number of categories the film appears in (as a top contender).
  // wins        = number of those categories where the film is ranked #1.
  // For person categories (actor, director, …) the film name lives in rawStudio;
  // for all other categories it lives in rawTitle.
  const filmMap = new Map<string, { nominations: number; wins: number }>();

  for (const category of categories) {
    const projections = buildProjections(category);
    const topProjections = projections.slice(0, getDisplayLimit(category));

    topProjections.forEach((entry, rank) => {
      const filmKey = PERSON_CATEGORY_IDS.has(category.id) ? entry.rawStudio : entry.rawTitle;
      if (!filmKey) return;
      const existing = filmMap.get(filmKey) ?? { nominations: 0, wins: 0 };
      filmMap.set(filmKey, {
        nominations: existing.nominations + 1,
        wins: existing.wins + (rank === 0 ? 1 : 0)
      });
    });
  }

  // Apply column visibility to headers based on current odds focus mode.
  if (thLeaderboardNominations) thLeaderboardNominations.hidden = oddsMode === "winner";
  if (thLeaderboardWins)        thLeaderboardWins.hidden        = oddsMode === "nomination";

  // Sort order matches the focused column: wins-first in winner mode, nominations-first otherwise.
  const rows = Array.from(filmMap.entries())
    .sort(([, a], [, b]) =>
      oddsMode === "winner"
        ? b.wins - a.wins || b.nominations - a.nominations
        : b.nominations - a.nominations || b.wins - a.wins
    )
    .slice(0, 10);

  if (rows.length === 0) {
    const row = leaderboardBody.insertRow();
    row.innerHTML = `<td class="results-empty" colspan="${oddsMode === "both" ? 3 : 2}">No contenders loaded yet.</td>`;
    return;
  }

  rows.forEach(([title, { nominations, wins }], index) => {
    const row = leaderboardBody.insertRow();
    row.className = "leaderboard-row";
    row.setAttribute(
      "aria-label",
      `${index + 1}. ${title}: ${nominations} nomination${nominations !== 1 ? "s" : ""}, ${wins} win${wins !== 1 ? "s" : ""}`
    );
    row.innerHTML =
      `<td class="leaderboard-film">` +
        `<span class="leaderboard-rank">${index + 1}</span>` +
        `<span class="leaderboard-title">${esc(title)}</span>` +
      `</td>` +
      (oddsMode !== "winner"     ? `<td class="leaderboard-num">${nominations}</td>` : "") +
      (oddsMode !== "nomination" ? `<td class="leaderboard-num">${wins}</td>`        : "");
  });
}

/** Dispatches to the correct results renderer based on the active UI mode. */
export function renderActiveView(activeCategory: Category, projections: Projection[]): void {
  if (compareMode && compareProfileId && !searchQuery) {
    if (comparePayloadCache.has(compareProfileId)) {
      renderCompareResults(activeCategory, projections);
    } else {
      setNormalTableHeaders(activeCategory);
      resultsBody.innerHTML = "";
      const loadingRow = document.createElement("tr");
      loadingRow.innerHTML = `<td class="results-empty" colspan="4">Loading comparison profile…</td>`;
      resultsBody.appendChild(loadingRow);
    }
  } else if (snapshotCompareMode && !searchQuery) {
    renderSnapshotCompareResults(activeCategory, projections);
  } else {
    renderResults(activeCategory, projections);
  }
}

// ── Main render function ──────────────────────────────────────────────────────

export function render() {
  setPanelsBusy(isBootstrapping);
  const activeCategory = getActiveCategory();
  updatePrintMeta();
  const projections = buildProjections(activeCategory);
  setLastOddsRecalculatedAt(new Date().toISOString());
  updateOddsFreshnessLabel();
  const capturedTrend = captureTrendSnapshot(activeCategory, projections);
  if (trendWindowSelect) trendWindowSelect.value = String(state.trendWindow);
  renderTabs();
  renderWeightSliders();
  renderWeightPresets();
  updateOddsModeButton();
  renderSummaryBar();
  renderLeaderboard();
  renderSweepPanel();
  renderCandidates(activeCategory, projections);
  renderSnapshotCompareDatePickers(activeCategory);
  renderActiveView(activeCategory, projections);
  if (capturedTrend) saveState();
}

// ── saveState forward reference ───────────────────────────────────────────────
// render.ts calls saveState() inside DOM event listeners created in createCard,
// renderTabs, and renderSummaryBar. Since saveState() lives in app.ts (which
// imports render.ts), we break the cycle with a settable ref that app.ts wires
// up before calling bootstrap().

let _saveState: () => void = () => { /* noop until wired by app.ts */ };
export function setSaveStateRef(fn: () => void): void { _saveState = fn; }
export function saveState(): void { _saveState(); }
