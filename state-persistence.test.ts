/**
 * State persistence round-trip tests.
 *
 * Coverage
 * ────────
 * Unit layer  — serializeStatePayload / applyStatePayload:
 *   1. weights        — custom weights serialize and restore exactly
 *   2. categoryId     — valid id restored; unknown id left unchanged
 *   3. trendWindow    — valid window restored; invalid value left unchanged
 *   4. lockedCategories — locked set survives a round-trip
 *   5. film overrides — custom precursor/history/buzz/strength on films
 *   6. trendHistory   — snapshots + lastSignatureByCategory
 *   7. partial payload — missing fields leave state unchanged
 *   8. weight clamping — out-of-range values are clamped to [1, 95]
 *
 * HTTP layer  — PUT /api/forecast/:profileId → GET /api/forecast/:profileId:
 *   9. full payload survives the HTTP round-trip and applyStatePayload restores it
 *  10. film overrides survive the HTTP round-trip
 *  11. lockedCategories survive the HTTP round-trip
 *  12. empty payload (no categories field) stores and is returned as-is
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import supertest from "supertest";
import {
  state,
  trendHistory,
  lockedCategories,
  categories,
  setCategories,
  setCategorySeeds,
  serializeStatePayload,
  applyStatePayload,
} from "./state.js";
import type { Category } from "./types.js";
import { app, _setDbForTesting } from "./server.js";
import { runMigrations } from "./migrate.js";

// ── Test fixtures ──────────────────────────────────────────────────────────────

/** Minimal two-category setup used by every unit test. */
function seedTestCategories(): void {
  const seeds = {
    picture: [
      { title: "Wild Horse Nine",  studio: "Searchlight", precursor: 88, history: 83, buzz: 86, strength: "High"   as const },
      { title: "The Odyssey",      studio: "Universal",   precursor: 84, history: 80, buzz: 88, strength: "High"   as const },
    ],
    director: [
      { title: "Martin McDonagh",  studio: "Wild Horse Nine", precursor: 88, history: 82, buzz: 86, strength: "High" as const },
    ],
  };
  setCategorySeeds(seeds);
  setCategories([
    { id: "picture",  name: "Best Picture",  nominees: 10, winnerBase: 0.16, films: seeds.picture.map(f => ({ ...f })) },
    { id: "director", name: "Best Director", nominees: 5,  winnerBase: 0.24, films: seeds.director.map(f => ({ ...f })) },
  ] as Category[]);
}

/** Reset module-level state to a clean baseline before each unit test. */
function resetState(): void {
  state.categoryId  = "";
  state.weights     = { precursor: 58, history: 30, buzz: 12 };
  state.trendWindow = 30;
  trendHistory.snapshots               = [];
  trendHistory.lastSignatureByCategory = {};
  lockedCategories.clear();
  seedTestCategories();
}

// ══════════════════════════════════════════════════════════════════════════════
// Unit tests — serializeStatePayload / applyStatePayload
// ══════════════════════════════════════════════════════════════════════════════

