-- Upgrade snapped_at from date-only ('2026-03-18') to ISO 8601 datetime
-- ('2026-03-18T12:00:00.000Z') so that multiple scraper runs on the same day
-- produce distinct rows instead of silently overwriting each other.
--
-- Existing rows are backfilled with a fixed T12:00:00.000Z suffix so they
-- remain sortable and can be distinguished from new intra-day snapshots.
-- The UNIQUE index and lookup index are rebuilt to cover the new format.

UPDATE snapshots
SET snapped_at = snapped_at || 'T12:00:00.000Z'
WHERE snapped_at NOT LIKE '%T%';
