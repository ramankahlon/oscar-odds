const schedule2026Films = [
  "The Mother and the Bear",
  "We Bury the Dead",
  "Greenland 2: Migration",
  "Primate",
  "Soulm8te",
  "Dead Man's Wire",
  "I Was A Stranger",
  "Magellan",
  "OBEX",
  "People We Meet on Vacation",
  "Starbright",
  "Young Mothers",
  "28 Years Later: The Bone Temple",
  "Charlie the Wonderdog",
  "All You Need Is Kill",
  "Night Patrol",
  "A Private Life",
  "The RIP",
  "Sound of Falling",
  "A Useful Ghost",
  "Clika",
  "H is for Hawk",
  "Mercy",
  "Return to Silent Hill",
  "In Cold Light",
  "Send Help",
  "Shelter",
  "Islands",
  "The Love That Remains",
  "The Moment",
  "A Poet",
  "Dracula: A Love Tale",
  "Scarlet",
  "Solo Mio",
  "The Strangers: Chapter 3",
  "Whistle",
  "Buffalo Kids",
  "Calle Malaga",
  "Jimpa",
  "My Father's Shadow",
  "The President's Cake",
  "Cold Storage",
  "Broken Bird",
  "Crime 101",
  "GOAT",
  "Good Luck, Have Fun, Don't Die",
  "Wuthering Heights",
  "The Mortuary Assistant",
  "Nirvanna the Band the Show the Movie",
  "How to Make a Killing",
  "I Can Only Imagine 2",
  "Psycho Killer",
  "Midwinter Break",
  "Protector",
  "This Is Not a Test",
  "EPiC: Elvis Presley in Concert",
  "Scream 7",
  "Dreams",
  "Man on the Run",
  "The Bride!",
  "Pixar's Hoppers",
  "Andre is an Idiot",
  "Peaky Blinders: The Immortal Man",
  "Youngblood",
  "The Breadwinner",
  "Reminders of Him",
  "The Undertone",
  "Slanted",
  "Billie Eilish - Hit Me Hard and Soft: The Tour (Live in 3D)",
  "Project Hail Mary",
  "The Pout-Pout Fish",
  "Whitney Springs",
  "The Dog Stars",
  "They Will Kill You",
  "Alpha",
  "Kontinental '25",
  "Yes",
  "The Drama",
  "The Super Mario Galaxy Movie",
  "A Great Awakening",
  "The Third Parent",
  "Ready or Not 2: Here I Come",
  "You, Me & Tuscany",
  "Normal",
  "The Resurrected",
  "Michael",
  "Omaha",
  "The Devil Wears Prada 2",
  "Hokum",
  "Mortal Kombat II",
  "The Sheep Detectives",
  "Is God Is",
  "Obsession",
  "Poetic License",
  "I Love Boosters",
  "The Mandalorian and Grogu",
  "Stop! That! Train!",
  "Animal Friends",
  "Masters of the Universe",
  "Power Ballad",
  "Scary Movie 6",
  "The Dish [Spielberg Movie]",
  "Pixar's Toy Story 5",
  "Supergirl",
  "Mega Minions",
  "Shiver",
  "Young Washington",
  "Moana [Live-Action]",
  "Cut Off",
  "Christopher Nolan's The Odyssey",
  "Evil Dead Burn",
  "Spider-Man: Brand New Day",
  "Once Upon A Time in A Cinema",
  "Super Troopers 3",
  "Flowervale Street",
  "PAW Patrol 3: The Dino Movie",
  "Mutiny",
  "Thread: An Insidious Tale",
  "Cliffhanger",
  "Coyote vs. Acme",
  "How to Rob a Bank",
  "Clayface",
  "Sense and Sensibility",
  "Practical Magic 2",
  "Resident Evil",
  "Charlie Harper",
  "Forgotten Island",
  "Judy [Inarritu Movie]",
  "Verity",
  "The Legend of Aang: The Last Airbender",
  "Other Mommy",
  "The Social Reckoning",
  "Street Fighter",
  "Whalefall",
  "Remain",
  "Shaun the Sheep: The Beast of Mossy Bottom",
  "Archangel",
  "Dr. Seuss' The Cat in the Hat",
  "Ebenezer: A Christmas Carol",
  "The Hunger Games: Sunrise on the Reaping",
  "Hexed",
  "Meet the Parents 4: Focker In-Law",
  "Narnia",
  "Violent Night 2",
  "Jumanji 3",
  "Avengers: Doomsday",
  "Dune: Part Three"
];

