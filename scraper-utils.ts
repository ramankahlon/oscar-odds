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

/** One Gold Derby category page's worth of ranked results. */
export interface GoldDerbyCategoryItem {
  categoryId: string;
  items: ScoreItem[];
}

interface AggregateItem {
  title: string;
  letterboxdScore: number;
  /** Max Gold Derby score across all categories this entity appears in. */
  goldderbyScore: number;
  /** Per-category Gold Derby score, keyed by the app's category ID. */
  goldderbyByCategory: Record<string, number>;
  nextbestpictureScore: number;
  awardsdailyScore: number;
  thegamerScore: number;
  indiewireScore: number;
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
  ["the dish", "Disclosure Day"],
  ["spielberg the dish", "Disclosure Day"],
  ["disclosure day", "Disclosure Day"],
  ["project hail mary", "Project Hail Mary"],
  ["the social reckoning", "The Social Reckoning"],
  ["michael", "Michael"],
  ["wild horse nine", "Wild Horse Nine"],
  ["fjord", "Fjord"],
  ["digger", "Digger"],
  ["all of a sudden", "All of a Sudden"],
  ["josephine", "Josephine"],
  ["disclosure day", "Disclosure Day"],
  ["jack of spades", "Jack of Spades"],
  ["dune messiah", "Dune: Part Three"],
  ["dune part three", "Dune: Part Three"],
  ["narnia", "Narnia"],
  ["sense and sensibility", "Sense and Sensibility"],
  ["wuthering heights", "Wuthering Heights"],
  ["the dog stars", "The Dog Stars"],
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

/**
 * Extract ranked contenders from a Gold Derby odds page.
 *
 * Gold Derby lists contenders in ranked order inside elements with classes like
 * `.contestant-name`, `.contender-name`, or plain `td` cells in an odds table.
 * If fewer than 5 structured hits are found the function falls back to the same
 * title-phrase extraction used by extractTheGamer so the source degrades
 * gracefully if the page layout changes.
 */
export function extractGoldDerby(html: string): ScoreItem[] {
  const $ = cheerio.load(html);
  const candidates: string[] = [];

  // Structured selectors Gold Derby has used for their odds tables.
  const structured = $(
    ".contestant-name, .contender-name, .name-text, .contestant .name, " +
    ".odds-table td:first-child, .odds-row td:first-child, " +
    "[class*='contestant'] [class*='name'], [class*='contender'] [class*='name']"
  );
  structured.each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text && isValidEntityCandidate(text)) candidates.push(text);
  });

  // Fall back to general article text extraction if structured parse found too few.
  if (candidates.length < 5) {
    $("h2, h3, li, td").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!text) return;
      extractTitleLikePhrases(text).forEach((phrase) => {
        if (isValidEntityCandidate(phrase)) candidates.push(phrase);
      });
    });
  }

  const unique = dedupeByNormalized(candidates.map((title) => ({ title })), (item) => item.title);
  const total = Math.max(unique.length, 1);
  return unique.slice(0, 30).map((item, index) => ({
    title: canonicalizeEntity(item.title).title || item.title,
    rank: index + 1,
    score: Number(((total - index) / total).toFixed(4))
  }));
}

/**
 * Extract predicted contenders from an IndieWire awards predictions article.
 *
 * IndieWire's predictions use standard article markup (h2/h3 headings per
 * category, <p> paragraphs, <li> bullet points) — the same selectors used by
 * extractTheGamer.  Keeping this as a distinct export means IndieWire's scrape
 * health is tracked independently.
 */
