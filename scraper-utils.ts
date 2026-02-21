import * as cheerio from "cheerio";

interface CanonicalResult {
  title: string;
  confidence: number;
  method: string;
}

interface ScoreItem {
  title: string;
  rank: number;
  score: number;
}

interface RedditPost {
  title: string;
  score: number;
  comments: number;
  createdUtc: number;
  permalink: string;
}

interface Mention {
  title: string;
  count: number;
  weightedScore: number;
}

interface AggregateItem {
  title: string;
  letterboxdScore: number;
  thegamerScore: number;
  redditCount: number;
  redditScore: number;
  combinedScore: number;
}

const BANNED_EXACT_PHRASES = new Set([
  "best picture",
  "best actor",
  "best actress",
  "best director",
  "academy awards",
  "oscar predictions",
  "oscars 2027",
  "top contenders",
  "prediction chatter"
]);

const BANNED_TOKENS = new Set([
  "oscars",
  "oscar",
  "academy",
  "awards",
  "predictions",
  "prediction",
  "contenders",
  "category",
  "categories",
  "reddit",
  "thread"
]);

const BANNED_PATTERN_MATCHERS = [
  /\boscars?\s+\d{4}\s+predictions?\b/i,
  /\b(best|academy)\s+(picture|actor|actress|director|supporting)\b/i
];

const KNOWN_ENTITY_ALIASES = new Map<string, string>([
  ["odyssey", "The Odyssey"],
  ["the odyssey", "The Odyssey"],
  ["christopher nolan s the odyssey", "The Odyssey"],
  ["christopher nolans the odyssey", "The Odyssey"],
  ["nolan odyssey", "The Odyssey"],
  ["dune part three", "Dune: Part Three"],
  ["dune 3", "Dune: Part Three"],
  ["the dish", "The Dish"],
  ["spielberg the dish", "The Dish"],
  ["project hail mary", "Project Hail Mary"],
  ["the social reckoning", "The Social Reckoning"],
  ["michael", "Michael"],
  ["the bride", "The Bride!"],
  ["the bride!", "The Bride!"],
  ["narnia", "Narnia"],
  ["sense and sensibility", "Sense and Sensibility"],
  ["wuthering heights", "Wuthering Heights"],
  ["the dog stars", "The Dog Stars"],
  ["judy", "Judy"],
  ["moana live action", "Moana Live-Action"],
  ["moana", "Moana Live-Action"]
]);

const KNOWN_ENTITIES = [...new Set(KNOWN_ENTITY_ALIASES.values())];

export function normalizeTitle(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

function aliasLookupKey(value: string): string {
  return normalizeTitle(value).replace(/'/g, "");
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeTitle(value).split(/\s+/).filter(Boolean));
}

function jaccardSimilarity(aValue: string, bValue: string): number {
  const a = tokenSet(aValue);
  const b = tokenSet(bValue);
  if (!a.size || !b.size) return 0;

  let intersection = 0;
  a.forEach((token) => {
    if (b.has(token)) intersection += 1;
  });
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function titleCaseWords(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function dedupeByNormalized<T>(items: T[], keySelector: (item: T) => string): T[] {
  const map = new Map<string, T>();
  items.forEach((item) => {
    const key = normalizeTitle(keySelector(item));
    if (!key || map.has(key)) return;
    map.set(key, item);
  });
  return [...map.values()];
}

export function isValidEntityCandidate(rawValue: unknown): boolean {
  const text = String(rawValue || "").trim();
  if (!text) return false;
  if (text.length < 3 || text.length > 80) return false;

  const normalized = normalizeTitle(text);
  if (!normalized) return false;
  if (BANNED_EXACT_PHRASES.has(normalized)) return false;
  if (BANNED_PATTERN_MATCHERS.some((pattern) => pattern.test(text))) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.every((token) => BANNED_TOKENS.has(token))) return false;
  const bannedTokenCount = tokens.reduce((count, token) => count + (BANNED_TOKENS.has(token) ? 1 : 0), 0);
  if (tokens.length >= 2 && bannedTokenCount / tokens.length >= 0.6) return false;

  const alphaCount = (text.match(/[A-Za-z]/g) || []).length;
  if (alphaCount < 3) return false;

  if (/^(the|a|an)\s+$/.test(normalized)) return false;
  if (/^[0-9\s:.-]+$/.test(text)) return false;

  return true;
}

export function canonicalizeEntity(rawValue: string, options: { knownEntities?: string[] } = {}): CanonicalResult {
  const normalized = normalizeTitle(rawValue);
  if (!normalized || !isValidEntityCandidate(rawValue)) {
    return { title: "", confidence: 0, method: "rejected" };
  }

  const normalizedAliasKey = aliasLookupKey(normalized);
  const directAlias = KNOWN_ENTITY_ALIASES.get(normalized) || KNOWN_ENTITY_ALIASES.get(normalizedAliasKey);
  if (directAlias) {
    return { title: directAlias, confidence: 1, method: "alias" };
  }

  const knownEntities = Array.isArray(options.knownEntities) && options.knownEntities.length ? options.knownEntities : KNOWN_ENTITIES;
  let best: CanonicalResult = { title: titleCaseWords(rawValue), confidence: 0, method: "raw" };

  knownEntities.forEach((entity) => {
    const similarity = jaccardSimilarity(normalized, entity);
    if (similarity > best.confidence) {
      best = { title: entity, confidence: similarity, method: "fuzzy" };
    }
  });

  if (best.confidence >= 0.8) return best;
  return { title: titleCaseWords(rawValue), confidence: 0.4, method: "raw" };
}

export function extractLetterboxd(html: string): ScoreItem[] {
  const $ = cheerio.load(html);
  const candidates: string[] = [];

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
    title: canonicalizeEntity(item.title).title || item.title,
    rank: index + 1,
    score: Number(((total - index) / total).toFixed(4))
  }));
}

