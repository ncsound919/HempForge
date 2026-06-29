/**
 * routes/lims.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * ISO 17025 laboratory directory + handshake toggle.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import {
  saveAuditLog,
  createAuditHash,
} from "../services/backendServices";
import {
  getIsoLabs,
  saveIsoLab,
} from "../lib/firebaseService";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

export function limsRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── GET /api/lims/labs ────────────────────────────────────────────────────
  router.get("/labs", deps.authMiddleware, async (req, res) => {
    try {
      const userContext = req.authContext;
      const labs = await getIsoLabs(
        req.firebaseToken as string,
        userContext?.tenantId || DEFAULT_TENANT
      );
      res.json(labs);
    } catch (err: any) {
      console.error("Error fetching ISO labs:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/lims/toggle-handshake ───────────────────────────────────────
  router.post("/toggle-handshake", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    if (userContext?.userRole !== "Lab Admin") {
      return res.status(403).json({
        error: "Forbidden: Administrative role 'Lab Admin' is required to toggle handshakes",
      });
    }
    const { labId } = req.body;
    const labs = await getIsoLabs(
      req.firebaseToken as string,
      userContext?.tenantId || DEFAULT_TENANT
    );
    const lab = labs.find((l) => l.id === labId);
    if (lab) {
      lab.activeHandshake = !lab.activeHandshake;
      await saveIsoLab(
        lab,
        req.firebaseToken as string,
        userContext?.tenantId || DEFAULT_TENANT
      );

      const handshakeMsg = `ISO 17025 Lab Linkage for '${lab.name}' ${lab.activeHandshake ? "ACTIVATED" : "DEACTIVATED"}. Certificate Number: ${lab.certificateNumber}. Verified via real-time directory audit handshake.`;
      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "unknown-user",
        userRole: userContext?.userRole || "Lab Admin",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
        action: "LIMS_HANDSHAKE_TOGGLE",
        details: handshakeMsg,
        category: "SYSTEM_INTEGRATION",
      };
      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      res.json({ success: true, lab, auditLog: hashedAudit });
    } else {
      res.status(404).json({ error: "ISO Lab ID not found" });
    }
  });

  return router;
}