export function extractIndieWire(html: string): ScoreItem[] {
  const $ = cheerio.load(html);
  const lines: string[] = [];

  $("main li, article li, main h2, main h3, article h2, article h3, article p, .entry-content p, .article-content p").each((_, el) => {
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

/**
 * Extract ranked contenders from a Next Best Picture predictions page.
 *
 * nextbestpicture.com uses a FooTable (table.predictions-choice-table) where
 * each row is a critic/predictor and each cell is their pick for that category.
 * Counting cell-value occurrences gives a consensus rank ordering: a film that
 * 20 critics pick ranks ahead of one only 3 critics pick.
 *
 * If the table is absent or too sparse (< 5 distinct titles found) the function
 * falls back to article-level text extraction, matching the TheGamer approach.
 */
export function extractNextBestPicture(html: string): ScoreItem[] {
  const $ = cheerio.load(html);
  const tally = new Map<string, { title: string; count: number }>();

  function recordTitle(raw: string): void {
    if (!isValidEntityCandidate(raw)) return;
    const canonical = canonicalizeEntity(raw);
    if (!canonical.title) return;
    const key = normalizeTitle(canonical.title);
    if (!key) return;
    const entry = tally.get(key) || { title: canonical.title, count: 0 };
    entry.count += 1;
    tally.set(key, entry);
  }

  // Primary: FooTable predictions-choice-table.
  // Selector covers both the named class and any footable-prefixed ID.
  const table = $("table.predictions-choice-table, table[id^='footable']").first();
  if (table.length) {
    table.find("tbody tr").each((_, row) => {
      $(row).find("td").each((_, cell) => {
        const text = $(cell).text().replace(/\s+/g, " ").trim();
        if (text) recordTitle(text);
      });
    });
  }

  // Fallback: article-style text extraction when the table is absent or sparse.
  if (tally.size < 5) {
    $("main li, article li, main h2, main h3, article h2, article h3, main p, article p, .entry-content p").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!text) return;
      extractTitleLikePhrases(text).forEach((phrase) => recordTitle(phrase));
    });
  }

  // Sort by consensus count descending; convert to normalised [0, 1] score.
  const sorted = [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 30);
  const total = Math.max(sorted.length, 1);
  return sorted.map((item, index) => ({
    title: item.title,
    rank: index + 1,
    score: Number(((total - index) / total).toFixed(4))
  }));
}

/**
 * Extract ranked Best Picture contenders from the Awards Daily homepage.
 *
 * The homepage embeds a structured prediction widget:
 *   ul.oscar-prediction-list
 *     li.oscar-prediction-item
 *       div.oscar-nominee-name   ← film title, sometimes with "(Studio)" suffix
 *       div.oscar-percentage     ← e.g. "94.5%"
 *
 * Unlike rank-only sources this extractor uses the explicit percentage as the
 * score (÷ 100), giving finer differentiation between adjacent contenders.
 * Falls back to article-level text extraction if the widget is absent.
 */
