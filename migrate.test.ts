import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "./migrate.js";

/** Create a fresh temporary directory for migration SQL files. */
function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "oscar-migrate-test-"));
}

function writeSql(dir: string, filename: string, sql: string): void {
  writeFileSync(path.join(dir, filename), sql, "utf8");
}

// Collect cleanup handles so afterEach can always tidy up even if a test throws.
const temps: Array<{ db: Database.Database; dir: string }> = [];

afterEach(() => {
  for (const { db, dir } of temps.splice(0)) {
    try { db.close(); } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runMigrations", () => {
  it("creates schema_migrations table on a fresh database", () => {
    const db = new Database(":memory:");
    const dir = makeTempDir();
    temps.push({ db, dir });

    runMigrations(db, dir);

    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("schema_migrations");
  });

  it("applies migration files in sorted (numeric) order", () => {
    const db = new Database(":memory:");
    const dir = makeTempDir();
    temps.push({ db, dir });

    // Write in reverse order to verify that sort(), not filesystem order, governs execution.
    writeSql(dir, "002_add_col.sql", "ALTER TABLE t ADD COLUMN b TEXT;");
    writeSql(dir, "001_create.sql", "CREATE TABLE t (a TEXT);");

    // If 002 ran before 001 the ALTER would throw "no such table: t".
    expect(() => runMigrations(db, dir)).not.toThrow();

    const cols = (
      db.prepare("PRAGMA table_info(t)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toContain("a");
    expect(cols).toContain("b");
  });

  it("does not re-run already-applied migrations (idempotent)", () => {
    const db = new Database(":memory:");
    const dir = makeTempDir();
    temps.push({ db, dir });

    // CREATE TABLE without IF NOT EXISTS — a second run would throw.
    writeSql(dir, "001_create.sql", "CREATE TABLE t (a TEXT);");

    runMigrations(db, dir);

    // Second call must not throw and must report zero new migrations.
    const second = runMigrations(db, dir);
    expect(second).toHaveLength(0);
  });

  it("returns only the filenames newly applied on each call", () => {
    const db = new Database(":memory:");
    const dir = makeTempDir();
    temps.push({ db, dir });

    writeSql(dir, "001_a.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");

    const first = runMigrations(db, dir);
    expect(first).toEqual(["001_a.sql"]);

    // Add a second migration and run again.
    writeSql(dir, "002_b.sql", "CREATE TABLE b (id INTEGER PRIMARY KEY);");

    const second = runMigrations(db, dir);
    expect(second).toEqual(["002_b.sql"]);
  });

  it("rolls back schema_migrations record when migration SQL is invalid", () => {
    const db = new Database(":memory:");
    const dir = makeTempDir();
    temps.push({ db, dir });

    writeSql(dir, "001_bad.sql", "THIS IS NOT VALID SQL;");

    expect(() => runMigrations(db, dir)).toThrow();

    // The failed migration must not be recorded — it will be retried next startup.
    const rows = db
      .prepare("SELECT filename FROM schema_migrations")
      .all() as Array<{ filename: string }>;
    expect(rows).toHaveLength(0);
  });

  it("fast-forwards tracker for existing DBs that pre-date the migration system", () => {
    const db = new Database(":memory:");
    const dir = makeTempDir();
    temps.push({ db, dir });

    // Simulate a pre-existing database: create tables manually (no migration tracker).
    db.exec(`
      CREATE TABLE profiles (id TEXT PRIMARY KEY, updated_at TEXT, payload TEXT, passphrase_hash TEXT);
      CREATE TABLE sessions  (token TEXT PRIMARY KEY, profile_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    `);

    writeSql(dir, "001_initial_schema.sql", "CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, updated_at TEXT, payload TEXT);");
    writeSql(dir, "002_add_passphrase.sql", "ALTER TABLE profiles ADD COLUMN passphrase_hash TEXT;");
    writeSql(dir, "003_add_sessions.sql",   "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, profile_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);");

    // Should not throw even though ALTER TABLE would fail on an existing column.
    expect(() => runMigrations(db, dir)).not.toThrow();

    // All three migrations must be marked as applied.
    const rows = db
      .prepare("SELECT filename FROM schema_migrations ORDER BY filename")
      .all() as Array<{ filename: string }>;
    expect(rows.map((r) => r.filename)).toEqual([
      "001_initial_schema.sql",
      "002_add_passphrase.sql",
      "003_add_sessions.sql",
    ]);
  });

  it("006_add_foreign_keys: orphaned rows are pruned and FK constraints are enforced after PRAGMA foreign_keys = ON", async () => {
    const db = new Database(":memory:");
    const dir = makeTempDir();
    temps.push({ db, dir });

    // Build the schema that existed before migration 006.
    db.exec(`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY, updated_at TEXT, payload TEXT, passphrase_hash TEXT
      );
      CREATE TABLE snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL, category_id TEXT NOT NULL,
        contender_key TEXT NOT NULL, contender_title TEXT NOT NULL,
        nom_pct REAL NOT NULL, win_pct REAL NOT NULL, snapped_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_snapshots_unique
        ON snapshots(profile_id, category_id, contender_key, snapped_at);
      CREATE INDEX idx_snapshots_lookup
        ON snapshots(profile_id, category_id, snapped_at);
      CREATE TABLE sessions (
        token TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_profile_id ON sessions(profile_id);
    `);

    // Seed: one valid profile, one orphaned snapshot and session (no matching profile).
    db.exec(`
      INSERT INTO profiles VALUES ('alice', '2026-01-01', '{}', NULL);
      INSERT INTO snapshots (profile_id, category_id, contender_key, contender_title, nom_pct, win_pct, snapped_at)
        VALUES ('alice', 'picture', 'film-a', 'Film A', 80.0, 30.0, '2026-03-01T12:00:00.000Z');
      INSERT INTO snapshots (profile_id, category_id, contender_key, contender_title, nom_pct, win_pct, snapped_at)
        VALUES ('ghost', 'picture', 'film-b', 'Film B', 50.0, 10.0, '2026-03-01T12:00:00.000Z');
      INSERT INTO sessions VALUES ('tok-alice', 'alice', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z');
      INSERT INTO sessions VALUES ('tok-ghost', 'ghost', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z');
    `);

    // Fast-forward 001–003 so the shim doesn't re-run them, then run migration 006.
    db.exec(`
      CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES ('001_initial_schema.sql', '2026-01-01');
      INSERT INTO schema_migrations VALUES ('002_add_passphrase.sql', '2026-01-01');
      INSERT INTO schema_migrations VALUES ('003_add_sessions.sql',   '2026-01-01');
      INSERT INTO schema_migrations VALUES ('004_add_client_errors.sql', '2026-01-01');
      INSERT INTO schema_migrations VALUES ('005_snapshots_datetime.sql', '2026-01-01');
    `);

    const { DEFAULT_MIGRATIONS_DIR } = await import("./migrate.js");
    expect(() => runMigrations(db, DEFAULT_MIGRATIONS_DIR)).not.toThrow();

    // Orphaned rows must be gone.
    const snapRows = db.prepare("SELECT profile_id FROM snapshots").all() as Array<{ profile_id: string }>;
    expect(snapRows.every((r) => r.profile_id === "alice")).toBe(true);
    const sessRows = db.prepare("SELECT profile_id FROM sessions").all() as Array<{ profile_id: string }>;
    expect(sessRows.every((r) => r.profile_id === "alice")).toBe(true);

    // Valid alice rows must be preserved.
    expect(snapRows).toHaveLength(1);
    expect(sessRows).toHaveLength(1);

    // After enabling FK enforcement, inserting a row that references a
    // non-existent profile must be rejected.
    db.pragma("foreign_keys = ON");
    expect(() =>
      db.prepare(
        "INSERT INTO snapshots (profile_id, category_id, contender_key, contender_title, nom_pct, win_pct, snapped_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("nobody", "picture", "x", "X", 1, 1, "2026-03-02T12:00:00.000Z")
    ).toThrow();

    // Deleting the profile must cascade-delete its snapshots and sessions.
    db.prepare("DELETE FROM profiles WHERE id = ?").run("alice");
    expect(db.prepare("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number }).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).toEqual({ n: 0 });
  });
});
