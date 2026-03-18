import { clamp } from "./forecast-utils.js";
import {
  state,
  categories,
  lockedCategories,
  surpriseBuzzUndo,
  compareMode,
  compareProfileId,
  snapshotCompareMode,
  snapshotDateA,
  snapshotDateB,
  oddsMode,
  comparePayloadCache,
  pendingBuzzSync,
  pendingUndo,
  profileOptions,
  profileAuthMap,
  resolveUnlock,
  unlockProfileId,
  authDialogMode,
  BUILTIN_PRESETS,
  WEIGHT_PRESETS_KEY,
  TREND_WINDOW_OPTIONS,
  CLIENT_ERROR_QUEUE,
  clientErrorFlushTimer,
  userPresets,
  setCompareMode,
  setCompareProfileId,
  setSnapshotCompareMode,
  setSnapshotDateA,
  setSnapshotDateB,
  setOddsMode,
  setSearchQuery,
  setResolveUnlock,
  setAuthDialogMode,
  setClientErrorFlushTimer,
  setProfileOptions,
  normalizeSignalKey,
  applyConsensusRanking,
  saveUserPresetsToStorage,
  parseFilmRecord,
  getSnapshotDays,
  getActiveCategory,
  buildShareUrl,
  isNoisyError,
} from "./state.js";
import type { ClientErrorPayload, WeightPreset } from "./state.js";
import type { Category, Film } from "./types.js";
import {
  render,
  saveState,
  setAppNotice,
  openAuthDialog,
  closeAuthDialog,
  updateLockButton,
  renderProfileOptions,
  updateCompareProfileSelect,
  renderWeightSliders,
  renderWeightPresets,
  updateOddsModeButton,
  setCsvStatus,
  setConsensusImportStatus,
  showBuzzSyncBanner,
  clearBuzzSyncBanner,
  showUndoToast,
  dismissUndoToast,
  applyTheme,
  contenderSearch,
  contenderSearchClear,
  compareToggleButton,
  compareControls,
  snapshotCompareToggle,
  snapshotCompareControls,
  trendWindowControl,
  oddsModeToggle,
  lockNomineesButton,
  surpriseMeButton,
  restoreBuzzButton,
  undoToastButton,
  undoToastDismiss,
  buzzSyncApply,
  buzzSyncDismiss,
  exportCsvButton,
  importCsvButton,
  csvFileInput,
  consensusImportButton,
  consensusImportDialog,
  consensusImportInput,
  consensusImportStatus,
  consensusImportCategory,
  consensusImportApply,
  consensusImportCancel,
  profileSelect,
  newProfileButton,
  renameProfileButton,
  deleteProfileButton,
  profileLockButton,
  authDialog,
  authDialogTitle,
  authDialogDesc,
  authDialogForm,
  authPassphraseInput,
  authPassphraseConfirm,
  authConfirmLabel,
  authDialogError,
  authDialogSubmit,
  authDialogCancel,
  authSecurityOptions,
  authChangePassphraseBtn,
  authRemovePassphraseBtn,
  authLogoutBtn,
  authSecurityClose,
  themeToggleButton,
  printPdfButton,
  printMeta,
  savePresetButton,
  weightPresetsEl,
  precursorSlider,
  historySlider,
  buzzSlider,
  compareProfileSelect,
  trendWindowSelect,
  snapshotDateASelect,
  snapshotDateBSelect,
} from "./render.js";

// ── Forward references for functions that live in app.ts ───────────────────────
// app.ts wires these up by calling the setters below before bootstrap() runs.

let _loadState: () => void = () => {};
let _loadStateFromApi: () => Promise<void> = async () => {};
let _loadProfiles: () => Promise<void> = async () => {};
let _refreshAuthStatus: (profileId: string) => Promise<void> = async () => {};
let _promptUnlock: (profileId: string) => Promise<boolean> = async () => false;
let _fetchAndRenderCompare: () => Promise<void> = async () => {};
let _saveStateToApi: () => Promise<boolean> = async () => false;
let _getLocalStorageKeyForProfile: (profileId?: string) => string = () => "";
let _getForecastApiUrl: (profileId?: string) => string = () => "";
let _getCsrfToken: () => string = () => "";

