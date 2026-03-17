#!/usr/bin/env tsx
/**
 * analyze.ts
 *
 * Orchestrates the full analysis pipeline in dependency order:
 *
 *   Stage 1 (serial):
 *     optimize-weights  →  data/learned-weights.json
 *
 *   Stage 2 (parallel, all read learned-weights or oscar-history only):
 *     calibrate         →  data/calibration.json
 *     bootstrap-ci      →  data/bootstrap-ci.json
 *     joint-probability →  data/joint-probability.json
 *     feature-importance→  data/feature-importance.json
 *     brier-decomposition→ data/brier-decomposition.json
 *     ab-test           →  data/ab-test.json
 *     pr-roc            →  data/pr-roc.json
 *     rolling-error     →  data/rolling-error.json
 *
 *   Stage 3 (validation):
 *     Confirms all 9 output files exist, are non-empty JSON objects, and
 *     were written within the last 5 minutes (i.e. by this run).
 *
 * Usage:  npm run analyze
 *
 * Flags:
 *   --skip-optimize   Skip stage 1 and reuse the existing learned-weights.json.
 *                     Useful when only the downstream scripts need refreshing.
 *   --only=<names>    Comma-separated list of stage-2 scripts to run instead of
 *                     all eight (e.g. --only=calibrate,pr-roc).
 */

import { spawn } from "child_process";
import { existsSync, statSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, "..");
const DATA       = join(ROOT, "data");

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args          = process.argv.slice(2);
const skipOptimize  = args.includes("--skip-optimize");
const onlyFlag      = args.find(a => a.startsWith("--only="));
const onlyNames     = onlyFlag ? onlyFlag.replace("--only=", "").split(",").map(s => s.trim()) : null;

// ── Helpers ───────────────────────────────────────────────────────────────────

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const DIM    = "\x1b[2m";

function log(msg: string): void { process.stdout.write(msg + "\n"); }
function hr(ch = "─", len = 68): string { return ch.repeat(len); }

