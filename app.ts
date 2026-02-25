import LZString from "lz-string";
import { clamp } from "./forecast-utils.js";
import {
  applySourceSignals,
  calculateNominationOdds,
  calculateWinnerOdds,
  normalizeSignalKey as normalizeSignalKeyCore,
  rebalanceCategory
} from "./app-logic.js";
import type { Category, Film, NormalizedWeights, Projection, ScoreResult, Strength } from "./types.js";

interface TrendEntry {
  key: string;
  title: string;
  nomination: number;
  winner: number;
}

interface TrendSnapshot {
  categoryId: string;
  capturedAt: string;
  sourceSnapshotId: string | null;
  entries: TrendEntry[];
}

interface TrendHistory {
  version: number;
  snapshots: TrendSnapshot[];
  lastSignatureByCategory: Record<string, string>;
}

interface TrendPoint {
  capturedAt: string;
  sourceSnapshotId: string;
  nomination: number;
  winner: number;
}

interface AppState {
  profileId: string;
  categoryId: string;
  weights: NormalizedWeights;
  trendWindow: number;
}

interface StatePayload {
  categoryId?: string;
  weights?: Partial<NormalizedWeights>;
  trendWindow?: number;
  trendHistory?: {
    version?: number;
    snapshots?: unknown[];
    lastSignatureByCategory?: Record<string, string>;
  };
  categories?: Array<{ id: string; films: unknown[] }>;
}

interface CompactShare {
  v: 1;
  c: string;                                                           // categoryId
  w: [number, number, number];                                         // [precursor, history, buzz] weights
  t: number;                                                           // trendWindow
  s: Record<string, Record<string, [number, number, number]>>;        // catId → title → [p,h,b]
}

interface SearchProjection extends Projection {
  categoryName: string;
}

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

function contender(title: string, studio: string, precursor: number, history: number, buzz: number, strength: Strength): Film {
  return { title, studio, precursor, history, buzz, strength };
}

