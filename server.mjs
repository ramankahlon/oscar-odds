import express from "express";
import rateLimit from "express-rate-limit";
import fs from "node:fs/promises";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import * as cheerio from "cheerio";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const STORE_PATH = path.join(__dirname, "data", "forecast-store.json"); // kept for one-time migration
const DB_PATH = path.join(__dirname, "data", "forecast.db");
const SCRAPE_OBSERVABILITY_PATH = path.join(__dirname, "data", "scrape-observability.json");
const DEFAULT_PROFILE_ID = "default";
const posterCache = new Map();
const TMDB_BASE_URL = "https://www.themoviedb.org";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BEARER = process.env.TMDB_API_READ_ACCESS_TOKEN || "";
const TMDB_RELEASE_YEAR = 2026;
const FORCE_HTTPS = process.env.FORCE_HTTPS === "true";
const ENABLE_SOURCE_POLLER = process.env.ENABLE_SOURCE_POLLER === "true";
const SOURCE_POLL_INTERVAL_MINUTES = Math.max(5, Number(process.env.SOURCE_POLL_INTERVAL_MINUTES || 30));
const bootAt = Date.now();
const requestMetrics = {
  total: 0,
  byMethod: {},
  byStatusClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 }
};
let pollerProcess = null;
let pollerState = { running: false, startedAt: null, lastExitCode: null, restarts: 0 };
let db;

const forecastWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." }
});

app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1);

app.use((req, res, next) => {
  requestMetrics.total += 1;
  requestMetrics.byMethod[req.method] = (requestMetrics.byMethod[req.method] || 0) + 1;

  const isForwardedHttps = req.get("x-forwarded-proto") === "https";
  if (FORCE_HTTPS && !req.secure && !isForwardedHttps) {
    const host = req.get("host");
    if (host) {
      res.redirect(301, `https://${host}${req.originalUrl}`);
      return;
    }
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https:;"
  );
  if (req.secure || isForwardedHttps) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  res.on("finish", () => {
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    if (requestMetrics.byStatusClass[statusClass] !== undefined) {
      requestMetrics.byStatusClass[statusClass] += 1;
    }
  });

  next();
});

app.use(
  express.static(__dirname, {
    maxAge: "1h",
    etag: true
  })
);

function startSourcePoller() {
  if (!ENABLE_SOURCE_POLLER) return;
  if (pollerProcess && !pollerProcess.killed) return;

  const args = ["scripts/poll-sources.mjs", "--interval-minutes", String(SOURCE_POLL_INTERVAL_MINUTES)];
  pollerProcess = spawn(process.execPath, args, {
    cwd: __dirname,
    env: process.env,
    stdio: "inherit"
  });
  pollerState.running = true;
  pollerState.startedAt = new Date().toISOString();

  pollerProcess.on("exit", (code) => {
    pollerState.running = false;
    pollerState.lastExitCode = code;
    pollerProcess = null;
    if (ENABLE_SOURCE_POLLER) {
      pollerState.restarts += 1;
      setTimeout(() => {
        startSourcePoller();
      }, 5000);
    }
  });
}

