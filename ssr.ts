/**
 * ssr.ts — Server-side rendering helpers for the initial page response.
 *
 * The app is a client-side SPA, but serving pre-rendered leaderboard HTML means
 * the page has meaningful content before app.js parses and executes.  This
 * improves perceived performance (content visible immediately) and gives crawlers
 * real data without executing JavaScript.
 *
 * Streaming model
 * ───────────────
 * The root GET "/" handler uses res.write() to push the HTML in two chunks:
 *
 *   1. <head> + body up to the leaderboard <tbody> open tag
 *      → browser sees <link rel="stylesheet">, <script src="app.js"> immediately
 *        and can start loading those assets in parallel.
 *
 *   2. The server reads the active profile from SQLite, scores all contenders
 *      (fast: pure synchronous math on a small dataset), and writes the
 *      pre-rendered leaderboard rows.
 *
 *   3. </tbody> + rest of body, res.end().
 *
 * Hydration
 * ─────────
 * app.js calls renderLeaderboard() on mount and overwrites the SSR content with
 * the fully-interactive version (including per-film ExperienceConfig boosts and
 * the user's in-session weight adjustments).  The SSR rows are marked with
 * data-ssr="true" so the client can optionally detect the initial state.
 *
 * SSR vs client delta
 * ───────────────────
 * The server calls scoreFilm() without an ExperienceConfig (the prior-wins and
 * overdue-narrative config lives in app.ts, not in the DB payload).  The numbers
 * differ by at most the experience-boost range (±8 %).  That's acceptable for an
 * initial preview; the client corrects them on hydration.
 */

import { readFileSync } from "node:fs";
import { clamp } from "./forecast-utils.js";
import { scoreFilm } from "./scoring-utils.js";
import { calculateNominationOdds, calculateWinnerOdds, rebalanceCategory } from "./app-logic.js";
import type { Film, NormalizedWeights } from "./types.js";
import type Database from "better-sqlite3";

// ── Category metadata ─────────────────────────────────────────────────────────
// Mirrors the categories array in app.ts.  nominees and winnerBase are needed to
// compute projection odds; the film arrays come from the saved profile payload.

interface CategoryMeta {
  id: string;
  nominees: number;
  winnerBase: number;
}

const CATEGORY_META: CategoryMeta[] = [
  { id: "picture",               nominees: 10, winnerBase: 0.16 },
  { id: "director",              nominees: 5,  winnerBase: 0.24 },
  { id: "actor",                 nominees: 5,  winnerBase: 0.25 },
  { id: "actress",               nominees: 5,  winnerBase: 0.24 },
  { id: "supporting-actor",      nominees: 5,  winnerBase: 0.23 },
  { id: "supporting-actress",    nominees: 5,  winnerBase: 0.23 },
  { id: "original-screenplay",   nominees: 5,  winnerBase: 0.22 },
  { id: "adapted-screenplay",    nominees: 5,  winnerBase: 0.22 },
  { id: "animated-feature",      nominees: 5,  winnerBase: 0.20 },
  { id: "international-feature", nominees: 5,  winnerBase: 0.20 },
  { id: "documentary-feature",   nominees: 5,  winnerBase: 0.20 },
  { id: "documentary-short",     nominees: 5,  winnerBase: 0.18 },
  { id: "live-action-short",     nominees: 5,  winnerBase: 0.18 },
  { id: "animated-short",        nominees: 5,  winnerBase: 0.18 },
  { id: "original-score",        nominees: 5,  winnerBase: 0.21 },
  { id: "original-song",         nominees: 5,  winnerBase: 0.20 },
  { id: "sound",                 nominees: 5,  winnerBase: 0.20 },
  { id: "production-design",     nominees: 5,  winnerBase: 0.20 },
  { id: "cinematography",        nominees: 5,  winnerBase: 0.20 },
  { id: "makeup-hairstyling",    nominees: 5,  winnerBase: 0.19 },
  { id: "costume-design",        nominees: 5,  winnerBase: 0.19 },
  { id: "film-editing",          nominees: 5,  winnerBase: 0.21 },
  { id: "visual-effects",        nominees: 5,  winnerBase: 0.20 },
  { id: "casting",               nominees: 5,  winnerBase: 0.19 },
];

// For person categories, rawStudio holds the film title (the person's film).
// This mirrors renderLeaderboard() in app.ts.
const PERSON_CATEGORY_IDS = new Set([
  "director", "actor", "actress", "supporting-actor", "supporting-actress",
]);

// Must match the constants in app.ts so SSR numbers are consistent with client.
const NOMINATION_PERCENT_UPLIFT = 1.14;
const WINNER_PERCENT_UPLIFT     = 1.2;
const WINNER_TO_NOMINATION_CAP  = 0.5;

