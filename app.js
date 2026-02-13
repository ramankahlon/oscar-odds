const categories = [
  {
    id: "picture",
    name: "Best Picture",
    nominees: 10,
    winnerBase: 0.16,
    films: [
      { title: "Avatar: Fire and Ash", studio: "Disney", precursor: 69, history: 62, buzz: 76, strength: "High" },
      { title: "Wicked: For Good", studio: "Universal", precursor: 72, history: 65, buzz: 82, strength: "High" },
      { title: "Mickey 17", studio: "Warner Bros.", precursor: 74, history: 71, buzz: 78, strength: "High" },
      { title: "Frankenstein", studio: "Netflix", precursor: 67, history: 58, buzz: 70, strength: "Medium" },
      { title: "The Running Man", studio: "Paramount", precursor: 54, history: 48, buzz: 61, strength: "Medium" },
      { title: "Superman", studio: "Warner Bros.", precursor: 57, history: 45, buzz: 79, strength: "Low" },
      { title: "F1", studio: "Apple/Warner", precursor: 63, history: 57, buzz: 73, strength: "Medium" },
      { title: "The Bride!", studio: "Warner Bros.", precursor: 59, history: 53, buzz: 68, strength: "Low" },
      { title: "Bugonia", studio: "Focus", precursor: 66, history: 60, buzz: 64, strength: "Medium" },
      { title: "Wake Up Dead Man", studio: "Netflix", precursor: 61, history: 51, buzz: 71, strength: "Low" }
    ]
  },
  {
    id: "director",
    name: "Best Director",
    nominees: 5,
    winnerBase: 0.24,
    films: [
      { title: "Mickey 17", studio: "Bong Joon-ho", precursor: 76, history: 79, buzz: 78, strength: "High" },
      { title: "Avatar: Fire and Ash", studio: "James Cameron", precursor: 65, history: 70, buzz: 77, strength: "Medium" },
      { title: "Frankenstein", studio: "Guillermo del Toro", precursor: 71, history: 73, buzz: 72, strength: "High" },
      { title: "Bugonia", studio: "Yorgos Lanthimos", precursor: 68, history: 67, buzz: 66, strength: "Medium" },
      { title: "The Bride!", studio: "Maggie Gyllenhaal", precursor: 56, history: 52, buzz: 60, strength: "Low" },
      { title: "Wicked: For Good", studio: "Jon M. Chu", precursor: 58, history: 49, buzz: 70, strength: "Low" }
    ]
  },
  {
    id: "actor",
    name: "Best Actor",
    nominees: 5,
    winnerBase: 0.25,
    films: [
      { title: "Mickey 17 (Robert Pattinson)", studio: "WB", precursor: 73, history: 68, buzz: 75, strength: "High" },
      { title: "The Smashing Machine (Dwayne Johnson)", studio: "A24", precursor: 70, history: 63, buzz: 71, strength: "High" },
      { title: "F1 (Brad Pitt)", studio: "Apple/Warner", precursor: 66, history: 65, buzz: 73, strength: "Medium" },
      { title: "The Running Man (Glen Powell)", studio: "Paramount", precursor: 57, history: 54, buzz: 64, strength: "Low" },
      { title: "Frankenstein (Oscar Isaac)", studio: "Netflix", precursor: 62, history: 59, buzz: 67, strength: "Medium" },
      { title: "Wake Up Dead Man (Daniel Craig)", studio: "Netflix", precursor: 64, history: 56, buzz: 70, strength: "Medium" }
    ]
  },
  {
    id: "actress",
    name: "Best Actress",
    nominees: 5,
    winnerBase: 0.24,
    films: [
      { title: "Wicked: For Good (Cynthia Erivo)", studio: "Universal", precursor: 77, history: 72, buzz: 82, strength: "High" },
      { title: "The Bride! (Jessie Buckley)", studio: "WB", precursor: 68, history: 66, buzz: 69, strength: "Medium" },
      { title: "Bugonia (Emma Stone)", studio: "Focus", precursor: 75, history: 74, buzz: 70, strength: "High" },
      { title: "Frankenstein (Mia Goth)", studio: "Netflix", precursor: 61, history: 58, buzz: 65, strength: "Low" },
      { title: "Avatar: Fire and Ash (Zoe Saldana)", studio: "Disney", precursor: 58, history: 53, buzz: 72, strength: "Low" },
      { title: "Anora follow-up contender", studio: "Neon", precursor: 55, history: 60, buzz: 63, strength: "Low" }
    ]
  }
];

