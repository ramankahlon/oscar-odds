import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildAggregate, extractLetterboxd, extractReddit, extractTheGamer } from "../scraper-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(PROJECT_ROOT, "data", "source-signals.json");
const OBSERVABILITY_PATH = path.join(PROJECT_ROOT, "data", "scrape-observability.json");

const SOURCE_URLS = {
  letterboxd: "https://letterboxd.com/000_leo/list/oscars-2027/",
  reddit: "https://www.reddit.com/r/oscarrace/hot.json?limit=75",
  thegamer: "https://www.thegamer.com/oscars-predictions-2026-2027/"
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REDDIT_USER_AGENT = "web:oscar-odds-bot:1.0.0 (scraper for open Oscar forecast project)";
const RETRY_COUNT = 2;
const RETRY_BACKOFF_MS = 750;

interface SourceMetrics {
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  consecutiveFailures: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastDurationMs: number | null;
  averageDurationMs: number | null;
  lastError: string | null;
}

interface RecentRun {
  at: string;
  status: string | null;
  durationMs: number;
  sources: Record<string, { ok: boolean; attempts: number; durationMs: number; error: string | null }>;
}

interface Observability {
  updatedAt: string | null;
  runsTotal: number;
  runsFailed: number;
  runSuccessRate: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunDurationMs: number | null;
  sources: Record<string, SourceMetrics>;
  recentRuns: RecentRun[];
}

interface RetryResult<T> {
  ok: boolean;
  value: T | null;
  attempts: number;
  error: string | null;
}

function parseArgs(): { once: boolean; intervalMinutes: number } {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const intervalFlagIndex = args.indexOf("--interval-minutes");
  const intervalMinutes = intervalFlagIndex >= 0 ? Number(args[intervalFlagIndex + 1]) : 30;
  return {
    once,
    intervalMinutes: Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 30
  };
}


async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.8"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status}`);
  }

  return response.text();
}