function initDb() {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id         TEXT PRIMARY KEY,
      updated_at TEXT,
      payload    TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // One-time migration from forecast-store.json when the DB is empty.
  const isEmpty = db.prepare("SELECT COUNT(*) AS n FROM profiles").get().n === 0;
  if (isEmpty) {
    try {
      const raw = readFileSync(STORE_PATH, "utf8");
      const doc = JSON.parse(raw);
      const profiles = doc?.profiles || (doc?.payload != null ? { [DEFAULT_PROFILE_ID]: { updatedAt: doc.updatedAt || null, payload: doc.payload } } : null);
      if (profiles && typeof profiles === "object" && Object.keys(profiles).length > 0) {
        const insert = db.prepare("INSERT OR IGNORE INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)");
        db.transaction(() => {
          for (const [id, entry] of Object.entries(profiles)) {
            insert.run(id, entry.updatedAt || null, entry.payload != null ? JSON.stringify(entry.payload) : null);
          }
        })();
        const activeProfileId = doc.activeProfileId || Object.keys(profiles)[0];
        db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("active_profile_id", activeProfileId);
        console.log("[db] migrated forecast-store.json → forecast.db");
      } else {
        throw new Error("no profiles in JSON store");
      }
    } catch {
      db.prepare("INSERT OR IGNORE INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(DEFAULT_PROFILE_ID, null, null);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("active_profile_id", DEFAULT_PROFILE_ID);
    }
  }
}

async function readScrapeObservability() {
  try {
    const raw = await fs.readFile(SCRAPE_OBSERVABILITY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { updatedAt: null };
    return parsed;
  } catch {
    return { updatedAt: null };
  }
}

function normalizePosterKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

function toAbsoluteTmdbUrl(value) {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) {
    if (value.includes("image.tmdb.org")) return `https:${value.slice(2)}`;
    return `https:${value.slice(2)}`;
  }
  if (value.startsWith("/t/p/")) return `https://image.tmdb.org${value}`;
  if (value.startsWith("/")) return `${TMDB_BASE_URL}${value}`;
  return `${TMDB_BASE_URL}/${value}`;
}

function canonicalMovieUrlFromPath(pathname) {
  const clean = String(pathname || "").trim();
  if (!clean) return "";
  const absolute = toAbsoluteTmdbUrl(clean);
  const url = new URL(absolute);
  return `${url.origin}${url.pathname}`;
}

function canonicalMovieUrlFromId(id) {
  const numeric = Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return `${TMDB_BASE_URL}/movie/${numeric}`;
}

function posterUrlFromPath(pathValue) {
  const pathString = String(pathValue || "").trim();
  if (!pathString) return "";
  if (pathString.startsWith("http://") || pathString.startsWith("https://")) {
    if (/^https?:\/\/www\.themoviedb\.org\/t\/p\//i.test(pathString)) {
      return pathString.replace(/^https?:\/\/www\.themoviedb\.org\/t\/p\//i, "https://image.tmdb.org/t/p/");
    }
    return pathString;
  }
  if (pathString.startsWith("/t/p/")) return `https://image.tmdb.org${pathString}`;
  return `${TMDB_IMAGE_BASE}${pathString.startsWith("/") ? "" : "/"}${pathString}`;
}

function posterUrlToOriginal(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/\/t\/p\/w\d+\//i.test(value)) return value.replace(/\/t\/p\/w\d+\//i, "/t/p/original/");
  return value;
}

async function isHttpResourceAvailable(url) {
  const target = String(url || "").trim();
  if (!target) return false;
  try {
    const head = await fetch(target, {
      method: "HEAD",
      headers: { "user-agent": "oscar-odds/1.0 (+local-dev)" },
      signal: AbortSignal.timeout(8000)
    });
    if (head.ok) {
      const contentType = String(head.headers.get("content-type") || "").toLowerCase();
      if (contentType.startsWith("image/")) return true;
    }
  } catch {
    // Fallback to GET probe below.
  }

  try {
    const get = await fetch(target, {
      method: "GET",
      headers: { Range: "bytes=0-0", "user-agent": "oscar-odds/1.0 (+local-dev)" },
      signal: AbortSignal.timeout(8000)
    });
    if (!get.ok) return false;
    const contentType = String(get.headers.get("content-type") || "").toLowerCase();
    return contentType.startsWith("image/");
  } catch {
    return false;
  }
}

async function resolveValidPosterUrl(candidateUrl) {
  const primary = String(candidateUrl || "").trim();
  if (!primary) return "";
  if (await isHttpResourceAvailable(primary)) return primary;
  const original = posterUrlToOriginal(primary);
  if (original && original !== primary && (await isHttpResourceAvailable(original))) return original;
  return "";
}

function releaseYearFromDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-/);
  if (!match) return null;
  return Number(match[1]);
}

function isTargetReleaseYear(value) {
  return releaseYearFromDate(value) === TMDB_RELEASE_YEAR;
}

