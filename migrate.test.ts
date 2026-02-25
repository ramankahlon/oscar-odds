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
});