const categoryDefinitions = [
  { id: "picture", name: "Best Picture", nominees: 10, winnerBase: 0.16 },
  { id: "director", name: "Best Director", nominees: 5, winnerBase: 0.24 },
  { id: "actor", name: "Best Actor", nominees: 5, winnerBase: 0.25 },
  { id: "actress", name: "Best Actress", nominees: 5, winnerBase: 0.24 },
  { id: "supporting-actor", name: "Best Supporting Actor", nominees: 5, winnerBase: 0.23 },
  { id: "supporting-actress", name: "Best Supporting Actress", nominees: 5, winnerBase: 0.23 },
  { id: "original-screenplay", name: "Best Original Screenplay", nominees: 5, winnerBase: 0.22 },
  { id: "adapted-screenplay", name: "Best Adapted Screenplay", nominees: 5, winnerBase: 0.22 },
  { id: "animated-feature", name: "Best Animated Feature Film", nominees: 5, winnerBase: 0.2 },
  { id: "international-feature", name: "Best International Feature Film", nominees: 5, winnerBase: 0.2 },
  { id: "documentary-feature", name: "Best Documentary Feature Film", nominees: 5, winnerBase: 0.2 },
  { id: "documentary-short", name: "Best Documentary Short Film", nominees: 5, winnerBase: 0.18 },
  { id: "live-action-short", name: "Best Live Action Short Film", nominees: 5, winnerBase: 0.18 },
  { id: "animated-short", name: "Best Animated Short Film", nominees: 5, winnerBase: 0.18 },
  { id: "original-score", name: "Best Original Score", nominees: 5, winnerBase: 0.21 },
  { id: "original-song", name: "Best Original Song", nominees: 5, winnerBase: 0.2 },
  { id: "sound", name: "Best Sound", nominees: 5, winnerBase: 0.2 },
  { id: "production-design", name: "Best Production Design", nominees: 5, winnerBase: 0.2 },
  { id: "cinematography", name: "Best Cinematography", nominees: 5, winnerBase: 0.2 },
  { id: "makeup-hairstyling", name: "Best Makeup and Hairstyling", nominees: 5, winnerBase: 0.19 },
  { id: "costume-design", name: "Best Costume Design", nominees: 5, winnerBase: 0.19 },
  { id: "film-editing", name: "Best Film Editing", nominees: 5, winnerBase: 0.21 },
  { id: "visual-effects", name: "Best Visual Effects", nominees: 5, winnerBase: 0.2 },
  { id: "casting", name: "Best Casting", nominees: 5, winnerBase: 0.19 }
];

function createSeedFilms() {
  return schedule2026Films.map((title) => ({
    title,
    studio: "TBD",
    precursor: 55,
    history: 50,
    buzz: 52,
    strength: "Medium"
  }));
}

const categories = categoryDefinitions.map((category) => ({
  ...category,
  films: createSeedFilms()
}));

const letterboxdRanks = new Map([
  ["Hamnet", 3],
  ["The Bride!", 14],
  ["The Testament of Ann Lee", 21],
  ["Is This Thing On?", 23],
  ["Magellan", 27],
  ["Dr. Seuss' The Cat in the Hat", 42],
  ["Is God Is", 43],
  ["Pixar's Hoppers", 44],
  ["Scream 7", 45],
  ["The Dish [Spielberg Movie]", 49],
  ["Christopher Nolan's The Odyssey", 50],
  ["Young Mothers", 53],
  ["Dune: Part Three", 54]
]);

const theGamerRanks = new Map([
  ["The Dish [Spielberg Movie]", 4],
  ["The Bride!", 5],
  ["Michael", 8],
  ["Hamnet", 10]
]);

const redditMentions = new Map([
  ["Christopher Nolan's The Odyssey", 9],
  ["Project Hail Mary", 6],
  ["Dune: Part Three", 4],
  ["Michael", 4],
  ["The Social Reckoning", 3],
  ["Narnia", 3],
  ["Sense and Sensibility", 2],
  ["The Bride!", 2],
  ["The Drama", 2],
  ["The Dish [Spielberg Movie]", 2],
  ["The Dog Stars", 1],
  ["Forgotten Island", 1],
  ["Pixar's Hoppers", 1],
  ["Avengers: Doomsday", 1],
  ["Wuthering Heights", 1],
  ["Clayface", 1]
]);