async function fetchRedditJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "user-agent": REDDIT_USER_AGENT,
      "accept": "application/json",
      "accept-language": "en-US,en;q=0.8"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status}`);
  }

  return response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function defaultSourceMetrics(): SourceMetrics {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    successRate: 0,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastDurationMs: null,
    averageDurationMs: null,
    lastError: null
  };
}

function defaultObservability(): Observability {
  return {
    updatedAt: null,
    runsTotal: 0,
    runsFailed: 0,
    runSuccessRate: 0,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunDurationMs: null,
    sources: {
      letterboxd: defaultSourceMetrics(),
      reddit: defaultSourceMetrics(),
      thegamer: defaultSourceMetrics()
    },
    recentRuns: []
  };
}

async function readObservability(): Promise<Observability> {
  try {
    const raw = await fs.readFile(OBSERVABILITY_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Observability>;
    if (!parsed || typeof parsed !== "object") return defaultObservability();
    return {
      ...defaultObservability(),
      ...parsed,
      sources: {
        letterboxd: { ...defaultSourceMetrics(), ...(parsed.sources?.letterboxd || {}) },
        reddit: { ...defaultSourceMetrics(), ...(parsed.sources?.reddit || {}) },
        thegamer: { ...defaultSourceMetrics(), ...(parsed.sources?.thegamer || {}) }
      },
      recentRuns: Array.isArray(parsed.recentRuns) ? parsed.recentRuns : []
    };
  } catch {
    return defaultObservability();
  }
}

async function writeObservability(observability: Observability): Promise<void> {
  await fs.writeFile(OBSERVABILITY_PATH, `${JSON.stringify(observability, null, 2)}\n`, "utf8");
}

async function withRetry<T>(task: () => Promise<T>, options: { retries?: number; backoffMs?: number } = {}): Promise<RetryResult<T>> {
  const retries = Number.isFinite(options.retries) ? (options.retries as number) : RETRY_COUNT;
  const backoffMs = Number.isFinite(options.backoffMs) ? (options.backoffMs as number) : RETRY_BACKOFF_MS;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const value = await task();
      return { ok: true, value, attempts: attempt, error: null };
    } catch (error) {
      lastError = error;
      if (attempt <= retries) {
        await sleep(backoffMs * attempt);
      }
    }
  }

  return {
    ok: false,
    value: null,
    attempts: retries + 1,
    error: String((lastError as Error)?.message || lastError)
  };
}

function updateSourceMetrics(
  observability: Observability,
  sourceId: string,
  attemptAt: string,
  durationMs: number,
  retryResult: RetryResult<unknown>
): void {
  const metrics = observability.sources[sourceId] || defaultSourceMetrics();
  metrics.attempts += 1;
  metrics.lastAttemptAt = attemptAt;
  metrics.lastDurationMs = durationMs;
  metrics.averageDurationMs =
    metrics.averageDurationMs == null
      ? durationMs
      : Number(((metrics.averageDurationMs * (metrics.attempts - 1) + durationMs) / metrics.attempts).toFixed(2));

  if (retryResult.ok) {
    metrics.successes += 1;
    metrics.consecutiveFailures = 0;
    metrics.lastSuccessAt = attemptAt;
    metrics.lastError = null;
  } else {
    metrics.failures += 1;
    metrics.consecutiveFailures += 1;
    metrics.lastFailureAt = attemptAt;
    metrics.lastError = retryResult.error;
  }

  metrics.successRate = Number((metrics.successes / Math.max(1, metrics.successes + metrics.failures)).toFixed(4));
  observability.sources[sourceId] = metrics;
}

function freshnessMinutes(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Number(((toMs - fromMs) / 60000).toFixed(2));
}


async function writeSnapshot(snapshot: unknown): Promise<void> {
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

async function runOnce(): Promise<void> {
  const runStartedAt = new Date();
  const generatedAt = new Date().toISOString();
  const observability = await readObservability();

  const sourceTasks: Record<string, () => Promise<unknown>> = {
    letterboxd: async () => extractLetterboxd(await fetchText(SOURCE_URLS.letterboxd)),
    reddit: async () => extractReddit(await fetchRedditJson(SOURCE_URLS.reddit)),
    thegamer: async () => extractTheGamer(await fetchText(SOURCE_URLS.thegamer))
  };

  const sourceRuns = await Promise.all(
    Object.entries(sourceTasks).map(async ([sourceId, task]) => {
      const sourceAttemptAt = new Date().toISOString();
      const started = Date.now();
      const retryResult = await withRetry(task, { retries: RETRY_COUNT, backoffMs: RETRY_BACKOFF_MS });
      const durationMs = Date.now() - started;
      updateSourceMetrics(observability, sourceId, sourceAttemptAt, durationMs, retryResult);
      return { sourceId, ...retryResult, durationMs };
    })
  );

  const letterboxdRun = sourceRuns.find((item) => item.sourceId === "letterboxd");
  const redditRun = sourceRuns.find((item) => item.sourceId === "reddit");
  const thegamerRun = sourceRuns.find((item) => item.sourceId === "thegamer");

  const letterboxdItems = letterboxdRun?.ok ? (letterboxdRun.value as ReturnType<typeof extractLetterboxd>) : [];
  const redditExtracted = redditRun?.ok ? (redditRun.value as ReturnType<typeof extractReddit>) : { posts: [], mentions: [] };
  const thegamerItems = thegamerRun?.ok ? (thegamerRun.value as ReturnType<typeof extractTheGamer>) : [];

  const runFailed = sourceRuns.some((item) => !item.ok);
  const runDurationMs = Date.now() - runStartedAt.getTime();
  observability.runsTotal += 1;
  if (runFailed) observability.runsFailed += 1;
  observability.runSuccessRate = Number(((observability.runsTotal - observability.runsFailed) / Math.max(1, observability.runsTotal)).toFixed(4));
  observability.lastRunAt = generatedAt;
  observability.lastRunStatus = runFailed ? "partial_failure" : "success";
  observability.lastRunDurationMs = runDurationMs;

  const snapshot = {
    generatedAt,
    sources: {
      letterboxd: {
        url: SOURCE_URLS.letterboxd,
        ok: Boolean(letterboxdRun?.ok),
        attempts: letterboxdRun?.attempts || 0,
        durationMs: letterboxdRun?.durationMs || null,
        error: letterboxdRun?.ok ? null : letterboxdRun?.error || "Unknown error",
        lastSuccessAt: observability.sources.letterboxd.lastSuccessAt,
        freshnessMinutes: freshnessMinutes(observability.sources.letterboxd.lastSuccessAt, generatedAt),
        items: letterboxdItems
      },
      reddit: {
        url: "https://reddit.com/r/oscarrace/",
        ok: Boolean(redditRun?.ok),
        attempts: redditRun?.attempts || 0,
        durationMs: redditRun?.durationMs || null,
        error: redditRun?.ok ? null : redditRun?.error || "Unknown error",
        lastSuccessAt: observability.sources.reddit.lastSuccessAt,
        freshnessMinutes: freshnessMinutes(observability.sources.reddit.lastSuccessAt, generatedAt),
        posts: redditExtracted.posts,
        mentions: redditExtracted.mentions
      },
      thegamer: {
        url: SOURCE_URLS.thegamer,
        ok: Boolean(thegamerRun?.ok),
        attempts: thegamerRun?.attempts || 0,
        durationMs: thegamerRun?.durationMs || null,
        error: thegamerRun?.ok ? null : thegamerRun?.error || "Unknown error",
        lastSuccessAt: observability.sources.thegamer.lastSuccessAt,
        freshnessMinutes: freshnessMinutes(observability.sources.thegamer.lastSuccessAt, generatedAt),
        items: thegamerItems
      }
    },
    aggregate: buildAggregate(letterboxdItems, redditExtracted.mentions, thegamerItems),
    observability: {
      runStatus: observability.lastRunStatus,
      runDurationMs,
      runSuccessRate: observability.runSuccessRate,
      sourceSuccessRates: {
        letterboxd: observability.sources.letterboxd.successRate,
        reddit: observability.sources.reddit.successRate,
        thegamer: observability.sources.thegamer.successRate
      }
    }
  };

  await writeSnapshot(snapshot);
  observability.updatedAt = generatedAt;
  observability.recentRuns = [
    {
      at: generatedAt,
      status: observability.lastRunStatus,
      durationMs: runDurationMs,
      sources: Object.fromEntries(
        sourceRuns.map((item) => [
          item.sourceId,
          { ok: item.ok, attempts: item.attempts, durationMs: item.durationMs, error: item.ok ? null : item.error }
        ])
      )
    },
    ...observability.recentRuns
  ].slice(0, 50);
  await writeObservability(observability);

  const summary = {
    generatedAt,
    runStatus: observability.lastRunStatus,
    runDurationMs,
    runSuccessRate: observability.runSuccessRate,
    letterboxd: {
      ok: snapshot.sources.letterboxd.ok,
      attempts: snapshot.sources.letterboxd.attempts,
      successRate: observability.sources.letterboxd.successRate,
      freshnessMinutes: snapshot.sources.letterboxd.freshnessMinutes,
      items: letterboxdItems.length
    },
    reddit: {
      ok: snapshot.sources.reddit.ok,
      attempts: snapshot.sources.reddit.attempts,
      successRate: observability.sources.reddit.successRate,
      freshnessMinutes: snapshot.sources.reddit.freshnessMinutes,
      posts: redditExtracted.posts.length,
      mentions: redditExtracted.mentions.length
    },
    thegamer: {
      ok: snapshot.sources.thegamer.ok,
      attempts: snapshot.sources.thegamer.attempts,
      successRate: observability.sources.thegamer.successRate,
      freshnessMinutes: snapshot.sources.thegamer.freshnessMinutes,
      items: thegamerItems.length
    },
    aggregate: snapshot.aggregate.length
  };
  console.log(JSON.stringify(summary));
}

async function main(): Promise<void> {
  const { once, intervalMinutes } = parseArgs();
  await runOnce();

  if (once) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(async () => {
    try {
      await runOnce();
    } catch (error) {
      console.error(`[poll-sources] ${new Date().toISOString()} ${(error as Error)?.message || error}`);
    }
  }, intervalMs);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
