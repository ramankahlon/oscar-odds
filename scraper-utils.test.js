import { describe, expect, it } from "vitest";
import {
  buildAggregate,
  canonicalizeEntity,
  extractLetterboxd,
  extractReddit,
  extractTheGamer,
  isValidEntityCandidate
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
        { title: "The Odyssey", score: 0.9 },
        { title: "Dune: Part Three", score: 0.8 }
      ],
      [
        { title: "The Odyssey", count: 4 },
        { title: "Michael", count: 3 }
      ],
      tg
    );

    const odyssey = aggregate.find((item) => item.title.toLowerCase().includes("odyssey"));
    expect(odyssey).toBeTruthy();
    expect(odyssey.combinedScore).toBeGreaterThan(0);
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
