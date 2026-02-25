-- Browser-reported JavaScript errors collected via POST /api/client-errors.

CREATE TABLE IF NOT EXISTS client_errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  source      TEXT,
  lineno      INTEGER,
  colno       INTEGER,
  stack       TEXT,
  context     TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_errors_occurred_at ON client_errors(occurred_at);
