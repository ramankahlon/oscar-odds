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

function contender(title, studio, precursor, history, buzz, strength) {
  return { title, studio, precursor, history, buzz, strength };
}

const categorySeeds = {
  picture: [
    contender("Christopher Nolan's The Odyssey", "Universal", 88, 84, 92, "High"),
    contender("Dune: Part Three", "Warner Bros.", 86, 81, 90, "High"),
    contender("Project Hail Mary", "Amazon MGM", 82, 74, 87, "High"),
    contender("The Social Reckoning", "A24", 80, 76, 83, "High"),
    contender("The Dog Stars", "20th Century Studios", 78, 82, 74, "High"),
    contender("The Bride!", "Warner Bros.", 77, 72, 81, "Medium"),
    contender("Michael", "Lionsgate", 75, 66, 88, "Medium"),
    contender("Sense and Sensibility", "Focus Features", 71, 73, 70, "Medium"),
    contender("Narnia", "Netflix", 68, 64, 79, "Medium"),
    contender("The Dish [Spielberg Movie]", "Universal", 69, 70, 72, "Medium")
  ],
  director: [
    contender("Christopher Nolan", "The Odyssey", 90, 88, 94, "High"),
    contender("Denis Villeneuve", "Dune: Part Three", 86, 84, 89, "High"),
    contender("Maggie Gyllenhaal", "The Bride!", 79, 73, 82, "High"),
    contender("Steven Spielberg", "The Dish", 78, 90, 72, "High"),
    contender("Alejandro G. Inarritu", "Judy", 74, 85, 68, "Medium")
  ],
  actor: [
    contender("Tom Cruise", "Judy", 84, 78, 90, "High"),
    contender("Jaafar Jackson", "Michael", 81, 66, 92, "High"),
    contender("Ryan Gosling", "Project Hail Mary", 79, 82, 76, "High"),
    contender("Matt Damon", "The Odyssey", 76, 82, 74, "High"),
    contender("Jeremy Strong", "The Social Reckoning", 73, 75, 72, "Medium")
  ],
  actress: [
    contender("Mikey Madison", "The Social Reckoning", 83, 76, 82, "High"),
    contender("Jessie Buckley", "The Bride!", 81, 79, 77, "High"),
    contender("Zendaya", "The Drama", 75, 73, 71, "Medium"),
    contender("Daisy Edgar-Jones", "Sense and Sensibility", 72, 70, 69, "Medium"),
    contender("Amy Adams", "At the Sea", 77, 86, 70, "High")
  ],
  "supporting-actor": [
    contender("John Magaro", "Nuremberg", 74, 80, 65, "Medium"),
    contender("Josh Brolin", "Dune: Part Three", 74, 70, 78, "Medium"),
    contender("John Malkovich", "Wild Horse Nine", 73, 77, 68, "Medium"),
    contender("John Goodman", "Judy", 71, 79, 66, "Medium"),
    contender("Will Poulter", "Saturn Return", 69, 64, 72, "Low")
  ],
  "supporting-actress": [
    contender("Sandra Huller", "Judy", 78, 86, 70, "High"),
    contender("Octavia Spencer", "Death of a Salesman", 76, 83, 65, "High"),
    contender("Mariana di Girolamo", "Wild Horse Nine", 72, 69, 71, "Medium"),
    contender("Charlize Theron", "The Odyssey", 70, 74, 73, "Medium"),
    contender("Parker Posey", "Wild Horse Nine", 68, 66, 67, "Low")
  ],
  "original-screenplay": [
    contender("The Social Reckoning", "A24", 82, 78, 80, "High"),
    contender("The Bride!", "Warner Bros.", 78, 71, 76, "High"),
    contender("The Drama", "A24", 75, 73, 72, "Medium"),
    contender("The Dish [Spielberg Movie]", "Universal", 73, 77, 69, "Medium"),
    contender("Michael", "Lionsgate", 70, 64, 78, "Medium")
  ],
  "adapted-screenplay": [
    contender("The Dog Stars", "20th Century Studios", 84, 86, 73, "High"),
    contender("Project Hail Mary", "Amazon MGM", 80, 72, 82, "High"),
    contender("Sense and Sensibility", "Focus Features", 77, 79, 68, "Medium"),
    contender("Narnia", "Netflix", 71, 66, 75, "Medium"),
    contender("Dune: Part Three", "Warner Bros.", 72, 74, 70, "Medium")
  ],
  "animated-feature": [
    contender("Pixar's Toy Story 5", "Disney/Pixar", 86, 89, 90, "High"),
    contender("Pixar's Hoppers", "Disney/Pixar", 82, 75, 84, "High"),
    contender("The Super Mario Galaxy Movie", "Universal/Illumination", 78, 67, 88, "Medium"),
    contender("Dr. Seuss' The Cat in the Hat", "Warner Bros.", 74, 69, 76, "Medium"),
    contender("PAW Patrol 3: The Dino Movie", "Paramount", 68, 60, 71, "Low")
  ],
  "international-feature": [
    contender("The Love That Remains", "Nordisk", 81, 83, 69, "High"),
    contender("A Poet", "Mubi", 78, 80, 65, "High"),
    contender("Calle Malaga", "Sony Pictures Classics", 74, 76, 63, "Medium"),
    contender("Islands", "Neon", 71, 72, 62, "Medium"),
    contender("The Mother and the Bear", "Janus Films", 69, 74, 60, "Low")
  ],
  "documentary-feature": [
    contender("Andre is an Idiot", "A24", 79, 76, 74, "High"),
    contender("EPiC: Elvis Presley in Concert", "Sony", 75, 70, 82, "Medium"),
    contender("Man on the Run", "Neon", 73, 71, 68, "Medium"),
    contender("Whalefall", "Participant", 70, 69, 65, "Medium"),
    contender("Archangel", "Netflix", 68, 66, 63, "Low")
  ],
  "documentary-short": [
    contender("The President's Cake", "ShortsTV", 74, 73, 67, "High"),
    contender("Stop! That! Train!", "ShortsTV", 72, 68, 64, "Medium"),
    contender("Other Mommy", "ShortsTV", 70, 65, 63, "Medium"),
    contender("Broken Bird", "ShortsTV", 68, 64, 60, "Low"),
    contender("Charlie Harper", "ShortsTV", 66, 62, 58, "Low")
  ],
  "live-action-short": [
    contender("The Third Parent", "ShortsTV", 75, 72, 66, "High"),
    contender("A Great Awakening", "ShortsTV", 73, 70, 64, "Medium"),
    contender("This Is Not a Test", "ShortsTV", 71, 66, 61, "Medium"),
    contender("Thread: An Insidious Tale", "ShortsTV", 69, 63, 65, "Low"),
    contender("The Resurrected", "ShortsTV", 67, 62, 60, "Low")
  ],
  "animated-short": [
    contender("Buffalo Kids", "ShortsTV", 74, 73, 68, "High"),
    contender("The Sheep Detectives", "ShortsTV", 72, 69, 66, "Medium"),
    contender("Shaun the Sheep: The Beast of Mossy Bottom", "Aardman", 70, 71, 69, "Medium"),
    contender("Whistle", "ShortsTV", 68, 64, 61, "Low"),
    contender("The Pout-Pout Fish", "DreamWorks", 67, 63, 62, "Low")
  ],
  "original-score": [
    contender("Dune: Part Three", "Warner Bros.", 87, 88, 80, "High"),
    contender("The Odyssey", "Universal", 83, 86, 78, "High"),
    contender("The Bride!", "Warner Bros.", 78, 76, 72, "Medium"),
    contender("Project Hail Mary", "Amazon MGM", 76, 73, 75, "Medium"),
    contender("Michael", "Lionsgate", 74, 68, 82, "Medium")
  ],
  "original-song": [
    contender("Michael", "Lionsgate", 84, 72, 91, "High"),
    contender("Narnia", "Netflix", 79, 68, 83, "Medium"),
    contender("Toy Story 5", "Disney/Pixar", 76, 71, 80, "Medium"),
    contender("Moana [Live-Action]", "Disney", 74, 70, 85, "Medium"),
    contender("The Bride!", "Warner Bros.", 73, 74, 88, "Medium")
  ],
  sound: [
    contender("Dune: Part Three", "Warner Bros.", 88, 86, 78, "High"),
    contender("The Odyssey", "Universal", 84, 80, 76, "High"),
    contender("Project Hail Mary", "Amazon MGM", 80, 74, 79, "Medium"),
    contender("Avengers: Doomsday", "Marvel", 77, 68, 86, "Medium"),
    contender("Spider-Man: Brand New Day", "Sony", 73, 64, 84, "Low")
  ],
  "production-design": [
    contender("The Odyssey", "Universal", 87, 85, 78, "High"),
    contender("Dune: Part Three", "Warner Bros.", 85, 83, 75, "High"),
    contender("The Bride!", "Warner Bros.", 82, 77, 73, "Medium"),
    contender("Narnia", "Netflix", 78, 69, 79, "Medium"),
    contender("The Dish [Spielberg Movie]", "Universal", 74, 72, 67, "Low")
  ],
  cinematography: [
    contender("The Odyssey", "Universal", 89, 88, 79, "High"),
    contender("Dune: Part Three", "Warner Bros.", 87, 86, 77, "High"),
    contender("The Dog Stars", "20th Century Studios", 83, 84, 71, "High"),
    contender("The Bride!", "Warner Bros.", 79, 74, 70, "Medium"),
    contender("Judy [Inarritu Movie]", "Warner Bros.", 76, 82, 68, "Medium")
  ],
  "makeup-hairstyling": [
    contender("The Bride!", "Warner Bros.", 86, 80, 75, "High"),
    contender("The Odyssey", "Universal", 82, 77, 73, "High"),
    contender("Michael", "Lionsgate", 80, 70, 84, "Medium"),
    contender("Supergirl", "DC Studios", 76, 64, 81, "Medium"),
    contender("Clayface", "DC Studios", 73, 67, 79, "Low")
  ],
  "costume-design": [
    contender("The Devil Wears Prada 2", "20th Century Studios", 86, 89, 71, "High"),
    contender("The Bride!", "Warner Bros.", 84, 81, 74, "High"),
    contender("Sense and Sensibility", "Focus Features", 80, 83, 68, "Medium"),
    contender("The Odyssey", "Universal", 78, 76, 72, "Medium"),
    contender("Narnia", "Netflix", 75, 69, 76, "Low")
  ],
  "film-editing": [
    contender("The Odyssey", "Universal", 85, 84, 79, "High"),
    contender("Dune: Part Three", "Warner Bros.", 83, 82, 76, "High"),
    contender("Project Hail Mary", "Amazon MGM", 80, 75, 78, "Medium"),
    contender("The Social Reckoning", "A24", 78, 77, 73, "Medium"),
    contender("Michael", "Lionsgate", 74, 69, 82, "Low")
  ],
  "visual-effects": [
    contender("Dune: Part Three", "Warner Bros.", 91, 88, 82, "High"),
    contender("The Odyssey", "Universal", 87, 83, 80, "High"),
    contender("Avengers: Doomsday", "Marvel", 85, 73, 90, "Medium"),
    contender("Project Hail Mary", "Amazon MGM", 82, 76, 84, "Medium"),
    contender("Spider-Man: Brand New Day", "Sony", 79, 68, 88, "Low")
  ],
  casting: [
    contender("The Social Reckoning", "A24", 82, 79, 75, "High"),
    contender("Michael", "Lionsgate", 80, 73, 88, "High"),
    contender("The Odyssey", "Universal", 78, 77, 74, "Medium"),
    contender("The Bride!", "Warner Bros.", 76, 72, 73, "Medium"),
    contender("Narnia", "Netflix", 72, 67, 78, "Low")
  ]
};