/** Runs a tsx script and streams its stdout/stderr prefixed with [name]. */
function runScript(name: string, scriptPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const label   = `${DIM}[${name}]${RESET} `;
    const child   = spawn("node", ["--import", "tsx/esm", scriptPath], {
      cwd:   ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env:   { ...process.env }
    });

    child.stdout.on("data", (chunk: Buffer) => {
      chunk.toString().split("\n").forEach(line => {
        if (line) process.stdout.write(label + line + "\n");
      });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      chunk.toString().split("\n").forEach(line => {
        if (line) process.stderr.write(`${DIM}[${name}]${RESET} ${RED}${line}${RESET}\n`);
      });
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} exited with code ${code}`));
    });
  });
}

// ── Output manifest ───────────────────────────────────────────────────────────

interface OutputSpec {
  /** Human-readable script name (matches npm run key). */
  name:    string;
  /** Path to the script relative to scripts/. */
  script:  string;
  /** Expected output file relative to data/. */
  outFile: string;
  /** Top-level key that must exist in the JSON output. */
  checkKey: string;
}

const STAGE1: OutputSpec = {
  name:    "optimize-weights",
  script:  "scripts/optimize-weights.ts",
  outFile: "learned-weights.json",
  checkKey: "weights"
};

const STAGE2: OutputSpec[] = [
  { name: "calibrate",          script: "scripts/calibrate.ts",            outFile: "calibration.json",        checkKey: "nomination"  },
  { name: "bootstrap-ci",       script: "scripts/bootstrap-ci.ts",         outFile: "bootstrap-ci.json",       checkKey: "summary"     },
  { name: "joint-probability",  script: "scripts/joint-probability.ts",    outFile: "joint-probability.json",  checkKey: "categories"  },
  { name: "feature-importance", script: "scripts/feature-importance.ts",   outFile: "feature-importance.json", checkKey: "features"    },
  { name: "brier-decomposition",script: "scripts/brier-decomposition.ts",  outFile: "brier-decomposition.json",checkKey: "nomination"  },
  { name: "ab-test",            script: "scripts/ab-test-presets.ts",      outFile: "ab-test.json",            checkKey: "presets"     },
  { name: "pr-roc",             script: "scripts/pr-roc.ts",               outFile: "pr-roc.json",             checkKey: "overall"     },
  { name: "rolling-error",      script: "scripts/rolling-error.ts",        outFile: "rolling-error.json",      checkKey: "years"       },
];

// ── Validation ────────────────────────────────────────────────────────────────

interface ValidationResult {
  spec:   OutputSpec;
  ok:     boolean;
  reason?: string;
}

const FRESH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function validateOutput(spec: OutputSpec, startedAt: number): ValidationResult {
  const filePath = join(DATA, spec.outFile);

  if (!existsSync(filePath)) {
    return { spec, ok: false, reason: "file not found" };
  }

  const stat = statSync(filePath);
  if (stat.mtimeMs < startedAt) {
    return { spec, ok: false, reason: `not updated (mtime predates run start by ${Math.round((startedAt - stat.mtimeMs) / 1000)}s)` };
  }

  if (stat.size === 0) {
    return { spec, ok: false, reason: "file is empty" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return { spec, ok: false, reason: "invalid JSON" };
  }

  if (!(spec.checkKey in parsed)) {
    return { spec, ok: false, reason: `missing key "${spec.checkKey}"` };
  }

  return { spec, ok: true };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startedAt = Date.now();

  log(`\n${BOLD}╔${hr("═")}╗${RESET}`);
  log(`${BOLD}║  OSCAR ODDS — ANALYSIS PIPELINE${" ".repeat(35)}║${RESET}`);
  log(`${BOLD}╚${hr("═")}╝${RESET}\n`);

  if (skipOptimize) {
    log(`${YELLOW}--skip-optimize:${RESET} reusing existing data/learned-weights.json\n`);
  }
  if (onlyNames) {
    log(`${YELLOW}--only:${RESET} running stage 2 subset: ${onlyNames.join(", ")}\n`);
  }

  const stage2 = onlyNames
    ? STAGE2.filter(s => onlyNames.includes(s.name))
    : STAGE2;

  if (onlyNames) {
    const unknown = onlyNames.filter(n => !STAGE2.some(s => s.name === n));
    if (unknown.length) {
      log(`${RED}Unknown script(s) in --only: ${unknown.join(", ")}${RESET}`);
      log(`Valid names: ${STAGE2.map(s => s.name).join(", ")}`);
      process.exit(1);
    }
  }

  // ── Stage 1: optimize-weights ─────────────────────────────────────────────

  if (!skipOptimize) {
    log(`${CYAN}${BOLD}▶ Stage 1/2 — optimize-weights${RESET}  (serial — other scripts depend on its output)\n`);
    const t0 = Date.now();
    try {
      await runScript(STAGE1.name, join(ROOT, STAGE1.script));
    } catch (err) {
      log(`\n${RED}${BOLD}✗ optimize-weights failed:${RESET} ${(err as Error).message}`);
      process.exit(1);
    }
    log(`\n${GREEN}✓ optimize-weights completed in ${((Date.now() - t0) / 1000).toFixed(1)}s${RESET}\n`);
  }

  // ── Stage 2: parallel analysis scripts ───────────────────────────────────

  log(`${CYAN}${BOLD}▶ Stage 2/2 — running ${stage2.length} analysis script(s) in parallel${RESET}\n`);
  const t1 = Date.now();

  const results = await Promise.allSettled(
    stage2.map(spec => runScript(spec.name, join(ROOT, spec.script)))
  );

  const failures = results
    .map((r, i) => ({ r, spec: stage2[i] }))
    .filter(({ r }) => r.status === "rejected");

  if (failures.length) {
    log(`\n${RED}${BOLD}✗ ${failures.length} script(s) failed:${RESET}`);
    failures.forEach(({ r, spec }) => {
      const reason = r.status === "rejected" ? (r.reason as Error).message : "";
      log(`  ${RED}•${RESET} ${spec.name}: ${reason}`);
    });
  }

  log(`\n${CYAN}Stage 2 completed in ${((Date.now() - t1) / 1000).toFixed(1)}s${RESET}\n`);

  // ── Stage 3: validation ───────────────────────────────────────────────────

  log(`${BOLD}${hr()}${RESET}`);
  log(`${BOLD}Validating outputs…${RESET}\n`);

  const allSpecs = skipOptimize ? stage2 : [STAGE1, ...stage2];
  const validations = allSpecs.map(spec => validateOutput(spec, startedAt));

  const colW = Math.max(...allSpecs.map(s => s.outFile.length));
  for (const v of validations) {
    const icon   = v.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const status = v.ok ? `${GREEN}ok${RESET}` : `${RED}${v.reason}${RESET}`;
    log(`  ${icon}  ${v.spec.outFile.padEnd(colW)}  ${status}`);
  }

  const allOk = validations.every(v => v.ok);
  log("");

  if (allOk) {
    log(`${GREEN}${BOLD}All ${validations.length} outputs validated successfully.${RESET}`);
    log(`${DIM}Total wall time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s${RESET}\n`);
  } else {
    const bad = validations.filter(v => !v.ok).length;
    log(`${RED}${BOLD}${bad} output(s) failed validation. See above for details.${RESET}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
