import { clamp, rebalanceFieldTotal } from "./forecast-utils.js";

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
  "The Dish",
  "Pixar's Toy Story 5",
  "Supergirl",
  "Mega Minions",
  "Shiver",
  "Young Washington",
  "Moana Live-Action",
  "Cut Off",
  "The Odyssey",
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
  "Judy",
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
    contender("The Odyssey", "Universal", 88, 84, 92, "High"),
    contender("Dune: Part Three", "Warner Bros.", 86, 81, 90, "High"),
    contender("Project Hail Mary", "Amazon MGM", 82, 74, 87, "High"),
    contender("The Social Reckoning", "A24", 80, 76, 83, "High"),
    contender("The Dog Stars", "20th Century Studios", 78, 82, 74, "High"),
    contender("The Bride!", "Warner Bros.", 77, 72, 81, "Medium"),
    contender("Michael", "Lionsgate", 75, 66, 88, "Medium"),
    contender("Sense and Sensibility", "Focus Features", 71, 73, 70, "Medium"),
    contender("Narnia", "Netflix", 68, 64, 79, "Medium"),
    contender("The Dish", "Universal", 69, 70, 72, "Medium")
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
    contender("The Dish", "Universal", 73, 77, 69, "Medium"),
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
    contender("Moana Live-Action", "Disney", 74, 70, 85, "Medium"),
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
    contender("The Dish", "Universal", 74, 72, 67, "Low")
  ],
  cinematography: [
    contender("The Odyssey", "Universal", 89, 88, 79, "High"),
    contender("Dune: Part Three", "Warner Bros.", 87, 86, 77, "High"),
    contender("The Dog Stars", "20th Century Studios", 83, 84, 71, "High"),
    contender("The Bride!", "Warner Bros.", 79, 74, 70, "Medium"),
    contender("Judy", "Warner Bros.", 76, 82, 68, "Medium")
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
    "Mikey Madison": 2,
    "Jessie Buckley": 2
  }
};

const overdueNarrativeBoost = {
  actress: {
    "Amy Adams": 1
  }
};

const STORAGE_KEY = "oscarOddsForecastState.v11";
const API_PROFILE_LIST_URL = "/api/profiles";
const API_FORECAST_BASE_URL = "/api/forecast";
const EXTERNAL_SIGNALS_URL = "data/source-signals.json";
const EXTERNAL_SIGNALS_POLL_MS = 5 * 60 * 1000;
const TREND_HISTORY_LIMIT = 240;
const TREND_WINDOW_OPTIONS = [7, 15, 30];
const NOMINATION_PERCENT_UPLIFT = 1.14;
const WINNER_PERCENT_UPLIFT = 1.2;
const WINNER_TO_NOMINATION_CAP = 0.5;

const state = {
  profileId: "default",
  categoryId: categories[0].id,
  weights: {
    precursor: 58,
    history: 30,
    buzz: 12
  },
  trendWindow: 30
};
let appliedExternalSnapshotId = null;
const trendHistory = {
  version: 1,
  snapshots: [],
  lastSignatureByCategory: {}
};

const categoryTabs = document.querySelector("#categoryTabs");
const categoryTitle = document.querySelector("#categoryTitle");
const candidateCards = document.querySelector("#candidateCards");
const resultsBody = document.querySelector("#resultsBody");
const resultsPrimaryHeader = document.querySelector("#resultsPrimaryHeader");
const explainTitle = document.querySelector("#explainTitle");
const explainMeta = document.querySelector("#explainMeta");
const explainDelta = document.querySelector("#explainDelta");
const explainBreakdown = document.querySelector("#explainBreakdown");
const explainNotes = document.querySelector("#explainNotes");
const trendTitle = document.querySelector("#trendTitle");
const trendMeta = document.querySelector("#trendMeta");
const trendChart = document.querySelector("#trendChart");
const trendSourceMoves = document.querySelector("#trendSourceMoves");
const trendWindowSelect = document.querySelector("#trendWindowSelect");
const appStateNotice = document.querySelector("#appStateNotice");
const resultsPanel = document.querySelector("#resultsPanel");
const movieDetailTitle = document.querySelector("#movieDetailTitle");
const movieDetailDirector = document.querySelector("#movieDetailDirector");
const movieDetailStars = document.querySelector("#movieDetailStars");
const movieDetailGenre = document.querySelector("#movieDetailGenre");
const movieDetailDescription = document.querySelector("#movieDetailDescription");
const movieDetailPoster = document.querySelector("#movieDetailPoster");
const movieDetailPosterLink = document.querySelector("#movieDetailPosterLink");
const exportCsvButton = document.querySelector("#exportCsvButton");
const importCsvButton = document.querySelector("#importCsvButton");
const csvFileInput = document.querySelector("#csvFileInput");
const csvStatus = document.querySelector("#csvStatus");
const profileSelect = document.querySelector("#profileSelect");
const newProfileButton = document.querySelector("#newProfileButton");
let profileOptions = ["default"];
const explainSelectionByCategory = {};
let activePosterRequestId = 0;
let isBootstrapping = true;
let posterFallbackActive = false;

