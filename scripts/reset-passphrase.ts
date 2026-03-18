#!/usr/bin/env tsx
/**
 * reset-passphrase.ts
 *
 * Admin CLI for passphrase recovery.  Directly modifies data/forecast.db —
 * the server does NOT need to be running, and no HTTP credentials are required.
 *
 * Usage
 * ─────
 *   # Clear the passphrase (profile becomes unprotected):
 *   npm run reset-passphrase -- <profileId>
 *
 *   # Set a specific new passphrase instead of clearing:
 *   npm run reset-passphrase -- <profileId> --set "new passphrase here"
 *
 *   # List all profiles and their protection status:
 *   npm run reset-passphrase -- --list
 *
 * Examples
 * ────────
 *   npm run reset-passphrase -- default
 *   npm run reset-passphrase -- alice --set "correct horse battery staple"
 *   npm run reset-passphrase -- --list
 *
 * Safety
 * ──────
 * This script bypasses HTTP authentication entirely.  It should only be run
 * by someone with direct filesystem access to data/forecast.db.  After
 * resetting, all active sessions for the profile are invalidated so stale
 * session cookies cannot be replayed.
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassphrase } from "../auth-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const DB_PATH    = join(__dirname, "../data/forecast.db");

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage:
  npm run reset-passphrase -- <profileId>
  npm run reset-passphrase -- <profileId> --set "<new passphrase>"
  npm run reset-passphrase -- --list
`.trim());
  process.exit(0);
}

// ── DB access ─────────────────────────────────────────────────────────────────

if (!existsSync(DB_PATH)) {
  console.error(`Error: database not found at ${DB_PATH}`);
  console.error("Start the server at least once to initialise the database.");
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

interface ProfileRow {
  id: string;
  passphrase_hash: string | null;
}

// ── --list ────────────────────────────────────────────────────────────────────

if (args[0] === "--list") {
  const rows = db.prepare("SELECT id, passphrase_hash FROM profiles ORDER BY id").all() as ProfileRow[];
  if (rows.length === 0) {
    console.log("No profiles found.");
  } else {
    console.log("Profiles:\n");
    for (const row of rows) {
      const status = row.passphrase_hash ? "passphrase set" : "no passphrase";
      console.log(`  ${row.id.padEnd(30)}  ${status}`);
    }
  }
  db.close();
  process.exit(0);
}

// ── Reset / set passphrase ────────────────────────────────────────────────────

const profileId = args[0];

// Mirror the server-side profile ID validation.
if (!/^[a-z0-9_-]+$/.test(profileId) || profileId.length > 100) {
  console.error(`Error: invalid profile ID "${profileId}".`);
  console.error("Profile IDs must match ^[a-z0-9_-]+$ and be at most 100 characters.");
  process.exit(1);
}

const row = db
  .prepare("SELECT id, passphrase_hash FROM profiles WHERE id = ?")
  .get(profileId) as ProfileRow | undefined;

if (!row) {
  console.error(`Error: profile "${profileId}" not found.`);
  console.error('Run  npm run reset-passphrase -- --list  to see available profiles.');
  process.exit(1);
}

// Determine operation: clear or set.
const setFlagIndex = args.indexOf("--set");
const isSet        = setFlagIndex !== -1;
const newPassphrase = isSet ? (args[setFlagIndex + 1] ?? "") : null;

if (isSet && newPassphrase!.length < 8) {
  console.error("Error: new passphrase must be at least 8 characters.");
  process.exit(1);
}

// Hash with the same algorithm the server uses (bcrypt, 12 rounds).
const newHash: string | null = isSet ? await hashPassphrase(newPassphrase!) : null;

// Apply atomically and invalidate all sessions so stale cookies can't be replayed.
db.transaction(() => {
  db.prepare("UPDATE profiles SET passphrase_hash = ? WHERE id = ?").run(newHash, profileId);
  db.prepare("DELETE FROM sessions WHERE profile_id = ?").run(profileId);
})();

db.close();

if (isSet) {
  console.log(`\u2713 Passphrase updated for profile "${profileId}". All sessions invalidated.`);
} else if (row.passphrase_hash) {
  console.log(`\u2713 Passphrase cleared for profile "${profileId}". Profile is now unprotected. All sessions invalidated.`);
} else {
  console.log(`Profile "${profileId}" had no passphrase — nothing to clear.`);
}
