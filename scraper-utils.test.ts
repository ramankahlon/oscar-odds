import { describe, expect, it } from "vitest";
import {
  buildAggregate,
  canonicalizeEntity,
  extractLetterboxd,
  extractNextBestPicture,
  extractReddit,
  extractTheGamer,
  isValidEntityCandidate,
  recencyMultiplier
} from "./scraper-utils.js";

describe("extractLetterboxd", () => {
  it("extracts ranked movie titles from list markup", () => {
    const html = `
      <ul>
        <li class="poster-container"><img alt="The Odyssey" /></li>
        <li class="poster-container"><img alt="Dune: Part Three" /></li>
        <li class="poster-container"><div class="film-detail-content"><h2>The Odyssey</h2></div></li>
      </ul>
    `;

    const items = extractLetterboxd(html);
    expect(items.length).toBe(2);
    expect(items[0].title).toBe("The Odyssey");
    expect(items[0].rank).toBe(1);
  });
});

describe("recencyMultiplier", () => {
  const nowMs = Date.now();
  const daysAgo = (d: number) => Math.floor((nowMs - d * 24 * 60 * 60 * 1000) / 1000);

  it("returns 2.0 for posts within 3 days", () => {
    expect(recencyMultiplier(daysAgo(1), nowMs)).toBe(2.0);
  });

  it("returns 1.0 for posts between 3 and 7 days old", () => {
    expect(recencyMultiplier(daysAgo(5), nowMs)).toBe(1.0);
  });

  it("returns 0.5 for posts between 7 and 30 days old", () => {
    expect(recencyMultiplier(daysAgo(14), nowMs)).toBe(0.5);
  });

  it("returns 0.25 for posts older than 30 days", () => {
    expect(recencyMultiplier(daysAgo(45), nowMs)).toBe(0.25);
  });

  it("returns 1 for missing or zero timestamp", () => {
    expect(recencyMultiplier(0, nowMs)).toBe(1);
    expect(recencyMultiplier(null, nowMs)).toBe(1);
  });
});

describe("extractReddit", () => {
  it("extracts posts and mention counts", () => {
    const data = {
      data: {
        children: [
          { data: { title: "2027 Best Picture: The Odyssey vs Dune Part Three", score: 21, num_comments: 9, permalink: "/r/oscarrace/x" } },
          { data: { title: "Mikey Madison in The Social Reckoning", score: 17, num_comments: 4, permalink: "/r/oscarrace/y" } }
        ]
      }
    };

    const extracted = extractReddit(data);
    expect(extracted.posts.length).toBe(2);
    expect(extracted.mentions.length).toBeGreaterThan(0);
  });

  it("weights recent posts higher than old posts", () => {
    const nowMs = Date.now();
    const recentUtc = Math.floor((nowMs - 1 * 24 * 60 * 60 * 1000) / 1000);  // 1 day ago → 2.0×
    const oldUtc = Math.floor((nowMs - 45 * 24 * 60 * 60 * 1000) / 1000);    // 45 days ago → 0.25×

    const data = {
      data: {
        children: [
          { data: { title: "The Odyssey gets buzz", score: 10, num_comments: 5, created_utc: recentUtc, permalink: "/r/oscarrace/a" } },
          { data: { title: "Dune Part Three discussion", score: 10, num_comments: 5, created_utc: oldUtc, permalink: "/r/oscarrace/b" } }
        ]
      }
    };

    const extracted = extractReddit(data, nowMs);
    const odyssey = extracted.mentions.find((m) => m.title.toLowerCase().includes("odyssey"));
    const dune = extracted.mentions.find((m) => m.title.toLowerCase().includes("dune"));

    if (odyssey && dune) {
      expect(odyssey.weightedScore).toBeGreaterThan(dune.weightedScore);
    }
  });
});