function setAppNotice(message = "", type = "") {
  if (!appStateNotice) return;
  appStateNotice.textContent = message;
  appStateNotice.className = `app-notice${type ? ` ${type}` : ""}`;
}

function setPanelsBusy(isBusy) {
  const busyValue = isBusy ? "true" : "false";
  if (resultsPanel) resultsPanel.setAttribute("aria-busy", busyValue);
  if (candidateCards) candidateCards.setAttribute("aria-busy", busyValue);
}

function normalizeMovieDetailKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

function getTmdbSearchUrl(title) {
  return `https://www.themoviedb.org/search?query=${encodeURIComponent(String(title || "").trim())}`;
}

function buildPosterFallbackDataUrl(title) {
  const safeTitle = String(title || "Selected Movie")
    .slice(0, 60)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f8edd9"/><stop offset="1" stop-color="#eadac2"/></linearGradient></defs><rect width="600" height="900" fill="url(#g)"/><text x="300" y="420" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#1e1a17">Poster Unavailable</text><text x="300" y="470" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#5f554a">${safeTitle}</text><text x="300" y="525" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#5f554a">TMDB Search Link Below</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const movieDetails = {
  "The Odyssey": {
    director: "Christopher Nolan",
    stars: ["Matt Damon", "Charlize Theron", "Tom Holland"],
    genre: "Epic, Action, Historical Drama",
    description: "A large-scale adaptation of Homer's Odyssey following a long, dangerous return home after war."
  },
  "Dune: Part Three": {
    director: "Denis Villeneuve",
    stars: ["Timothee Chalamet", "Zendaya", "Florence Pugh"],
    genre: "Sci-Fi, Epic, Drama",
    description: "The next chapter of the Dune saga, escalating political power struggles and interstellar conflict."
  },
  "Project Hail Mary": {
    director: "Phil Lord & Christopher Miller",
    stars: ["Ryan Gosling", "Sandra Huller"],
    genre: "Sci-Fi, Adventure, Drama",
    description: "A lone astronaut wakes in deep space and must solve an extinction-level crisis for Earth."
  },
  "The Social Reckoning": {
    director: "Trey Edward Shults",
    stars: ["Mikey Madison", "Jeremy Strong"],
    genre: "Drama, Thriller",
    description: "A prestige drama about public accountability, image, and power in a high-stakes social collapse."
  },
  "The Dog Stars": {
    director: "Ridley Scott",
    stars: ["Jacob Elordi", "Margaret Qualley"],
    genre: "Post-Apocalyptic, Drama",
    description: "A pilot and his companion navigate a devastated world while searching for hope and connection."
  },
  "The Bride!": {
    director: "Maggie Gyllenhaal",
    stars: ["Jessie Buckley", "Christian Bale"],
    genre: "Gothic, Romance, Horror-Drama",
    description: "A stylized reimagining of Frankenstein's Bride that blends classic horror iconography with romance."
  },
  Michael: {
    director: "Antoine Fuqua",
    stars: ["Jaafar Jackson", "Colman Domingo", "Nia Long"],
    genre: "Biographical Drama",
    description: "A biopic charting Michael Jackson's life, career rise, and lasting global pop-cultural influence."
  },
  "Sense and Sensibility": {
    director: "Georgia Oakley",
    stars: ["Daisy Edgar-Jones", "Paul Mescal"],
    genre: "Period Drama, Romance",
    description: "A new adaptation of Austen's novel centered on class, love, and family pressure in Regency England."
  },
  Narnia: {
    director: "Greta Gerwig",
    stars: ["Ensemble Cast"],
    genre: "Fantasy, Adventure",
    description: "A new screen take on C.S. Lewis world-building with large-scale fantasy production design."
  },
  "The Dish": {
    director: "Steven Spielberg",
    stars: ["Emily Blunt", "Colin Firth"],
    genre: "Historical Drama",
    description: "A prestige period drama from Spielberg expected to focus on media, politics, and institutional power."
  },
  Judy: {
    director: "Alejandro G. Inarritu",
    stars: ["Tom Cruise", "Sandra Huller", "John Goodman"],
    genre: "Drama",
    description: "A character-driven drama built around a demanding central performance and major supporting turns."
  },
  "Wuthering Heights": {
    director: "Emerald Fennell",
    stars: ["Jacob Elordi", "Margot Robbie"],
    genre: "Period Drama, Romance",
    description: "A modernized gothic adaptation of the classic novel focused on obsession, class, and revenge."
  },
  "The Drama": {
    director: "Kristoffer Borgli",
    stars: ["Zendaya", "Robert Pattinson"],
    genre: "Romantic Drama",
    description: "A relationship-centered prestige drama that blends sharp humor and emotional instability."
  },
  "The Odyssey": {
    director: "Christopher Nolan",
    stars: ["Matt Damon", "Charlize Theron", "Tom Holland"],
    genre: "Epic, Action, Historical Drama",
    description: "A large-scale adaptation of Homer's Odyssey following a long, dangerous return home after war."
  }
};