export function extractAwardsDaily(html: string): ScoreItem[] {
  const $ = cheerio.load(html);
  const items: Array<{ title: string; score: number }> = [];

  $("li.oscar-prediction-item").each((_, el) => {
    // Strip studio name in parentheses: "Hamnet (Focus Features)" → "Hamnet"
    const rawName = $(el).find(".oscar-nominee-name").text()
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const pctText = $(el).find(".oscar-percentage").text().trim();
    const pct = parseFloat(pctText);

    if (!rawName || !isValidEntityCandidate(rawName)) return;
    const canonical = canonicalizeEntity(rawName);
    if (!canonical.title) return;

    // Use the explicit percentage as the score; fall back to rank-order if missing.
    const score = Number.isFinite(pct) && pct > 0 ? Math.min(pct / 100, 1) : 0;
    items.push({ title: canonical.title, score });
  });

  // Fallback: article text extraction when the widget is absent.
  if (items.length < 5) {
    const tally = new Map<string, { title: string; score: number }>();
    $("main li, article li, main h2, main h3, article h2, article h3, main p, article p, .entry-content p").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!text) return;
      extractTitleLikePhrases(text).forEach((phrase) => {
        if (!isValidEntityCandidate(phrase)) return;
        const canonical = canonicalizeEntity(phrase);
        if (!canonical.title) return;
        const key = normalizeTitle(canonical.title);
        if (!key) return;
        const entry = tally.get(key) || { title: canonical.title, score: 0 };
        entry.score += 1;
        tally.set(key, entry);
      });
    });
    tally.forEach((entry) => items.push(entry));
  }

  items.sort((a, b) => b.score - a.score);
  const topScore = items[0]?.score || 1;
  return items.slice(0, 30).map((item, index) => ({
    title: item.title,
    rank: index + 1,
    // Normalise so the top item is always 1.0 (consistent with other extractors).
    score: Number((item.score / topScore).toFixed(4))
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
  thegamerItems: ScoreItem[],
  goldderbyCategories: GoldDerbyCategoryItem[] = [],
  indiewireItems: ScoreItem[] = [],
  nextbestpictureItems: ScoreItem[] = [],
  awardsdailyItems: ScoreItem[] = []
): AggregateItem[] {
  const aggregate = new Map<string, AggregateItem>();

  function getOrCreate(title: string): AggregateItem | null {
    const canonical = canonicalizeEntity(title);
    if (!canonical.title) return null;
    const key = normalizeTitle(canonical.title);
    if (!key) return null;
    if (!aggregate.has(key)) {
      aggregate.set(key, {
        title: canonical.title,
        letterboxdScore: 0,
        goldderbyScore: 0,
        goldderbyByCategory: {},
        nextbestpictureScore: 0,
        awardsdailyScore: 0,
        thegamerScore: 0,
        indiewireScore: 0,
        redditCount: 0,
        redditScore: 0,
        combinedScore: 0
      });
    }
    return aggregate.get(key)!;
  }

  letterboxdItems.forEach((item) => {
    const entry = getOrCreate(item.title);
    if (entry) entry.letterboxdScore = item.score;
  });

  // Process each Gold Derby category page, storing both a global max score
  // (used in combinedScore) and a per-category score for applySourceSignals.
  // item.score is already rank-calibrated by extractGoldDerby, so use it
  // directly (consistent with letterboxd and awardsdaily handling).
  goldderbyCategories.forEach(({ categoryId, items }) => {
    items.forEach((item) => {
      const entry = getOrCreate(item.title);
      if (!entry) return;
      entry.goldderbyScore = Math.max(entry.goldderbyScore, item.score);
      entry.goldderbyByCategory[categoryId] = Math.max(
        entry.goldderbyByCategory[categoryId] ?? 0,
        item.score
      );
    });
  });

  nextbestpictureItems.forEach((item, index) => {
    const entry = getOrCreate(item.title);
    if (entry) entry.nextbestpictureScore = Math.max(entry.nextbestpictureScore, Math.max(0, (30 - index) / 30));
  });

  // awardsdailyItems already carry a normalised [0,1] score derived from the
  // explicit prediction percentage on the Awards Daily homepage widget.
  awardsdailyItems.forEach((item) => {
    const entry = getOrCreate(item.title);
    if (entry) entry.awardsdailyScore = Math.max(entry.awardsdailyScore, item.score);
  });

  thegamerItems.forEach((item, index) => {
    const entry = getOrCreate(item.title);
    if (entry) entry.thegamerScore = Math.max(entry.thegamerScore, Math.max(0, (30 - index) / 30));
  });

  indiewireItems.forEach((item, index) => {
    const entry = getOrCreate(item.title);
    if (entry) entry.indiewireScore = Math.max(entry.indiewireScore, Math.max(0, (30 - index) / 30));
  });

  const maxReddit = Math.max(...redditMentions.map((item) => item.count), 1);
  redditMentions.forEach((item) => {
    const entry = getOrCreate(item.title);
    if (!entry) return;
    entry.redditCount = item.count;
    entry.redditScore = item.count / maxReddit;
  });

  // Combined score weights (must sum to 1.0):
  //   Gold Derby       0.22 — explicit ranked odds, most authoritative aggregator
  //   NextBestPicture  0.18 — critic consensus count from dedicated Oscar site
  //   Letterboxd       0.18 — curated ranked list (strong precursor signal)
  //   Awards Daily     0.14 — explicit prediction percentages, editorial authority
  //   IndieWire        0.10 — editorial predictions coverage
  //   TheGamer         0.10 — general predictions article coverage
  //   Reddit           0.08 — community discussion / social buzz
  return [...aggregate.values()]
    .map((item) => ({
      ...item,
      combinedScore: Number((
        item.goldderbyScore        * 0.22 +
        item.nextbestpictureScore  * 0.18 +
        item.letterboxdScore       * 0.18 +
        item.awardsdailyScore      * 0.14 +
        item.indiewireScore        * 0.10 +
        item.thegamerScore         * 0.10 +
        item.redditScore           * 0.08
      ).toFixed(4))
    }))
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, 80);
}