describe("extractNextBestPicture", () => {
  it("ranks films by how many critics picked them in the predictions table", () => {
    // 3 critics all pick The Odyssey; only 1 picks Dune — Odyssey should rank first.
    const html = `
      <table class="predictions-choice-table">
        <thead><tr><th>Critic</th><th>Best Picture</th></tr></thead>
        <tbody>
          <tr><td>Critic A</td><td>The Odyssey</td></tr>
          <tr><td>Critic B</td><td>The Odyssey</td></tr>
          <tr><td>Critic C</td><td>The Odyssey</td></tr>
          <tr><td>Critic D</td><td>Dune: Part Three</td></tr>
        </tbody>
      </table>
    `;

    const items = extractNextBestPicture(html);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].title).toBe("The Odyssey");
    expect(items[0].rank).toBe(1);
    const dune = items.find((i) => i.title.includes("Dune"));
    expect(dune).toBeTruthy();
    expect(dune!.rank).toBeGreaterThan(1);
  });

  it("falls back to article text extraction when table is absent", () => {
    const html = `
      <main>
        <h2>Best Picture Contenders 2027</h2>
        <p>The Odyssey is the frontrunner with strong precursor support.</p>
        <p>Wild Horse Nine has been gaining momentum.</p>
      </main>
    `;

    const items = extractNextBestPicture(html);
    expect(items.length).toBeGreaterThan(0);
    const odyssey = items.find((i) => i.title.toLowerCase().includes("odyssey"));
    expect(odyssey).toBeTruthy();
  });

  it("assigns score=1.0 to the top-ranked film", () => {
    const html = `
      <table class="predictions-choice-table">
        <tbody>
          <tr><td>The Odyssey</td></tr>
          <tr><td>The Odyssey</td></tr>
          <tr><td>Wild Horse Nine</td></tr>
        </tbody>
      </table>
    `;

    const items = extractNextBestPicture(html);
    expect(items[0].score).toBe(1.0);
  });

  it("includes nextbestpictureScore in the aggregate combined score", () => {
    const nbpItems = [
      { title: "The Odyssey", rank: 1, score: 1.0 },
      { title: "Wild Horse Nine", rank: 2, score: 0.5 }
    ];

    const aggregate = buildAggregate([], [], [], [], [], nbpItems);
    const odyssey = aggregate.find((a) => a.title.toLowerCase().includes("odyssey"));
    expect(odyssey).toBeTruthy();
    expect(odyssey!.nextbestpictureScore).toBeGreaterThan(0);
    expect(odyssey!.combinedScore).toBeGreaterThan(0);
  });
});

describe("extractTheGamer + buildAggregate", () => {
  it("parses contender-like names and builds aggregate scores", () => {
    const html = `
      <main>
        <h2>Top Contenders</h2>
        <li>The Odyssey looks strongest.</li>
        <li>Dune: Part Three is close behind.</li>
        <p>Prediction chatter around Michael is growing.</p>
      </main>
    `;

    const tg = extractTheGamer(html);
    expect(tg.length).toBeGreaterThan(0);

    const aggregate = buildAggregate(
      [
        { title: "The Odyssey", rank: 1, score: 0.9 },
        { title: "Dune: Part Three", rank: 2, score: 0.8 }
      ],
      [
        { title: "The Odyssey", count: 4, weightedScore: 4 },
        { title: "Michael", count: 3, weightedScore: 3 }
      ],
      tg
    );

    const odyssey = aggregate.find((item) => item.title.toLowerCase().includes("odyssey"));
    expect(odyssey).toBeTruthy();
    expect(odyssey!.combinedScore).toBeGreaterThan(0);
  });
});

describe("data quality validation + matching", () => {
  it("rejects noisy non-entity phrases", () => {
    expect(isValidEntityCandidate("Oscars 2027 Predictions")).toBe(false);
    expect(isValidEntityCandidate("Best Picture")).toBe(false);
    expect(isValidEntityCandidate("12345")).toBe(false);
  });

  it("canonicalizes aliases and fuzzy variants", () => {
    const alias = canonicalizeEntity("Christopher Nolan's The Odyssey");
    expect(alias.title).toBe("The Odyssey");

    const fuzzy = canonicalizeEntity("Dune Part Three");
    expect(fuzzy.title).toBe("Dune: Part Three");
  });
});
