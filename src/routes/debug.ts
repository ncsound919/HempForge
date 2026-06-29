/**
 * routes/debug.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Debug endpoints. Disabled in production (NODE_ENV=production). These
 * existed in the original monolith for local smoke-testing — preserved
 * here so existing Playwright tests keep passing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { authMiddleware } from "../services/backendServices";
import { fetchFromFirestore } from "../lib/firebaseService";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export function debugRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // GET /api/test-db — dumps raw auditLogs collection. Useful for smoke tests.
  router.get("/test-db", (req, res, next) => {
    if (IS_PRODUCTION) {
      return res.status(404).json({ error: "Not Found" });
    }
    return deps.authMiddleware(req, res, next);
  }, async (req: any, res: any) => {
    try {
      const token = req.firebaseToken as string;
      const logs = await fetchFromFirestore("auditLogs", token);
      res.json({ count: logs.length, logs });
    } catch (err: any) {
      console.error("test-db error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}