function extractMoviePathsFromSearchHtml(html) {
  const $ = cheerio.load(html);
  const paths = [];
  const seen = new Set();
  const selectors = [
    "section.search_results.movie .card .content h2 a[href^='/movie/']",
    ".search_results.movie .card .image_content a[href^='/movie/']",
    ".results .card .content h2 a[href^='/movie/']",
    "a.result[href^='/movie/']",
    "a[href^='/movie/']"
  ];

  const pushPath = (href) => {
    if (!href || !/\/movie\/[0-9]/i.test(href)) return;
    const normalized = String(href).split("?")[0].trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    paths.push(normalized);
  };

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      pushPath($(el).attr("href"));
    });
    if (paths.length >= 10) break;
  }

  if (paths.length === 0) {
    for (const match of html.matchAll(/href="(\/movie\/[0-9][^"?#]*)/gi)) {
      pushPath(match[1]);
      if (paths.length >= 10) break;
    }
  }

  return paths;
}

function extractPosterUrlFromMovieHtml(html) {
  const $ = cheerio.load(html);
  const selectorCandidates = [
    ".poster_wrapper img.poster",
    ".poster img",
    "img.poster",
    "meta[property='og:image']"
  ];

  for (const selector of selectorCandidates) {
    const node = $(selector).first();
    if (!node || node.length === 0) continue;
    const candidate =
      node.attr("data-src") ||
      node.attr("data-srcset")?.split(" ")[0] ||
      node.attr("src") ||
      node.attr("content") ||
      "";
    const absolute = toAbsoluteTmdbUrl(String(candidate).trim());
    if (absolute) return absolute;
  }

  return "";
}