const STORAGE_KEY = "oscarOddsForecastState.v1";

const state = {
  categoryId: categories[0].id,
  weights: {
    precursor: 58,
    history: 30,
    buzz: 12
  }
};

const categoryTabs = document.querySelector("#categoryTabs");
const categoryTitle = document.querySelector("#categoryTitle");
const candidateCards = document.querySelector("#candidateCards");
const resultsBody = document.querySelector("#resultsBody");
const precursorWeight = document.querySelector("#precursorWeight");
const historyWeight = document.querySelector("#historyWeight");
const buzzWeight = document.querySelector("#buzzWeight");
const precursorWeightValue = document.querySelector("#precursorWeightValue");
const historyWeightValue = document.querySelector("#historyWeightValue");
const buzzWeightValue = document.querySelector("#buzzWeightValue");
const exportCsvButton = document.querySelector("#exportCsvButton");
const importCsvButton = document.querySelector("#importCsvButton");
const csvFileInput = document.querySelector("#csvFileInput");
const csvStatus = document.querySelector("#csvStatus");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWeights() {
  const total = state.weights.precursor + state.weights.history + state.weights.buzz;
  return {
    precursor: state.weights.precursor / total,
    history: state.weights.history / total,
    buzz: state.weights.buzz / total
  };
}

function logistic(z) {
  return 1 / (1 + Math.exp(-z));
}

function strengthBoost(strength) {
  if (strength === "High") return 1.06;
  if (strength === "Medium") return 1.0;
  return 0.94;
}

function sanitizeStrength(value) {
  if (value === "High" || value === "Medium" || value === "Low") return value;
  return "Low";
}

function parseFilmRecord(record) {
  if (!record || typeof record !== "object") return null;

  const title = String(record.title || "").trim();
  const studio = String(record.studio || "").trim();
  if (!title || !studio) return null;

  return {
    title,
    studio,
    precursor: clamp(Number(record.precursor || 0), 0, 100),
    history: clamp(Number(record.history || 0), 0, 100),
    buzz: clamp(Number(record.buzz || 0), 0, 100),
    strength: sanitizeStrength(String(record.strength || "").trim())
  };
}

function getActiveCategory() {
  return categories.find((category) => category.id === state.categoryId);
}

function scoreFilm(film, normalizedWeights) {
  const linear =
    film.precursor * normalizedWeights.precursor +
    film.history * normalizedWeights.history +
    film.buzz * normalizedWeights.buzz;

  const centered = (linear - 55) / 12;
  const nominationRaw = logistic(centered) * strengthBoost(film.strength);
  const winnerRaw = nominationRaw * (0.6 + film.precursor / 190);

  return {
    nominationRaw,
    winnerRaw
  };
}

function renderTabs() {
  categoryTabs.innerHTML = "";

  categories.forEach((category) => {
    const tab = document.createElement("button");
    tab.className = "tab";
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(category.id === state.categoryId));
    tab.textContent = category.name;
    tab.addEventListener("click", () => {
      state.categoryId = category.id;
      saveState();
      render();
    });
    categoryTabs.appendChild(tab);
  });
}

function createCard(category, film, filmIndex) {
  const card = document.createElement("div");
  card.className = "candidate-card";

  const head = document.createElement("div");
  head.className = "candidate-head";

  const title = document.createElement("h3");
  title.textContent = film.title;

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = `${film.studio}`;

  head.append(title, badge);

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
    input.value = String(film[field.key]);
    input.addEventListener("input", (event) => {
      film[field.key] = clamp(Number(event.target.value || 0), 0, 100);
      saveState();
      renderResults(category);
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
    categories
      .find((c) => c.id === category.id)
      .films[filmIndex].strength = event.target.value;
    saveState();
    renderResults(category);
  });
  strengthLabel.appendChild(strengthSelect);
  grid.appendChild(strengthLabel);

  card.append(head, grid);
  return card;
}

function renderCandidates(category) {
  categoryTitle.textContent = category.name;
  candidateCards.innerHTML = "";

  category.films.forEach((film, index) => {
    candidateCards.appendChild(createCard(category, film, index));
  });
}