export function setLoadStateRef(fn: () => void): void { _loadState = fn; }
export function setLoadStateFromApiRef(fn: () => Promise<void>): void { _loadStateFromApi = fn; }
export function setLoadProfilesRef(fn: () => Promise<void>): void { _loadProfiles = fn; }
export function setRefreshAuthStatusRef(fn: (profileId: string) => Promise<void>): void { _refreshAuthStatus = fn; }
export function setPromptUnlockRef(fn: (profileId: string) => Promise<boolean>): void { _promptUnlock = fn; }
export function setFetchAndRenderCompareRef(fn: () => Promise<void>): void { _fetchAndRenderCompare = fn; }
export function setSaveStateToApiRef(fn: () => Promise<boolean>): void { _saveStateToApi = fn; }
export function setGetLocalStorageKeyForProfileRef(fn: (profileId?: string) => string): void { _getLocalStorageKeyForProfile = fn; }
export function setGetForecastApiUrlRef(fn: (profileId?: string) => string): void { _getForecastApiUrl = fn; }
export function setCsrfTokenRef(fn: () => string): void { _getCsrfToken = fn; }

// ── Helpers used by bind functions ────────────────────────────────────────────

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function parseConsensusInput(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportContendersCsv(): string {
  const header = ["category_id", "category_name", "title", "studio", "precursor", "history", "buzz", "strength"];
  const rows = [header.join(",")];

  categories.forEach((category) => {
    category.films.forEach((film) => {
      rows.push(
        [
          csvEscape(category.id),
          csvEscape(category.name),
          csvEscape(film.title),
          csvEscape(film.studio),
          film.precursor,
          film.history,
          film.buzz,
          csvEscape(film.strength)
        ].join(",")
      );
    });
  });

  return rows.join("\n");
}

function parseCsv(text: string): string[][] {
  const rows = [];
  let row: string[] = [];
  let value = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }

    i += 1;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

function importContendersCsv(text: string): void {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV is empty or missing rows.");

  const headerMap = rows[0].map((name) => name.trim().toLowerCase());
  const requiredColumns = ["category_id", "title", "studio", "precursor", "history", "buzz", "strength"];
  const missingColumns = requiredColumns.filter((name) => !headerMap.includes(name));
  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(", ")}`);
  }

  const indexOf = (name: string): number => headerMap.indexOf(name);
  const filmsByCategory = new Map<string, Film[]>();

  rows.slice(1).forEach((entry, rowIndex) => {
    const categoryId = String(entry[indexOf("category_id")] || "").trim();
    const category = categories.find((item) => item.id === categoryId);
    if (!category) {
      throw new Error(`Unknown category_id "${categoryId}" on row ${rowIndex + 2}.`);
    }

    const film = parseFilmRecord({
      title: entry[indexOf("title")],
      studio: entry[indexOf("studio")],
      precursor: entry[indexOf("precursor")],
      history: entry[indexOf("history")],
      buzz: entry[indexOf("buzz")],
      strength: entry[indexOf("strength")]
    });

    if (!film) {
      throw new Error(`Invalid contender data on row ${rowIndex + 2}.`);
    }

    if (!filmsByCategory.has(categoryId)) filmsByCategory.set(categoryId, []);
    filmsByCategory.get(categoryId)!.push(film);
  });

  if (filmsByCategory.size === 0) throw new Error("CSV did not include any contenders.");

  categories.forEach((category) => {
    const importedFilms = filmsByCategory.get(category.id);
    if (importedFilms && importedFilms.length > 0) {
      category.films = importedFilms;
    }
  });
}

function applyBuzzSync(): void {
  if (!pendingBuzzSync) return;
  const { title, buzz, targets } = pendingBuzzSync;
  const key = normalizeSignalKey(title);
  targets.forEach((cat) => {
    cat.films.forEach((f) => {
      if (normalizeSignalKey(f.title) === key) f.buzz = buzz;
    });
  });
  clearBuzzSyncBanner();
  saveState();
  render();
  setCsvStatus(`Buzz synced to ${targets.length} other categor${targets.length === 1 ? "y" : "ies"}.`, "success");
}

// ── Error reporting ────────────────────────────────────────────────────────────

export function flushClientErrors(): void {
  if (CLIENT_ERROR_QUEUE.length === 0) return;
  const batch = CLIENT_ERROR_QUEUE.splice(0);
  // keepalive: true ensures the request survives page unload.
  fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(batch),
    keepalive: true,
  }).catch(() => { /* intentionally silent */ });
}

export function reportClientError(payload: ClientErrorPayload): void {
  if (isNoisyError(payload.message, payload.source)) return;
  CLIENT_ERROR_QUEUE.push(payload);
  if (CLIENT_ERROR_QUEUE.length >= 10) {
    if (clientErrorFlushTimer !== null) { clearTimeout(clientErrorFlushTimer); setClientErrorFlushTimer(null); }
    flushClientErrors();
  } else if (clientErrorFlushTimer === null) {
    setClientErrorFlushTimer(setTimeout(() => { setClientErrorFlushTimer(null); flushClientErrors(); }, 3_000));
  }
}

// ── Global window error handlers ──────────────────────────────────────────────

export function bindWindowErrorHandlers(): void {
  // Capture synchronous JS errors (TypeError, ReferenceError, etc.)
  window.onerror = (message, source, lineno, colno, error): boolean => {
    reportClientError({
      message: String(message),
      source: typeof source === "string" ? source : undefined,
      lineno: typeof lineno === "number" ? lineno : undefined,
      colno:  typeof colno  === "number" ? colno  : undefined,
      stack:  error?.stack,
      context: window.location.pathname,
    });
    return false; // preserve browser's default console output
  };

  // Capture unhandled promise rejections (async/await, fetch chains, etc.)
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason as unknown;
    const err = reason instanceof Error ? reason : null;
    reportClientError({
      message: err?.message ?? String(reason ?? "Unhandled promise rejection"),
      stack:   err?.stack,
      context: window.location.pathname,
    });
  });
}

// ── Weight sliders ────────────────────────────────────────────────────────────

export function bindWeightSliders(): void {
  const debouncedRender = debounce(render, 100);

  function handleSlider(key: "precursor" | "history" | "buzz") {
    return (event: Event) => {
      state.weights[key] = clamp(Number((event.target as HTMLInputElement).value), 1, 95);
      renderWeightSliders();   // update % labels immediately while dragging
      renderWeightPresets();   // update active-preset highlight immediately
      saveState();
      debouncedRender();
    };
  }

  precursorSlider?.addEventListener("input", handleSlider("precursor"));
  historySlider  ?.addEventListener("input", handleSlider("history"));
  buzzSlider     ?.addEventListener("input", handleSlider("buzz"));
}

// ── Save preset button ────────────────────────────────────────────────────────

export function bindSavePresetButton(): void {
  if (!savePresetButton) return;
  savePresetButton.addEventListener("click", () => {
    const name = prompt("Name for this preset:")?.trim();
    if (!name) return;
    if (name.length > 40) {
      alert("Preset name must be 40 characters or fewer.");
      return;
    }
    const allNames = [...BUILTIN_PRESETS, ...userPresets].map((p) => p.name.toLowerCase());
    if (allNames.includes(name.toLowerCase())) {
      alert(`A preset named "${name}" already exists.`);
      return;
    }
    userPresets.push({
      name,
      precursor: state.weights.precursor,
      history:   state.weights.history,
      buzz:      state.weights.buzz,
    });
    saveUserPresetsToStorage(userPresets);
    renderWeightPresets();
  });
}

// ── Weight presets ────────────────────────────────────────────────────────────

export function bindWeightPresets(): void {
  if (!weightPresetsEl) return;
  weightPresetsEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const chip   = target.closest<HTMLElement>(".weight-preset-chip");
    if (!chip) return;

    const index  = Number(chip.dataset.presetIndex);
    const allPresets = [...BUILTIN_PRESETS, ...userPresets];
    const preset = allPresets[index];
    if (!preset) return;

    if (target.closest(".weight-preset-delete")) {
      const userIndex = index - BUILTIN_PRESETS.length;
      userPresets.splice(userIndex, 1);
      saveUserPresetsToStorage(userPresets);
      renderWeightPresets();
    } else if (target.closest(".weight-preset-name")) {
      state.weights.precursor = preset.precursor;
      state.weights.history   = preset.history;
      state.weights.buzz      = preset.buzz;
      saveState();
      render();
    }
  });
}

// ── Theme toggle ──────────────────────────────────────────────────────────────

export function bindThemeToggle(): void {
  themeToggleButton?.addEventListener("click", () => {
    type Theme = "dark" | "light";
    const current = document.documentElement.dataset.theme as Theme | undefined;
    const osDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const effective: Theme = current ?? (osDark ? "dark" : "light");
    applyTheme(effective === "dark" ? "light" : "dark");
  });
}

// ── Odds mode toggle ──────────────────────────────────────────────────────────

export function bindOddsModeToggle(): void {
  if (!oddsModeToggle) return;
  oddsModeToggle.addEventListener("click", () => {
    if (oddsMode === "both")            setOddsMode("nomination");
    else if (oddsMode === "nomination") setOddsMode("winner");
    else                                setOddsMode("both");
    render();
  });
}

// ── Lock nominees button ──────────────────────────────────────────────────────

export function bindLockNomineesButton(): void {
  if (!lockNomineesButton) return;
  lockNomineesButton.addEventListener("click", () => {
    const categoryId = state.categoryId;
    if (lockedCategories.has(categoryId)) {
      lockedCategories.delete(categoryId);
    } else {
      lockedCategories.add(categoryId);
    }
    saveState();
    render();
  });
}

// ── Undo toast ────────────────────────────────────────────────────────────────

export function bindUndoToast(): void {
  undoToastButton?.addEventListener("click", () => {
    pendingUndo?.();
    dismissUndoToast();
  });
  undoToastDismiss?.addEventListener("click", dismissUndoToast);
}

// ── Surprise Me ────────────────────────────────────────────────────────────────

export function bindSurpriseMe(): void {
  if (!surpriseMeButton || !restoreBuzzButton) return;

  surpriseMeButton.addEventListener("click", () => {
    const category = categories.find((c) => c.id === state.categoryId);
    if (!category || category.films.length === 0) return;

    // Save original buzz values only on the first randomization (preserve clean undo state).
    if (!surpriseBuzzUndo.has(category.id)) {
      surpriseBuzzUndo.set(category.id, category.films.map((f) => f.buzz));
    }

    // Apply ±5–15 pt random noise to every film's buzz score.
    category.films.forEach((film) => {
      const magnitude = 5 + Math.random() * 10; // [5, 15)
      const delta = Math.random() < 0.5 ? magnitude : -magnitude;
      film.buzz = Math.round(clamp(film.buzz + delta, 1, 95));
    });

    saveState();
    render();

    const categoryId = category.id;
    showUndoToast(`Buzz randomized in ${category.name}.`, () => {
      const cat = categories.find((c) => c.id === categoryId);
      if (!cat) return;
      const original = surpriseBuzzUndo.get(categoryId);
      if (!original) return;
      cat.films.forEach((film, i) => { if (original[i] !== undefined) film.buzz = original[i]; });
      surpriseBuzzUndo.delete(categoryId);
      saveState();
      render();
    });
  });

  restoreBuzzButton.addEventListener("click", () => {
    const category = categories.find((c) => c.id === state.categoryId);
    if (!category) return;

    const original = surpriseBuzzUndo.get(category.id);
    if (!original) return;

    category.films.forEach((film, i) => {
      if (original[i] !== undefined) film.buzz = original[i];
    });
    surpriseBuzzUndo.delete(category.id);

    saveState();
    render();
  });
}

// ── Consensus import ──────────────────────────────────────────────────────────

export function bindConsensusImport(): void {
  consensusImportButton?.addEventListener("click", () => {
    if (!consensusImportDialog) return;
    if (consensusImportCategory) consensusImportCategory.textContent = getActiveCategory().name;
    if (consensusImportInput) consensusImportInput.value = "";
    if (consensusImportStatus) consensusImportStatus.hidden = true;
    consensusImportDialog.showModal();
    consensusImportInput?.focus();
  });

  consensusImportApply?.addEventListener("click", () => {
    if (!consensusImportInput || !consensusImportDialog) return;
    const titles = parseConsensusInput(consensusImportInput.value);
    if (titles.length === 0) {
      setConsensusImportStatus("Enter at least one film title.", true);
      return;
    }
    const category = getActiveCategory();
    // Snapshot precursor values before applying so we can undo.
    const precursorSnapshot = category.films.map((f: Film) => ({ title: f.title, precursor: f.precursor }));
    const { matched, unmatched } = applyConsensusRanking(category, titles);
    if (matched.length === 0) {
      setConsensusImportStatus(`No titles matched films in ${category.name}.`, true);
      return;
    }
    saveState();
    render();
    consensusImportDialog!.close();
    const note = unmatched.length > 0 ? ` Unmatched: ${unmatched.join(", ")}.` : "";
    setCsvStatus(
      `Consensus applied: ${matched.length} film${matched.length !== 1 ? "s" : ""} ranked in ${category.name}.${note}`,
      "success"
    );
    showUndoToast(`Consensus applied to ${category.name}.`, () => {
      for (const snap of precursorSnapshot) {
        const film = category.films.find((f: Film) => f.title === snap.title);
        if (film) film.precursor = snap.precursor;
      }
      saveState();
      render();
    });
  });

  consensusImportCancel?.addEventListener("click", () => consensusImportDialog?.close());

  // Close on backdrop click
  consensusImportDialog?.addEventListener("click", (e) => {
    if (e.target === consensusImportDialog) consensusImportDialog!.close();
  });
}

// ── Buzz sync ─────────────────────────────────────────────────────────────────

export function bindBuzzSync(): void {
  buzzSyncApply?.addEventListener("click", applyBuzzSync);
  buzzSyncDismiss?.addEventListener("click", clearBuzzSyncBanner);
}

// ── CSV controls ──────────────────────────────────────────────────────────────

export function bindCsvControls(): void {
  exportCsvButton.addEventListener("click", () => {
    const csvText = exportContendersCsv();
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStamp = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `contenders-${dateStamp}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    setCsvStatus("Contender CSV exported.", "success");
  });

  importCsvButton.addEventListener("click", () => {
    csvFileInput.click();
  });

  csvFileInput.addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      importContendersCsv(await file.text());
      saveState();
      render();
      setCsvStatus(`Imported ${file.name}.`, "success");
    } catch (error) {
      setCsvStatus((error as Error).message || "CSV import failed.", "error");
    } finally {
      csvFileInput.value = "";
    }
  });
}