function createSeedFilms() {
  return schedule2026Films.map((title) => contender(title, "TBD", 55, 50, 52, "Medium"));
}

const categories = categoryDefinitions.map((category) => ({
  ...category,
  films: categorySeeds[category.id] ? [...categorySeeds[category.id]] : createSeedFilms()
}));

const priorCategoryWins = {
  director: {
    "Christopher Nolan": 1,
    "Steven Spielberg": 2,
    "Alejandro G. Inarritu": 2
  },
  actor: {},
  actress: {
    "Mikey Madison": 1,
    "Jessie Buckley": 1
  },
  "supporting-actor": {},
  "supporting-actress": {
    "Octavia Spencer": 1
  }
};

const recentWinnerPenalty = {
  actress: {
    "Mikey Madison": 1,
    "Jessie Buckley": 1
  }
};

const overdueNarrativeBoost = {
  actress: {
    "Amy Adams": 1
  }
};

const STORAGE_KEY = "oscarOddsForecastState.v11";
const EXTERNAL_SIGNALS_URL = "data/source-signals.json";
const EXTERNAL_SIGNALS_POLL_MS = 5 * 60 * 1000;

const state = {
  categoryId: categories[0].id,
  weights: {
    precursor: 58,
    history: 30,
    buzz: 12
  }
};
let appliedExternalSnapshotId = null;

