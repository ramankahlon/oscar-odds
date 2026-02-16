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

const USER_AGENT = "oscar-odds-bot/1.0 (+local-dev)";
const RETRY_COUNT = 2;
const RETRY_BACKOFF_MS = 750;

function parseArgs() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const intervalFlagIndex = args.indexOf("--interval-minutes");
  const intervalMinutes = intervalFlagIndex >= 0 ? Number(args[intervalFlagIndex + 1]) : 30;
  return {
    once,
    intervalMinutes: Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 30
  };
}


async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      "accept-language": "en-US,en;q=0.8"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status}`);
  }

  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function defaultSourceMetrics() {
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

function defaultObservability() {
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

async function readObservability() {
  try {
    const raw = await fs.readFile(OBSERVABILITY_PATH, "utf8");
    const parsed = JSON.parse(raw);
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

async function writeObservability(observability) {
  await fs.writeFile(OBSERVABILITY_PATH, `${JSON.stringify(observability, null, 2)}\n`, "utf8");
}

async function withRetry(task, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : RETRY_COUNT;
  const backoffMs = Number.isFinite(options.backoffMs) ? options.backoffMs : RETRY_BACKOFF_MS;
  let lastError = null;
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
    error: String(lastError?.message || lastError)
  };
}

function updateSourceMetrics(observability, sourceId, attemptAt, durationMs, retryResult) {
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

function freshnessMinutes(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Number(((toMs - fromMs) / 60000).toFixed(2));
}


async function writeSnapshot(snapshot) {
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

async function runOnce() {
  const runStartedAt = new Date();
  const generatedAt = new Date().toISOString();
  const observability = await readObservability();

  const sourceTasks = {
    letterboxd: async () => extractLetterboxd(await fetchText(SOURCE_URLS.letterboxd)),
    reddit: async () => extractReddit(await fetchJson(SOURCE_URLS.reddit)),
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

  const letterboxdItems = letterboxdRun?.ok ? letterboxdRun.value : [];
  const redditExtracted = redditRun?.ok ? redditRun.value : { posts: [], mentions: [] };
  const thegamerItems = thegamerRun?.ok ? thegamerRun.value : [];

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
      items: snapshot.sources.letterboxd.items.length
    },
    reddit: {
      ok: snapshot.sources.reddit.ok,
      attempts: snapshot.sources.reddit.attempts,
      successRate: observability.sources.reddit.successRate,
      freshnessMinutes: snapshot.sources.reddit.freshnessMinutes,
      posts: snapshot.sources.reddit.posts.length,
      mentions: snapshot.sources.reddit.mentions.length
    },
    thegamer: {
      ok: snapshot.sources.thegamer.ok,
      attempts: snapshot.sources.thegamer.attempts,
      successRate: observability.sources.thegamer.successRate,
      freshnessMinutes: snapshot.sources.thegamer.freshnessMinutes,
      items: snapshot.sources.thegamer.items.length
    },
    aggregate: snapshot.aggregate.length
  };
  console.log(JSON.stringify(summary));
}

async function main() {
  const { once, intervalMinutes } = parseArgs();
  await runOnce();

  if (once) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(async () => {
    try {
      await runOnce();
    } catch (error) {
      console.error(`[poll-sources] ${new Date().toISOString()} ${error?.message || error}`);
    }
  }, intervalMs);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
