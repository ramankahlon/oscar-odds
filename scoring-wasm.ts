/**
 * scoring-wasm.ts — TypeScript wrapper for the WebAssembly scoring kernel.
 *
 * This module owns the WASM boundary completely.  Callers see a normal
 * TypeScript API; all memory management and type encoding happens here.
 *
 * WASM boundary design
 * ────────────────────
 * WASM 1.0 functions can only accept/return i32 and f64.
 *
 * • Film numbers (precursor, history, buzz, weights) are already f64-compatible,
 *   so they cross the boundary unchanged.
 *
 * • Strength ("High" | "Medium" | "Low") is encoded as i32 (2/1/0) by
 *   strengthToI32() before the call.  Strings cannot transit WASM directly.
 *
 * • ScoreResult (7 fields) is returned via a fixed buffer in WASM linear memory
 *   rather than 7 separate exports.  We pin a Float64Array view to that buffer
 *   at init time, so subsequent reads are plain typed-array indexing.
 *
 * • winnerHistoryMultiplier is pre-computed in JS and passed in as an f64.
 *   It requires arbitrary string→number lookups across a JS config object.
 *   Serialising that map into linear memory on every call would cost far more
 *   than the compute saves — the right place to draw the boundary.
 *
 * Host import
 * ───────────
 * The kernel imports Math.exp from the JS host (declared @external("env","exp")
 * in the AS source).  WASM has no native exp instruction; delegating to the host
 * keeps the binary at ~400 bytes and produces bit-identical results to the JS path.
 */

import type { ScoreResult, Strength } from "./types.js";

// ── WASM export shape ──────────────────────────────────────────────────────────

interface ScoringWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  getResultPtr(): number;
  clamp(value: number, min: number, max: number): number;
  strengthBoost(strength: number): number;
  scoreFilmCore(
    precursor: number,
    history: number,
    buzz: number,
    wPrecursor: number,
    wHistory: number,
    wBuzz: number,
    strength: number,
    winnerHistoryMultiplier: number,
  ): void;
}

// ── Module-level state ─────────────────────────────────────────────────────────

let wasmExports: ScoringWasmExports | null = null;

// Pinned Float64Array over the 7-element result buffer in WASM linear memory.
// Created once at init; valid for the module lifetime (we never grow memory).
let resultView: Float64Array | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Encode the Strength string enum as an i32 for the WASM boundary.
 * Matches the encoding expected by strengthBoost() in wasm/scoring.ts.
 */
export function strengthToI32(s: Strength): number {
  if (s === "High")   return 2;
  if (s === "Medium") return 1;
  return 0; // Low
}

// ── Initialization ─────────────────────────────────────────────────────────────

/**
 * Load and instantiate wasm/scoring.wasm.
 *
 * Browser:  WebAssembly.instantiateStreaming streams the binary directly into the
 *           WASM compiler; the module starts parsing before the download finishes.
 *           This is the correct browser path — never buffer the whole binary first.
 *
 * Node/tests: fetch is absent, so we fall back to reading the file and calling
 *             WebAssembly.instantiate(buffer).  Same semantics, different I/O.
 *
 * Import object: only { env: { exp: Math.exp } } is needed.  The kernel declares
 * the sigmoid's exp as @external("env","exp") so the host wires in JS Math.exp.
 * All other functions are self-contained WASM arithmetic.
 *
 * After instantiation we pin resultView to the fixed result buffer so every
 * subsequent scoreFilmWasm() call is just typed-array indexing — no per-call
 * pointer arithmetic in JS.
 */
export async function initScoringWasm(wasmUrl: string): Promise<void> {
  const imports: WebAssembly.Imports = {
    env: {
      // Only export we need from the host: Math.exp for the logistic sigmoid.
      // Providing it here means the module remains numerically identical to the
      // JS fallback and avoids shipping a hand-rolled libm in WASM.
      exp: Math.exp,
    },
  };

  let instance: WebAssembly.Instance;

  if (typeof fetch !== "undefined" && typeof WebAssembly.instantiateStreaming === "function") {
    // Browser: stream the Response directly — no need to fully buffer the binary.
    const result = await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports);
    instance = result.instance;
  } else {
    // Node.js / test environment: read file then instantiate from the ArrayBuffer.
    const { readFileSync } = await import("node:fs");
    const buffer = readFileSync(new URL(wasmUrl, import.meta.url));
    const result = await WebAssembly.instantiate(buffer, imports);
    instance = result.instance;
  }

  wasmExports = instance.exports as unknown as ScoringWasmExports;

  // Pin a Float64Array to the fixed result buffer.
  // Offset comes from getResultPtr() (currently 0); using the exported value
  // keeps the JS side decoupled from the internal memory layout of the AS module.
  const ptr = wasmExports.getResultPtr();
  resultView = new Float64Array(wasmExports.memory.buffer, ptr, 7);
}

export function isScoringWasmReady(): boolean {
  return wasmExports !== null;
}

// ── Scoring call ───────────────────────────────────────────────────────────────

/**
 * Invoke the WASM scoring kernel and read back the result.
 *
 * Boundary crossing:
 *   IN  — 6 f64 (film fields + weights), 1 i32 (strength), 1 f64 (whm)
 *   OUT — 7 f64 values read from the pinned Float64Array in linear memory
 *
 * The winnerHistoryMultiplier is computed by the caller in JS before this call.
 * It requires string lookups against a JS config object; passing that map into
 * WASM memory on every call would require full serialisation and be pure overhead.
 */
export function scoreFilmWasm(
  precursor: number,
  history: number,
  buzz: number,
  wPrecursor: number,
  wHistory: number,
  wBuzz: number,
  strength: Strength,
  winnerHistoryMultiplier: number,
): ScoreResult {
  if (!wasmExports || !resultView) {
    throw new Error("WASM scoring module not initialized — call initScoringWasm() first");
  }

  wasmExports.scoreFilmCore(
    precursor, history, buzz,
    wPrecursor, wHistory, wBuzz,
    strengthToI32(strength),
    winnerHistoryMultiplier,
  );

  // Read results from WASM linear memory via the pinned Float64Array.
  // Layout matches the store<f64> sequence in wasm/scoring.ts:
  //   [0] nominationRaw  [1] winnerRaw  [2] precursorContribution
  //   [3] historyContribution  [4] buzzContribution
  //   [5] strengthMultiplier   [6] winnerHistoryMultiplier
  return {
    nominationRaw:           resultView[0],
    winnerRaw:               resultView[1],
    precursorContribution:   resultView[2],
    historyContribution:     resultView[3],
    buzzContribution:        resultView[4],
    strengthMultiplier:      resultView[5],
    winnerHistoryMultiplier: resultView[6],
  };
}
