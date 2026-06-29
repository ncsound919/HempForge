/**
 * structuredLogger.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * JSON-line logger. One line per log event. Easy to ship to Cloud Logging,
 * Datadog, Loki, or any aggregator that ingests JSON.
 *
 * Output format:
 *   {"ts":"2026-06-29T12:34:56.789Z","level":"info","msg":"request.start",
 *    "requestId":"...","method":"GET","path":"/api/coas",...}
 *
 * In development, the level defaults to "debug" and output goes to stdout.
 * In production, the level defaults to "info" and output goes to stdout
 * (a sidecar/aggregator is expected to scrape it).
 * ─────────────────────────────────────────────────────────────────────────────
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const LOG_LEVEL: Level = (process.env.LOG_LEVEL as Level) || (IS_PRODUCTION ? "info" : "debug");

function shouldEmit(level: Level): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[LOG_LEVEL];
}

function emit(level: Level, msg: string, fields: Record<string, unknown>): void {
  if (!shouldEmit(level)) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  // Use process.stdout/stderr so the line is a single newline-delimited JSON
  // record. JSON.stringify with no trailing comma; write directly.
  const out = JSON.stringify(line) + "\n";
  if (level === "error" || level === "warn") {
    process.stderr.write(out);
  } else {
    process.stdout.write(out);
  }
}

export const logger = {
  debug(msg: string, fields: Record<string, unknown> = {}): void {
    emit("debug", msg, fields);
  },
  info(msg: string, fields: Record<string, unknown> = {}): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields: Record<string, unknown> = {}): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields: Record<string, unknown> = {}): void {
    emit("error", msg, fields);
  },
};