/**
 * tracing.ts — OpenTelemetry SDK initialisation.
 *
 * This file is the first import in server.ts.  In Node.js ESM, module bodies
 * execute depth-first in import order: this module's body runs before server.ts's
 * body (and before any middleware or route is registered on the Express app).
 * The SDK uses shimmer to patch Express.Router.prototype and node:http on start(),
 * so those patches are in place before app.use() / app.get() are ever called.
 *
 * ── Configuration (standard OpenTelemetry env vars) ──────────────────────────
 *
 *   OTEL_SERVICE_NAME
 *     Span resource tag.  Default: "oscar-odds".
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT
 *     OTLP/HTTP collector URL.  Examples:
 *       http://localhost:4318   — local Jaeger (fastest local setup)
 *       https://api.honeycomb.io — Honeycomb (free tier, needs OTLP_HEADERS too)
 *     Unset → ConsoleSpanExporter in development; SDK disabled in production.
 *
 *   OTEL_EXPORTER_OTLP_HEADERS
 *     Comma-separated key=value forwarded as HTTP headers to the collector.
 *     Honeycomb auth: "x-honeycomb-team=<API_KEY>,x-honeycomb-dataset=oscar-odds"
 *
 *   OTEL_TRACES_SAMPLER / OTEL_TRACES_SAMPLER_ARG
 *     Sampling strategy.  Default: "parentbased_always_on" (sample everything).
 *     For production with real traffic: "traceidratio" + OTEL_TRACES_SAMPLER_ARG=0.1
 *     samples 10 % of root spans and keeps child spans consistent with their parent.
 *
 * ── SPA/SSR trade-off note ────────────────────────────────────────────────────
 * Health (/api/health) and metrics (/api/metrics) probes are excluded from
 * tracing — they're high-frequency polling targets with no actionable information
 * per span.  Including them would skew p99 latency and inflate trace storage.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import type { IncomingMessage } from "node:http";
import type { Span } from "@opentelemetry/api";

const SERVICE_NAME    = process.env.OTEL_SERVICE_NAME ?? "oscar-odds";
const SERVICE_VERSION = "1.0.0";
const DEPLOY_ENV      = process.env.NODE_ENV ?? "development";
const IS_DEV          = DEPLOY_ENV !== "production";
const OTLP_ENDPOINT   = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

// ── Exporter selection ────────────────────────────────────────────────────────
// Priority: OTLP endpoint (any collector) > console (dev only) > disabled.
// Returning null skips SDK start entirely — no per-request overhead for
// deployments that haven't opted into tracing.

function buildExporter(): OTLPTraceExporter | ConsoleSpanExporter | null {
  if (OTLP_ENDPOINT) {
    // Reads OTEL_EXPORTER_OTLP_ENDPOINT + OTEL_EXPORTER_OTLP_HEADERS from env.
    // Works with Jaeger (native OTLP since v1.35), Honeycomb, Grafana Tempo,
    // and any OTLP-compatible backend.
    return new OTLPTraceExporter();
  }
  if (IS_DEV) {
    // Prints human-readable span JSON to stdout so you can verify
    // instrumentation without running a collector.
    return new ConsoleSpanExporter();
  }
  return null;
}

const exporter = buildExporter();

// Export a flag so server.ts can surface tracing status in /api/health.
export const tracingEnabled = exporter !== null;

if (exporter) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]:      SERVICE_NAME,
      [ATTR_SERVICE_VERSION]:   SERVICE_VERSION,
      "deployment.environment": DEPLOY_ENV,
    }),

    traceExporter: exporter,

    instrumentations: [
      // ── HTTP instrumentation ──────────────────────────────────────────────
      // Server spans: every incoming HTTP request → 1 root span.
      // Client spans: every outgoing fetch/http.request (e.g. TMDB poster API).
      new HttpInstrumentation({
        // Exclude health/metrics probes — high frequency, zero analytical value.
        // Keeping them would skew p99 latency charts and inflate storage costs.
        ignoreIncomingRequestHook: (req: IncomingMessage): boolean => {
          const url = req.url ?? "";
          return url.startsWith("/api/health") || url.startsWith("/api/metrics");
        },

        // Share URLs embed LZ-compressed app state as query params.
        // Using the raw URL as the span name creates unbounded cardinality
        // (every unique share link would be a distinct operation name).
        // Strip query strings so the span name stays template-like.
        requestHook: (span: Span, request: unknown): void => {
          const req = request as { method?: string; url?: string };
          if (req.url !== undefined) {
            const path = req.url.split("?")[0] || "/";
            span.updateName(`${req.method ?? "GET"} ${path}`);
          }
        },
      }),

      // ── Express instrumentation ───────────────────────────────────────────
      // Adds a child span per matched route/middleware layer.
      // The span name uses the route template ("/api/forecast/:profileId")
      // not the resolved path ("/api/forecast/default") — bounded cardinality.
      new ExpressInstrumentation(),
    ],
  });

  sdk.start();

  // Drain in-flight spans before the process exits.  Without this, the last
  // batch of spans (covering the shutdown sequence itself) is silently dropped.
  // Both SIGTERM (Render deploy rotation) and SIGINT (local Ctrl-C) must drain.
  const drainAndShutdown = (): void => {
    sdk.shutdown().catch((err: unknown) => {
      process.stderr.write(`[otel] shutdown error: ${String(err)}\n`);
    });
  };
  process.once("SIGTERM", drainAndShutdown);
  process.once("SIGINT",  drainAndShutdown);
}

export {};
