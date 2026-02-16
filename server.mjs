import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const STORE_PATH = path.join(__dirname, "data", "forecast-store.json");
const SCRAPE_OBSERVABILITY_PATH = path.join(__dirname, "data", "scrape-observability.json");
const DEFAULT_PROFILE_ID = "default";
const posterCache = new Map();
const TMDB_BASE_URL = "https://www.themoviedb.org";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BEARER = process.env.TMDB_API_READ_ACCESS_TOKEN || "";
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

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.profiles && typeof parsed.profiles === "object") return parsed;

    const migratedPayload = parsed?.payload || null;
    return {
      updatedAt: parsed?.updatedAt || null,
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: {
          updatedAt: parsed?.updatedAt || null,
          payload: migratedPayload
        }
      }
    };
  } catch {
    return {
      updatedAt: null,
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: { updatedAt: null, payload: null }
      }
    };
  }
}

async function writeStore(document) {
  await fs.writeFile(STORE_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return document;
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
  if (value.startsWith("//")) return `https:${value}`;
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
  if (pathString.startsWith("http://") || pathString.startsWith("https://")) return pathString;
  return `${TMDB_IMAGE_BASE}${pathString.startsWith("/") ? "" : "/"}${pathString}`;
}

function extractMoviePathFromSearchHtml(html) {
  const $ = cheerio.load(html);
  const selectors = [
    "section.search_results.movie .card .content h2 a[href^='/movie/']",
    ".search_results.movie .card .image_content a[href^='/movie/']",
    ".results .card .content h2 a[href^='/movie/']",
    "a.result[href^='/movie/']",
    "a[href^='/movie/']"
  ];

  for (const selector of selectors) {
    const href = $(selector).first().attr("href");
    if (href && /\/movie\/[0-9]/i.test(href)) {
      return href;
    }
  }

  const match = html.match(/href=\"(\/movie\/[0-9][^\"?#]*)/i);
  return match ? match[1] : "";
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
  const firstMovie = Array.isArray(searchJson?.results) ? searchJson.results.find((item) => item?.id) : null;
  if (!firstMovie) return null;

  return {
    posterUrl: posterUrlFromPath(firstMovie.poster_path),
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
  const firstMovie = results.find((item) => item?.media_type === "movie" && item?.id) || results.find((item) => item?.id);
  if (!firstMovie) return null;

  return {
    posterUrl: posterUrlFromPath(firstMovie.poster_path || firstMovie.profile_path || ""),
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
  const moviePath = extractMoviePathFromSearchHtml(searchHtml);
  if (!moviePath) {
    posterCache.set(cacheKey, null);
    return null;
  }

  const movieUrl = canonicalMovieUrlFromPath(moviePath);
  const movieResponse = await fetch(movieUrl, {
    headers: {
      "user-agent": "oscar-odds/1.0 (+local-dev)",
      "accept-language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!movieResponse.ok) throw new Error(`TMDB movie fetch failed: ${movieResponse.status}`);

  const movieHtml = await movieResponse.text();
  const posterUrl = extractPosterUrlFromMovieHtml(movieHtml);
  if (!posterUrl) {
    const payload = { posterUrl: "", movieUrl };
    posterCache.set(cacheKey, payload);
    return payload;
  }

  const payload = { posterUrl, movieUrl };
  posterCache.set(cacheKey, payload);
  return payload;
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

app.get("/api/profiles", async (_, res) => {
  const doc = await readStore();
  const profiles = Object.entries(doc.profiles || {}).map(([id, entry]) => ({
    id,
    updatedAt: entry?.updatedAt || null
  }));
  res.json({ activeProfileId: doc.activeProfileId || DEFAULT_PROFILE_ID, profiles });
});

app.get("/api/forecast/:profileId", async (req, res) => {
  const doc = await readStore();
  const profileId = req.params.profileId || DEFAULT_PROFILE_ID;
  const profile = doc.profiles?.[profileId] || { updatedAt: null, payload: null };
  res.json({ profileId, ...profile });
});

app.put("/api/forecast/:profileId", async (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    res.status(400).json({ error: "Invalid forecast payload." });
    return;
  }

  const profileId = req.params.profileId || DEFAULT_PROFILE_ID;
  const doc = await readStore();
  const updatedAt = new Date().toISOString();
  doc.updatedAt = updatedAt;
  doc.activeProfileId = profileId;
  doc.profiles = doc.profiles || {};
  doc.profiles[profileId] = { updatedAt, payload };

  const saved = await writeStore(doc);
  res.json({ profileId, ...saved.profiles[profileId] });
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

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  startSourcePoller();
});

function shutdown(signal) {
  console.log(`[server] received ${signal}, shutting down...`);
  if (pollerProcess && !pollerProcess.killed) pollerProcess.kill("SIGTERM");
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
