/**
 * Oscar-odds scoring kernel — AssemblyScript source.
 *
 * Compiled to WebAssembly with:
 *   npx asc wasm/scoring.ts --outFile wasm/scoring.wasm --runtime stub --initialMemory 1 --optimizeLevel 3
 *
 * Design notes
 * ────────────
 * WASM boundary: functions can only accept/return i32 and f64 (no strings, no objects).
 *
 * • Strength enum → i32:  High=2, Medium=1, Low=0  (encoded by the JS wrapper before
 *   crossing the boundary; strings cannot transit WASM directly).
 *
 * • Result struct → linear memory: writing 7 f64 values into a fixed buffer and reading
 *   them back via a pinned Float64Array is a single typed-array slice vs. 7 separate
 *   import/export round-trips.  This is the canonical pattern for returning aggregates
 *   from WASM when multi-value returns aren't available in the toolchain.
 *
 * • winnerHistoryMultiplier stays in JS: it requires arbitrary string→number lookups
 *   across a JS config object.  Serialising that map into WASM linear memory on every
 *   call would cost more than the compute saves.  Pre-compute it in JS and pass the
 *   resulting f64 — this is the right place to draw the WASM boundary.
 *
 * • Math.exp → host import: WASM has no native exp instruction.  We could ship a
 *   pure-AS libm implementation, but delegating to the JS host keeps the binary
 *   tiny (~1 KB) and numerically identical to the JS fallback path.
 */

// ── Host import ────────────────────────────────────────────────────────────────
// Declared @external("env","exp") so the compiled module imports it as
// (import "env" "exp" (func …)).  The JS wrapper satisfies this with { env: { exp: Math.exp } }.
@external("env", "exp")
declare function hostExp(x: f64): f64;

// ── Result buffer ──────────────────────────────────────────────────────────────
// Fixed 56-byte block (7 × f64) at offset 0 of WASM linear memory.
// Safe with --runtime none: no allocator is present, so nothing else claims this range.
// Layout:
//   [0]  nominationRaw
//   [1]  winnerRaw
//   [2]  precursorContribution
//   [3]  historyContribution
//   [4]  buzzContribution
//   [5]  strengthMultiplier
//   [6]  winnerHistoryMultiplier
const RESULT: usize = 0;

/** Returns the byte offset of the result buffer so JS can pin a Float64Array to it. */
export function getResultPtr(): i32 {
  return 0;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

export function clamp(value: f64, min: f64, max: f64): f64 {
  return value < min ? min : value > max ? max : value;
}

/**
 * Maps the Strength i32 encoding to its multiplicative boost.
 * High (+6 %) → 1.06 | Medium (neutral) → 1.0 | Low (−6 %) → 0.94
 */
export function strengthBoost(strength: i32): f64 {
  if (strength === 2) return 1.06; // High
  if (strength === 1) return 1.0;  // Medium
  return 0.94;                     // Low
}

// ── Scoring kernel ─────────────────────────────────────────────────────────────

/**
 * Computes nomination and winner raw scores plus all breakdown fields, then
 * writes the 7 results into the fixed result buffer in linear memory.
 *
 * The caller reads them back via a Float64Array view pinned to getResultPtr().
 */
export function scoreFilmCore(
  precursor: f64,
  history: f64,
  buzz: f64,
  wPrecursor: f64,
  wHistory: f64,
  wBuzz: f64,
  strength: i32,
  winnerHistoryMultiplier: f64,
): void {
  const precursorContribution: f64 = precursor * wPrecursor;
  const historyContribution: f64   = history   * wHistory;
  const buzzContribution: f64      = buzz      * wBuzz;

  const linear: f64   = precursorContribution + historyContribution + buzzContribution;
  const centered: f64 = (linear - 55.0) / 12.0;

  const strengthMult: f64   = strengthBoost(strength);
  // Logistic sigmoid — requires exp(), which is imported from the JS host.
  const nominationRaw: f64  = (1.0 / (1.0 + hostExp(-centered))) * strengthMult;
  const winnerRaw: f64      = nominationRaw * (0.6 + precursor / 190.0) * winnerHistoryMultiplier;

  store<f64>(RESULT +  0, nominationRaw);
  store<f64>(RESULT +  8, winnerRaw);
  store<f64>(RESULT + 16, precursorContribution);
  store<f64>(RESULT + 24, historyContribution);
  store<f64>(RESULT + 32, buzzContribution);
  store<f64>(RESULT + 40, strengthMult);
  store<f64>(RESULT + 48, winnerHistoryMultiplier);
}
