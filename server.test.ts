/**
 * Integration tests for the 8 core API route groups in server.ts.
 *
 * Each test creates an isolated in-memory SQLite database, runs the real
 * migrations, seeds it with minimal fixture data, then fires HTTP requests
 * through the same Express app object that production uses.
 *
 * Covered route groups
 * ────────────────────
 *  1. GET  /api/health                            — health envelope
 *  2. GET  /api/profiles                          — profile listing
 *  3. GET  /api/forecast/:profileId               — forecast read
 *  4. PUT  /api/forecast/:profileId               — forecast write + auth guard
 *  5. DELETE /api/forecast/:profileId             — profile delete + last-profile guard
 *  6. PATCH  /api/forecast/:profileId/rename      — rename + conflict check
 *  7. GET  /api/forecast/:profileId/history       — snapshot history
 *  8. GET  /api/profiles/:profileId/auth-status   — auth status
 *     POST /api/profiles/:profileId/login         — login → session cookie
 *     POST /api/profiles/:profileId/logout        — logout → cookie cleared
 *     POST /api/profiles/:profileId/passphrase    — set passphrase (guarded)
 *     DELETE /api/profiles/:profileId/passphrase  — remove passphrase (guarded)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import supertest from "supertest";
import { app, _setDbForTesting } from "./server.js";
import { runMigrations } from "./migrate.js";
import { hashPassphrase, generateSessionToken, sessionExpiresAt, SESSION_COOKIE } from "./auth-utils.js";

// ── DB factory ─────────────────────────────────────────────────────────────────

function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  // Seed a default profile and active-profile-id meta row.
  db.prepare("INSERT INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
    "default", new Date().toISOString(), null
  );
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    "active_profile_id", "default"
  );
  return db;
}

// ── Test lifecycle ─────────────────────────────────────────────────────────────

let db: Database.Database;

beforeEach(() => {
  db = makeTestDb();
  _setDbForTesting(db);
});

afterEach(() => {
  db.close();
});

const req = supertest(app);

// ── Helper: create a valid session cookie for a profile ───────────────────────

async function loginAs(profileId: string, passphrase: string): Promise<string> {
  const hash = await hashPassphrase(passphrase);
  db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(hash, profileId);
  const token = generateSessionToken();
  const expiresAt = sessionExpiresAt();
  db.prepare(
    "INSERT INTO sessions (token, profile_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(token, profileId, new Date().toISOString(), expiresAt.toISOString());
  return `${SESSION_COOKIE}=${token}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/health
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /api/health", () => {
  it("returns 200 with ok:true", async () => {
    const res = await req.get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("includes uptimeSeconds >= 0", async () => {
    const res = await req.get("/api/health");
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("includes tracing object with enabled flag", async () => {
    const res = await req.get("/api/health");
    expect(res.body.tracing).toHaveProperty("enabled");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/profiles
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /api/profiles", () => {
  it("returns the default profile", async () => {
    const res = await req.get("/api/profiles");
    expect(res.status).toBe(200);
    const ids = (res.body.profiles as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain("default");
  });

  it("reports activeProfileId", async () => {
    const res = await req.get("/api/profiles");
    expect(res.body.activeProfileId).toBe("default");
  });

  it("hasPassphrase is false for unprotected profile", async () => {
    const res = await req.get("/api/profiles");
    const profile = (res.body.profiles as Array<{ id: string; hasPassphrase: boolean }>)
      .find((p) => p.id === "default");
    expect(profile?.hasPassphrase).toBe(false);
  });

  it("returns multiple profiles when several exist", async () => {
    db.prepare("INSERT INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
      "alt", new Date().toISOString(), null
    );
    const res = await req.get("/api/profiles");
    const ids = (res.body.profiles as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain("default");
    expect(ids).toContain("alt");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/forecast/:profileId
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /api/forecast/:profileId", () => {
  it("returns null payload for a new profile", async () => {
    const res = await req.get("/api/forecast/default");
    expect(res.status).toBe(200);
    expect(res.body.profileId).toBe("default");
    expect(res.body.payload).toBeNull();
  });

  it("returns stored payload after a PUT", async () => {
    db.prepare("UPDATE profiles SET payload = ? WHERE id = ?").run(
      JSON.stringify({ categoryId: "picture" }), "default"
    );
    const res = await req.get("/api/forecast/default");
    expect(res.status).toBe(200);
    expect(res.body.payload.categoryId).toBe("picture");
  });

  it("returns 400 for an invalid profile ID (uppercase)", async () => {
    const res = await req.get("/api/forecast/INVALID");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns profile not found as null payload for unknown id", async () => {
    const res = await req.get("/api/forecast/no-such-profile");
    expect(res.status).toBe(200);
    expect(res.body.payload).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. PUT /api/forecast/:profileId
// ══════════════════════════════════════════════════════════════════════════════

describe("PUT /api/forecast/:profileId", () => {
  it("stores a forecast payload and returns 200", async () => {
    const body = { categoryId: "actor", weights: { precursor: 58, history: 30, buzz: 12 } };
    const res = await req.put("/api/forecast/default").send(body);
    expect(res.status).toBe(200);
    expect(res.body.profileId).toBe("default");
    expect(res.body.payload.categoryId).toBe("actor");
  });

  it("persists the payload so a subsequent GET returns it", async () => {
    await req.put("/api/forecast/default").send({ categoryId: "picture" });
    const res = await req.get("/api/forecast/default");
    expect(res.body.payload.categoryId).toBe("picture");
  });

  it("creates a new profile row when the profile doesn't exist yet", async () => {
    const res = await req.put("/api/forecast/new-profile").send({ x: 1 });
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT id FROM profiles WHERE id = ?").get("new-profile");
    expect(row).toBeTruthy();
  });

  it("returns 401 when the profile is passphrase-protected and no session cookie", async () => {
    const hash = await hashPassphrase("s3cret!!");
    db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(hash, "default");
    const res = await req.put("/api/forecast/default").send({ x: 1 });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("accepts the request when a valid session cookie is sent", async () => {
    const cookie = await loginAs("default", "s3cret!!");
    const res = await req
      .put("/api/forecast/default")
      .set("Cookie", cookie)
      .send({ categoryId: "director" });
    expect(res.status).toBe(200);
  });

  it("returns 400 for an invalid profile ID in the URL", async () => {
    const res = await req.put("/api/forecast/UPPER").send({});
    expect(res.status).toBe(400);
  });

  it("upserts snapshot rows when trendHistory.snapshots is provided", async () => {
    const body = {
      trendHistory: {
        snapshots: [
          {
            categoryId: "picture",
            capturedAt: "2026-01-15T12:00:00.000Z",
            entries: [{ key: "film-a", title: "Film A", nomination: 80, winner: 40 }],
          },
        ],
      },
    };
    await req.put("/api/forecast/default").send(body);
    const row = db
      .prepare("SELECT * FROM snapshots WHERE profile_id = ? AND category_id = ?")
      .get("default", "picture") as Record<string, unknown> | undefined;
    expect(row?.contender_key).toBe("film-a");
    expect(row?.nom_pct).toBe(80);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. DELETE /api/forecast/:profileId
// ══════════════════════════════════════════════════════════════════════════════

describe("DELETE /api/forecast/:profileId", () => {
  it("returns 400 when trying to delete the last profile", async () => {
    const res = await req.delete("/api/forecast/default");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last profile/i);
  });

  it("deletes a profile and updates activeProfileId", async () => {
    db.prepare("INSERT INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
      "spare", new Date().toISOString(), null
    );
    const res = await req.delete("/api/forecast/spare");
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe("spare");
    const row = db.prepare("SELECT id FROM profiles WHERE id = ?").get("spare");
    expect(row).toBeUndefined();
  });

  it("returns 404 for a profile that doesn't exist", async () => {
    db.prepare("INSERT INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
      "other", new Date().toISOString(), null
    );
    const res = await req.delete("/api/forecast/ghost");
    expect(res.status).toBe(404);
  });

  it("returns 401 when the profile to delete is protected and no session", async () => {
    db.prepare("INSERT INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
      "protected", new Date().toISOString(), null
    );
    const hash = await hashPassphrase("passw0rd!");
    db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(hash, "protected");
    const res = await req.delete("/api/forecast/protected");
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. PATCH /api/forecast/:profileId/rename
// ══════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/forecast/:profileId/rename", () => {
  it("renames a profile", async () => {
    const res = await req
      .patch("/api/forecast/default/rename")
      .send({ newId: "renamed" });
    expect(res.status).toBe(200);
    expect(res.body.profileId).toBe("renamed");
    const row = db.prepare("SELECT id FROM profiles WHERE id = ?").get("renamed");
    expect(row).toBeTruthy();
  });

  it("returns 200 with same id when renaming to itself", async () => {
    const res = await req
      .patch("/api/forecast/default/rename")
      .send({ newId: "default" });
    expect(res.status).toBe(200);
    expect(res.body.profileId).toBe("default");
  });

  it("returns 409 when newId already exists", async () => {
    db.prepare("INSERT INTO profiles (id, updated_at, payload) VALUES (?, ?, ?)").run(
      "taken", new Date().toISOString(), null
    );
    const res = await req
      .patch("/api/forecast/default/rename")
      .send({ newId: "taken" });
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 for a profile that doesn't exist", async () => {
    const res = await req
      .patch("/api/forecast/ghost/rename")
      .send({ newId: "new-name" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid newId (uppercase)", async () => {
    const res = await req
      .patch("/api/forecast/default/rename")
      .send({ newId: "UPPER" });
    expect(res.status).toBe(400);
  });

  it("returns 401 when the profile is protected and no session cookie", async () => {
    const hash = await hashPassphrase("p@ssw0rd!!");
    db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(hash, "default");
    const res = await req
      .patch("/api/forecast/default/rename")
      .send({ newId: "new-name" });
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. GET /api/forecast/:profileId/history
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /api/forecast/:profileId/history", () => {
  it("returns empty snapshots for a new profile", async () => {
    const res = await req.get("/api/forecast/default/history");
    expect(res.status).toBe(200);
    expect(res.body.profileId).toBe("default");
    expect(res.body.snapshots).toEqual([]);
  });

  it("returns grouped snapshots after PUT with trendHistory", async () => {
    const putBody = {
      trendHistory: {
        snapshots: [
          {
            categoryId: "picture",
            capturedAt: "2026-03-01T12:00:00.000Z",
            entries: [
              { key: "film-a", title: "Film A", nomination: 75, winner: 30 },
              { key: "film-b", title: "Film B", nomination: 60, winner: 20 },
            ],
          },
        ],
      },
    };
    await req.put("/api/forecast/default").send(putBody);

    const res = await req.get("/api/forecast/default/history");
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(1);
    expect(res.body.snapshots[0].categoryId).toBe("picture");
    expect(res.body.snapshots[0].entries).toHaveLength(2);
  });

  it("returns 400 for invalid profile ID", async () => {
    const res = await req.get("/api/forecast/INVALID/history");
    expect(res.status).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. Auth routes: auth-status, login, logout, passphrase set/remove
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /api/profiles/:profileId/auth-status", () => {
  it("returns hasPassphrase:false and authenticated:false for unprotected profile", async () => {
    const res = await req.get("/api/profiles/default/auth-status");
    expect(res.status).toBe(200);
    expect(res.body.hasPassphrase).toBe(false);
    expect(res.body.authenticated).toBe(false);
  });

  it("returns 404 for unknown profile", async () => {
    const res = await req.get("/api/profiles/ghost/auth-status");
    expect(res.status).toBe(404);
  });

  it("returns hasPassphrase:true when passphrase is set", async () => {
    const hash = await hashPassphrase("s3cret!!");
    db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(hash, "default");
    const res = await req.get("/api/profiles/default/auth-status");
    expect(res.body.hasPassphrase).toBe(true);
    expect(res.body.authenticated).toBe(false);
  });

  it("returns authenticated:true when a valid session cookie is present", async () => {
    const cookie = await loginAs("default", "s3cret!!");
    const res = await req
      .get("/api/profiles/default/auth-status")
      .set("Cookie", cookie);
    expect(res.body.authenticated).toBe(true);
  });
});

describe("POST /api/profiles/:profileId/login", () => {
  it("returns 400 when the profile has no passphrase", async () => {
    const res = await req
      .post("/api/profiles/default/login")
      .send({ passphrase: "anything" });
    expect(res.status).toBe(400);
  });

  it("returns 401 for wrong passphrase", async () => {
    const hash = await hashPassphrase("correct-horse");
    db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(hash, "default");
    const res = await req
      .post("/api/profiles/default/login")
      .send({ passphrase: "wrong-pass" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  it("returns 200 and sets a session cookie on correct passphrase", async () => {
    const hash = await hashPassphrase("correct-horse");
    db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(hash, "default");
    const res = await req
      .post("/api/profiles/default/login")
      .send({ passphrase: "correct-horse" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const setCookie = res.headers["set-cookie"] as string[] | string | undefined;
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
    expect(cookies.some((c) => c.startsWith(SESSION_COOKIE))).toBe(true);
  });

  it("returns 404 for unknown profile", async () => {
    const res = await req
      .post("/api/profiles/ghost/login")
      .send({ passphrase: "anything" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when passphrase body field is missing", async () => {
    const res = await req.post("/api/profiles/default/login").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/profiles/:profileId/logout", () => {
  it("returns 200 and clears the session cookie", async () => {
    const cookie = await loginAs("default", "s3cret!!");
    const res = await req
      .post("/api/profiles/default/logout")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const setCookie = res.headers["set-cookie"] as string[] | string | undefined;
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
    // The cookie should be cleared (expires in the past / Max-Age=0)
    expect(
      cookies.some((c) => c.includes(SESSION_COOKIE) && (c.includes("Expires=Thu, 01 Jan 1970") || c.includes("Max-Age=0")))
    ).toBe(true);
  });

  it("returns 200 even when no cookie is provided (idempotent)", async () => {
    const res = await req.post("/api/profiles/default/logout");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/profiles/:profileId/passphrase", () => {
  it("returns 401 when the profile already has a passphrase and no session", async () => {
    const hash = await hashPassphrase("old-pass!!");
    db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(hash, "default");
    const res = await req
      .post("/api/profiles/default/passphrase")
      .send({ passphrase: "new-passphrase" });
    expect(res.status).toBe(401);
  });

  it("sets a passphrase on an unprotected profile and returns 200", async () => {
    const res = await req
      .post("/api/profiles/default/passphrase")
      .send({ passphrase: "new-passphrase!" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const row = db
      .prepare("SELECT passphrase_hash FROM profiles WHERE id = ?")
      .get("default") as { passphrase_hash: string | null };
    expect(row.passphrase_hash).not.toBeNull();
  });

  it("returns 400 when passphrase is too short (< 8 chars)", async () => {
    const res = await req
      .post("/api/profiles/default/passphrase")
      .send({ passphrase: "short" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown profile", async () => {
    const res = await req
      .post("/api/profiles/ghost/passphrase")
      .send({ passphrase: "long-enough!" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/profiles/:profileId/passphrase", () => {
  it("removes the passphrase when authenticated", async () => {
    const cookie = await loginAs("default", "s3cret!!");
    const res = await req
      .delete("/api/profiles/default/passphrase")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const row = db
      .prepare("SELECT passphrase_hash FROM profiles WHERE id = ?")
      .get("default") as { passphrase_hash: string | null };
    expect(row.passphrase_hash).toBeNull();
  });

  it("returns 401 when there is no session cookie", async () => {
    const hash = await hashPassphrase("s3cret!!");
    db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(hash, "default");
    const res = await req.delete("/api/profiles/default/passphrase");
    expect(res.status).toBe(401);
  });

  it("returns 400 when the profile has no passphrase to remove", async () => {
    const res = await req.delete("/api/profiles/default/passphrase");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not have/i);
  });

  it("returns 404 for an unknown profile", async () => {
    const res = await req.delete("/api/profiles/ghost/passphrase");
    expect(res.status).toBe(404);
  });
});