const categoryTabs = document.querySelector("#categoryTabs");
const categoryTitle = document.querySelector("#categoryTitle");
const candidateCards = document.querySelector("#candidateCards");
const resultsBody = document.querySelector("#resultsBody");
const resultsPrimaryHeader = document.querySelector("#resultsPrimaryHeader");
const exportCsvButton = document.querySelector("#exportCsvButton");
const importCsvButton = document.querySelector("#importCsvButton");
const csvFileInput = document.querySelector("#csvFileInput");
const csvStatus = document.querySelector("#csvStatus");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSignalKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
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

function winnerExperienceBoost(categoryId, contenderName) {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";
  if (!isPersonCategory) return 1;

  const wins = priorCategoryWins[categoryId]?.[contenderName] || 0;
  const hasRecentPenalty = Boolean(recentWinnerPenalty[categoryId]?.[contenderName]);
  const hasOverdueNarrative = Boolean(overdueNarrativeBoost[categoryId]?.[contenderName]);

  let boost = 1;
  if (wins === 0) {
    boost += 0.06;
  } else {
    boost += Math.min(wins, 2) * 0.03;
  }

  if (hasRecentPenalty) boost -= 0.12;
  if (hasOverdueNarrative) boost += 0.08;
  return clamp(boost, 0.8, 1.2);
}