function extractReleaseYearFromMovieHtml(html) {
  const $ = cheerio.load(html);
  const ldJson = $("script[type='application/ld+json']").first().text().trim();
  if (ldJson) {
    try {
      const parsed = JSON.parse(ldJson);
      const releaseDate = parsed?.datePublished || parsed?.releasedEvent?.startDate || "";
      const fromLd = releaseYearFromDate(releaseDate);
      if (fromLd) return fromLd;
    } catch {
      // Fall through to regex/meta parsing.
    }
  }

  const dateMeta =
    $("meta[property='movie:release_date']").attr("content") ||
    $("meta[property='og:release_date']").attr("content") ||
    "";
  const fromMeta = releaseYearFromDate(dateMeta);
  if (fromMeta) return fromMeta;

  const dateRegex = html.match(/"release_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/i);
  if (dateRegex?.[1]) return releaseYearFromDate(dateRegex[1]);
  return null;
}

function tmdbApiHeaders() {
  if (TMDB_BEARER) return { Authorization: `Bearer ${TMDB_BEARER}` };
  return {};
}

async function fetchFromTmdbApi(query) {
  if (!TMDB_API_KEY && !TMDB_BEARER) return null;

  const searchUrl = new URL("https://api.themoviedb.org/3/search/movie");
  searchUrl.searchParams.set("query", query);
  searchUrl.searchParams.set("include_adult", "false");
  searchUrl.searchParams.set("language", "en-US");
  searchUrl.searchParams.set("page", "1");
  searchUrl.searchParams.set("primary_release_year", String(TMDB_RELEASE_YEAR));
  if (TMDB_API_KEY) searchUrl.searchParams.set("api_key", TMDB_API_KEY);

  const searchResponse = await fetch(searchUrl, {
    headers: {
      ...tmdbApiHeaders(),
      "user-agent": "oscar-odds/1.0 (+local-dev)"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!searchResponse.ok) return null;
  const searchJson = await searchResponse.json();
  const results = Array.isArray(searchJson?.results) ? searchJson.results : [];
  const firstMovie = results.find((item) => item?.id && isTargetReleaseYear(item?.release_date));
  if (!firstMovie?.id) return null;
  const posterUrl = await resolveValidPosterUrl(posterUrlFromPath(firstMovie.poster_path));

  return {
    posterUrl,
    movieUrl: canonicalMovieUrlFromId(firstMovie.id)
  };
}

async function fetchFromTmdbRemoteMulti(query) {
  const remoteUrl = new URL("https://www.themoviedb.org/search/remote/multi");
  remoteUrl.searchParams.set("query", query);
  remoteUrl.searchParams.set("language", "en-US");

  const response = await fetch(remoteUrl, {
    headers: {
      "x-requested-with": "XMLHttpRequest",
      "accept": "application/json",
      "user-agent": "oscar-odds/1.0 (+local-dev)"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) return null;
  const json = await response.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  const firstMovie = results.find((item) => {
    const isMovieLike = !item?.media_type || item.media_type === "movie";
    return isMovieLike && item?.id && isTargetReleaseYear(item?.release_date);
  });
  if (!firstMovie?.id) return null;
  const posterUrl = await resolveValidPosterUrl(posterUrlFromPath(firstMovie.poster_path || firstMovie.profile_path || ""));

  return {
    posterUrl,
    movieUrl: canonicalMovieUrlFromId(firstMovie.id)
  };
}

async function fetchTmdbPoster(title) {
  const query = String(title || "").trim();
  if (!query) return null;

  const cacheKey = normalizePosterKey(query);
  if (posterCache.has(cacheKey)) return posterCache.get(cacheKey);

  const queryVariants = [query];
  if (query === "The Odyssey") queryVariants.push("The Odyssey Christopher Nolan");
  if (query === "The Dish") queryVariants.push("The Dish Spielberg");
  if (query === "Michael") queryVariants.push("Michael Jackson biopic");

  for (const candidateQuery of queryVariants) {
    const apiResult = await fetchFromTmdbApi(candidateQuery);
    if (apiResult?.movieUrl) {
      posterCache.set(cacheKey, apiResult);
      return apiResult;
    }
  }

  for (const candidateQuery of queryVariants) {
    const remoteResult = await fetchFromTmdbRemoteMulti(candidateQuery);
    if (remoteResult?.movieUrl) {
      posterCache.set(cacheKey, remoteResult);
      return remoteResult;
    }
  }

  const searchUrl = `https://www.themoviedb.org/search?query=${encodeURIComponent(query)}`;
  const searchResponse = await fetch(searchUrl, {
    headers: {
      "user-agent": "oscar-odds/1.0 (+local-dev)",
      "accept-language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!searchResponse.ok) throw new Error(`TMDB search failed: ${searchResponse.status}`);

  const searchHtml = await searchResponse.text();
  const moviePaths = extractMoviePathsFromSearchHtml(searchHtml);
  if (moviePaths.length === 0) {
    posterCache.set(cacheKey, null);
    return null;
  }

  for (const moviePath of moviePaths) {
    const movieUrl = canonicalMovieUrlFromPath(moviePath);
    const movieResponse = await fetch(movieUrl, {
      headers: {
        "user-agent": "oscar-odds/1.0 (+local-dev)",
        "accept-language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!movieResponse.ok) continue;

    const movieHtml = await movieResponse.text();
    const releaseYear = extractReleaseYearFromMovieHtml(movieHtml);
    if (releaseYear !== TMDB_RELEASE_YEAR) continue;

    const posterUrl = await resolveValidPosterUrl(extractPosterUrlFromMovieHtml(movieHtml));
    const payload = { posterUrl: posterUrl || "", movieUrl };
    posterCache.set(cacheKey, payload);
    return payload;
  }

  posterCache.set(cacheKey, null);
  return null;
}

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - bootAt) / 1000),
    poller: {
      enabled: ENABLE_SOURCE_POLLER,
      ...pollerState
    }
  });
});

app.get("/api/metrics", (_, res) => {
  res.json({
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - bootAt) / 1000),
    requests: requestMetrics,
    poller: {
      enabled: ENABLE_SOURCE_POLLER,
      ...pollerState
    }
  });
});

app.get("/api/scrape-observability", async (_, res) => {
  const doc = await readScrapeObservability();
  res.json(doc);
});

app.get("/api/profiles", (_, res) => {
  const profiles = db
    .prepare("SELECT id, updated_at FROM profiles ORDER BY id")
    .all()
    .map((row) => ({ id: row.id, updatedAt: row.updated_at || null }));
  const activeProfileId =
    db.prepare("SELECT value FROM meta WHERE key = ?").get("active_profile_id")?.value || DEFAULT_PROFILE_ID;
  res.json({ activeProfileId, profiles });
});

app.get("/api/forecast/:profileId", (req, res) => {
  const profileId = req.params.profileId || DEFAULT_PROFILE_ID;
  const row = db.prepare("SELECT id, updated_at, payload FROM profiles WHERE id = ?").get(profileId);
  const profile = row
    ? { updatedAt: row.updated_at || null, payload: row.payload != null ? JSON.parse(row.payload) : null }
    : { updatedAt: null, payload: null };
  res.json({ profileId, ...profile });
});

app.put("/api/forecast/:profileId", forecastWriteLimiter, (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    res.status(400).json({ error: "Invalid forecast payload." });
    return;
  }

  const profileId = req.params.profileId || DEFAULT_PROFILE_ID;
  const updatedAt = new Date().toISOString();
  db.prepare("INSERT OR REPLACE INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
    profileId,
    updatedAt,
    JSON.stringify(payload)
  );
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("active_profile_id", profileId);
  res.json({ profileId, updatedAt, payload });
});

app.delete("/api/forecast/:profileId", (req, res) => {
  const profileId = req.params.profileId;
  if (!db.prepare("SELECT id FROM profiles WHERE id = ?").get(profileId)) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  const remaining = db.prepare("SELECT id FROM profiles WHERE id != ?").all(profileId);
  if (remaining.length === 0) {
    res.status(400).json({ error: "Cannot delete the last profile." });
    return;
  }

  db.transaction(() => {
    db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
    const activeRow = db.prepare("SELECT value FROM meta WHERE key = ?").get("active_profile_id");
    if (!activeRow?.value || activeRow.value === profileId) {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("active_profile_id", remaining[0].id);
    }
  })();

  const activeProfileId =
    db.prepare("SELECT value FROM meta WHERE key = ?").get("active_profile_id")?.value || remaining[0].id;
  res.json({ deleted: profileId, activeProfileId });
});

app.patch("/api/forecast/:profileId/rename", (req, res) => {
  const oldId = req.params.profileId;
  const newId = String(req.body?.newId || "").trim();

  if (!newId) {
    res.status(400).json({ error: "Missing newId." });
    return;
  }

  const existing = db.prepare("SELECT id, updated_at, payload FROM profiles WHERE id = ?").get(oldId);
  if (!existing) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  if (newId === oldId) {
    res.json({ profileId: newId });
    return;
  }

  if (db.prepare("SELECT id FROM profiles WHERE id = ?").get(newId)) {
    res.status(409).json({ error: "A profile with that name already exists." });
    return;
  }

  db.transaction(() => {
    db.prepare("INSERT INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
      newId,
      existing.updated_at,
      existing.payload
    );
    db.prepare("DELETE FROM profiles WHERE id = ?").run(oldId);
    const activeRow = db.prepare("SELECT value FROM meta WHERE key = ?").get("active_profile_id");
    if (activeRow?.value === oldId) {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("active_profile_id", newId);
    }
  })();

  res.json({ profileId: newId });
});

app.get("/api/tmdb-poster", async (req, res) => {
  const title = String(req.query.title || "").trim();
  if (!title) {
    res.status(400).json({ error: "Missing title query param." });
    return;
  }

  try {
    const result = await fetchTmdbPoster(title);
    res.json({ title, result });
  } catch (error) {
    res.status(502).json({ error: String(error?.message || error) });
  }
});

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

initDb();

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  startSourcePoller();
});

function shutdown(signal) {
  console.log(`[server] received ${signal}, shutting down...`);
  if (pollerProcess && !pollerProcess.killed) pollerProcess.kill("SIGTERM");
  server.close(() => {
    if (db?.open) db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
