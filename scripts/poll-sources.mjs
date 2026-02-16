import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildAggregate, extractLetterboxd, extractReddit, extractTheGamer } from "../scraper-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(PROJECT_ROOT, "data", "source-signals.json");

const SOURCE_URLS = {
  letterboxd: "https://letterboxd.com/000_leo/list/oscars-2027/",
  reddit: "https://www.reddit.com/r/oscarrace/hot.json?limit=75",
  thegamer: "https://www.thegamer.com/oscars-predictions-2026-2027/"
};

const USER_AGENT = "oscar-odds-bot/1.0 (+local-dev)";

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


async function writeSnapshot(snapshot) {
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

async function runOnce() {
  const generatedAt = new Date().toISOString();

  const [letterboxdResult, redditResult, thegamerResult] = await Promise.allSettled([
    fetchText(SOURCE_URLS.letterboxd),
    fetchJson(SOURCE_URLS.reddit),
    fetchText(SOURCE_URLS.thegamer)
  ]);

  const letterboxdItems = letterboxdResult.status === "fulfilled" ? extractLetterboxd(letterboxdResult.value) : [];
  const redditExtracted = redditResult.status === "fulfilled" ? extractReddit(redditResult.value) : { posts: [], mentions: [] };
  const thegamerItems = thegamerResult.status === "fulfilled" ? extractTheGamer(thegamerResult.value) : [];

  const snapshot = {
    generatedAt,
    sources: {
      letterboxd: {
        url: SOURCE_URLS.letterboxd,
        ok: letterboxdResult.status === "fulfilled",
        error: letterboxdResult.status === "rejected" ? String(letterboxdResult.reason?.message || letterboxdResult.reason) : null,
        items: letterboxdItems
      },
      reddit: {
        url: "https://reddit.com/r/oscarrace/",
        ok: redditResult.status === "fulfilled",
        error: redditResult.status === "rejected" ? String(redditResult.reason?.message || redditResult.reason) : null,
        posts: redditExtracted.posts,
        mentions: redditExtracted.mentions
      },
      thegamer: {
        url: SOURCE_URLS.thegamer,
        ok: thegamerResult.status === "fulfilled",
        error: thegamerResult.status === "rejected" ? String(thegamerResult.reason?.message || thegamerResult.reason) : null,
        items: thegamerItems
      }
    },
    aggregate: buildAggregate(letterboxdItems, redditExtracted.mentions, thegamerItems)
  };

  await writeSnapshot(snapshot);

  const summary = {
    generatedAt,
    letterboxd: { ok: snapshot.sources.letterboxd.ok, items: snapshot.sources.letterboxd.items.length },
    reddit: { ok: snapshot.sources.reddit.ok, posts: snapshot.sources.reddit.posts.length, mentions: snapshot.sources.reddit.mentions.length },
    thegamer: { ok: snapshot.sources.thegamer.ok, items: snapshot.sources.thegamer.items.length },
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
