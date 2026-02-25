-- Core tables present from the first deployment.

CREATE TABLE IF NOT EXISTS profiles (
  id         TEXT PRIMARY KEY,
  updated_at TEXT,
  payload    TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      TEXT    NOT NULL,
  category_id     TEXT    NOT NULL,
  contender_key   TEXT    NOT NULL,
  contender_title TEXT    NOT NULL,
  nom_pct         REAL    NOT NULL,
  win_pct         REAL    NOT NULL,
  snapped_at      TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_unique
  ON snapshots(profile_id, category_id, contender_key, snapped_at);

CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
  ON snapshots(profile_id, category_id, snapped_at);