// ── Search controls ────────────────────────────────────────────────────────────

export function bindSearchControls(): void {
  if (!contenderSearch) return;
  const search = contenderSearch;
  const debouncedRender = debounce(render, 150);
  search.addEventListener("input", () => {
    setSearchQuery(search.value.trim());
    if (contenderSearchClear) contenderSearchClear.hidden = !search.value.trim();
    debouncedRender();
  });
  if (contenderSearchClear) {
    const clear = contenderSearchClear;
    clear.addEventListener("click", () => {
      setSearchQuery("");
      search.value = "";
      clear.hidden = true;
      render();
    });
  }
}

// ── Trend controls ────────────────────────────────────────────────────────────

export function bindTrendControls(): void {
  if (!trendWindowSelect) return;
  trendWindowSelect.value = String(state.trendWindow);
  trendWindowSelect.addEventListener("change", (event) => {
    const value = Number((event.target as HTMLSelectElement).value || 30);
    state.trendWindow = TREND_WINDOW_OPTIONS.includes(value) ? value : 30;
    saveState();
    render();
  });
}

// ── Print controls ────────────────────────────────────────────────────────────

export function bindPrintControls(): void {
  printPdfButton?.addEventListener("click", () => {
    if (printMeta) {
      const activeCategory = getActiveCategory();
      const stamp = new Date().toLocaleString();
      printMeta.textContent = `Profile: ${state.profileId} | Category: ${activeCategory?.name || "Unknown"} | Generated: ${stamp}`;
    }
    window.print();
  });
}

