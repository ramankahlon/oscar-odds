-- Add passphrase_hash to profiles for per-profile passphrase protection.
-- SQLite does not support ALTER TABLE ADD COLUMN IF NOT EXISTS; idempotency
-- is guaranteed by the schema_migrations tracking table (this file runs once).

ALTER TABLE profiles ADD COLUMN passphrase_hash TEXT;
