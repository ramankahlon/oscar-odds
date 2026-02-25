import express, { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import fs from "node:fs/promises";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, ChildProcess } from "node:child_process";
import * as cheerio from "cheerio";
import Database from "better-sqlite3";
import { z } from "zod";
import type { Logger } from "pino";
import { logger } from "./logger.js";
import { getBacktestResult } from "./backtest.js";
import { runMigrations } from "./migrate.js";
import {
  hashPassphrase,
  verifyPassphrase,
  generateSessionToken,
  sessionExpiresAt,
  isSessionExpired,
  SESSION_COOKIE,
} from "./auth-utils.js";
import swaggerUi from "swagger-ui-express";
import yaml from "js-yaml";

declare global {
  namespace Express {
    interface Request {
      log: Logger;
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const STORE_PATH = path.join(__dirname, "data", "forecast-store.json"); // kept for one-time migration
const DB_PATH = path.join(__dirname, "data", "forecast.db");
const SCRAPE_OBSERVABILITY_PATH = path.join(__dirname, "data", "scrape-observability.json");
const DEFAULT_PROFILE_ID = "default";
const posterCache = new Map<string, { posterUrl: string; movieUrl: string } | null>();
const TMDB_BASE_URL = "https://www.themoviedb.org";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BEARER = process.env.TMDB_API_READ_ACCESS_TOKEN || "";
const TMDB_RELEASE_YEAR = 2026;
const FORCE_HTTPS = process.env.FORCE_HTTPS === "true";
const ENABLE_SOURCE_POLLER = process.env.ENABLE_SOURCE_POLLER === "true";
const SOURCE_POLL_INTERVAL_MINUTES = Math.max(5, Number(process.env.SOURCE_POLL_INTERVAL_MINUTES || 30));
const bootAt = Date.now();
const openApiSpec = yaml.load(readFileSync(path.join(__dirname, "openapi.yaml"), "utf8")) as Record<string, unknown>;
const requestMetrics = {
  total: 0,
  byMethod: {} as Record<string, number>,
  byStatusClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 } as Record<string, number>
};
let pollerProcess: ChildProcess | null = null;
const pollerState = { running: false, startedAt: null as string | null, lastExitCode: null as number | null, restarts: 0 };
const scraperEventClients = new Set<Response>();
let db: Database.Database;

function broadcastScraperEvent(): void {
  if (scraperEventClients.size === 0) return;
  const payload = `data: ${JSON.stringify({ type: "scraper-run", ts: new Date().toISOString() })}\n\n`;
  for (const client of scraperEventClients) {
    try {
      client.write(payload);
    } catch {
      scraperEventClients.delete(client);
    }
  }
}

interface ProfileRow {
  id: string;
  updated_at: string | null;
  payload: string | null;
  passphrase_hash: string | null;
}

interface MetaRow {
  value: string;
}

interface CountRow {
  n: number;
}

interface SnapshotRow {
  category_id: string;
  contender_key: string;
  contender_title: string;
  nom_pct: number;
  win_pct: number;
  snapped_at: string;
}

// ── Zod schemas ──────────────────────────────────────────────────────────────

const profileIdSchema = z
  .string()
  .min(1, "Profile ID is required")
  .max(100, "Profile ID too long")
  .regex(/^[a-z0-9_-]+$/, "Profile ID must contain only lowercase letters, numbers, hyphens, or underscores");

const forecastPayloadSchema = z.record(z.string(), z.unknown());

const renameBodySchema = z.object({
  newId: profileIdSchema,
});

const passphraseBodySchema = z.object({
  passphrase: z.string().min(8, "Passphrase must be at least 8 characters").max(128),
});

const loginBodySchema = z.object({
  passphrase: z.string().min(1, "Passphrase is required"),
});

const tmdbPosterQuerySchema = z.object({
  title: z.string().min(1, "title is required").max(200, "title too long"),
});

function parseBody<T>(schema: z.ZodSchema<T>, body: unknown, res: Response): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    res.status(400).json({ error: message });
    return null;
  }
  return result.data;
}

function parseParam(schema: z.ZodSchema<string>, value: unknown, res: Response): string | null {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0]?.message ?? "Invalid parameter." });
    return null;
  }
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────

const forecastWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." }
});

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.set("trust proxy", 1);

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers["x-request-id"] as string | undefined) || randomUUID();
  const startMs = Date.now();
  res.setHeader("x-request-id", requestId);
  req.log = logger.child({ requestId, method: req.method, path: req.path });
  res.on("finish", () => {
    req.log.info({ status: res.statusCode, durationMs: Date.now() - startMs }, "request");
  });
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
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
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; worker-src 'self'; connect-src 'self' https:;"
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

// Service workers must never be served with a long-lived cache: the browser
// needs to be able to check for updates on every navigation. Serve sw.js
// before the static middleware so this header takes precedence.
app.get("/sw.js", (_: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(__dirname, "sw.js"));
});

app.use(
  express.static(__dirname, {
    maxAge: "1h",
    etag: true
  })
);

function startSourcePoller(): void {
  if (!ENABLE_SOURCE_POLLER) return;
  if (pollerProcess && !pollerProcess.killed) return;

  const args = ["scripts/poll-sources.ts", "--interval-minutes", String(SOURCE_POLL_INTERVAL_MINUTES)];
  pollerProcess = spawn(process.execPath, args, {
    cwd: __dirname,
    env: process.env,
    stdio: ["inherit", "pipe", "inherit"]
  });
  pollerState.running = true;
  pollerState.startedAt = new Date().toISOString();

  // Intercept stdout to detect completed scraper runs (the script emits one JSON
  // summary line per run that contains a `runStatus` field). Forward all bytes to
  // the server's own stdout so logs remain visible.
  pollerProcess.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    for (const line of chunk.toString().split("\n")) {
      try {
        const parsed = JSON.parse(line.trim()) as Record<string, unknown>;
        if (typeof parsed.runStatus === "string") {
          broadcastScraperEvent();
        }
      } catch {
        // Non-JSON log line — ignore
      }
    }
  });

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

function initDb(): void {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const newMigrations = runMigrations(db);
  if (newMigrations.length > 0) {
    logger.info({ migrations: newMigrations }, "db migrations applied");
  }

  // Purge expired sessions on startup.
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());

  // One-time migration from forecast-store.json when the DB is empty.
  const isEmpty = (db.prepare("SELECT COUNT(*) AS n FROM profiles").get() as CountRow).n === 0;
  if (isEmpty) {
    try {
      const raw = readFileSync(STORE_PATH, "utf8");
      const doc = JSON.parse(raw) as Record<string, unknown>;
      const profiles = (doc?.profiles as Record<string, { updatedAt?: string; payload: unknown }> | undefined) ||
        (doc?.payload != null ? { [DEFAULT_PROFILE_ID]: { updatedAt: doc.updatedAt as string | undefined || null, payload: doc.payload } } : null);
      if (profiles && typeof profiles === "object" && Object.keys(profiles).length > 0) {
        const insert = db.prepare("INSERT OR IGNORE INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)");
        db.transaction(() => {
          for (const [id, entry] of Object.entries(profiles)) {
            insert.run(id, entry.updatedAt || null, entry.payload != null ? JSON.stringify(entry.payload) : null);
          }
        })();
        const activeProfileId = (doc.activeProfileId as string | undefined) || Object.keys(profiles)[0];
        db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("active_profile_id", activeProfileId);
        logger.info("db migrated forecast-store.json → forecast.db");
      } else {
        throw new Error("no profiles in JSON store");
      }
    } catch {
      db.prepare("INSERT OR IGNORE INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(DEFAULT_PROFILE_ID, null, null);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("active_profile_id", DEFAULT_PROFILE_ID);
    }
  }
}

function requireProfileAuth(req: Request, res: Response, next: NextFunction): void {
  const profileId = req.params.profileId;
  const row = db
    .prepare("SELECT passphrase_hash FROM profiles WHERE id = ?")
    .get(profileId) as Pick<ProfileRow, "passphrase_hash"> | undefined;
  if (!row?.passphrase_hash) { next(); return; } // unprotected → allow through

  const token = (req.cookies as Record<string, string>)[SESSION_COOKIE];
  if (!token) { res.status(401).json({ error: "Authentication required." }); return; }

  const session = db
    .prepare("SELECT profile_id, expires_at FROM sessions WHERE token = ?")
    .get(token) as { profile_id: string; expires_at: string } | undefined;

  if (!session || session.profile_id !== profileId) {
    res.status(401).json({ error: "Authentication required." }); return;
  }
  if (isSessionExpired(session.expires_at)) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(401).json({ error: "Session expired." }); return;
  }
  next();
}