// ── Snapshot compare controls ─────────────────────────────────────────────────

export function bindSnapshotCompareControls(): void {
  snapshotCompareToggle?.addEventListener("click", () => {
    if (snapshotCompareMode) {
      setSnapshotCompareMode(false);
      setSnapshotDateA(null);
      setSnapshotDateB(null);
      if (snapshotCompareControls) snapshotCompareControls.hidden = true;
      if (trendWindowControl) trendWindowControl.hidden = false;
      if (snapshotCompareToggle) {
        snapshotCompareToggle.textContent = "Compare dates";
        snapshotCompareToggle.setAttribute("aria-pressed", "false");
        snapshotCompareToggle.classList.remove("action-button--lock-active");
      }
      render();
      return;
    }

    const activeCategory = getActiveCategory();
    const days = getSnapshotDays(activeCategory.id);
    if (days.length < 2) {
      setAppNotice("Need at least 2 snapshot days to compare.", "error");
      return;
    }

    // Disable profile compare if active
    if (compareMode) {
      setCompareMode(false);
      setCompareProfileId(null);
      if (compareControls) compareControls.hidden = true;
      if (compareToggleButton) {
        compareToggleButton.textContent = "Compare";
        compareToggleButton.setAttribute("aria-pressed", "false");
      }
    }

    setSnapshotCompareMode(true);
    setSnapshotDateA(days[0]);
    setSnapshotDateB(days[days.length - 1]);
    if (snapshotCompareToggle) {
      snapshotCompareToggle.textContent = "✕ Compare dates";
      snapshotCompareToggle.setAttribute("aria-pressed", "true");
      snapshotCompareToggle.classList.add("action-button--lock-active");
    }
    render();
  });

  snapshotDateASelect?.addEventListener("change", (event) => {
    setSnapshotDateA((event.target as HTMLSelectElement).value);
    render();
  });

  snapshotDateBSelect?.addEventListener("change", (event) => {
    setSnapshotDateB((event.target as HTMLSelectElement).value);
    render();
  });
}