function renderResults(category) {
  const normalized = normalizeWeights();

  const scored = category.films.map((film) => {
    const scores = scoreFilm(film, normalized);
    return { ...film, ...scores };
  });

  const nominationTotal = scored.reduce((sum, item) => sum + item.nominationRaw, 0) || 1;
  const winnerTotal = scored.reduce((sum, item) => sum + item.winnerRaw, 0) || 1;

  const nomineeScale = category.nominees / Math.max(1, scored.length);

  const projections = scored
    .map((film) => {
      const nomination = clamp((film.nominationRaw / nominationTotal) * 100 * nomineeScale, 0.4, 99);
      const winner = clamp(
        ((film.winnerRaw / winnerTotal) * 100 + nomination * category.winnerBase) /
          (1 + category.winnerBase),
        0.2,
        90
      );

      return {
        title: film.title,
        nomination,
        winner
      };
    })
    .sort((a, b) => b.winner - a.winner);

  resultsBody.innerHTML = "";
  projections.forEach((entry) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td><strong>${entry.title}</strong></td><td>${entry.nomination.toFixed(1)}%</td><td>${entry.winner.toFixed(1)}%</td>`;
    resultsBody.appendChild(row);
  });
}

function syncWeightLabels() {
  precursorWeight.value = String(state.weights.precursor);
  historyWeight.value = String(state.weights.history);
  buzzWeight.value = String(state.weights.buzz);
  precursorWeightValue.textContent = `${state.weights.precursor}%`;
  historyWeightValue.textContent = `${state.weights.history}%`;
  buzzWeightValue.textContent = `${state.weights.buzz}%`;
}

function bindWeightInputs() {
  const map = [
    { input: precursorWeight, key: "precursor" },
    { input: historyWeight, key: "history" },
    { input: buzzWeight, key: "buzz" }
  ];

  map.forEach(({ input, key }) => {
    input.addEventListener("input", (event) => {
      state.weights[key] = clamp(Number(event.target.value || 0), 1, 95);
      syncWeightLabels();
      saveState();
      renderResults(getActiveCategory());
    });
  });
}

function setCsvStatus(message, type = "") {
  csvStatus.textContent = message;
  csvStatus.className = `tool-status${type ? ` ${type}` : ""}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportContendersCsv() {
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

function parseCsv(text) {
  const rows = [];
  let row = [];
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

function importContendersCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV is empty or missing rows.");

  const headerMap = rows[0].map((name) => name.trim().toLowerCase());
  const requiredColumns = ["category_id", "title", "studio", "precursor", "history", "buzz", "strength"];
  const missingColumns = requiredColumns.filter((name) => !headerMap.includes(name));
  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(", ")}`);
  }

  const indexOf = (name) => headerMap.indexOf(name);
  const filmsByCategory = new Map();

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
    filmsByCategory.get(categoryId).push(film);
  });

  if (filmsByCategory.size === 0) throw new Error("CSV did not include any contenders.");

  categories.forEach((category) => {
    const importedFilms = filmsByCategory.get(category.id);
    if (importedFilms && importedFilms.length > 0) {
      category.films = importedFilms;
    }
  });
}

function bindCsvControls() {
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
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      importContendersCsv(await file.text());
      saveState();
      render();
      setCsvStatus(`Imported ${file.name}.`, "success");
    } catch (error) {
      setCsvStatus(error.message || "CSV import failed.", "error");
    } finally {
      csvFileInput.value = "";
    }
  });
}

function saveState() {
  try {
    const payload = {
      categoryId: state.categoryId,
      weights: state.weights,
      categories: categories.map((category) => ({
        id: category.id,
        films: category.films
      }))
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures (private mode or blocked storage).
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    if (parsed.weights && typeof parsed.weights === "object") {
      state.weights.precursor = clamp(Number(parsed.weights.precursor || state.weights.precursor), 1, 95);
      state.weights.history = clamp(Number(parsed.weights.history || state.weights.history), 1, 95);
      state.weights.buzz = clamp(Number(parsed.weights.buzz || state.weights.buzz), 1, 95);
    }

    if (typeof parsed.categoryId === "string" && categories.some((category) => category.id === parsed.categoryId)) {
      state.categoryId = parsed.categoryId;
    }

    if (Array.isArray(parsed.categories)) {
      parsed.categories.forEach((storedCategory) => {
        if (!storedCategory || typeof storedCategory !== "object") return;
        const target = categories.find((category) => category.id === storedCategory.id);
        if (!target || !Array.isArray(storedCategory.films)) return;

        const films = storedCategory.films.map(parseFilmRecord).filter(Boolean);
        if (films.length > 0) target.films = films;
      });
    }
  } catch {
    // Ignore malformed state.
  }
}

function render() {
  const activeCategory = getActiveCategory();
  renderTabs();
  renderCandidates(activeCategory);
  renderResults(activeCategory);
}

loadState();
bindWeightInputs();
bindCsvControls();
syncWeightLabels();
render();