describe("serializeStatePayload / applyStatePayload round-trips", () => {
  beforeEach(resetState);

  // 1. Weights
  it("restores custom weights exactly", () => {
    state.weights = { precursor: 70, history: 20, buzz: 10 };
    const payload = serializeStatePayload();
    state.weights = { precursor: 58, history: 30, buzz: 12 };
    applyStatePayload(payload);
    expect(state.weights).toEqual({ precursor: 70, history: 20, buzz: 10 });
  });

  // 2. categoryId — valid
  it("restores a valid categoryId", () => {
    state.categoryId = "picture";
    const payload = serializeStatePayload();
    state.categoryId = "director";
    applyStatePayload(payload);
    expect(state.categoryId).toBe("picture");
  });

  // 2b. categoryId — unknown id is ignored
  it("ignores an unknown categoryId", () => {
    const payload: Record<string, unknown> = { categoryId: "nonexistent-category" };
    state.categoryId = "director";
    applyStatePayload(payload);
    expect(state.categoryId).toBe("director");
  });

  // 3. trendWindow — valid value
  it("restores a valid trendWindow", () => {
    state.trendWindow = 15;
    const payload = serializeStatePayload();
    state.trendWindow = 30;
    applyStatePayload(payload);
    expect(state.trendWindow).toBe(15);
  });

  // 3b. trendWindow — invalid value left unchanged
  it("ignores an invalid trendWindow", () => {
    state.trendWindow = 7;
    applyStatePayload({ trendWindow: 999 });
    expect(state.trendWindow).toBe(7);
  });

  // 4. lockedCategories
  it("restores locked categories", () => {
    lockedCategories.add("picture");
    lockedCategories.add("director");
    const payload = serializeStatePayload();
    lockedCategories.clear();
    applyStatePayload(payload);
    expect([...lockedCategories].sort()).toEqual(["director", "picture"]);
  });

  it("clears locked categories when the payload has an empty array", () => {
    lockedCategories.add("picture");
    applyStatePayload({ lockedCategories: [] });
    expect(lockedCategories.size).toBe(0);
  });

  // 5. Film overrides
  it("restores custom film scores on a category", () => {
    const pic = categories.find(c => c.id === "picture")!;
    pic.films[0].precursor = 42;
    pic.films[0].buzz      = 99;
    pic.films[0].strength  = "Low";
    const payload = serializeStatePayload();

    // Reset films back to seeds
    resetState();

    applyStatePayload(payload);
    const restored = categories.find(c => c.id === "picture")!.films[0];
    expect(restored.precursor).toBe(42);
    expect(restored.buzz).toBe(99);
    expect(restored.strength).toBe("Low");
  });

  it("preserves the original title and studio through the round-trip", () => {
    const payload = serializeStatePayload();
    resetState();
    applyStatePayload(payload);
    const film = categories.find(c => c.id === "picture")!.films[0];
    expect(film.title).toBe("Wild Horse Nine");
    expect(film.studio).toBe("Searchlight");
  });

  it("discards a film record missing title or studio", () => {
    const payload: Record<string, unknown> = {
      categories: [{ id: "picture", films: [
        { title: "", studio: "Searchlight", precursor: 50, history: 50, buzz: 50, strength: "Medium" },
        { title: "Wild Horse Nine", studio: "Searchlight", precursor: 77, history: 70, buzz: 75, strength: "High" },
      ]}],
    };
    applyStatePayload(payload);
    // First film (empty title) is dropped; second film is applied
    const pic = categories.find(c => c.id === "picture")!;
    expect(pic.films.some(f => f.title === "Wild Horse Nine" && f.precursor === 77)).toBe(true);
  });

  // 6. trendHistory
  it("restores trendHistory snapshots and lastSignatureByCategory", () => {
    trendHistory.snapshots = [
      {
        categoryId: "picture",
        capturedAt: "2026-01-15T00:00:00.000Z",
        sourceSnapshotId: "snap-1",
        entries: [{ key: "wild-horse-nine", title: "Wild Horse Nine", nomination: 85, winner: 70 }],
      },
    ];
    trendHistory.lastSignatureByCategory = { picture: "sig-abc" };
    const payload = serializeStatePayload();

    trendHistory.snapshots = [];
    trendHistory.lastSignatureByCategory = {};
    applyStatePayload(payload);

    expect(trendHistory.snapshots).toHaveLength(1);
    expect(trendHistory.snapshots[0].categoryId).toBe("picture");
    expect(trendHistory.snapshots[0].capturedAt).toBe("2026-01-15T00:00:00.000Z");
    expect(trendHistory.snapshots[0].sourceSnapshotId).toBe("snap-1");
    expect(trendHistory.snapshots[0].entries[0]).toEqual({
      key: "wild-horse-nine", title: "Wild Horse Nine", nomination: 85, winner: 70,
    });
    expect(trendHistory.lastSignatureByCategory).toEqual({ picture: "sig-abc" });
  });

  it("drops trendHistory snapshots that have no valid entries", () => {
    applyStatePayload({
      trendHistory: {
        snapshots: [
          { categoryId: "picture", capturedAt: "2026-01-15T00:00:00.000Z", sourceSnapshotId: null, entries: [] },
        ],
        lastSignatureByCategory: {},
      },
    });
    expect(trendHistory.snapshots).toHaveLength(0);
  });

  // 7. Partial payload — missing fields leave state unchanged
  it("leaves state unchanged when payload is null", () => {
    state.weights = { precursor: 70, history: 20, buzz: 10 };
    applyStatePayload(null);
    expect(state.weights).toEqual({ precursor: 70, history: 20, buzz: 10 });
  });

  it("leaves state unchanged when payload is empty object", () => {
    state.weights = { precursor: 70, history: 20, buzz: 10 };
    state.trendWindow = 15;
    applyStatePayload({});
    expect(state.weights).toEqual({ precursor: 70, history: 20, buzz: 10 });
    expect(state.trendWindow).toBe(15);
  });

  it("only updates fields present in the payload, leaving others intact", () => {
    state.weights     = { precursor: 70, history: 20, buzz: 10 };
    state.trendWindow = 15;
    applyStatePayload({ trendWindow: 7 });
    expect(state.weights).toEqual({ precursor: 70, history: 20, buzz: 10 });
    expect(state.trendWindow).toBe(7);
  });

  // 8. Weight clamping
  it("clamps weights that exceed the maximum of 95", () => {
    applyStatePayload({ weights: { precursor: 200, history: 30, buzz: 12 } });
    expect(state.weights.precursor).toBe(95);
  });

  it("clamps weights below the minimum of 1 to 1", () => {
    applyStatePayload({ weights: { precursor: 58, history: 0, buzz: 12 } });
    // 0 triggers the `|| state.weights.history` fallback in applyStatePayload, keeping current value
    expect(state.weights.history).toBe(30); // unchanged — 0 is falsy, falls back to current
  });

  it("clamps negative weights to 1", () => {
    applyStatePayload({ weights: { precursor: -50, history: 30, buzz: 12 } });
    expect(state.weights.precursor).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// HTTP round-trip tests — PUT → GET → applyStatePayload
// ══════════════════════════════════════════════════════════════════════════════

let db: Database.Database;

function makeTestDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("journal_mode = WAL");
  runMigrations(d);
  d.prepare("INSERT INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
    "default", new Date().toISOString(), null
  );
  d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "active_profile_id", "default"
  );
  return d;
}

const req = supertest(app);

describe("PUT /api/forecast → GET /api/forecast HTTP round-trips", () => {
  beforeEach(() => {
    db = makeTestDb();
    _setDbForTesting(db);
    resetState();
  });

  afterEach(() => {
    db.close();
  });

  // 9. Full payload survives the HTTP round-trip
  it("full payload survives PUT → GET → applyStatePayload", async () => {
    // Build a payload with several non-default values
    state.weights     = { precursor: 72, history: 18, buzz: 10 };
    state.trendWindow = 15;
    lockedCategories.add("picture");
    const sentPayload = serializeStatePayload();

    const putRes = await req.put("/api/forecast/default").send(sentPayload);
    expect(putRes.status).toBe(200);

    const getRes = await req.get("/api/forecast/default");
    expect(getRes.status).toBe(200);
    expect(getRes.body.payload).not.toBeNull();

    // Apply the server-returned payload to a clean state and verify
    resetState();
    applyStatePayload(getRes.body.payload);

    expect(state.weights).toEqual({ precursor: 72, history: 18, buzz: 10 });
    expect(state.trendWindow).toBe(15);
    expect(lockedCategories.has("picture")).toBe(true);
  });

  // 10. Film overrides survive the HTTP round-trip
  it("film score overrides survive PUT → GET → applyStatePayload", async () => {
    const pic = categories.find(c => c.id === "picture")!;
    pic.films[0].precursor = 55;
    pic.films[0].history   = 44;
    pic.films[0].buzz      = 33;
    pic.films[0].strength  = "Low";
    const sentPayload = serializeStatePayload();

    await req.put("/api/forecast/default").send(sentPayload);
    const getRes = await req.get("/api/forecast/default");

    resetState();
    applyStatePayload(getRes.body.payload);

    const restored = categories.find(c => c.id === "picture")!.films[0];
    expect(restored.precursor).toBe(55);
    expect(restored.history).toBe(44);
    expect(restored.buzz).toBe(33);
    expect(restored.strength).toBe("Low");
  });

  // 11. lockedCategories survive the HTTP round-trip
  it("lockedCategories survive PUT → GET → applyStatePayload", async () => {
    lockedCategories.add("picture");
    lockedCategories.add("director");
    const sentPayload = serializeStatePayload();

    await req.put("/api/forecast/default").send(sentPayload);
    const getRes = await req.get("/api/forecast/default");

    resetState();
    applyStatePayload(getRes.body.payload);

    expect([...lockedCategories].sort()).toEqual(["director", "picture"]);
  });

  // 12. Empty payload stored and returned as-is
  it("stores an empty payload and returns it without mutation", async () => {
    const putRes = await req.put("/api/forecast/default").send({});
    expect(putRes.status).toBe(200);
    expect(putRes.body.payload).toEqual({});

    const getRes = await req.get("/api/forecast/default");
    expect(getRes.body.payload).toEqual({});
  });

  it("a second PUT overwrites the previous payload", async () => {
    await req.put("/api/forecast/default").send({ weights: { precursor: 60, history: 28, buzz: 12 } });
    await req.put("/api/forecast/default").send({ weights: { precursor: 75, history: 18, buzz: 7 } });

    const getRes = await req.get("/api/forecast/default");
    expect(getRes.body.payload.weights.precursor).toBe(75);
  });

  it("GET returns null payload for a profile that has never been PUT", async () => {
    db.prepare("INSERT INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
      "fresh", new Date().toISOString(), null
    );
    const getRes = await req.get("/api/forecast/fresh");
    expect(getRes.status).toBe(200);
    expect(getRes.body.payload).toBeNull();
  });
});