const movieDetailsIndex = new Map(
  Object.entries(movieDetails).map(([title, details]) => [normalizeMovieDetailKey(title), { title, ...details }])
);

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
  const recentPenaltyLevel = Number(recentWinnerPenalty[categoryId]?.[contenderName] || 0);
  const hasOverdueNarrative = Boolean(overdueNarrativeBoost[categoryId]?.[contenderName]);

  let boost = 1;
  if (wins === 0) {
    boost += 0.06;
  } else {
    boost -= 0.08 + Math.min(wins, 3) * 0.03;
  }

  if (recentPenaltyLevel > 0) boost -= 0.12 * recentPenaltyLevel;
  if (hasOverdueNarrative) boost += 0.08;
  return clamp(boost, 0.55, 1.15);
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
    setAppNotice("Syncing external source updates...", "loading");
    const response = await fetch(`${EXTERNAL_SIGNALS_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      setAppNotice("External source snapshot unavailable. Showing latest saved forecast.", "error");
      return;
    }
    const snapshot = await response.json();
    const changed = applyExternalSignalSnapshot(snapshot);
    if (!changed) {
      setAppNotice("");
      return;
    }
    saveState();
    render();
    setAppNotice(`Applied source refresh from ${new Date(snapshot.generatedAt || Date.now()).toLocaleString()}.`);
  } catch {
    setAppNotice("Could not load external source snapshot. Showing latest saved forecast.", "error");
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
  const precursorContribution = film.precursor * normalizedWeights.precursor;
  const historyContribution = film.history * normalizedWeights.history;
  const buzzContribution = film.buzz * normalizedWeights.buzz;
  const linear = precursorContribution + historyContribution + buzzContribution;

  const centered = (linear - 55) / 12;
  const strengthMultiplier = strengthBoost(film.strength);
  const winnerHistoryMultiplier = winnerExperienceBoost(categoryId, film.title);
  const nominationRaw = logistic(centered) * strengthMultiplier;
  const winnerRaw = nominationRaw * (0.6 + film.precursor / 190) * winnerHistoryMultiplier;

  return {
    nominationRaw,
    winnerRaw,
    precursorContribution,
    historyContribution,
    buzzContribution,
    strengthMultiplier,
    winnerHistoryMultiplier
  };
}

function renderTabs() {
  categoryTabs.innerHTML = "";

  const select = document.createElement("select");
  select.className = "category-select";
  select.setAttribute("aria-label", "Oscar category");

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    option.selected = category.id === state.categoryId;
    select.appendChild(option);
  });

  select.addEventListener("change", (event) => {
    state.categoryId = event.target.value;
    saveState();
    render();
  });

  categoryTabs.appendChild(select);
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

function getSelectedFilmTitle(categoryId, entry) {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";
  return isPersonCategory ? entry.rawStudio : entry.rawTitle;
}

function trendKeyForEntry(categoryId, entry) {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";
  const base = isPersonCategory ? `${entry.rawTitle}::${entry.rawStudio}` : entry.rawTitle;
  return `${categoryId}::${normalizeSignalKey(base)}`;
}

function buildCategoryTrendSignature(category, displayProjections) {
  const rows = displayProjections.map((entry) => {
    return `${trendKeyForEntry(category.id, entry)}:${entry.nomination.toFixed(2)}:${entry.winner.toFixed(2)}`;
  });
  return `${category.id}|${appliedExternalSnapshotId || "manual"}|${rows.join("|")}`;
}

function captureTrendSnapshot(category, projections) {
  const displayProjections = projections.slice(0, getDisplayLimit(category));
  if (displayProjections.length === 0) return false;

  const signature = buildCategoryTrendSignature(category, displayProjections);
  if (trendHistory.lastSignatureByCategory[category.id] === signature) return false;
  trendHistory.lastSignatureByCategory[category.id] = signature;

  trendHistory.snapshots.push({
    categoryId: category.id,
    capturedAt: new Date().toISOString(),
    sourceSnapshotId: appliedExternalSnapshotId || null,
    entries: displayProjections.map((entry) => ({
      key: trendKeyForEntry(category.id, entry),
      title: entry.title,
      nomination: Number(entry.nomination.toFixed(2)),
      winner: Number(entry.winner.toFixed(2))
    }))
  });

  if (trendHistory.snapshots.length > TREND_HISTORY_LIMIT) {
    trendHistory.snapshots.splice(0, trendHistory.snapshots.length - TREND_HISTORY_LIMIT);
  }
  return true;
}

function pointsForEntryTrend(category, entry) {
  const key = trendKeyForEntry(category.id, entry);
  const pointLimit = TREND_WINDOW_OPTIONS.includes(Number(state.trendWindow)) ? Number(state.trendWindow) : 30;
  return trendHistory.snapshots
    .filter((snapshot) => snapshot.categoryId === category.id)
    .map((snapshot) => {
      const contender = (snapshot.entries || []).find((item) => item.key === key);
      if (!contender) return null;
      return {
        capturedAt: snapshot.capturedAt,
        sourceSnapshotId: snapshot.sourceSnapshotId || "",
        nomination: Number(contender.nomination || 0),
        winner: Number(contender.winner || 0)
      };
    })
    .filter(Boolean)
    .slice(-pointLimit);
}

function formatTrendStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function buildPolylinePath(points, metric, width, height, minY, maxY) {
  if (!points.length) return "";
  const range = Math.max(maxY - minY, 1);
  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point[metric] - minY) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderTrendChart(points) {
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
    .filter(Boolean);

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

function renderSourceMovement(points) {
  if (!trendSourceMoves) return;
  trendSourceMoves.innerHTML = "";

  const sourcePointIndexes = points
    .map((point, index) => {
      if (!point.sourceSnapshotId) return null;
      const previous = points[index - 1];
      if (previous?.sourceSnapshotId === point.sourceSnapshotId) return null;
      return index;
    })
    .filter((value) => Number.isInteger(value));

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

function renderTrendAnalytics(category, entry) {
  if (!entry) {
    trendTitle.textContent = "Trend Analytics";
    trendMeta.textContent = "Select a contender to view movement over time.";
    renderTrendChart([]);
    renderSourceMovement([]);
    return;
  }

  const points = pointsForEntryTrend(category, entry);
  trendTitle.textContent = `Trend Analytics: ${entry.title}`;
  if (points.length < 2) {
    trendMeta.textContent = "Need at least two snapshots to show movement.";
  } else {
    const first = points[0];
    const last = points[points.length - 1];
    const nomDelta = last.nomination - first.nomination;
    const winDelta = last.winner - first.winner;
    trendMeta.textContent = `Last ${points.length} updates: Nomination ${nomDelta >= 0 ? "+" : ""}${nomDelta.toFixed(
      1
    )}pp, Winner ${winDelta >= 0 ? "+" : ""}${winDelta.toFixed(1)}pp.`;
  }

  renderTrendChart(points);
  renderSourceMovement(points);
}

function setPosterState(posterUrl, movieUrl) {
  const src = posterUrl || buildPosterFallbackDataUrl(movieDetailTitle.textContent || "Selected Movie");
  const href = movieUrl || getTmdbSearchUrl(movieDetailTitle.textContent || "");
  posterFallbackActive = !posterUrl;
  movieDetailPoster.src = src;
  movieDetailPoster.classList.remove("hidden");
  movieDetailPosterLink.href = href;
  movieDetailPosterLink.classList.remove("hidden");
}

async function loadPosterForTitle(title) {
  const requestId = ++activePosterRequestId;
  setPosterState(buildPosterFallbackDataUrl(title), getTmdbSearchUrl(title));
  if (!title) return;

  try {
    const response = await fetch(`/api/tmdb-poster?title=${encodeURIComponent(title)}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (requestId !== activePosterRequestId) return;
    const posterUrl = payload?.result?.posterUrl || "";
    const movieUrl = payload?.result?.movieUrl || "";
    if (posterUrl || movieUrl) setPosterState(posterUrl, movieUrl);
  } catch {
    // Keep fallback poster/link if API is unavailable.
  }
}