const categorySeeds: Record<string, Film[]> = {
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

function createSeedFilms(): Film[] {
  return schedule2026Films.map((title) => contender(title, "TBD", 55, 50, 52, "Medium"));
}

const categories: Category[] = categoryDefinitions.map((category) => ({
  ...category,
  films: categorySeeds[category.id] ? [...categorySeeds[category.id]] : createSeedFilms()
}));

const priorCategoryWins: Record<string, Record<string, number>> = {
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

const recentWinnerPenalty: Record<string, Record<string, number>> = {
  actress: {
    "Mikey Madison": 2,
    "Jessie Buckley": 2
  }
};

const overdueNarrativeBoost: Record<string, Record<string, number>> = {
  actress: {
    "Amy Adams": 1
  }
};

const CATEGORY_SHORT_NAMES: Record<string, string> = {
  "picture": "Picture",
  "director": "Director",
  "actor": "Actor",
  "actress": "Actress",
  "supporting-actor": "Supp. Actor",
  "supporting-actress": "Supp. Actress",
  "original-screenplay": "Orig. Screenplay",
  "adapted-screenplay": "Adpt. Screenplay",
  "animated-feature": "Animated",
  "international-feature": "Intl. Feature",
  "documentary-feature": "Doc. Feature",
  "documentary-short": "Doc. Short",
  "live-action-short": "Live Action Short",
  "animated-short": "Animated Short",
  "original-score": "Score",
  "original-song": "Song",
  "sound": "Sound",
  "production-design": "Prod. Design",
  "cinematography": "Cinematography",
  "makeup-hairstyling": "Makeup",
  "costume-design": "Costume",
  "film-editing": "Film Editing",
  "visual-effects": "VFX",
  "casting": "Casting"
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

const state: AppState = {
  profileId: "default",
  categoryId: categories[0].id,
  weights: {
    precursor: 58,
    history: 30,
    buzz: 12
  },
  trendWindow: 30
};
let appliedExternalSnapshotId: string | null = null;
const trendHistory: TrendHistory = {
  version: 1,
  snapshots: [],
  lastSignatureByCategory: {}
};

const categoryTabs = document.querySelector<HTMLElement>("#categoryTabs")!;
const categorySummaryBar = document.querySelector<HTMLElement>("#categorySummaryBar");
const leaderboardBody = document.querySelector<HTMLTableSectionElement>("#leaderboardBody");
const categoryTitle = document.querySelector<HTMLElement>("#categoryTitle")!;
const candidateCards = document.querySelector<HTMLElement>("#candidateCards")!;
const resultsBody = document.querySelector<HTMLTableSectionElement>("#resultsBody")!;
const resultsPrimaryHeader = document.querySelector<HTMLElement>("#resultsPrimaryHeader");
const oddsLastUpdated = document.querySelector<HTMLElement>("#oddsLastUpdated");
const explainTitle = document.querySelector<HTMLElement>("#explainTitle")!;
const explainMeta = document.querySelector<HTMLElement>("#explainMeta")!;
const explainDelta = document.querySelector<HTMLElement>("#explainDelta")!;
const explainBreakdown = document.querySelector<HTMLElement>("#explainBreakdown")!;
const explainNotes = document.querySelector<HTMLElement>("#explainNotes")!;
const trendTitle = document.querySelector<HTMLElement>("#trendTitle")!;
const trendMeta = document.querySelector<HTMLElement>("#trendMeta")!;
const trendChart = document.querySelector<SVGElement>("#trendChart");
const trendSourceMoves = document.querySelector<HTMLElement>("#trendSourceMoves");
const trendWindowSelect = document.querySelector<HTMLSelectElement>("#trendWindowSelect");
const appStateNotice = document.querySelector<HTMLElement>("#appStateNotice");
const scraperHealthBadge = document.querySelector<HTMLElement>("#scraperHealthBadge");
const contenderSearch = document.querySelector<HTMLInputElement>("#contenderSearch");
const contenderSearchClear = document.querySelector<HTMLElement>("#contenderSearchClear");
const compareToggleButton = document.querySelector<HTMLButtonElement>("#compareToggleButton");
const compareControls = document.querySelector<HTMLElement>("#compareControls");
const compareProfileSelect = document.querySelector<HTMLSelectElement>("#compareProfileSelect");
const thNomination = document.querySelector<HTMLElement>("#thNomination");
const thWinner = document.querySelector<HTMLElement>("#thWinner");
const thCompareB = document.querySelector<HTMLElement>("#thCompareB");
const thDelta = document.querySelector<HTMLElement>("#thDelta");
let searchQuery = "";
let compareMode = false;
let compareProfileId: string | null = null;
const comparePayloadCache = new Map<string, StatePayload>();
const resultsPanel = document.querySelector<HTMLElement>("#resultsPanel");
const movieDetailTitle = document.querySelector<HTMLElement>("#movieDetailTitle")!;
const movieDetailDirector = document.querySelector<HTMLElement>("#movieDetailDirector")!;
const movieDetailStars = document.querySelector<HTMLElement>("#movieDetailStars")!;
const movieDetailGenre = document.querySelector<HTMLElement>("#movieDetailGenre")!;
const movieDetailDescription = document.querySelector<HTMLElement>("#movieDetailDescription")!;
const posterSkeleton = document.querySelector<HTMLElement>("#posterSkeleton");
const movieDetailPoster = document.querySelector<HTMLImageElement>("#movieDetailPoster")!;
const movieDetailPosterLink = document.querySelector<HTMLAnchorElement>("#movieDetailPosterLink")!;
const exportCsvButton = document.querySelector<HTMLButtonElement>("#exportCsvButton")!;
const importCsvButton = document.querySelector<HTMLButtonElement>("#importCsvButton")!;
const csvFileInput = document.querySelector<HTMLInputElement>("#csvFileInput")!;
const csvStatus = document.querySelector<HTMLElement>("#csvStatus")!;
const profileSelect = document.querySelector<HTMLSelectElement>("#profileSelect")!;
const newProfileButton = document.querySelector<HTMLButtonElement>("#newProfileButton")!;
const renameProfileButton = document.querySelector<HTMLButtonElement>("#renameProfileButton");
const deleteProfileButton = document.querySelector<HTMLButtonElement>("#deleteProfileButton");
const profileLockButton       = document.querySelector<HTMLButtonElement>("#profileLockButton");
const authDialog              = document.querySelector<HTMLDialogElement>("#authDialog");
const authDialogTitle         = document.querySelector<HTMLElement>("#authDialogTitle");
const authDialogDesc          = document.querySelector<HTMLElement>("#authDialogDesc");
const authDialogForm          = document.querySelector<HTMLElement>("#authDialogForm");
const authPassphraseInput     = document.querySelector<HTMLInputElement>("#authPassphraseInput");
const authPassphraseConfirm   = document.querySelector<HTMLInputElement>("#authPassphraseConfirm");
const authConfirmLabel        = document.querySelector<HTMLElement>("#authConfirmLabel");
const authDialogError         = document.querySelector<HTMLElement>("#authDialogError");
const authDialogSubmit        = document.querySelector<HTMLButtonElement>("#authDialogSubmit");
const authDialogCancel        = document.querySelector<HTMLButtonElement>("#authDialogCancel");
const authSecurityOptions     = document.querySelector<HTMLElement>("#authSecurityOptions");
const authChangePassphraseBtn = document.querySelector<HTMLButtonElement>("#authChangePassphraseBtn");
const authRemovePassphraseBtn = document.querySelector<HTMLButtonElement>("#authRemovePassphraseBtn");
const authLogoutBtn           = document.querySelector<HTMLButtonElement>("#authLogoutBtn");
const authSecurityClose       = document.querySelector<HTMLButtonElement>("#authSecurityClose");
const printPdfButton = document.querySelector<HTMLButtonElement>("#printPdfButton");
const printMeta = document.querySelector<HTMLElement>("#printMeta");
const backtestStatus         = document.querySelector<HTMLElement>("#backtestStatus");
const backtestOverview       = document.querySelector<HTMLElement>("#backtestOverview");
const backtestStatGrid       = document.querySelector<HTMLElement>("#backtestStatGrid");
const backtestCategoryBody   = document.querySelector<HTMLTableSectionElement>("#backtestCategoryBody");
const backtestYearBody       = document.querySelector<HTMLTableSectionElement>("#backtestYearBody");
const backtestCategoryFilter = document.querySelector<HTMLSelectElement>("#backtestCategoryFilter");
let profileOptions: string[] = ["default"];
// Auth state keyed by profileId; populated by loadProfiles() + refreshAuthStatus()
const profileAuthMap = new Map<string, { hasPassphrase: boolean; authenticated: boolean }>();
// Resolve callback and target profileId for the promptUnlock() promise
let resolveUnlock: ((ok: boolean) => void) | null = null;
let unlockProfileId: string = "";
const explainSelectionByCategory: Record<string, number> = {};
let activePosterRequestId = 0;
let isBootstrapping = true;
let posterFallbackActive = false;
let backendOfflineMode = false;
let lastOddsRecalculatedAt: string | null = null;
let lastSourceSyncAt: string | null = null;

function setBackendOfflineMode(isOffline: boolean): void {
  backendOfflineMode = Boolean(isOffline);
  if (backendOfflineMode) {
    setAppNotice("Offline mode — data loaded from local storage.", "error");
    return;
  }
  if (appStateNotice?.textContent === "Offline mode — data loaded from local storage.") {
    setAppNotice("");
  }
}

function setAppNotice(message = "", type = ""): void {
  if (!appStateNotice) return;
  if (!message && backendOfflineMode) {
    appStateNotice.textContent = "Offline mode — data loaded from local storage.";
    appStateNotice.className = "app-notice error";
    return;
  }
  appStateNotice.textContent = message;
  appStateNotice.className = `app-notice${type ? ` ${type}` : ""}`;
}

function setPanelsBusy(isBusy: boolean): void {
  const busyValue = isBusy ? "true" : "false";
  if (resultsPanel) resultsPanel.setAttribute("aria-busy", busyValue);
  if (candidateCards) candidateCards.setAttribute("aria-busy", busyValue);
}

function formatTimestamp(value: string | number | null): string {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function updateOddsFreshnessLabel() {
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

function normalizeMovieDetailKey(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

function getTmdbSearchUrl(title: string): string {
  return `https://www.themoviedb.org/search?query=${encodeURIComponent(String(title || "").trim())}`;
}

function normalizePosterRenderUrl(url: string): string {
  const value = String(url || "").trim();
  if (!value) return "";
  if (value.startsWith("/t/p/")) return `https://image.tmdb.org${value}`;
  if (value.startsWith("http://www.themoviedb.org/t/p/")) return value.replace("http://www.themoviedb.org/t/p/", "https://image.tmdb.org/t/p/");
  if (value.startsWith("https://www.themoviedb.org/t/p/")) return value.replace("https://www.themoviedb.org/t/p/", "https://image.tmdb.org/t/p/");
  return value;
}

function buildPosterFallbackDataUrl(title: string): string {
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
  }
};

interface MovieDetailEntry {
  title: string;
  director: string;
  stars: string[];
  genre: string;
  description: string;
}
const movieDetailsIndex = new Map<string, MovieDetailEntry>(
  Object.entries(movieDetails).map(([title, details]) => [normalizeMovieDetailKey(title), { title, ...details }])
);

function normalizeSignalKey(value: unknown): string {
  return normalizeSignalKeyCore(value);
}

function normalizeWeights(): NormalizedWeights {
  const total = state.weights.precursor + state.weights.history + state.weights.buzz;
  return {
    precursor: state.weights.precursor / total,
    history: state.weights.history / total,
    buzz: state.weights.buzz / total
  };
}

function logistic(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function strengthBoost(strength: Strength): number {
  if (strength === "High") return 1.06;
  if (strength === "Medium") return 1.0;
  return 0.94;
}

function winnerExperienceBoost(categoryId: string, contenderName: string): number {
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

function sanitizeStrength(value: unknown): Strength {
  if (value === "High" || value === "Medium" || value === "Low") return value;
  return "Low";
}

function applyExternalSignalSnapshot(snapshot: unknown): boolean {
  const result = applySourceSignals({
    categories,
    snapshot,
    lastAppliedSnapshotId: appliedExternalSnapshotId
  });
  if (!result.changed) return false;
  appliedExternalSnapshotId = result.appliedSnapshotId;
  lastSourceSyncAt = (snapshot as { generatedAt?: string })?.generatedAt || new Date().toISOString();
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

const SCRAPE_OBSERVABILITY_URL = "/api/scrape-observability";
const SCRAPE_STALE_THRESHOLD_MINUTES = 120;

async function checkScraperHealth() {
  if (!scraperHealthBadge) return;
  try {
    const res = await fetch(SCRAPE_OBSERVABILITY_URL, { cache: "no-store" });
    if (!res.ok) return;
    const obs = await res.json();
    const sources = obs?.sources || {};
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

function startScraperEventStream() {
  checkScraperHealth(); // initial badge state on load

  const evtSource = new EventSource("/api/scraper-events");

  evtSource.onmessage = () => {
    checkScraperHealth();
  };

  // EventSource reconnects automatically on error; no explicit handling needed
}

function parseFilmRecord(record: unknown): Film | null {
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;

  const title = String(r.title || "").trim();
  const studio = String(r.studio || "").trim();
  if (!title || !studio) return null;

  return {
    title,
    studio,
    precursor: clamp(Number(r.precursor || 0), 0, 100),
    history: clamp(Number(r.history || 0), 0, 100),
    buzz: clamp(Number(r.buzz || 0), 0, 100),
    strength: sanitizeStrength(String(r.strength || "").trim())
  };
}

function getActiveCategory(): Category {
  return categories.find((category) => category.id === state.categoryId) ?? categories[0];
}

function scoreFilm(categoryId: string, film: Film, normalizedWeights: NormalizedWeights): ScoreResult {
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

function renderTabs(): void {
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
    state.categoryId = (event.target as HTMLSelectElement).value;
    if (searchQuery) {
      searchQuery = "";
      if (contenderSearch) contenderSearch.value = "";
      if (contenderSearchClear) contenderSearchClear.hidden = true;
    }
    saveState();
    render();
  });

  categoryTabs.appendChild(select);
}

function createCard(category: Category, film: Film, filmIndex: number): HTMLDivElement {
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
    input.value = String((film as unknown as Record<string, unknown>)[field.key]);
    input.addEventListener("input", (event) => {
      (film as unknown as Record<string, number>)[field.key] = clamp(Number((event.target as HTMLInputElement).value || 0), 0, 100);
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

function getDisplayLimit(category: Category): number {
  return category.id === "picture" ? 10 : 5;
}

function getPrimaryColumnLabel(categoryId: string): string {
  const personCategoryLabels: Record<string, string> = {
    director: "Director",
    actor: "Actor",
    actress: "Actress",
    "supporting-actor": "Supporting Actor",
    "supporting-actress": "Supporting Actress"
  };
  return personCategoryLabels[categoryId] || "Film";
}

function getDisplayTitle(categoryId: string, title: string, studio: string): string {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";

  if (!isPersonCategory) return title;
  return `${title} (${studio})`;
}

function getSelectedFilmTitle(categoryId: string, entry: Projection): string {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";
  return isPersonCategory ? entry.rawStudio : entry.rawTitle;
}

function trendKeyForEntry(categoryId: string, entry: Projection): string {
  const isPersonCategory =
    categoryId === "director" ||
    categoryId === "actor" ||
    categoryId === "actress" ||
    categoryId === "supporting-actor" ||
    categoryId === "supporting-actress";
  const base = isPersonCategory ? `${entry.rawTitle}::${entry.rawStudio}` : entry.rawTitle;
  return `${categoryId}::${normalizeSignalKey(base)}`;
}

function buildCategoryTrendSignature(category: Category, displayProjections: Projection[]): string {
  const rows = displayProjections.map((entry) => {
    return `${trendKeyForEntry(category.id, entry)}:${entry.nomination.toFixed(2)}:${entry.winner.toFixed(2)}`;
  });
  return `${category.id}|${appliedExternalSnapshotId || "manual"}|${rows.join("|")}`;
}

function captureTrendSnapshot(category: Category, projections: Projection[]): boolean {
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

function pointsForEntryTrend(category: Category, entry: Projection): TrendPoint[] {
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
    .filter((p): p is TrendPoint => p !== null)
    .slice(-pointLimit);
}

function formatTrendStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function buildPolylinePath(points: TrendPoint[], metric: "nomination" | "winner", width: number, height: number, minY: number, maxY: number): string {
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

function renderTrendChart(points: TrendPoint[]): void {
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

function renderSourceMovement(points: TrendPoint[]): void {
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

function renderTrendAnalytics(category: Category, entry: Projection | null): void {
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

function showPosterSkeleton(): void {
  if (posterSkeleton) posterSkeleton.hidden = false;
  if (movieDetailPoster) movieDetailPoster.classList.add("hidden");
  if (movieDetailPosterLink) movieDetailPosterLink.classList.add("hidden");
}

function hidePosterSkeleton(): void {
  if (posterSkeleton) posterSkeleton.hidden = true;
}

function setPosterState(posterUrl: string, movieUrl: string): void {
  const title = movieDetailTitle.textContent || "Selected Movie";
  const src = normalizePosterRenderUrl(posterUrl) || buildPosterFallbackDataUrl(title);
  const href = movieUrl || getTmdbSearchUrl(title);
  posterFallbackActive = !posterUrl;
  hidePosterSkeleton();
  movieDetailPoster.src = src;
  movieDetailPoster.alt = `${title} poster`;
  movieDetailPoster.classList.remove("hidden");
  movieDetailPosterLink.href = href;
  movieDetailPosterLink.classList.remove("hidden");
}

async function loadPosterForTitle(title: string): Promise<void> {
  const requestId = ++activePosterRequestId;
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
  posterFallbackActive = true;
  const title = movieDetailTitle.textContent || "Selected Movie";
  movieDetailPoster.src = buildPosterFallbackDataUrl(title);
  movieDetailPoster.alt = `${title} poster`;
  movieDetailPosterLink.href = getTmdbSearchUrl(title);
});

function renderMovieDetails(category: Category, entry: Projection | null): void {
  if (!entry) {
    activePosterRequestId++;
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

interface BuildProjectionsOverrides {
  films?: Film[];
  weights?: Partial<NormalizedWeights>;
}
function buildProjections(category: Category, overrides: BuildProjectionsOverrides | null = null): Projection[] {
  const films = overrides?.films ?? category.films;
  let normalized;
  if (overrides?.weights) {
    const w = overrides.weights;
    const total = (w.precursor ?? 0) + (w.history ?? 0) + (w.buzz ?? 0) || 1;
    normalized = { precursor: (w.precursor ?? 0) / total, history: (w.history ?? 0) / total, buzz: (w.buzz ?? 0) / total };
  } else {
    normalized = normalizeWeights();
  }

  const scored = films.map((film, index) => {
    const scores = scoreFilm(category.id, film, normalized);
    return { ...film, ...scores, index };
  });

  const nominationTotal = scored.reduce((sum, item) => sum + item.nominationRaw, 0) || 1;
  const winnerTotal = scored.reduce((sum, item) => sum + item.winnerRaw, 0) || 1;
  const nomineeScale = category.nominees / Math.max(1, scored.length);

  const projections = scored
    .map((film) => {
      const nomination = calculateNominationOdds({
        nominationRaw: film.nominationRaw,
        nominationTotal,
        nomineeScale,
        uplift: NOMINATION_PERCENT_UPLIFT,
        min: 0.6,
        max: 99
      });
      const winner = calculateWinnerOdds({
        winnerRaw: film.winnerRaw,
        winnerTotal,
        nomination,
        winnerBase: category.winnerBase,
        uplift: WINNER_PERCENT_UPLIFT,
        min: 0.4,
        max: 92
      });

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

  rebalanceCategory(topContenders, {
    winnerToNominationCap: WINNER_TO_NOMINATION_CAP,
    nominationBand: {
      minTotal: 90,
      maxTotal: 95,
      targetTotal: 93,
      minValue: 0.6,
      maxValue: 50
    },
    winnerBand: {
      minTotal: 30,
      maxTotal: 45,
      targetTotal: 38,
      minValue: 0.4,
      maxValue: 24
    }
  });

  return [...topContenders, ...projections.slice(displayLimit)];
}

function renderCandidates(category: Category, projections: Projection[]): void {
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

function renderSearchResults(query: string): void {
  if (resultsPrimaryHeader) resultsPrimaryHeader.textContent = "Film";
  if (thNomination) thNomination.hidden = false;
  if (thWinner) thWinner.textContent = "Winner %";
  if (thCompareB) thCompareB.hidden = true;
  if (thDelta) thDelta.hidden = true;
  resultsBody.innerHTML = "";

  const normalizedQuery = query.toLowerCase();
  const matches: SearchProjection[] = [];

  categories.forEach((category) => {
    const projections = buildProjections(category);
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
    row.innerHTML = `<td class="results-empty" colspan="3">No contenders match "${query}".</td>`;
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
        searchQuery = "";
        if (contenderSearch) contenderSearch.value = "";
        if (contenderSearchClear) contenderSearchClear.hidden = true;
        state.categoryId = entry.categoryId;
        const cat = categories.find((c) => c.id === entry.categoryId);
        if (cat) {
          const catProjections = buildProjections(cat);
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
          <strong>${entry.title}</strong>
          <span class="results-category-label">${entry.categoryName}</span>
        </td>
        <td data-label="Nomination %">${entry.nomination.toFixed(1)}%</td>
        <td data-label="Winner %">${entry.winner.toFixed(1)}%</td>
      `;
      resultsBody.appendChild(row);
    });
  }

  renderExplanation(getActiveCategory(), null, []);
  renderMovieDetails(getActiveCategory(), null);
  renderTrendAnalytics(getActiveCategory(), null);
}

function renderResults(category: Category, projections: Projection[]): void {
  if (searchQuery) {
    renderSearchResults(searchQuery);
    return;
  }
  setNormalTableHeaders(category);
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

function renderExplanation(category: Category, entry: Projection | null, fieldEntries: Projection[]): void {
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

function setCsvStatus(message: string, type = ""): void {
  csvStatus.textContent = message;
  csvStatus.className = `tool-status${type ? ` ${type}` : ""}`;
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

function bindSearchControls(): void {
  if (!contenderSearch) return;
  contenderSearch.addEventListener("input", () => {
    searchQuery = contenderSearch.value.trim();
    if (contenderSearchClear) contenderSearchClear.hidden = !searchQuery;
    render();
  });
  if (contenderSearchClear) {
    contenderSearchClear.addEventListener("click", () => {
      searchQuery = "";
      contenderSearch.value = "";
      contenderSearchClear.hidden = true;
      render();
    });
  }
}

function bindCsvControls(): void {
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

function serializeStatePayload(): StatePayload {
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

function applyStatePayload(parsed: unknown): void {
  if (!parsed || typeof parsed !== "object") return;
  const p = parsed as StatePayload;

  if (p.weights && typeof p.weights === "object") {
    state.weights.precursor = clamp(Number(p.weights.precursor || state.weights.precursor), 1, 95);
    state.weights.history = clamp(Number(p.weights.history || state.weights.history), 1, 95);
    state.weights.buzz = clamp(Number(p.weights.buzz || state.weights.buzz), 1, 95);
  }

  if (TREND_WINDOW_OPTIONS.includes(Number(p.trendWindow))) {
    state.trendWindow = Number(p.trendWindow);
  }

  if (typeof p.categoryId === "string" && categories.some((category) => category.id === p.categoryId)) {
    state.categoryId = p.categoryId;
  }

  if (Array.isArray(p.categories)) {
    p.categories.forEach((storedCategory) => {
      if (!storedCategory || typeof storedCategory !== "object") return;
      const sc = storedCategory as Record<string, unknown>;
      const target = categories.find((category) => category.id === sc.id);
      if (!target || !Array.isArray(sc.films)) return;

      const films = (sc.films as unknown[]).map(parseFilmRecord).filter((f): f is Film => f !== null);
      if (films.length > 0) target.films = films;
    });
  }

  if (p.trendHistory && typeof p.trendHistory === "object") {
    const snapshots = Array.isArray(p.trendHistory.snapshots) ? p.trendHistory.snapshots : [];
    trendHistory.snapshots = snapshots
      .map((rawSnapshot) => {
        const snapshot = rawSnapshot as Record<string, unknown>;
        if (!snapshot || typeof snapshot !== "object") return null;
        if (typeof snapshot.categoryId !== "string") return null;
        const capturedAt = String(snapshot.capturedAt || "");
        const entries = Array.isArray(snapshot.entries)
          ? (snapshot.entries as unknown[])
              .map((rawEntry) => {
                const entry = rawEntry as Record<string, unknown>;
                if (!entry || typeof entry !== "object") return null;
                if (typeof entry.key !== "string") return null;
                return {
                  key: entry.key,
                  title: String(entry.title || ""),
                  nomination: clamp(Number(entry.nomination || 0), 0, 100),
                  winner: clamp(Number(entry.winner || 0), 0, 100)
                };
              })
              .filter((e): e is TrendEntry => e !== null)
          : [];
        if (!entries.length) return null;
        return {
          categoryId: snapshot.categoryId,
          capturedAt: capturedAt || new Date().toISOString(),
          sourceSnapshotId: snapshot.sourceSnapshotId ? String(snapshot.sourceSnapshotId) : null,
          entries
        };
      })
      .filter((s): s is TrendSnapshot => s !== null)
      .slice(-TREND_HISTORY_LIMIT);
    trendHistory.lastSignatureByCategory =
      p.trendHistory.lastSignatureByCategory && typeof p.trendHistory.lastSignatureByCategory === "object"
        ? { ...p.trendHistory.lastSignatureByCategory }
        : {};
  }
}

function getLocalStorageKeyForProfile(profileId = state.profileId) {
  return `${STORAGE_KEY}.${profileId}`;
}

function getForecastApiUrl(profileId = state.profileId) {
  return `${API_FORECAST_BASE_URL}/${encodeURIComponent(profileId)}`;
}

function updatePrintMeta() {
  if (!printMeta) return;
  const activeCategory = getActiveCategory();
  const stamp = new Date().toLocaleString();
  printMeta.textContent = `Profile: ${state.profileId} | Category: ${activeCategory?.name || "Unknown"} | Generated: ${stamp}`;
}

function renderProfileOptions() {
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

// Current auth dialog mode — read by the single submit listener
let authDialogMode: "unlock" | "set" | "change" | null = null;

function updateLockButton(): void {
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

async function refreshAuthStatus(profileId: string): Promise<void> {
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/auth-status`);
    if (!res.ok) return;
    const data = await res.json() as { hasPassphrase: boolean; authenticated: boolean };
    profileAuthMap.set(profileId, data);
    updateLockButton();
  } catch { /* ignore */ }
}

function openAuthDialog(mode: "unlock" | "set" | "change"): void {
  if (!authDialog || !authDialogTitle || !authDialogDesc || !authDialogForm || !authSecurityOptions) return;
  authDialogMode = mode;
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

function closeAuthDialog(): void {
  if (!authDialog) return;
  authDialogMode = null;
  if (authPassphraseInput) authPassphraseInput.value = "";
  if (authPassphraseConfirm) authPassphraseConfirm.value = "";
  if (authDialogError) authDialogError.textContent = "";
  if (authDialog.open) authDialog.close();
}

function promptUnlock(profileId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    resolveUnlock = resolve;
    unlockProfileId = profileId;
    openAuthDialog("unlock");
  });
}

function bindProfileLockButton(): void {
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
      authDialogMode = null;
      authDialogForm.hidden = true;
      authSecurityOptions.hidden = false;
      if (!authDialog.open) authDialog.showModal();
    }
  });

  authChangePassphraseBtn?.addEventListener("click", () => {
    openAuthDialog("change");
  });

  authRemovePassphraseBtn?.addEventListener("click", async () => {
    const profileId = state.profileId;
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/passphrase`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setAppNotice(err.error || "Failed to remove passphrase.", "error");
        return;
      }
      closeAuthDialog();
      await refreshAuthStatus(profileId);
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
      await refreshAuthStatus(profileId);
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
    resolveUnlock = null;
    closeAuthDialog();
    cb?.(false);
  });

  authDialog?.addEventListener("close", () => {
    const cb = resolveUnlock;
    resolveUnlock = null;
    cb?.(false);
  });

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
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ passphrase }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          if (authDialogError) authDialogError.textContent = err.error || "Login failed.";
          return;
        }
        const cb = resolveUnlock;
        resolveUnlock = null;
        await refreshAuthStatus(profileId);
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
          headers: { "content-type": "application/json" },
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
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ passphrase }),
        });
        if (loginRes.ok) await refreshAuthStatus(profileId);
        setAppNotice(mode === "set" ? "Passphrase set successfully." : "Passphrase changed successfully.");
      } catch {
        if (authDialogError) authDialogError.textContent = "Failed to set passphrase. Check your connection.";
      }
    }
  });
}

async function loadProfiles() {
  try {
    const response = await fetch(API_PROFILE_LIST_URL, { cache: "no-store" });
    if (!response.ok) {
      setBackendOfflineMode(true);
      renderProfileOptions();
      return;
    }
    setBackendOfflineMode(false);
    const doc = await response.json();
    const entries: Array<{ id?: unknown; hasPassphrase?: unknown }> = Array.isArray(doc.profiles) ? doc.profiles : [];
    const ids: string[] = entries.map((e) => String(e.id || "")).filter(Boolean);
    if (!ids.length) ids.push("default");
    profileOptions = [...new Set(ids)];
    // Seed the auth map from the profile list response
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

async function saveStateToApi() {
  try {
    const response = await fetch(getForecastApiUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(serializeStatePayload())
    });
    if (response.status === 401) {
      const ok = await promptUnlock(state.profileId);
      if (ok) void saveStateToApi(); // retry once after successful login
      return;
    }
    if (!response.ok) {
      setBackendOfflineMode(true);
      return;
    }
    setBackendOfflineMode(false);
  } catch {
    setBackendOfflineMode(true);
  }
}

// Fetches the server-side daily snapshot history and prepends any entries that are
// not already present in the in-memory trendHistory.  Extends the trend chart with
// data that predates the current session or exceeds the in-memory 240-entry cap.
async function mergeServerHistory(profileId: string): Promise<void> {
  try {
    const res = await fetch(
      `${API_FORECAST_BASE_URL}/${encodeURIComponent(profileId)}/history`,
      { cache: "no-store" }
    );
    if (!res.ok) return;
    const doc = await res.json();
    if (!doc || !Array.isArray(doc.snapshots) || doc.snapshots.length === 0) return;

    // Calendar dates already covered by the in-memory history per category.
    const existingDates = new Set<string>();
    for (const snap of trendHistory.snapshots) {
      existingDates.add(`${snap.categoryId}::${snap.capturedAt.slice(0, 10)}`);
    }

    const serverSnaps: TrendSnapshot[] = [];
    for (const raw of doc.snapshots as unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const snap = raw as Record<string, unknown>;
      const categoryId = typeof snap.categoryId === "string" ? snap.categoryId : null;
      const snappedAt = typeof snap.snappedAt === "string" ? snap.snappedAt : null;
      const entries = Array.isArray(snap.entries) ? snap.entries : [];
      if (!categoryId || !snappedAt) continue;
      if (existingDates.has(`${categoryId}::${snappedAt}`)) continue;
      serverSnaps.push({
        categoryId,
        capturedAt: `${snappedAt}T12:00:00.000Z`,
        sourceSnapshotId: null,
        entries: (entries as unknown[]).flatMap((e) => {
          if (!e || typeof e !== "object") return [];
          const entry = e as Record<string, unknown>;
          const key = typeof entry.key === "string" ? entry.key : null;
          if (!key) return [];
          return [{
            key,
            title: typeof entry.title === "string" ? entry.title : "",
            nomination: typeof entry.nomPct === "number" ? entry.nomPct : 0,
            winner: typeof entry.winPct === "number" ? entry.winPct : 0,
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

async function loadStateFromApi() {
  const profileId = state.profileId;
  try {
    const response = await fetch(getForecastApiUrl(profileId), { cache: "no-store" });
    if (!response.ok) {
      setBackendOfflineMode(true);
      return;
    }
    const doc = await response.json();
    if (!doc || typeof doc !== "object" || !doc.payload) return;
    setBackendOfflineMode(false);
    applyStatePayload(doc.payload);
    await mergeServerHistory(profileId);
  } catch {
    setBackendOfflineMode(true);
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
    state.profileId = (event.target as HTMLSelectElement).value;
    loadState();
    await loadStateFromApi();
    await refreshAuthStatus(state.profileId);
    if (compareMode) {
      updateCompareProfileSelect();
      if (compareProfileId === state.profileId || !compareProfileId) {
        const others = profileOptions.filter((id) => id !== state.profileId);
        compareProfileId = others[0] ?? null;
        if (!compareProfileId) {
          compareMode = false;
          if (compareControls) compareControls.hidden = true;
          if (compareToggleButton) { compareToggleButton.textContent = "Compare"; compareToggleButton.setAttribute("aria-pressed", "false"); }
        } else {
          updateCompareProfileSelect();
          await fetchAndRenderCompare();
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
    if (!profileOptions.includes(profileId)) profileOptions.push(profileId);
    state.profileId = profileId;
    renderProfileOptions();
    saveState();
    await loadProfiles();
  });

  renameProfileButton?.addEventListener("click", async () => {
    const current = state.profileId;
    const input = window.prompt("Rename profile to:", current);
    if (!input || input.trim() === current) return;
    const newId = input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    if (!newId || newId === current) return;

    const doRename = async (): Promise<void> => {
      const res = await fetch(`${API_FORECAST_BASE_URL}/${encodeURIComponent(current)}/rename`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newId })
      });
      if (res.status === 401) {
        const ok = await promptUnlock(current);
        if (ok) await doRename();
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAppNotice((err as { error?: string }).error || "Rename failed.", "error");
        return;
      }
      const oldKey = getLocalStorageKeyForProfile(current);
      const saved = localStorage.getItem(oldKey);
      if (saved) {
        localStorage.setItem(getLocalStorageKeyForProfile(newId), saved);
        localStorage.removeItem(oldKey);
      }
      const idx = profileOptions.indexOf(current);
      if (idx >= 0) profileOptions[idx] = newId;
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
      const res = await fetch(getForecastApiUrl(current), { method: "DELETE" });
      if (res.status === 401) {
        const ok = await promptUnlock(current);
        if (ok) await doDelete();
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAppNotice((err as { error?: string }).error || "Delete failed.", "error");
        return;
      }
      const doc = await res.json();
      localStorage.removeItem(getLocalStorageKeyForProfile(current));
      profileOptions = profileOptions.filter((id) => id !== current);
      state.profileId = (doc as { activeProfileId?: string }).activeProfileId || profileOptions[0];
      renderProfileOptions();
      loadState();
      await loadStateFromApi();
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

function bindTrendControls() {
  if (!trendWindowSelect) return;
  trendWindowSelect.value = String(state.trendWindow);
  trendWindowSelect.addEventListener("change", (event) => {
    const value = Number((event.target as HTMLSelectElement).value || 30);
    state.trendWindow = TREND_WINDOW_OPTIONS.includes(value) ? value : 30;
    saveState();
    render();
  });
}

function bindPrintControls() {
  printPdfButton?.addEventListener("click", () => {
    updatePrintMeta();
    window.print();
  });
}

async function fetchComparePayload(profileId: string): Promise<StatePayload | null> {
  if (comparePayloadCache.has(profileId)) return comparePayloadCache.get(profileId) ?? null;
  try {
    const res = await fetch(getForecastApiUrl(profileId), { cache: "no-store" });
    if (!res.ok) {
      setBackendOfflineMode(true);
      return null;
    }
    const doc = await res.json();
    if (!doc?.payload) return null;
    setBackendOfflineMode(false);
    comparePayloadCache.set(profileId, doc.payload);
    return doc.payload;
  } catch {
    setBackendOfflineMode(true);
    return null;
  }
}

function buildCompareProjectionsFrom(category: Category, payload: StatePayload | null | undefined): Projection[] | null {
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

function setNormalTableHeaders(category: Category) {
  if (resultsPrimaryHeader) resultsPrimaryHeader.textContent = getPrimaryColumnLabel(category.id);
  if (thNomination) thNomination.hidden = false;
  if (thWinner) thWinner.textContent = "Winner %";
  if (thCompareB) thCompareB.hidden = true;
  if (thDelta) thDelta.hidden = true;
}

function setCompareTableHeaders(category: Category) {
  if (resultsPrimaryHeader) resultsPrimaryHeader.textContent = getPrimaryColumnLabel(category.id);
  if (thNomination) thNomination.hidden = true;
  if (thWinner) { thWinner.textContent = state.profileId; thWinner.setAttribute("aria-label", `Winner % for profile "${state.profileId}"`); }
  if (thCompareB) { thCompareB.textContent = compareProfileId; thCompareB.setAttribute("aria-label", `Winner % for profile "${compareProfileId}"`); thCompareB.hidden = false; }
  if (thDelta) thDelta.hidden = false;
}

function updateCompareProfileSelect() {
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
  if (!compareProfileId || !others.includes(compareProfileId)) compareProfileId = others[0] ?? null;
}

async function fetchAndRenderCompare() {
  if (!compareProfileId) return;
  setAppNotice("Loading comparison profile…", "loading");
  await fetchComparePayload(compareProfileId);
  setAppNotice("");
  render();
}

function renderCompareResults(category: Category, primaryProjections: Projection[]) {
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
      const sign = delta >= 0 ? "+" : "";
      const cls = delta > 0.5 ? "delta-pos" : delta < -0.5 ? "delta-neg" : "delta-neutral";
      deltaCell = `<td data-label="Δ" class="${cls}">${sign}${delta.toFixed(1)}pp</td>`;
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
      <td data-label="${getPrimaryColumnLabel(category.id)}"><strong>${entry.title}</strong></td>
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

function bindCompareControls() {
  compareToggleButton?.addEventListener("click", async () => {
    if (compareMode) {
      compareMode = false;
      compareProfileId = null;
      if (compareControls) compareControls.hidden = true;
      compareToggleButton.textContent = "Compare";
      compareToggleButton.setAttribute("aria-pressed", "false");
      render();
      return;
    }
    const others = profileOptions.filter((id) => id !== state.profileId);
    if (others.length === 0) {
      setAppNotice("Create a second profile to use comparison mode.", "error");
      return;
    }
    compareMode = true;
    compareProfileId = others[0];
    updateCompareProfileSelect();
    if (compareControls) compareControls.hidden = false;
    compareToggleButton.textContent = "✕ Compare";
    compareToggleButton.setAttribute("aria-pressed", "true");
    await fetchAndRenderCompare();
  });

  compareProfileSelect?.addEventListener("change", async (event) => {
    const sel = (event.target as HTMLSelectElement).value;
    comparePayloadCache.delete(sel);
    compareProfileId = sel;
    await fetchAndRenderCompare();
  });
}

function renderSummaryBar() {
  if (!categorySummaryBar) return;
  categorySummaryBar.innerHTML = "";

  categories.forEach((category) => {
    const projections = buildProjections(category);
    const top = projections[0];
    const second = projections[1];
    if (!top) return;

    const gap = second ? top.winner - second.winner : null;
    const shortName = CATEGORY_SHORT_NAMES[category.id] || category.name;
    const isActive = category.id === state.categoryId;
    const displayName = top.rawTitle;

    let gapClass = "gap-moderate";
    if (gap !== null) {
      if (gap < 5) gapClass = "gap-tight";
      else if (gap >= 15) gapClass = "gap-clear";
    }

    const card = document.createElement("button");
    card.type = "button";
    card.className = `summary-card${isActive ? " active" : ""}`;
    card.setAttribute(
      "aria-label",
      `${category.name}: ${displayName}, ${top.winner.toFixed(1)}% winner odds${gap !== null ? `, +${gap.toFixed(1)}pp lead` : ""}`
    );
    card.setAttribute("aria-pressed", isActive ? "true" : "false");

    card.innerHTML = `
      <span class="summary-card-category">${shortName}</span>
      <span class="summary-card-title">${displayName}</span>
      <span class="summary-card-footer">
        <span class="summary-card-odds">${top.winner.toFixed(1)}%</span>
        ${gap !== null ? `<span class="summary-card-gap ${gapClass}">+${gap.toFixed(1)}pp</span>` : ""}
      </span>
    `;

    card.addEventListener("click", () => {
      if (searchQuery) {
        searchQuery = "";
        if (contenderSearch) contenderSearch.value = "";
        if (contenderSearchClear) contenderSearchClear.hidden = true;
      }
      state.categoryId = category.id;
      saveState();
      render();
    });

    categorySummaryBar.appendChild(card);
  });

  // Scroll the active card into view within the bar
  const activeCard = categorySummaryBar.querySelector<HTMLElement>(".summary-card.active");
  if (activeCard) {
    const bar = categorySummaryBar;
    bar.scrollLeft = activeCard.offsetLeft - bar.clientWidth / 2 + activeCard.offsetWidth / 2;
  }
}

const PERSON_CATEGORY_IDS = new Set(["director", "actor", "actress", "supporting-actor", "supporting-actress"]);

function renderLeaderboard(): void {
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

  // Sort by nomination count desc; break ties by win count desc. Show top 10 only.
  const rows = Array.from(filmMap.entries())
    .sort(([, a], [, b]) => b.nominations - a.nominations || b.wins - a.wins)
    .slice(0, 10);

  if (rows.length === 0) {
    const row = leaderboardBody.insertRow();
    row.innerHTML = `<td class="results-empty" colspan="3">No contenders loaded yet.</td>`;
    return;
  }

  rows.forEach(([title, { nominations, wins }], index) => {
    const row = leaderboardBody.insertRow();
    row.className = "leaderboard-row";
    row.setAttribute(
      "aria-label",
      `${index + 1}. ${title}: ${nominations} nomination${nominations !== 1 ? "s" : ""}, ${wins} win${wins !== 1 ? "s" : ""}`
    );
    row.innerHTML = `
      <td class="leaderboard-film">
        <span class="leaderboard-rank">${index + 1}</span>
        <span class="leaderboard-title">${title}</span>
      </td>
      <td class="leaderboard-num">${nominations}</td>
      <td class="leaderboard-num">${wins}</td>
    `;
  });
}

function render() {
  setPanelsBusy(isBootstrapping);
  const activeCategory = getActiveCategory();
  updatePrintMeta();
  const projections = buildProjections(activeCategory);
  lastOddsRecalculatedAt = new Date().toISOString();
  updateOddsFreshnessLabel();
  const capturedTrend = captureTrendSnapshot(activeCategory, projections);
  if (trendWindowSelect) trendWindowSelect.value = String(state.trendWindow);
  renderTabs();
  renderSummaryBar();
  renderLeaderboard();
  renderCandidates(activeCategory, projections);
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
  } else {
    renderResults(activeCategory, projections);
  }
  if (capturedTrend) saveState();
}

function serializeSharePayload(): CompactShare {
  const sliders: Record<string, Record<string, [number, number, number]>> = {};
  for (const cat of categories) {
    sliders[cat.id] = {};
    for (const film of cat.films) {
      sliders[cat.id][film.title] = [film.precursor, film.history, film.buzz];
    }
  }
  return {
    v: 1,
    c: state.categoryId,
    w: [state.weights.precursor, state.weights.history, state.weights.buzz],
    t: state.trendWindow,
    s: sliders
  };
}

function buildShareUrl(): string {
  const json = JSON.stringify(serializeSharePayload());
  const compressed = LZString.compressToEncodedURIComponent(json);
  return `${window.location.origin}${window.location.pathname}?share=${compressed}`;
}

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

function bindShareControls(): void {
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

// ── Backtest interfaces ───────────────────────────────────────────────────

interface BacktestCategorySummary {
  categoryId: string;
  nominationAccuracyAvg: number;
  winnerAccuracyPct: number;
  nominationBrierAvg: number;
  winnerBrierAvg: number;
}

interface BacktestYearRow {
  year: number;
  ceremony: number;
  categoryId: string;
  nominationAccuracy: number;
  winnerCorrect: boolean;
  nominationBrierScore: number;
  winnerBrierScore: number;
  topPredicted: string;
  actualWinner: string;
}

interface BacktestOverall {
  nominationAccuracyAvg: number;
  winnerAccuracyPct: number;
  nominationBrierAvg: number;
  winnerBrierAvg: number;
}

interface BacktestApiResult {
  computedAt: string;
  yearsBacktested: number;
  yearRange: { from: number; to: number };
  overall: BacktestOverall;
  byCategory: BacktestCategorySummary[];
  byYear: BacktestYearRow[];
}

// ── Backtest rendering ────────────────────────────────────────────────────

const BACKTEST_CATEGORY_LABELS: Record<string, string> = {
  "picture": "Best Picture",
  "director": "Best Director",
  "actor": "Best Actor",
  "actress": "Best Actress",
  "supporting-actor": "Best Supporting Actor",
  "supporting-actress": "Best Supporting Actress"
};

function renderBacktestStatGrid(overall: BacktestOverall): void {
  if (!backtestStatGrid) return;
  const stats = [
    {
      label: "Nom. Accuracy",
      value: `${(overall.nominationAccuracyAvg * 100).toFixed(1)}%`,
      sub: "avg across categories"
    },
    {
      label: "Winner Accuracy",
      value: `${overall.winnerAccuracyPct.toFixed(1)}%`,
      sub: "top pick = actual winner"
    },
    {
      label: "Nom. Brier Score",
      value: overall.nominationBrierAvg.toFixed(3),
      sub: "lower is better"
    },
    {
      label: "Win. Brier Score",
      value: overall.winnerBrierAvg.toFixed(3),
      sub: "lower is better"
    }
  ];
  backtestStatGrid.innerHTML = stats
    .map(
      (s) => `<div class="backtest-stat-card">
        <span class="backtest-stat-label">${s.label}</span>
        <span class="backtest-stat-value">${s.value}</span>
        <span class="backtest-stat-sub">${s.sub}</span>
      </div>`
    )
    .join("");
}

function renderBacktestCategoryTable(categories: BacktestCategorySummary[]): void {
  if (!backtestCategoryBody) return;
  backtestCategoryBody.innerHTML = categories
    .map((cat) => {
      const label = BACKTEST_CATEGORY_LABELS[cat.categoryId] ?? cat.categoryId;
      return `<tr>
        <td>${label}</td>
        <td class="backtest-num">${(cat.nominationAccuracyAvg * 100).toFixed(1)}%</td>
        <td class="backtest-num">${cat.winnerAccuracyPct.toFixed(1)}%</td>
        <td class="backtest-num">${cat.nominationBrierAvg.toFixed(3)}</td>
        <td class="backtest-num">${cat.winnerBrierAvg.toFixed(3)}</td>
      </tr>`;
    })
    .join("");
}

function renderBacktestYearTable(rows: BacktestYearRow[], filterCategoryId: string): void {
  if (!backtestYearBody) return;
  const filtered = filterCategoryId === "all"
    ? rows
    : rows.filter((r) => r.categoryId === filterCategoryId);
  if (filtered.length === 0) {
    backtestYearBody.innerHTML = `<tr><td class="results-empty" colspan="5">No data for selected category.</td></tr>`;
    return;
  }
  backtestYearBody.innerHTML = filtered
    .map((r) => {
      const correctClass = r.winnerCorrect ? "backtest-correct" : "backtest-miss";
      const correctLabel = r.winnerCorrect ? "✓" : "✗";
      return `<tr>
        <td>${r.year}</td>
        <td>${r.topPredicted}</td>
        <td>${r.actualWinner}</td>
        <td class="backtest-num">${(r.nominationAccuracy * 100).toFixed(1)}%</td>
        <td class="backtest-num ${correctClass}">${correctLabel}</td>
      </tr>`;
    })
    .join("");
}

function populateBacktestFilter(categories: BacktestCategorySummary[]): void {
  if (!backtestCategoryFilter) return;
  backtestCategoryFilter.innerHTML =
    `<option value="all">All Categories</option>` +
    categories
      .map((cat) => {
        const label = BACKTEST_CATEGORY_LABELS[cat.categoryId] ?? cat.categoryId;
        return `<option value="${cat.categoryId}">${label}</option>`;
      })
      .join("");
}

async function loadBacktest(): Promise<void> {
  if (backtestStatus) {
    backtestStatus.textContent = "Loading accuracy data…";
    backtestStatus.className = "app-notice loading";
  }
  try {
    const res = await fetch("/api/backtest", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as BacktestApiResult;
    if (backtestStatus) { backtestStatus.textContent = ""; backtestStatus.className = "app-notice"; }
    if (backtestOverview) backtestOverview.hidden = false;
    renderBacktestStatGrid(data.overall);
    renderBacktestCategoryTable(data.byCategory);
    populateBacktestFilter(data.byCategory);
    renderBacktestYearTable(data.byYear, "all");
    backtestCategoryFilter?.addEventListener("change", () => {
      renderBacktestYearTable(data.byYear, backtestCategoryFilter.value);
    });
  } catch {
    if (backtestStatus) {
      backtestStatus.textContent = "Could not load backtesting data.";
      backtestStatus.className = "app-notice error";
    }
  }
}

async function bootstrap() {
  setPanelsBusy(true);
  setAppNotice("Loading forecast workspace...", "loading");
  await loadProfiles();
  loadState();
  await loadStateFromApi();
  bindProfileControls();
  bindProfileLockButton();
  bindTrendControls();
  bindCsvControls();
  bindPrintControls();
  bindSearchControls();
  bindCompareControls();
  bindShareControls();
  isBootstrapping = false;
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

bootstrap();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // SW registration is best-effort; failure doesn't affect core functionality.
  });
}