export function extractTitleLikePhrases(text: string): string[] {
  const matches: string[] = [];
  const quoted = text.match(/"([^"]{2,80})"/g) || [];
  quoted.forEach((part) => {
    matches.push(part.replaceAll('"', "").trim());
  });

  const titleCasePattern = /\b([A-Z][a-z0-9'!:-]+(?:\s+[A-Z][a-z0-9'!:-]+){1,7})\b/g;
  for (const match of text.matchAll(titleCasePattern)) {
    const phrase = match[1].trim();
    if (phrase.length < 4) continue;
    if (/\b(Best|Oscar|Oscars|Academy|Awards|Prediction|Predictions|Category)\b/.test(phrase)) continue;
    if (isValidEntityCandidate(phrase)) matches.push(phrase);
  }

  return dedupeByNormalized(matches.map((value) => ({ value })), (item) => item.value)
    .map((item) => item.value)
    .slice(0, 60);
}

export function extractTheGamer(html: string): ScoreItem[] {
  const $ = cheerio.load(html);
  const lines: string[] = [];

  $("main li, article li, main h2, main h3, article h2, article h3, article p").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    lines.push(text);
  });

  const titleCounts = new Map<string, { title: string; score: number }>();
  lines.forEach((line, index) => {
    const weight = Math.max(1, 6 - Math.floor(index / 10));
    extractTitleLikePhrases(line).forEach((title) => {
      const canonical = canonicalizeEntity(title);
      if (!canonical.title) return;
      const key = normalizeTitle(canonical.title);
      if (!key) return;
      const entry = titleCounts.get(key) || { title: canonical.title, score: 0 };
      entry.score += weight;
      titleCounts.set(key, entry);
    });
  });

  return [...titleCounts.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map((item, index) => ({ title: item.title, rank: index + 1, score: item.score }));
}

export function recencyMultiplier(createdUtc: number | null | undefined, nowMs = Date.now()): number {
  if (!createdUtc || !Number.isFinite(createdUtc)) return 1;
  const ageDays = (nowMs - createdUtc * 1000) / (1000 * 60 * 60 * 24);
  if (ageDays <= 3) return 2.0;
  if (ageDays <= 7) return 1.0;
  if (ageDays <= 30) return 0.5;
  return 0.25;
}

export function extractReddit(data: unknown, nowMs = Date.now()): { posts: RedditPost[]; mentions: Mention[] } {
  const dataObj = data as { data?: { children?: Array<{ data?: Record<string, unknown> }> } };
  const children = dataObj?.data?.children || [];
  const posts: RedditPost[] = children
    .map((child) => child?.data)
    .filter(Boolean)
    .map((post) => ({
      title: String(post!.title || "").trim(),
      score: Number(post!.score || 0),
      comments: Number(post!.num_comments || 0),
      createdUtc: Number(post!.created_utc || 0),
      permalink: post!.permalink ? `https://reddit.com${post!.permalink}` : ""
    }))
    .filter((post) => post.title.length > 0);

  const mentionMap = new Map<string, Mention>();
  posts.forEach((post) => {
    extractTitleLikePhrases(post.title).forEach((title) => {
      const canonical = canonicalizeEntity(title);
      if (!canonical.title) return;
      const key = normalizeTitle(canonical.title);
      if (!key) return;
      const entry = mentionMap.get(key) || { title: canonical.title, count: 0, weightedScore: 0 };
      const decay = recencyMultiplier(post.createdUtc, nowMs);
      entry.count += decay;
      entry.weightedScore += (post.score + post.comments) * decay;
      mentionMap.set(key, entry);
    });
  });

  const mentions = [...mentionMap.values()]
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, 40);

  return { posts: posts.slice(0, 50), mentions };
}

export function buildAggregate(
  letterboxdItems: ScoreItem[],
  redditMentions: Mention[],
  thegamerItems: ScoreItem[]
): AggregateItem[] {
  const aggregate = new Map<string, AggregateItem>();

  letterboxdItems.forEach((item) => {
    const canonical = canonicalizeEntity(item.title);
    if (!canonical.title) return;
    const key = normalizeTitle(canonical.title);
    if (!key) return;
    aggregate.set(key, {
      title: canonical.title,
      letterboxdScore: item.score,
      thegamerScore: 0,
      redditCount: 0,
      redditScore: 0,
      combinedScore: 0
    });
  });

  thegamerItems.forEach((item, index) => {
    const canonical = canonicalizeEntity(item.title);
    if (!canonical.title) return;
    const key = normalizeTitle(canonical.title);
    if (!key) return;
    const current =
      aggregate.get(key) || {
        title: canonical.title,
        letterboxdScore: 0,
        thegamerScore: 0,
        redditCount: 0,
        redditScore: 0,
        combinedScore: 0
      };
    current.thegamerScore = Math.max(current.thegamerScore, Math.max(0, (30 - index) / 30));
    aggregate.set(key, current);
  });

  const maxReddit = Math.max(...redditMentions.map((item) => item.count), 1);
  redditMentions.forEach((item) => {
    const canonical = canonicalizeEntity(item.title);
    if (!canonical.title) return;
    const key = normalizeTitle(canonical.title);
    if (!key) return;
    const current =
      aggregate.get(key) || {
        title: canonical.title,
        letterboxdScore: 0,
        thegamerScore: 0,
        redditCount: 0,
        redditScore: 0,
        combinedScore: 0
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