movieDetailPoster?.addEventListener("error", () => {
  if (posterFallbackActive) return;
  posterFallbackActive = true;
  movieDetailPoster.src = buildPosterFallbackDataUrl(movieDetailTitle.textContent || "Selected Movie");
  movieDetailPosterLink.href = getTmdbSearchUrl(movieDetailTitle.textContent || "");
});

function renderMovieDetails(category, entry) {
  if (!entry) {
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

function buildProjections(category) {
  const normalized = normalizeWeights();

  const scored = category.films.map((film, index) => {
    const scores = scoreFilm(category.id, film, normalized);
    return { ...film, ...scores, index };
  });

  const nominationTotal = scored.reduce((sum, item) => sum + item.nominationRaw, 0) || 1;
  const winnerTotal = scored.reduce((sum, item) => sum + item.winnerRaw, 0) || 1;
  const nomineeScale = category.nominees / Math.max(1, scored.length);

  const projections = scored
    .map((film) => {
      const nomination = clamp((film.nominationRaw / nominationTotal) * 100 * nomineeScale * NOMINATION_PERCENT_UPLIFT, 0.6, 99);
      const winner = clamp(
        (((film.winnerRaw / winnerTotal) * 100 + nomination * category.winnerBase) /
          (1 + category.winnerBase)) *
          WINNER_PERCENT_UPLIFT,
        0.4,
        92
      );

      return {
        index: film.index,
        categoryId: category.id,
        rawTitle: film.title,
        rawStudio: film.studio,
        title: getDisplayTitle(category.id, film.title, film.studio),
        nomination,
        winner,
        precursorContribution: film.precursorContribution,
        historyContribution: film.historyContribution,
        buzzContribution: film.buzzContribution,
        strengthMultiplier: film.strengthMultiplier,
        winnerHistoryMultiplier: film.winnerHistoryMultiplier
      };
    })
    .sort((a, b) => b.winner - a.winner);

  const displayLimit = getDisplayLimit(category);
  const topContenders = projections.slice(0, displayLimit);

  rebalanceFieldTotal(topContenders, "nomination", {
    minTotal: 90,
    maxTotal: 95,
    targetTotal: 93,
    minValue: 0.6,
    maxValue: 50
  });

  rebalanceFieldTotal(topContenders, "winner", {
    minTotal: 30,
    maxTotal: 45,
    targetTotal: 38,
    minValue: 0.4,
    maxValue: 24
  });

  topContenders.forEach((entry) => {
    entry.winner = Math.min(entry.winner, entry.nomination * WINNER_TO_NOMINATION_CAP);
  });

  return [...topContenders, ...projections.slice(displayLimit)];
}

function renderCandidates(category, projections) {
  categoryTitle.textContent = category.name;
  candidateCards.innerHTML = "";

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

function renderResults(category, projections) {
  resultsPrimaryHeader.textContent = getPrimaryColumnLabel(category.id);
  resultsBody.innerHTML = "";
  const displayProjections = projections.slice(0, getDisplayLimit(category));
  if (displayProjections.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="results-empty" colspan="3">No projected contenders for this category.</td>`;
    resultsBody.appendChild(row);
    renderExplanation(category, null, []);
    renderMovieDetails(category, null);
    renderTrendAnalytics(category, null);
    return;
  }

  const selectedIndex = explainSelectionByCategory[category.id] ?? 0;
  const boundedIndex = clamp(selectedIndex, 0, Math.max(0, displayProjections.length - 1));
  explainSelectionByCategory[category.id] = boundedIndex;

  displayProjections.forEach((entry, index) => {
    const row = document.createElement("tr");
    row.className = `results-row${index === boundedIndex ? " active" : ""}`;
    row.setAttribute("tabindex", "0");
    row.setAttribute("role", "button");
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
    row.innerHTML = `<td data-label="${getPrimaryColumnLabel(category.id)}"><strong>${entry.title}</strong></td><td data-label="Nomination %">${entry.nomination.toFixed(
      1
    )}%</td><td data-label="Winner %">${entry.winner.toFixed(1)}%</td>`;
    resultsBody.appendChild(row);
  });

  renderExplanation(category, displayProjections[boundedIndex], displayProjections);
  renderMovieDetails(category, displayProjections[boundedIndex]);
  renderTrendAnalytics(category, displayProjections[boundedIndex]);
}

function renderExplanation(category, entry, fieldEntries) {
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

  const contributionTotal =
    entry.precursorContribution + entry.historyContribution + entry.buzzContribution || 1;
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

function serializeStatePayload() {
  return {
    categoryId: state.categoryId,
    weights: state.weights,
    trendWindow: state.trendWindow,
    trendHistory: {
      version: trendHistory.version,
      snapshots: trendHistory.snapshots,
      lastSignatureByCategory: trendHistory.lastSignatureByCategory
    },
    categories: categories.map((category) => ({
      id: category.id,
      films: category.films
    }))
  };
}

function applyStatePayload(parsed) {
  if (!parsed || typeof parsed !== "object") return;

  if (parsed.weights && typeof parsed.weights === "object") {
    state.weights.precursor = clamp(Number(parsed.weights.precursor || state.weights.precursor), 1, 95);
    state.weights.history = clamp(Number(parsed.weights.history || state.weights.history), 1, 95);
    state.weights.buzz = clamp(Number(parsed.weights.buzz || state.weights.buzz), 1, 95);
  }

  if (TREND_WINDOW_OPTIONS.includes(Number(parsed.trendWindow))) {
    state.trendWindow = Number(parsed.trendWindow);
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

  if (parsed.trendHistory && typeof parsed.trendHistory === "object") {
    const snapshots = Array.isArray(parsed.trendHistory.snapshots) ? parsed.trendHistory.snapshots : [];
    trendHistory.snapshots = snapshots
      .map((snapshot) => {
        if (!snapshot || typeof snapshot !== "object") return null;
        if (typeof snapshot.categoryId !== "string") return null;
        const capturedAt = String(snapshot.capturedAt || "");
        const entries = Array.isArray(snapshot.entries)
          ? snapshot.entries
              .map((entry) => {
                if (!entry || typeof entry !== "object") return null;
                if (typeof entry.key !== "string") return null;
                return {
                  key: entry.key,
                  title: String(entry.title || ""),
                  nomination: clamp(Number(entry.nomination || 0), 0, 100),
                  winner: clamp(Number(entry.winner || 0), 0, 100)
                };
              })
              .filter(Boolean)
          : [];
        if (!entries.length) return null;
        return {
          categoryId: snapshot.categoryId,
          capturedAt: capturedAt || new Date().toISOString(),
          sourceSnapshotId: snapshot.sourceSnapshotId ? String(snapshot.sourceSnapshotId) : null,
          entries
        };
      })
      .filter(Boolean)
      .slice(-TREND_HISTORY_LIMIT);
    trendHistory.lastSignatureByCategory =
      parsed.trendHistory.lastSignatureByCategory && typeof parsed.trendHistory.lastSignatureByCategory === "object"
        ? { ...parsed.trendHistory.lastSignatureByCategory }
        : {};
  }
}

function getLocalStorageKeyForProfile(profileId = state.profileId) {
  return `${STORAGE_KEY}.${profileId}`;
}

function getForecastApiUrl(profileId = state.profileId) {
  return `${API_FORECAST_BASE_URL}/${encodeURIComponent(profileId)}`;
}

function renderProfileOptions() {
  profileSelect.innerHTML = "";
  profileOptions.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    option.selected = id === state.profileId;
    profileSelect.appendChild(option);
  });
}

async function loadProfiles() {
  try {
    const response = await fetch(API_PROFILE_LIST_URL, { cache: "no-store" });
    if (!response.ok) {
      renderProfileOptions();
      return;
    }
    const doc = await response.json();
    const ids = Array.isArray(doc.profiles) ? doc.profiles.map((entry) => entry.id).filter(Boolean) : [];
    if (!ids.length) ids.push("default");
    profileOptions = [...new Set(ids)];
    if (typeof doc.activeProfileId === "string" && profileOptions.includes(doc.activeProfileId)) {
      state.profileId = doc.activeProfileId;
    } else if (!profileOptions.includes(state.profileId)) {
      state.profileId = profileOptions[0];
    }
    renderProfileOptions();
  } catch {
    renderProfileOptions();
  }
}

async function saveStateToApi() {
  try {
    await fetch(getForecastApiUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(serializeStatePayload())
    });
  } catch {
    setAppNotice("Autosave API unavailable. Working in local save mode.", "error");
  }
}

async function loadStateFromApi() {
  try {
    const response = await fetch(getForecastApiUrl(), { cache: "no-store" });
    if (!response.ok) return;
    const doc = await response.json();
    if (!doc || typeof doc !== "object" || !doc.payload) return;
    applyStatePayload(doc.payload);
  } catch {
    setAppNotice("Could not load profile from API. Using locally saved state.", "error");
  }
}

function saveState() {
  try {
    localStorage.setItem(getLocalStorageKeyForProfile(), JSON.stringify(serializeStatePayload()));
  } catch {
    // Ignore storage failures (private mode or blocked storage).
  }

  void saveStateToApi();
}

function loadState() {
  try {
    const raw = localStorage.getItem(getLocalStorageKeyForProfile());
    if (!raw) return;

    const parsed = JSON.parse(raw);
    applyStatePayload(parsed);
  } catch {
    // Ignore malformed state.
  }
}

function bindProfileControls() {
  profileSelect.addEventListener("change", async (event) => {
    state.profileId = event.target.value;
    loadState();
    await loadStateFromApi();
    render();
  });

  newProfileButton.addEventListener("click", async () => {
    const name = window.prompt("New profile name:");
    if (!name) return;
    const profileId = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    if (!profileId) return;
    if (!profileOptions.includes(profileId)) profileOptions.push(profileId);
    state.profileId = profileId;
    renderProfileOptions();
    saveState();
    await loadProfiles();
  });
}

function bindTrendControls() {
  if (!trendWindowSelect) return;
  trendWindowSelect.value = String(state.trendWindow);
  trendWindowSelect.addEventListener("change", (event) => {
    const value = Number(event.target.value || 30);
    state.trendWindow = TREND_WINDOW_OPTIONS.includes(value) ? value : 30;
    saveState();
    render();
  });
}

function render() {
  setPanelsBusy(isBootstrapping);
  const activeCategory = getActiveCategory();
  const projections = buildProjections(activeCategory);
  const capturedTrend = captureTrendSnapshot(activeCategory, projections);
  if (trendWindowSelect) trendWindowSelect.value = String(state.trendWindow);
  renderTabs();
  renderCandidates(activeCategory, projections);
  renderResults(activeCategory, projections);
  if (capturedTrend) saveState();
}

async function bootstrap() {
  setPanelsBusy(true);
  setAppNotice("Loading forecast workspace...", "loading");
  await loadProfiles();
  loadState();
  await loadStateFromApi();
  bindProfileControls();
  bindTrendControls();
  bindCsvControls();
  isBootstrapping = false;
  setPanelsBusy(false);
  setAppNotice("");
  render();
  startExternalSignalPolling();
}

bootstrap();
