-- Add ON DELETE CASCADE foreign key constraints to snapshots and sessions so
-- that deleting a profile automatically removes all associated rows, and
-- referential integrity is enforced at the database layer.
--
-- SQLite does not support ALTER TABLE ADD CONSTRAINT, so both tables are
-- rebuilt using the standard SQLite table-rename pattern:
--   1. Create <table>_new with the FK constraint.
--   2. Copy data from the old table (orphaned rows are purged first).
--   3. Drop the old table.
--   4. Rename <table>_new → <table>.
--   5. Recreate indexes.
--
-- PRAGMA foreign_keys = ON is set by server.ts after all migrations complete,
-- so FK enforcement is not active during this migration.

-- Purge any orphaned rows that don't reference a known profile.  These could
-- only exist if the database was modified directly, bypassing the application.
DELETE FROM snapshots WHERE profile_id NOT IN (SELECT id FROM profiles);
DELETE FROM sessions  WHERE profile_id NOT IN (SELECT id FROM profiles);

-- ── snapshots ────────────────────────────────────────────────────────────────

CREATE TABLE snapshots_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      TEXT    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id     TEXT    NOT NULL,
  contender_key   TEXT    NOT NULL,
  contender_title TEXT    NOT NULL,
  nom_pct         REAL    NOT NULL,
  win_pct         REAL    NOT NULL,
  snapped_at      TEXT    NOT NULL
);

INSERT INTO snapshots_new
  SELECT id, profile_id, category_id, contender_key, contender_title,
         nom_pct, win_pct, snapped_at
  FROM snapshots;

DROP TABLE snapshots;
ALTER TABLE snapshots_new RENAME TO snapshots;

CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_unique
  ON snapshots(profile_id, category_id, contender_key, snapped_at);

CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
  ON snapshots(profile_id, category_id, snapped_at);

-- ── sessions ─────────────────────────────────────────────────────────────────

CREATE TABLE sessions_new (
  token      TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

INSERT INTO sessions_new
  SELECT token, profile_id, created_at, expires_at
  FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX IF NOT EXISTS idx_sessions_profile_id ON sessions(profile_id);