// ── Compare controls ──────────────────────────────────────────────────────────

export function bindCompareControls(): void {
  if (!compareToggleButton) return;
  const toggleBtn = compareToggleButton;
  toggleBtn.addEventListener("click", async () => {
    if (compareMode) {
      setCompareMode(false);
      setCompareProfileId(null);
      if (compareControls) compareControls.hidden = true;
      toggleBtn.textContent = "Compare";
      toggleBtn.setAttribute("aria-pressed", "false");
      render();
      return;
    }
    const others = profileOptions.filter((id) => id !== state.profileId);
    if (others.length === 0) {
      setAppNotice("Create a second profile to use comparison mode.", "error");
      return;
    }
    // Disable snapshot compare if active
    if (snapshotCompareMode) {
      setSnapshotCompareMode(false);
      setSnapshotDateA(null);
      setSnapshotDateB(null);
      if (snapshotCompareControls) snapshotCompareControls.hidden = true;
      if (trendWindowControl) trendWindowControl.hidden = false;
      if (snapshotCompareToggle) {
        snapshotCompareToggle.textContent = "Compare dates";
        snapshotCompareToggle.setAttribute("aria-pressed", "false");
        snapshotCompareToggle.classList.remove("action-button--lock-active");
      }
    }
    setCompareMode(true);
    setCompareProfileId(others[0]);
    updateCompareProfileSelect();
    if (compareControls) compareControls.hidden = false;
    toggleBtn.textContent = "✕ Compare";
    toggleBtn.setAttribute("aria-pressed", "true");
    await _fetchAndRenderCompare();
  });

  compareProfileSelect?.addEventListener("change", async (event) => {
    const sel = (event.target as HTMLSelectElement).value;
    comparePayloadCache.delete(sel);
    setCompareProfileId(sel);
    await _fetchAndRenderCompare();
  });
}

