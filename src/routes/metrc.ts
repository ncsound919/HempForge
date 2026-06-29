/**
 * routes/metrc.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Metrc / seed-to-sale track & trace. NOTE: as of Phase 0, this is an
 * in-memory stub. Real Metrc integration requires per-state API contracts
 * and is deferred to a later phase. Endpoints preserve the existing
 * request/response shapes so the React frontend keeps working.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import {
  saveAuditLog,
  createAuditHash,
} from "../services/backendServices";
import {
  getMetrcPackages,
  saveMetrcPackage,
} from "../lib/firebaseService";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

export function metrcRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── GET /api/metrc/packages ────────────────────────────────────────────────
  router.get("/packages", deps.authMiddleware, async (req, res) => {
    try {
      const userContext = req.authContext;
      const pkgs = await getMetrcPackages(
        req.firebaseToken as string,
        userContext?.tenantId || DEFAULT_TENANT
      );
      res.json(pkgs);
    } catch (err: any) {
      console.error("Error fetching Metrc packages:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/metrc/sync ──────────────────────────────────────────────────
  router.post("/sync", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    if (
      userContext?.userRole !== "Quality Auditor" &&
      userContext?.userRole !== "Lab Admin"
    ) {
      return res.status(403).json({
        error:
          "Forbidden: Elevated role ('Quality Auditor' or 'Lab Admin') is required for Metrc synchronization",
      });
    }
    const { packageId, syncStatus } = req.body;
    const pkgs = await getMetrcPackages(
      req.firebaseToken as string,
      userContext?.tenantId || DEFAULT_TENANT
    );
    const pkgIndex = pkgs.findIndex((p) => p.packageId === packageId);

    if (pkgIndex !== -1) {
      const updatedPkg = {
        ...pkgs[pkgIndex],
        status: syncStatus || "Testing-Passed",
        lastSyncDate: new Date().toISOString(),
      };

      await saveMetrcPackage(
        updatedPkg,
        req.firebaseToken as string,
        userContext?.tenantId || DEFAULT_TENANT
      );

      const syncDetails = `Metrc package ${packageId} status updated to '${syncStatus}' following ISO 17025 laboratory verification and regulatory pass/fail check.`;
      const newLog: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "unknown-user",
        userRole: userContext?.userRole || "Operator",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
        action: "METRC_SYNC_PUSH",
        details: syncDetails,
        category: "SYSTEM_INTEGRATION",
      };
      const hashedLog: AuditLog = { ...newLog, hash: createAuditHash(newLog) };
      await saveAuditLog(hashedLog, req.firebaseToken as string);

      res.json({ success: true, package: updatedPkg, auditLog: hashedLog });
    } else {
      res.status(404).json({ error: "Metrc Package ID not found" });
    }
  });

  return router;
}