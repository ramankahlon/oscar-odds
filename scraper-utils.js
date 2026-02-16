import * as cheerio from "cheerio";

export function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

export function titleCaseWords(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function dedupeByNormalized(items, keySelector) {
  const map = new Map();
  items.forEach((item) => {
    const key = normalizeTitle(keySelector(item));
    if (!key || map.has(key)) return;
    map.set(key, item);
  });
  return [...map.values()];
}

export function extractLetterboxd(html) {
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

export function extractTitleLikePhrases(text) {
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

export function extractTheGamer(html) {
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

export function extractReddit(data) {
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

export function buildAggregate(letterboxdItems, redditMentions, thegamerItems) {
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
