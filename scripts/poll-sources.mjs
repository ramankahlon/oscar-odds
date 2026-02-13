import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

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

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

function titleCaseWords(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
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

function dedupeByNormalized(items, keySelector) {
  const map = new Map();
  items.forEach((item) => {
    const key = normalizeTitle(keySelector(item));
    if (!key || map.has(key)) return;
    map.set(key, item);
  });
  return [...map.values()];
}

function extractLetterboxd(html) {
  const $ = cheerio.load(html);
  const candidates = [];

  $("li.poster-container img[alt]").each((_, el) => {
    const title = ($(el).attr("alt") || "").trim();
    if (!title) return;
    candidates.push(title);
  });

  $("li.poster-container .film-detail-content h2").each((_, el) => {
    const title = $(el).text().trim();
    if (!title) return;
    candidates.push(title);
  });

  const unique = dedupeByNormalized(candidates.map((title) => ({ title })), (item) => item.title);
  const total = Math.max(unique.length, 1);

  return unique.map((item, index) => ({
    title: item.title,
    rank: index + 1,
    score: Number(((total - index) / total).toFixed(4))
  }));
}

function extractTitleLikePhrases(text) {
  const matches = [];
  const quoted = text.match(/"([^"]{2,80})"/g) || [];
  quoted.forEach((part) => {
    matches.push(part.replaceAll('"', "").trim());
  });

  const titleCasePattern = /\b([A-Z][a-z0-9'!:-]+(?:\s+[A-Z][a-z0-9'!:-]+){1,7})\b/g;
  for (const match of text.matchAll(titleCasePattern)) {
    const phrase = match[1].trim();
    if (phrase.length < 4) continue;
    if (/\b(Best|Oscar|Oscars|Academy|Awards|Prediction|Predictions|Category)\b/.test(phrase)) continue;
    matches.push(phrase);
  }

  return dedupeByNormalized(matches.map((value) => ({ value })), (item) => item.value)
    .map((item) => item.value)
    .slice(0, 60);
}

function extractTheGamer(html) {
  const $ = cheerio.load(html);
  const lines = [];

  $("main li, article li, main h2, main h3, article h2, article h3, article p").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    lines.push(text);
  });

  const titleCounts = new Map();
  lines.forEach((line, index) => {
    const weight = Math.max(1, 6 - Math.floor(index / 10));
    extractTitleLikePhrases(line).forEach((title) => {
      const key = normalizeTitle(title);
      if (!key) return;
      const entry = titleCounts.get(key) || { title: titleCaseWords(title), score: 0 };
      entry.score += weight;
      titleCounts.set(key, entry);
    });
  });

  return [...titleCounts.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map((item, index) => ({ title: item.title, rank: index + 1, score: item.score }));
}

function extractReddit(data) {
  const children = data?.data?.children || [];
  const posts = children
    .map((child) => child?.data)
    .filter(Boolean)
    .map((post) => ({
      title: String(post.title || "").trim(),
      score: Number(post.score || 0),
      comments: Number(post.num_comments || 0),
      createdUtc: Number(post.created_utc || 0),
      permalink: post.permalink ? `https://reddit.com${post.permalink}` : ""
    }))
    .filter((post) => post.title.length > 0);

  const mentionMap = new Map();
  posts.forEach((post) => {
    extractTitleLikePhrases(post.title).forEach((title) => {
      const key = normalizeTitle(title);
      if (!key) return;
      const entry = mentionMap.get(key) || { title: titleCaseWords(title), count: 0, weightedScore: 0 };
      entry.count += 1;
      entry.weightedScore += post.score + post.comments;
      mentionMap.set(key, entry);
    });
  });

  const mentions = [...mentionMap.values()]
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, 40);

  return { posts: posts.slice(0, 50), mentions };
}

function buildAggregate(letterboxdItems, redditMentions, thegamerItems) {
  const aggregate = new Map();

  letterboxdItems.forEach((item) => {
    const key = normalizeTitle(item.title);
    if (!key) return;
    aggregate.set(key, {
      title: item.title,
      letterboxdScore: item.score,
      thegamerScore: 0,
      redditCount: 0,
      redditScore: 0
    });
  });

  thegamerItems.forEach((item, index) => {
    const key = normalizeTitle(item.title);
    if (!key) return;
    const current =
      aggregate.get(key) || {
        title: item.title,
        letterboxdScore: 0,
        thegamerScore: 0,
        redditCount: 0,
        redditScore: 0
      };
    current.thegamerScore = Math.max(current.thegamerScore, Math.max(0, (30 - index) / 30));
    aggregate.set(key, current);
  });

  const maxReddit = Math.max(...redditMentions.map((item) => item.count), 1);
  redditMentions.forEach((item) => {
    const key = normalizeTitle(item.title);
    if (!key) return;
    const current =
      aggregate.get(key) || {
        title: item.title,
        letterboxdScore: 0,
        thegamerScore: 0,
        redditCount: 0,
        redditScore: 0
      };
    current.redditCount = item.count;
    current.redditScore = item.count / maxReddit;
    aggregate.set(key, current);
  });

  return [...aggregate.values()]
    .map((item) => ({
      ...item,
      combinedScore: Number((item.letterboxdScore * 0.45 + item.thegamerScore * 0.25 + item.redditScore * 0.3).toFixed(4))
    }))
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, 80);
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
