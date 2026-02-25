-- HTTP-only session tokens for passphrase-protected profiles.

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_profile_id ON sessions(profile_id);
