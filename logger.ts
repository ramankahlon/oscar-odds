import pino from "pino";
import { trace } from "@opentelemetry/api";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",

    // Inject the active span's trace and span IDs into every log record.
    // This lets you jump from a Pino log line directly to its trace in
    // Jaeger/Honeycomb/Grafana by filtering on traceId.
    // Returns {} when no span is active (startup logs, background tasks) —
    // the field is simply omitted rather than set to a zero-value string.
    mixin(): Record<string, string> {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const ctx = span.spanContext();
      return { traceId: ctx.traceId, spanId: ctx.spanId };
    },
  },
  isDev
    ? pino.transport({
        target: "pino-pretty",
        options: { colorize: true, ignore: "pid,hostname" },
      })
    : undefined
);