const bovadaAmericanOdds = new Map([
  ["Hamnet", 400]
]);

const kalshiImpliedOdds = new Map([
  ["Hamnet", 0.05]
]);

function rankToScore(rank, maxRank) {
  if (!rank) return 0;
  return clamp((maxRank - rank + 1) / maxRank, 0, 1);
}

function americanOddsToProbability(odds) {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  if (odds > 0) return 100 / (odds + 100);
  const abs = Math.abs(odds);
  return abs / (abs + 100);
}

function applyExternalPredictionSignals() {
  const maxRedditMentions = Math.max(...redditMentions.values(), 1);
  categories.forEach((category) => {
    category.films.forEach((film) => {
      const letterboxdScore = rankToScore(letterboxdRanks.get(film.title), 54);
      const theGamerScore = rankToScore(theGamerRanks.get(film.title), 10);
      const redditScore = clamp((redditMentions.get(film.title) || 0) / maxRedditMentions, 0, 1);
      const bovadaScore = americanOddsToProbability(bovadaAmericanOdds.get(film.title));
      const kalshiScore = clamp(kalshiImpliedOdds.get(film.title) || 0, 0, 1);
      const bettingScore =
        bovadaScore > 0 && kalshiScore > 0
          ? (bovadaScore + kalshiScore) / 2
          : bovadaScore > 0
            ? bovadaScore
            : kalshiScore;

      const composite =
        letterboxdScore * 0.35 +
        theGamerScore * 0.2 +
        redditScore * 0.25 +
        bettingScore * 0.2;

      if (composite <= 0) return;

      film.precursor = clamp(Math.round(55 + composite * 35), 0, 100);
      film.history = clamp(Math.round(50 + (letterboxdScore * 0.7 + theGamerScore * 0.3) * 28), 0, 100);
      film.buzz = clamp(
        Math.round(52 + (redditScore * 0.4 + Math.max(letterboxdScore, theGamerScore, bettingScore) * 0.6) * 36),
        0,
        100
      );

      if (composite >= 0.62 || redditScore >= 0.8 || bettingScore >= 0.35) {
        film.strength = "High";
      } else if (composite >= 0.34) {
        film.strength = "Medium";
      } else {
        film.strength = "Low";
      }
    });
  });
}

applyExternalPredictionSignals();

const STORAGE_KEY = "oscarOddsForecastState.v7";

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
      render();
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
    render();
  });
  strengthLabel.appendChild(strengthSelect);
  grid.appendChild(strengthLabel);

  card.append(head, grid);
  return card;
}

function getDisplayLimit(category) {
  return category.id === "picture" ? 10 : 5;
}

function buildProjections(category) {
  const normalized = normalizeWeights();

  const scored = category.films.map((film, index) => {
    const scores = scoreFilm(film, normalized);
    return { ...film, ...scores, index };
  });

  const nominationTotal = scored.reduce((sum, item) => sum + item.nominationRaw, 0) || 1;
  const winnerTotal = scored.reduce((sum, item) => sum + item.winnerRaw, 0) || 1;
  const nomineeScale = category.nominees / Math.max(1, scored.length);

  return scored
    .map((film) => {
      const nomination = clamp((film.nominationRaw / nominationTotal) * 100 * nomineeScale, 0.4, 99);
      const winner = clamp(
        ((film.winnerRaw / winnerTotal) * 100 + nomination * category.winnerBase) /
          (1 + category.winnerBase),
        0.2,
        90
      );

      return {
        index: film.index,
        title: film.title,
        nomination,
        winner
      };
    })
    .sort((a, b) => b.winner - a.winner);
}

function renderCandidates(category, projections) {
  categoryTitle.textContent = category.name;
  candidateCards.innerHTML = "";

  projections.slice(0, getDisplayLimit(category)).forEach((entry) => {
    candidateCards.appendChild(createCard(category, category.films[entry.index], entry.index));
  });
}

function renderResults(category, projections) {
  resultsBody.innerHTML = "";
  projections.slice(0, getDisplayLimit(category)).forEach((entry) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td><strong>${entry.title}</strong></td><td>${entry.nomination.toFixed(1)}%</td><td>${entry.winner.toFixed(1)}%</td>`;
    resultsBody.appendChild(row);
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
  const projections = buildProjections(activeCategory);
  renderTabs();
  renderCandidates(activeCategory, projections);
  renderResults(activeCategory, projections);
}

loadState();
bindCsvControls();
render();
