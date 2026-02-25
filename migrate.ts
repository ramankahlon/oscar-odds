import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Default location of numbered *.sql migration files. */
export const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, "migrations");

/**
 * Runs all pending SQL migrations from `migrationsDir` against `db`.
 *
 * On every call it:
 *   1. Bootstraps the `schema_migrations` tracking table (CREATE TABLE IF NOT EXISTS).
 *   2. For existing databases that pre-date this migration system, seeds the
 *      tracker with already-applied migrations so they are never re-executed
 *      (detected by the presence of the `passphrase_hash` column in `profiles`).
 *   3. Reads all *.sql files from `migrationsDir`, sorted lexicographically
 *      (001_... < 002_... < 003_... by numeric prefix convention).
 *   4. For each file not yet in `schema_migrations`, runs it inside a transaction
 *      and records it. If the SQL fails, the transaction rolls back and the file
 *      is NOT recorded — it will be retried on the next startup.
 *
 * Safe to call on every startup (fully idempotent).
 *
 * @param db             Open better-sqlite3 Database instance.
 * @param migrationsDir  Directory containing *.sql files (default: ./migrations/).
 * @returns              Filenames newly applied during this call.
 */
export function runMigrations(
  db: Database.Database,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR
): string[] {
  // Step 1 — bootstrap the tracking table.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  // Step 2 — one-time bootstrap shim for databases that already have the full
  // schema but were created before this migration system existed.
  //
  // Detection: schema_migrations is empty AND profiles table already has the
  // passphrase_hash column (introduced in migration 002).  When both conditions
  // are true, all three existing migrations have effectively been applied already
  // — we record them without running their SQL so 002's ALTER TABLE doesn't fail.
  const trackerEmpty =
    (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number }).n === 0;

  if (trackerEmpty) {
    const profileExists = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='profiles'")
      .get() as { n: number };

    if (profileExists.n > 0) {
      const cols = (
        db.prepare("PRAGMA table_info(profiles)").all() as Array<{ name: string }>
      ).map((c) => c.name);

      if (cols.includes("passphrase_hash")) {
        // This DB has the full schema — fast-forward the tracker.
        const now = new Date().toISOString();
        const seed = db.prepare(
          "INSERT OR IGNORE INTO schema_migrations (filename, applied_at) VALUES (?, ?)"
        );
        db.transaction(() => {
          seed.run("001_initial_schema.sql", now);
          seed.run("002_add_passphrase.sql", now);
          seed.run("003_add_sessions.sql", now);
        })();
      }
    }
  }

  // Step 3 — load already-applied filenames.
  const applied = new Set<string>(
    (
      db.prepare("SELECT filename FROM schema_migrations").all() as Array<{ filename: string }>
    ).map((r) => r.filename)
  );

  // Step 4 — enumerate migration files in sorted order.
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lexicographic sort; "001_" < "002_" < "003_" by numeric prefix

  const insertRecord = db.prepare(
    "INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)"
  );

  const appliedNow: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(path.join(migrationsDir, file), "utf8");

    // Run the migration SQL and record it atomically.  If db.exec throws, the
    // transaction rolls back and schema_migrations is not updated — the file
    // will be retried on the next startup.
    db.transaction(() => {
      db.exec(sql);
      insertRecord.run(file, new Date().toISOString());
    })();

    appliedNow.push(file);
  }

  return appliedNow;
}