function sanitizeStrength(value) {
  if (value === "High" || value === "Medium" || value === "Low") return value;
  return "Low";
}

function applyExternalSignalSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.aggregate)) return false;
  if (!snapshot.generatedAt || snapshot.generatedAt === appliedExternalSnapshotId) return false;

  const aggregateMap = new Map();
  snapshot.aggregate.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const key = normalizeSignalKey(entry.title);
    if (!key) return;
    aggregateMap.set(key, entry);
  });

  if (aggregateMap.size === 0) return false;

  let updated = 0;
  categories.forEach((category) => {
    category.films.forEach((film) => {
      const match =
        aggregateMap.get(normalizeSignalKey(film.title)) ||
        aggregateMap.get(normalizeSignalKey(film.studio));

      if (!match) return;

      const combined = clamp(Number(match.combinedScore || 0), 0, 1);
      const letterboxdScore = clamp(Number(match.letterboxdScore || 0), 0, 1);
      const redditScore = clamp(Number(match.redditScore || 0), 0, 1);
      const thegamerScore = clamp(Number(match.thegamerScore || 0), 0, 1);

      film.precursor = clamp(film.precursor + Math.round((combined - 0.35) * 10), 0, 100);
      film.history = clamp(film.history + Math.round((letterboxdScore + thegamerScore - 0.55) * 8), 0, 100);
      film.buzz = clamp(film.buzz + Math.round((redditScore + thegamerScore - 0.5) * 10), 0, 100);

      if (combined >= 0.7 || redditScore >= 0.75) {
        film.strength = "High";
      } else if (combined >= 0.45) {
        film.strength = "Medium";
      } else {
        film.strength = "Low";
      }

      updated += 1;
    });
  });

  if (updated === 0) return false;
  appliedExternalSnapshotId = snapshot.generatedAt;
  return true;
}

async function fetchAndApplyExternalSignals() {
  try {
    const response = await fetch(`${EXTERNAL_SIGNALS_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const snapshot = await response.json();
    const changed = applyExternalSignalSnapshot(snapshot);
    if (!changed) return;
    saveState();
    render();
  } catch {
    // Ignore unavailable local scrape output (e.g. before first poll run).
  }
}

function startExternalSignalPolling() {
  fetchAndApplyExternalSignals();
  setInterval(() => {
    fetchAndApplyExternalSignals();
  }, EXTERNAL_SIGNALS_POLL_MS);
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

function scoreFilm(categoryId, film, normalizedWeights) {
  const linear =
    film.precursor * normalizedWeights.precursor +
    film.history * normalizedWeights.history +
    film.buzz * normalizedWeights.buzz;

  const centered = (linear - 55) / 12;
  const nominationRaw = logistic(centered) * strengthBoost(film.strength);
  const winnerRaw = nominationRaw * (0.6 + film.precursor / 190) * winnerExperienceBoost(categoryId, film.title);

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

function getPrimaryColumnLabel(categoryId) {
  const personCategoryLabels = {
    director: "Director",
    actor: "Actor",
    actress: "Actress",
    "supporting-actor": "Supporting Actor",
    "supporting-actress": "Supporting Actress"
  };
  return personCategoryLabels[categoryId] || "Film";
}

function getDisplayTitle(categoryId, title, studio) {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";

  if (!isPersonCategory) return title;
  return `${title} (${studio})`;
}

function buildProjections(category) {
  const normalized = normalizeWeights();

  const scored = category.films.map((film, index) => {
    const scores = scoreFilm(category.id, film, normalized);
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
        title: getDisplayTitle(category.id, film.title, film.studio),
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
  resultsPrimaryHeader.textContent = getPrimaryColumnLabel(category.id);
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
startExternalSignalPolling();