async function readScrapeObservability(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(SCRAPE_OBSERVABILITY_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return { updatedAt: null };
    return parsed;
  } catch {
    return { updatedAt: null };
  }
}

function normalizePosterKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

function toAbsoluteTmdbUrl(value: string): string {
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

function canonicalMovieUrlFromPath(pathname: string): string {
  const clean = String(pathname || "").trim();
  if (!clean) return "";
  const absolute = toAbsoluteTmdbUrl(clean);
  const url = new URL(absolute);
  return `${url.origin}${url.pathname}`;
}

function canonicalMovieUrlFromId(id: number): string {
  const numeric = Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return `${TMDB_BASE_URL}/movie/${numeric}`;
}

function posterUrlFromPath(pathValue: string): string {
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

function posterUrlToOriginal(url: string): string {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/\/t\/p\/w\d+\//i.test(value)) return value.replace(/\/t\/p\/w\d+\//i, "/t/p/original/");
  return value;
}

async function isHttpResourceAvailable(url: string): Promise<boolean> {
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

async function resolveValidPosterUrl(candidateUrl: string): Promise<string> {
  const primary = String(candidateUrl || "").trim();
  if (!primary) return "";
  if (await isHttpResourceAvailable(primary)) return primary;
  const original = posterUrlToOriginal(primary);
  if (original && original !== primary && (await isHttpResourceAvailable(original))) return original;
  return "";
}

function releaseYearFromDate(value: string): number | null {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-/);
  if (!match) return null;
  return Number(match[1]);
}

function isTargetReleaseYear(value: string): boolean {
  return releaseYearFromDate(value) === TMDB_RELEASE_YEAR;
}

function extractMoviePathsFromSearchHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const paths: string[] = [];
  const seen = new Set<string>();
  const selectors = [
    "section.search_results.movie .card .content h2 a[href^='/movie/']",
    ".search_results.movie .card .image_content a[href^='/movie/']",
    ".results .card .content h2 a[href^='/movie/']",
    "a.result[href^='/movie/']",
    "a[href^='/movie/']"
  ];

  const pushPath = (href: string | undefined): void => {
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

function extractPosterUrlFromMovieHtml(html: string): string {
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

function extractReleaseYearFromMovieHtml(html: string): number | null {
  const $ = cheerio.load(html);
  const ldJson = $("script[type='application/ld+json']").first().text().trim();
  if (ldJson) {
    try {
      const parsed = JSON.parse(ldJson) as Record<string, unknown>;
      const releaseDate = (parsed?.datePublished as string) || ((parsed?.releasedEvent as Record<string, string>)?.startDate) || "";
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

function tmdbApiHeaders(): Record<string, string> {
  if (TMDB_BEARER) return { Authorization: `Bearer ${TMDB_BEARER}` };
  return {};
}

async function fetchFromTmdbApi(query: string): Promise<{ posterUrl: string; movieUrl: string } | null> {
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
  const searchJson = await searchResponse.json() as { results?: Array<{ id?: number; poster_path?: string; release_date?: string }> };
  const results = Array.isArray(searchJson?.results) ? searchJson.results : [];
  const firstMovie = results.find((item) => item?.id && isTargetReleaseYear(item?.release_date || ""));
  if (!firstMovie?.id) return null;
  const posterUrl = await resolveValidPosterUrl(posterUrlFromPath(firstMovie.poster_path || ""));

  return {
    posterUrl,
    movieUrl: canonicalMovieUrlFromId(firstMovie.id)
  };
}

async function fetchFromTmdbRemoteMulti(query: string): Promise<{ posterUrl: string; movieUrl: string } | null> {
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
  const json = await response.json() as { results?: Array<{ id?: number; media_type?: string; poster_path?: string; profile_path?: string; release_date?: string }> };
  const results = Array.isArray(json?.results) ? json.results : [];
  const firstMovie = results.find((item) => {
    const isMovieLike = !item?.media_type || item.media_type === "movie";
    return isMovieLike && item?.id && isTargetReleaseYear(item?.release_date || "");
  });
  if (!firstMovie?.id) return null;
  const posterUrl = await resolveValidPosterUrl(posterUrlFromPath(firstMovie.poster_path || firstMovie.profile_path || ""));

  return {
    posterUrl,
    movieUrl: canonicalMovieUrlFromId(firstMovie.id)
  };
}

async function fetchTmdbPoster(title: string): Promise<{ posterUrl: string; movieUrl: string } | null> {
  const query = String(title || "").trim();
  if (!query) return null;

  const cacheKey = normalizePosterKey(query);
  if (posterCache.has(cacheKey)) return posterCache.get(cacheKey) ?? null;

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

app.get("/api/health", (_: Request, res: Response) => {
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

app.get("/api/metrics", (_: Request, res: Response) => {
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

app.get("/api/scrape-observability", async (_: Request, res: Response) => {
  const doc = await readScrapeObservability();
  res.json(doc);
});

app.get("/api/profiles", (_: Request, res: Response) => {
  const profiles = db
    .prepare("SELECT id, updated_at, passphrase_hash FROM profiles ORDER BY id")
    .all()
    .map((row) => {
      const r = row as { id: string; updated_at: string | null; passphrase_hash: string | null };
      return { id: r.id, updatedAt: r.updated_at || null, hasPassphrase: !!r.passphrase_hash };
    });
  const activeProfileId =
    (db.prepare("SELECT value FROM meta WHERE key = ?").get("active_profile_id") as MetaRow | undefined)?.value || DEFAULT_PROFILE_ID;
  res.json({ activeProfileId, profiles });
});

app.get("/api/forecast/:profileId", (req: Request, res: Response) => {
  const profileId = parseParam(profileIdSchema, req.params.profileId, res);
  if (profileId === null) return;
  const row = db.prepare("SELECT id, updated_at, payload FROM profiles WHERE id = ?").get(profileId) as ProfileRow | undefined;
  const profile = row
    ? { updatedAt: row.updated_at || null, payload: row.payload != null ? JSON.parse(row.payload) as unknown : null }
    : { updatedAt: null, payload: null };
  res.json({ profileId, ...profile });
});

app.put("/api/forecast/:profileId", forecastWriteLimiter, requireProfileAuth, (req: Request, res: Response) => {
  const profileId = parseParam(profileIdSchema, req.params.profileId, res);
  if (profileId === null) return;
  const payload = parseBody(forecastPayloadSchema, req.body, res);
  if (payload === null) return;
  const updatedAt = new Date().toISOString();
  db.prepare("INSERT OR REPLACE INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
    profileId,
    updatedAt,
    JSON.stringify(payload)
  );
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("active_profile_id", profileId);

  // Extract trendHistory.snapshots from the payload and upsert one row per contender
  // per calendar day. Overwrites same-day rows so the latest values are preserved.
  const rawSnapshots: unknown[] = Array.isArray((payload as any).trendHistory?.snapshots)
    ? (payload as any).trendHistory.snapshots
    : [];
  if (rawSnapshots.length > 0) {
    const upsertSnap = db.prepare(`
      INSERT INTO snapshots
        (profile_id, category_id, contender_key, contender_title, nom_pct, win_pct, snapped_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, category_id, contender_key, snapped_at) DO UPDATE SET
        contender_title = excluded.contender_title,
        nom_pct         = excluded.nom_pct,
        win_pct         = excluded.win_pct
    `);
    db.transaction(() => {
      for (const rawSnap of rawSnapshots) {
        if (!rawSnap || typeof rawSnap !== "object") continue;
        const snap = rawSnap as Record<string, unknown>;
        const categoryId = typeof snap.categoryId === "string" ? snap.categoryId : null;
        const capturedAt = typeof snap.capturedAt === "string" ? snap.capturedAt : null;
        const entries = Array.isArray(snap.entries) ? snap.entries : [];
        if (!categoryId || !capturedAt) continue;
        const snappedAt = capturedAt.slice(0, 10);
        for (const rawEntry of entries) {
          if (!rawEntry || typeof rawEntry !== "object") continue;
          const entry = rawEntry as Record<string, unknown>;
          const key = typeof entry.key === "string" ? entry.key : null;
          const title = typeof entry.title === "string" ? entry.title : "";
          const nomination = typeof entry.nomination === "number" ? entry.nomination : 0;
          const winner = typeof entry.winner === "number" ? entry.winner : 0;
          if (!key) continue;
          upsertSnap.run(profileId, categoryId, key, title, nomination, winner, snappedAt);
        }
      }
    })();
  }

  res.json({ profileId, updatedAt, payload });
});

app.delete("/api/forecast/:profileId", requireProfileAuth, (req: Request, res: Response) => {
  const profileId = parseParam(profileIdSchema, req.params.profileId, res);
  if (profileId === null) return;
  if (!db.prepare("SELECT id FROM profiles WHERE id = ?").get(profileId)) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  const remaining = db.prepare("SELECT id FROM profiles WHERE id != ?").all(profileId) as Array<{ id: string }>;
  if (remaining.length === 0) {
    res.status(400).json({ error: "Cannot delete the last profile." });
    return;
  }

  db.transaction(() => {
    db.prepare("DELETE FROM snapshots WHERE profile_id = ?").run(profileId);
    db.prepare("DELETE FROM sessions WHERE profile_id = ?").run(profileId);
    db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
    const activeRow = db.prepare("SELECT value FROM meta WHERE key = ?").get("active_profile_id") as MetaRow | undefined;
    if (!activeRow?.value || activeRow.value === profileId) {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("active_profile_id", remaining[0].id);
    }
  })();

  const activeProfileId =
    (db.prepare("SELECT value FROM meta WHERE key = ?").get("active_profile_id") as MetaRow | undefined)?.value || remaining[0].id;
  res.json({ deleted: profileId, activeProfileId });
});

app.patch("/api/forecast/:profileId/rename", requireProfileAuth, (req: Request, res: Response) => {
  const oldId = parseParam(profileIdSchema, req.params.profileId, res);
  if (oldId === null) return;
  const body = parseBody(renameBodySchema, req.body, res);
  if (body === null) return;
  const newId = body.newId;

  const existing = db.prepare("SELECT id, updated_at, payload, passphrase_hash FROM profiles WHERE id = ?").get(oldId) as ProfileRow | undefined;
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
    db.prepare("UPDATE snapshots SET profile_id = ? WHERE profile_id = ?").run(newId, oldId);
    db.prepare("INSERT INTO profiles (id, updated_at, payload, passphrase_hash) VALUES (?, ?, ?, ?)").run(
      newId,
      existing.updated_at,
      existing.payload,
      existing.passphrase_hash ?? null
    );
    db.prepare("DELETE FROM profiles WHERE id = ?").run(oldId);
    db.prepare("UPDATE sessions SET profile_id = ? WHERE profile_id = ?").run(newId, oldId);
    const activeRow = db.prepare("SELECT value FROM meta WHERE key = ?").get("active_profile_id") as MetaRow | undefined;
    if (activeRow?.value === oldId) {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("active_profile_id", newId);
    }
  })();

  res.json({ profileId: newId });
});

app.get("/api/forecast/:profileId/history", (req: Request, res: Response) => {
  const profileId = parseParam(profileIdSchema, req.params.profileId, res);
  if (profileId === null) return;

  const rows = db.prepare(
    `SELECT category_id, contender_key, contender_title, nom_pct, win_pct, snapped_at
     FROM snapshots
     WHERE profile_id = ?
     ORDER BY snapped_at ASC, category_id ASC`
  ).all(profileId) as SnapshotRow[];

  // Group flat rows into one snapshot object per (snapped_at × category_id).
  const snapshotMap = new Map<string, {
    categoryId: string;
    snappedAt: string;
    entries: Array<{ key: string; title: string; nomPct: number; winPct: number }>;
  }>();

  for (const row of rows) {
    const mapKey = `${row.snapped_at}::${row.category_id}`;
    if (!snapshotMap.has(mapKey)) {
      snapshotMap.set(mapKey, { categoryId: row.category_id, snappedAt: row.snapped_at, entries: [] });
    }
    snapshotMap.get(mapKey)!.entries.push({
      key: row.contender_key,
      title: row.contender_title,
      nomPct: row.nom_pct,
      winPct: row.win_pct,
    });
  }

  res.json({ profileId, snapshots: Array.from(snapshotMap.values()) });
});

app.get("/api/tmdb-poster", async (req: Request, res: Response) => {
  const query = parseBody(tmdbPosterQuerySchema, req.query, res);
  if (query === null) return;
  const title = query.title;

  try {
    const result = await fetchTmdbPoster(title);
    res.json({ title, result });
  } catch (error) {
    res.status(502).json({ error: String((error as Error)?.message || error) });
  }
});

app.get("/api/profiles/:profileId/auth-status", (req: Request, res: Response) => {
  const profileId = parseParam(profileIdSchema, req.params.profileId, res);
  if (profileId === null) return;

  const row = db
    .prepare("SELECT passphrase_hash FROM profiles WHERE id = ?")
    .get(profileId) as Pick<ProfileRow, "passphrase_hash"> | undefined;

  if (!row) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  const hasPassphrase = !!row.passphrase_hash;
  let authenticated = false;

  if (hasPassphrase) {
    const token = (req.cookies as Record<string, string>)[SESSION_COOKIE];
    if (token) {
      const session = db
        .prepare("SELECT profile_id, expires_at FROM sessions WHERE token = ?")
        .get(token) as { profile_id: string; expires_at: string } | undefined;
      if (session && session.profile_id === profileId && !isSessionExpired(session.expires_at)) {
        authenticated = true;
      }
    }
  }

  res.json({ profileId, hasPassphrase, authenticated });
});

app.post("/api/profiles/:profileId/login", authLimiter, async (req: Request, res: Response) => {
  const profileId = parseParam(profileIdSchema, req.params.profileId, res);
  if (profileId === null) return;

  const body = parseBody(loginBodySchema, req.body, res);
  if (body === null) return;

  const row = db
    .prepare("SELECT passphrase_hash FROM profiles WHERE id = ?")
    .get(profileId) as Pick<ProfileRow, "passphrase_hash"> | undefined;

  if (!row) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  if (!row.passphrase_hash) {
    res.status(400).json({ error: "Profile is not password protected." });
    return;
  }

  const valid = await verifyPassphrase(body.passphrase, row.passphrase_hash);
  if (!valid) {
    res.status(401).json({ error: "Incorrect passphrase." });
    return;
  }

  const token = generateSessionToken();
  const expiresAt = sessionExpiresAt();
  db.prepare("INSERT INTO sessions (token, profile_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, profileId, new Date().toISOString(), expiresAt.toISOString());

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: FORCE_HTTPS,
    path: "/",
    expires: expiresAt,
  });

  res.json({ ok: true });
});

app.post("/api/profiles/:profileId/logout", (req: Request, res: Response) => {
  const profileId = parseParam(profileIdSchema, req.params.profileId, res);
  if (profileId === null) return;

  const token = (req.cookies as Record<string, string>)[SESSION_COOKIE];
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token = ? AND profile_id = ?").run(token, profileId);
  }

  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.post("/api/profiles/:profileId/passphrase", authLimiter, requireProfileAuth, async (req: Request, res: Response) => {
  const profileId = parseParam(profileIdSchema, req.params.profileId, res);
  if (profileId === null) return;

  const body = parseBody(passphraseBodySchema, req.body, res);
  if (body === null) return;

  const row = db.prepare("SELECT id FROM profiles WHERE id = ?").get(profileId) as { id: string } | undefined;
  if (!row) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  const hash = await hashPassphrase(body.passphrase);
  db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(hash, profileId);
  db.prepare("DELETE FROM sessions WHERE profile_id = ?").run(profileId);
  res.clearCookie(SESSION_COOKIE, { path: "/" });

  res.json({ ok: true });
});

app.delete("/api/profiles/:profileId/passphrase", requireProfileAuth, (req: Request, res: Response) => {
  const profileId = parseParam(profileIdSchema, req.params.profileId, res);
  if (profileId === null) return;

  const row = db
    .prepare("SELECT passphrase_hash FROM profiles WHERE id = ?")
    .get(profileId) as Pick<ProfileRow, "passphrase_hash"> | undefined;

  if (!row) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  if (!row.passphrase_hash) {
    res.status(400).json({ error: "Profile does not have a passphrase." });
    return;
  }

  db.prepare("UPDATE profiles SET passphrase_hash = NULL WHERE id = ?").run(profileId);
  db.prepare("DELETE FROM sessions WHERE profile_id = ?").run(profileId);
  res.clearCookie(SESSION_COOKIE, { path: "/" });

  res.json({ ok: true });
});

app.get("/api/backtest", (_req: Request, res: Response) => {
  res.json(getBacktestResult());
});

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get("/api/scraper-events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(": connected\n\n");
  scraperEventClients.add(res);

  // Send a keepalive comment every 30 s to prevent proxy/load-balancer timeouts
  const keepalive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      clearInterval(keepalive);
    }
  }, 30_000);

  req.on("close", () => {
    clearInterval(keepalive);
    scraperEventClients.delete(res);
  });
});

app.get("*", (_: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

initDb();

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "server listening");
  startSourcePoller();
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  if (pollerProcess && !pollerProcess.killed) pollerProcess.kill("SIGTERM");
  server.close(() => {
    if (db?.open) db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