// ── Profile lock button ───────────────────────────────────────────────────────

export function bindProfileLockButton(): void {
  if (!profileLockButton) return;

  profileLockButton.addEventListener("click", async () => {
    const profileId = state.profileId;
    const auth = profileAuthMap.get(profileId);

    if (!auth || !auth.hasPassphrase) {
      openAuthDialog("set");
    } else if (!auth.authenticated) {
      openAuthDialog("unlock");
    } else {
      // Show security options panel
      if (!authDialog || !authDialogForm || !authSecurityOptions) return;
      setAuthDialogMode(null);
      authDialogForm.hidden = true;
      authSecurityOptions.hidden = false;
      if (!authDialog.open) authDialog.showModal();
      authChangePassphraseBtn?.focus();
    }
  });

  authChangePassphraseBtn?.addEventListener("click", () => {
    openAuthDialog("change");
  });

  authRemovePassphraseBtn?.addEventListener("click", async () => {
    const profileId = state.profileId;
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/passphrase`, {
        method: "DELETE",
        headers: { "x-csrf-token": _getCsrfToken() },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setAppNotice(err.error || "Failed to remove passphrase.", "error");
        return;
      }
      closeAuthDialog();
      await _refreshAuthStatus(profileId);
      setAppNotice("Passphrase removed.");
    } catch {
      setAppNotice("Failed to remove passphrase. Check your connection.", "error");
    }
  });

  authLogoutBtn?.addEventListener("click", async () => {
    const profileId = state.profileId;
    try {
      await fetch(`/api/profiles/${encodeURIComponent(profileId)}/logout`, { method: "POST" });
      closeAuthDialog();
      await _refreshAuthStatus(profileId);
      setAppNotice("Logged out.");
    } catch {
      setAppNotice("Logout failed. Check your connection.", "error");
    }
  });

  authSecurityClose?.addEventListener("click", () => {
    closeAuthDialog();
  });

  authDialogCancel?.addEventListener("click", () => {
    const cb = resolveUnlock;
    setResolveUnlock(null);
    closeAuthDialog();
    cb?.(false);
  });

  authDialog?.addEventListener("close", () => {
    const cb = resolveUnlock;
    setResolveUnlock(null);
    cb?.(false);
  });

  // Real-time confirm-field validation: show/clear the mismatch error as the user
  // types, so they don't have to wait until submit to discover a typo.
  // Only active in "set" / "change" mode; the confirm field is hidden in "unlock".
  function validatePassphraseMatch(): void {
    if (!authDialogError || !authPassphraseInput || !authPassphraseConfirm) return;
    if (authDialogMode !== "set" && authDialogMode !== "change") return;
    const pass    = authPassphraseInput.value;
    const confirm = authPassphraseConfirm.value;
    if (confirm && pass !== confirm) {
      authDialogError.textContent = "Passphrases do not match.";
    } else if (authDialogError.textContent === "Passphrases do not match.") {
      // Only clear this specific error — leave length warnings untouched.
      authDialogError.textContent = "";
    }
  }

  authPassphraseInput?.addEventListener("input", validatePassphraseMatch);
  authPassphraseConfirm?.addEventListener("input", validatePassphraseMatch);

  // Single submit listener — handles unlock / set / change based on authDialogMode
  authDialogSubmit?.addEventListener("click", async () => {
    const profileId = authDialogMode === "unlock" ? unlockProfileId || state.profileId : state.profileId;
    const mode = authDialogMode;

    if (mode === "unlock") {
      const passphrase = authPassphraseInput?.value ?? "";
      if (!passphrase) {
        if (authDialogError) authDialogError.textContent = "Passphrase is required.";
        return;
      }
      try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/login`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": _getCsrfToken() },
          body: JSON.stringify({ passphrase }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          if (authDialogError) authDialogError.textContent = err.error || "Login failed.";
          return;
        }
        const cb = resolveUnlock;
        setResolveUnlock(null);
        await _refreshAuthStatus(profileId);
        closeAuthDialog();
        cb?.(true);
      } catch {
        if (authDialogError) authDialogError.textContent = "Login failed. Check your connection.";
      }
    } else if (mode === "set" || mode === "change") {
      const passphrase = authPassphraseInput?.value ?? "";
      const confirm = authPassphraseConfirm?.value ?? "";
      if (passphrase.length < 8) {
        if (authDialogError) authDialogError.textContent = "Passphrase must be at least 8 characters.";
        return;
      }
      if (passphrase !== confirm) {
        if (authDialogError) authDialogError.textContent = "Passphrases do not match.";
        return;
      }
      try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/passphrase`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": _getCsrfToken() },
          body: JSON.stringify({ passphrase }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          if (authDialogError) authDialogError.textContent = err.error || "Failed to set passphrase.";
          return;
        }
        closeAuthDialog();
        // Log in immediately after setting passphrase so the session cookie is established
        const loginRes = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/login`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": _getCsrfToken() },
          body: JSON.stringify({ passphrase }),
        });
        if (loginRes.ok) await _refreshAuthStatus(profileId);
        setAppNotice(mode === "set" ? "Passphrase set successfully." : "Passphrase changed successfully.");
      } catch {
        if (authDialogError) authDialogError.textContent = "Failed to set passphrase. Check your connection.";
      }
    }
  });
}