// ── HTML safety ───────────────────────────────────────────────────────────────
// Film titles come from user-controlled data stored in the DB.  All values
// interpolated into HTML must be escaped to prevent XSS in the SSR output.

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Film parsing ──────────────────────────────────────────────────────────────
// Mirrors parseFilmRecord() in app.ts.  Validates and normalises a raw object
// from the stored profile payload into a typed Film.

function parseFilm(record: unknown): Film | null {
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;

  const title  = String(r.title  ?? "").trim();
  const studio = String(r.studio ?? "").trim();
  if (!title || !studio) return null;

  const rawStrength = String(r.strength ?? "");
  const strength = (["High", "Medium", "Low"].includes(rawStrength)
    ? rawStrength
    : "Medium") as Film["strength"];

  return {
    title,
    studio,
    precursor: clamp(Number(r.precursor ?? 0), 0, 100),
    history:   clamp(Number(r.history   ?? 0), 0, 100),
    buzz:      clamp(Number(r.buzz      ?? 0), 0, 100),
    strength,
  };
}

// ── Server-side leaderboard ───────────────────────────────────────────────────

export interface LeaderboardRow {
  title:       string;
  nominations: number;
  wins:        number;
}

/**
 * Reads the active profile from the DB, runs the full scoring pipeline for
 * every category, and returns the top-10 leaderboard rows.
 *
 * Returns [] if the profile has no data yet (first boot / empty DB) so the
 * caller can render a graceful empty state.
 */
export function buildSsrLeaderboard(db: Database.Database): LeaderboardRow[] {
  // ── 1. Fetch the active profile payload ──────────────────────────────────
  const profileId = (
    db.prepare("SELECT value FROM meta WHERE key = ?")
      .get("active_profile_id") as { value: string } | undefined
  )?.value ?? "default";

  const row = db
    .prepare("SELECT payload FROM profiles WHERE id = ?")
    .get(profileId) as { payload: string | null } | undefined;

  if (!row?.payload) return [];

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    return [];
  }

  // ── 2. Normalise weights (fall back to app.ts defaults: 58 / 30 / 12) ───
  const rawW = payload.weights as Record<string, unknown> | undefined;
  const wp   = clamp(Number(rawW?.precursor ?? 58), 1, 95);
  const wh   = clamp(Number(rawW?.history   ?? 30), 1, 95);
  const wb   = clamp(Number(rawW?.buzz      ?? 12), 1, 95);
  const wSum = wp + wh + wb;
  const weights: NormalizedWeights = {
    precursor: wp / wSum,
    history:   wh / wSum,
    buzz:      wb / wSum,
  };

  // ── 3. Parse the stored category/film arrays ─────────────────────────────
  const storedCats = Array.isArray(payload.categories)
    ? (payload.categories as unknown[])
    : [];

  // ── 4. Score every category and aggregate into a film → {noms, wins} map ─
  const filmMap = new Map<string, { nominations: number; wins: number }>();

  for (const meta of CATEGORY_META) {
    const stored = storedCats.find(
      (sc) => sc && typeof sc === "object" &&
               (sc as Record<string, unknown>).id === meta.id,
    ) as Record<string, unknown> | undefined;

    if (!stored || !Array.isArray(stored.films)) continue;

    const films = (stored.films as unknown[])
      .map(parseFilm)
      .filter((f): f is Film => f !== null);

    if (!films.length) continue;

    // Score each film.  ExperienceConfig (prior wins, overdue narratives) lives
    // in app.ts and is not persisted in the DB payload.  We call scoreFilm
    // without it; the resulting numbers are within ±8 % of the client values.
    const scored = films.map((film, index) => ({
      ...film,
      ...scoreFilm(meta.id, film, weights),
      index,
    }));

    const nominationTotal = scored.reduce((s, x) => s + x.nominationRaw, 0) || 1;
    const winnerTotal     = scored.reduce((s, x) => s + x.winnerRaw, 0) || 1;
    const nomineeScale    = meta.nominees / Math.max(1, scored.length);

    // Map raw scores → calibrated odds, then sort by winner% descending.
    // This matches the buildProjections() sort order in app.ts.
    const projections = scored.map((film) => {
      const nomination = calculateNominationOdds({
        nominationRaw:   film.nominationRaw,
        nominationTotal,
        nomineeScale,
        uplift: NOMINATION_PERCENT_UPLIFT,
        min: 0.6,
        max: 99,
      });
      const winner = calculateWinnerOdds({
        winnerRaw:  film.winnerRaw,
        winnerTotal,
        nomination,
        winnerBase: meta.winnerBase,
        uplift: WINNER_PERCENT_UPLIFT,
        min: 0.4,
        max: 92,
      });
      return { rawTitle: film.title, rawStudio: film.studio, nomination, winner };
    }).sort((a, b) => b.winner - a.winner);

    const displayLimit  = meta.id === "picture" ? 10 : 5;
    const topContenders = projections.slice(0, displayLimit);

    // Apply the same rebalance pass that buildProjections() uses so totals stay
    // within the expected nomination/winner band.
    rebalanceCategory(topContenders, {
      winnerToNominationCap: WINNER_TO_NOMINATION_CAP,
      nominationBand: { minTotal: 90, maxTotal: 95, targetTotal: 93, minValue: 0.6, maxValue: 50 },
      winnerBand:     { minTotal: 30, maxTotal: 45, targetTotal: 38, minValue: 0.4, maxValue: 24 },
    });

    // Accumulate into the film-level leaderboard.
    // Person categories (actor, director, …) use rawStudio (the film title) as
    // the key — same logic as renderLeaderboard() in app.ts.
    topContenders.forEach((entry, rank) => {
      const filmKey = PERSON_CATEGORY_IDS.has(meta.id)
        ? entry.rawStudio
        : entry.rawTitle;
      if (!filmKey) return;

      const existing = filmMap.get(filmKey) ?? { nominations: 0, wins: 0 };
      filmMap.set(filmKey, {
        nominations: existing.nominations + 1,
        wins:        existing.wins + (rank === 0 ? 1 : 0),
      });
    });
  }

  return Array.from(filmMap.entries())
    .map(([title, data]) => ({ title, ...data }))
    .sort((a, b) => b.nominations - a.nominations || b.wins - a.wins)
    .slice(0, 10);
}

