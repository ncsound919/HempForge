/**
 * requestLogger.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Assigns a correlation ID to every request, emits a structured start log,
 * and a completion log with duration. The correlation ID is echoed back in
 * the x-request-id response header so clients can include it in bug reports.
 *
 * Pairs with src/lib/structuredLogger.ts. The logger writes JSON lines;
 * this middleware just adds the request-context fields.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../lib/structuredLogger";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTime?: number;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId =
    (req.headers["x-request-id"] as string | undefined) || crypto.randomUUID();
  req.requestId = requestId;
  req.startTime = Date.now();
  res.setHeader("x-request-id", requestId);

  logger.info("request.start", {
    requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    userId: req.authContext?.userId,
    tenantId: req.authContext?.tenantId,
    role: req.authContext?.userRole,
  });

  res.on("finish", () => {
    logger.info("request.finish", {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: Date.now() - (req.startTime ?? Date.now()),
      userId: req.authContext?.userId,
      tenantId: req.authContext?.tenantId,
    });
  });

  next();
}