// ── Profile controls ──────────────────────────────────────────────────────────

export function bindProfileControls(): void {
  profileSelect.addEventListener("change", async (event) => {
    state.profileId = (event.target as HTMLSelectElement).value;
    _loadState();
    await _loadStateFromApi();
    await _refreshAuthStatus(state.profileId);
    if (compareMode) {
      updateCompareProfileSelect();
      if (compareProfileId === state.profileId || !compareProfileId) {
        const others = profileOptions.filter((id) => id !== state.profileId);
        setCompareProfileId(others[0] ?? null);
        if (!compareProfileId) {
          setCompareMode(false);
          if (compareControls) compareControls.hidden = true;
          if (compareToggleButton) { compareToggleButton.textContent = "Compare"; compareToggleButton.setAttribute("aria-pressed", "false"); }
        } else {
          updateCompareProfileSelect();
          await _fetchAndRenderCompare();
          return;
        }
      }
    }
    render();
  });

  newProfileButton.addEventListener("click", async () => {
    const name = window.prompt("New profile name:");
    if (!name) return;
    const profileId = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    if (!profileId) return;
    if (!profileOptions.includes(profileId)) setProfileOptions([...profileOptions, profileId]);
    state.profileId = profileId;
    renderProfileOptions();
    saveState();
    await _loadProfiles();
  });

  renameProfileButton?.addEventListener("click", async () => {
    const current = state.profileId;
    const input = window.prompt("Rename profile to (letters, digits, hyphens, underscores only):", current);
    if (!input || input.trim() === current) return;
    const newId = input.trim().toLowerCase();
    if (!newId || newId === current) return;
    if (!/^[a-z0-9_-]+$/.test(newId)) {
      alert("Invalid profile name. Use only letters a–z, digits, hyphens and underscores.");
      return;
    }

    const doRename = async (): Promise<void> => {
      const res = await fetch(`${_getForecastApiUrl(current)}/rename`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-csrf-token": _getCsrfToken() },
        body: JSON.stringify({ newId }),
      });
      if (res.status === 401) {
        const ok = await _promptUnlock(current);
        if (ok) await doRename();
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAppNotice((err as { error?: string }).error || "Rename failed.", "error");
        return;
      }
      const oldKey = _getLocalStorageKeyForProfile(current);
      const saved = localStorage.getItem(oldKey);
      if (saved) {
        localStorage.setItem(_getLocalStorageKeyForProfile(newId), saved);
        localStorage.removeItem(oldKey);
      }
      const idx = profileOptions.indexOf(current);
      const newOptions = [...profileOptions];
      if (idx >= 0) newOptions[idx] = newId;
      setProfileOptions(newOptions);
      state.profileId = newId;
      renderProfileOptions();
      setAppNotice(`Profile renamed to "${newId}".`);
    };

    try {
      await doRename();
    } catch {
      setAppNotice("Rename failed. Check your connection.", "error");
    }
  });

  deleteProfileButton?.addEventListener("click", async () => {
    if (profileOptions.length <= 1) return;
    const current = state.profileId;
    if (!window.confirm(`Delete profile "${current}"? This cannot be undone.`)) return;

    const doDelete = async (): Promise<void> => {
      const res = await fetch(_getForecastApiUrl(current), {
        method: "DELETE",
        headers: { "x-csrf-token": _getCsrfToken() },
      });
      if (res.status === 401) {
        const ok = await _promptUnlock(current);
        if (ok) await doDelete();
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAppNotice((err as { error?: string }).error || "Delete failed.", "error");
        return;
      }
      const doc = await res.json();
      localStorage.removeItem(_getLocalStorageKeyForProfile(current));
      setProfileOptions(profileOptions.filter((id) => id !== current));
      state.profileId = (doc as { activeProfileId?: string }).activeProfileId || profileOptions[0];
      renderProfileOptions();
      _loadState();
      await _loadStateFromApi();
      render();
      setAppNotice("Profile deleted.");
    };

    try {
      await doDelete();
    } catch {
      setAppNotice("Delete failed. Check your connection.", "error");
    }
  });
}

