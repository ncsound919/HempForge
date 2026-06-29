/**
 * errorHandler.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized error mapping. express-async-errors forwards thrown errors
 * from async handlers to here. We:
 *   1. Log the full error server-side (with stack).
 *   2. Return a sanitized JSON body to the client.
 *
 * Known error shapes we map explicitly:
 *   - Multer/JSON parse errors → 400
 *   - Auth middleware errors   → already 401/403 before reaching us
 *   - Validation errors        → 422
 *   - Everything else          → 500
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/structuredLogger";

export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({ error: "Not Found", path: req.originalUrl });
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const requestId = req.requestId;

  // JSON body parse errors from express.json()
  if (err?.type === "entity.parse.failed") {
    logger.warn("request.bad_json", { requestId, message: err.message });
    res.status(400).json({ error: "Invalid JSON body", requestId });
    return;
  }

  // Payload too large
  if (err?.type === "entity.too.large") {
    logger.warn("request.payload_too_large", { requestId, length: err.length });
    res.status(413).json({ error: "Request body too large", requestId });
    return;
  }

  // Our own HttpError
  if (err instanceof HttpError) {
    logger.warn("request.http_error", {
      requestId,
      status: err.status,
      message: err.message,
      details: err.details,
    });
    res.status(err.status).json({ error: err.message, details: err.details, requestId });
    return;
  }

  // Unknown
  logger.error("request.unhandled_error", {
    requestId,
    message: err?.message ?? String(err),
    stack: err?.stack,
    path: req.originalUrl,
  });
  res.status(500).json({ error: "Internal Server Error", requestId });
}