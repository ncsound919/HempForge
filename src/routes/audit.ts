/**
 * routes/audit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Audit log endpoints. Authenticated. Chain-integrity verification is gated
 * to Quality Auditor / Lab Admin per ALCOA+ principle of independent review.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import {
  getAuditLogs,
  saveAuditLog,
  createAuditHash,
  checkGeminiRateLimit,
  GEMINI_LIMIT_MAX_REQUESTS,
} from "../services/backendServices";
import { verifyAuditChain } from "../lib/auditEngine";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

function isChainedAuditEntry(log: AuditLog): log is AuditLog & {
  sequenceNumber: number;
  previousHash: string;
} {
  return typeof (log as any).sequenceNumber === "number" && typeof (log as any).previousHash === "string";
}

export function auditRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── GET /api/audit/logs ───────────────────────────────────────────────────
  router.get("/logs", deps.authMiddleware, async (req, res) => {
    try {
      const logs = await getAuditLogs(req.firebaseToken as string);
      const tenantId = req.authContext?.tenantId || DEFAULT_TENANT;
      const filteredLogs = logs.filter((log) => log.tenantId === tenantId);
      res.json(filteredLogs);
    } catch (err: any) {
      console.error("Error fetching audit logs:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/audit/logs ──────────────────────────────────────────────────
  router.post("/logs", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    const { action, details, category } = req.body;

    const newLog: Omit<AuditLog, "hash"> = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: userContext?.userId || "system-agent",
      userRole: userContext?.userRole || "Operator",
      tenantId: userContext?.tenantId || DEFAULT_TENANT,
      action: action || "SYSTEM_EVENT",
      details: details || "No details provided",
      category: category || "SYSTEM_INTEGRATION",
    };

    const hashedLog: AuditLog = {
      ...newLog,
      hash: createAuditHash(newLog),
    };

    await saveAuditLog(hashedLog, req.firebaseToken as string);
    res.status(201).json(hashedLog);
  });

  // ─── POST /api/audit/verify-chain ──────────────────────────────────────────
  router.post("/verify-chain", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    const userId = userContext?.userId || "unknown-user";

    const rateLimit = checkGeminiRateLimit(userId);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "Rate limit exceeded for audit verification.",
        details: `Please try again after ${new Date(rateLimit.resetTime).toLocaleTimeString()}.`,
      });
    }

    if (userContext?.userRole !== "Quality Auditor" && userContext?.userRole !== "Lab Admin") {
      return res.status(403).json({
        error: "Forbidden: Quality Auditor or Lab Admin role required for chain verification",
      });
    }

    try {
      const logs = await getAuditLogs(req.firebaseToken as string);
      const tenantId = userContext?.tenantId || DEFAULT_TENANT;
      const tenantLogs = logs.filter((log) => log.tenantId === tenantId);

      const chainEntries = tenantLogs.filter(isChainedAuditEntry) as unknown as Array<
        AuditLog & { sequenceNumber: number; previousHash: string }
      >;
      const legacyLogs = tenantLogs.filter((log) => !isChainedAuditEntry(log));

      const chainResult = verifyAuditChain(chainEntries);

      const legacyResults = legacyLogs.map((log) => {
        const expectedHash = createAuditHash({
          id: log.id,
          timestamp: log.timestamp,
          userId: log.userId,
          userRole: log.userRole,
          tenantId: log.tenantId,
          action: log.action,
          details: log.details,
          category: log.category,
        });
        return {
          id: log.id,
          timestamp: log.timestamp,
          action: log.action,
          hashValid: log.hash === expectedHash,
          storedHash: log.hash?.substring(0, 16) + "...",
        };
      });
      const legacyCorrupted = legacyResults.filter((r) => !r.hashValid).length;

      res.json({
        totalEntries: tenantLogs.length,
        chainEntries: chainResult.totalEntries,
        chainVerified: chainResult.verifiedEntries,
        chainIntact: chainResult.valid && legacyCorrupted === 0,
        chainDetails: chainResult,
        legacyEntries: legacyLogs.length,
        legacyVerified: legacyLogs.length - legacyCorrupted,
        legacyCorrupted,
        verifiedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("Audit chain verification error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

// Re-export so existing imports keep working
export { GEMINI_LIMIT_MAX_REQUESTS };