// ── Share controls ────────────────────────────────────────────────────────────

export function bindShareControls(): void {
  const shareButton = document.getElementById("shareButton") as HTMLButtonElement | null;
  if (!shareButton) return;

  shareButton.addEventListener("click", async () => {
    try {
      const url = buildShareUrl();
      await navigator.clipboard.writeText(url);
      setAppNotice("Share link copied to clipboard.", "");
      setTimeout(() => setAppNotice(""), 3000);
    } catch {
      // Clipboard blocked — surface URL in address bar for manual copy
      window.history.replaceState(null, "", buildShareUrl());
      setAppNotice("Clipboard unavailable — copy the URL from the address bar.", "");
      setTimeout(() => setAppNotice(""), 6000);
    }
  });
}

// ── User presets loading ──────────────────────────────────────────────────────

export function loadUserPresets(): WeightPreset[] {
  try {
    const raw = localStorage.getItem(WEIGHT_PRESETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p): p is WeightPreset => {
        if (!p || typeof p !== "object") return false;
        const q = p as Record<string, unknown>;
        return (
          typeof q.name === "string" && q.name.trim() !== "" &&
          typeof q.precursor === "number" &&
          typeof q.history   === "number" &&
          typeof q.buzz      === "number"
        );
      })
      .map((p) => ({
        name:      p.name.trim().slice(0, 40),
        precursor: clamp(p.precursor, 1, 95),
        history:   clamp(p.history,   1, 95),
        buzz:      clamp(p.buzz,      1, 95),
      }));
  } catch {
    return [];
  }
}