// ── HTML splitting ────────────────────────────────────────────────────────────
// Split index.html at the leaderboard <tbody> so we can inject SSR rows between
// the open and close tags without touching the rest of the markup.

const LEADERBOARD_TBODY_OPEN  = '<tbody id="leaderboardBody">';
const LEADERBOARD_TBODY_CLOSE = "</tbody>";
const LEADERBOARD_SPLIT_TOKEN = LEADERBOARD_TBODY_OPEN + LEADERBOARD_TBODY_CLOSE;

// data-ssr attribute lets app.ts detect and cleanly replace the initial content.
const LEADERBOARD_TBODY_SSR = '<tbody id="leaderboardBody" data-ssr="true">';

export interface SplitHtml {
  /** Everything up to and including the open <tbody data-ssr="true"> tag. */
  before: string;
  /** </tbody> and the remainder of the document. */
  after:  string;
}

/**
 * Reads index.html and splits it at the leaderboard tbody split point.
 * Called once at startup and the result is cached.
 */
export function splitIndexHtml(indexPath: string): SplitHtml {
  const html = readFileSync(indexPath, "utf8");
  const idx  = html.indexOf(LEADERBOARD_SPLIT_TOKEN);

  if (idx === -1) {
    // index.html doesn't contain the expected marker (markup changed).
    // Return the full document in "before" so the route always responds.
    return { before: html, after: "" };
  }

  return {
    before: html.slice(0, idx) + LEADERBOARD_TBODY_SSR,
    after:  LEADERBOARD_TBODY_CLOSE + html.slice(idx + LEADERBOARD_SPLIT_TOKEN.length),
  };
}

// ── Row rendering ─────────────────────────────────────────────────────────────

/**
 * Renders leaderboard rows as an HTML string.
 * All user-controlled values are HTML-escaped to prevent XSS.
 */
export function renderLeaderboardRows(rows: LeaderboardRow[]): string {
  if (rows.length === 0) {
    return `<tr><td class="results-empty" colspan="3">No contenders loaded yet.</td></tr>`;
  }

  return rows.map(({ title, nominations, wins }, index) => {
    const rank      = index + 1;
    const safeName  = escHtml(title);
    const nomLabel  = nominations !== 1 ? "nominations" : "nomination";
    const winLabel  = wins        !== 1 ? "wins"        : "win";
    return (
      `<tr class="leaderboard-row" ` +
        `aria-label="${rank}. ${safeName}: ${nominations} ${nomLabel}, ${wins} ${winLabel}">` +
        `<td class="leaderboard-film">` +
          `<span class="leaderboard-rank">${rank}</span>` +
          `<span class="leaderboard-title">${safeName}</span>` +
        `</td>` +
        `<td class="leaderboard-num">${nominations}</td>` +
        `<td class="leaderboard-num">${wins}</td>` +
      `</tr>`
    );
  }).join("\n");
}
