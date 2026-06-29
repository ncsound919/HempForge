/**
 * routes/coa.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Certificate of Analysis endpoints. All authenticated. Public verification
 * (GET /api/coas/verify/:id) lives in verify.ts because it has no auth and
 * a different storage path.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import crypto from "crypto";
import { param } from "express-validator";
import {
  saveAuditLog,
  createAuditHash,
  signCoa,
} from "../services/backendServices";
import { TenantRepository } from "../lib/firebaseRepo";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

export function coaRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── GET /api/coas ─────────────────────────────────────────────────────────
  router.get("/", deps.authMiddleware, async (req, res) => {
    const tenantId = req.authContext?.tenantId || DEFAULT_TENANT;
    try {
      const repo = new TenantRepository<any>("coas", tenantId);
      const list = await repo.list();
      res.json(list);
    } catch (err: any) {
      console.error("Error fetching COAs:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /api/coas/:id ─────────────────────────────────────────────────────
  router.get(
    "/:id",
    deps.authMiddleware,
    [param("id").isString().trim().notEmpty().escape()],
    async (req, res) => {
      const tenantId = req.authContext?.tenantId || DEFAULT_TENANT;
      const { id } = req.params;
      try {
        const repo = new TenantRepository<any>("coas", tenantId);
        const coa = await repo.get(id);
        if (!coa) {
          return res.status(404).json({ error: "COA not found" });
        }
        res.json(coa);
      } catch (err: any) {
        console.error("COA fetch error:", err);
        res.status(500).json({ error: "Failed to fetch COA" });
      }
    }
  );

  // ─── POST /api/coas ────────────────────────────────────────────────────────
  router.post("/", deps.authMiddleware, async (req, res) => {
    const tenantId = req.authContext?.tenantId || DEFAULT_TENANT;
    const token = req.firebaseToken as string;
    const userContext = req.authContext;
    const coaData = req.body;

    if (!coaData.batchId || !coaData.strain) {
      return res.status(400).json({ error: "Batch ID and Strain are required for COA registration" });
    }

    const coaId = coaData.id || `coa-${crypto.randomUUID()}`;
    const newCoa: any = {
      ...coaData,
      id: coaId,
      uploadDate: coaData.uploadDate || new Date().toISOString().split("T")[0],
      userId: userContext?.userId || "unknown-user",
      tenantId,
      certifiedBy: userContext?.userEmail || "System Compliance Agent",
      certificationDate: new Date().toISOString().split("T")[0],
      labCertificateNumber: coaData.labCertificateNumber || "Cert-4493-02",
      labName: coaData.labName || "Wilmington Analytical Chemistry Services",
    };

    try {
      newCoa.complianceSignature = signCoa(newCoa);
    } catch (err: any) {
      return res.status(500).json({ error: "COA signing failed" });
    }

    const repo = new TenantRepository<any>("coas", tenantId);
    await repo.save({ ...newCoa });

    const auditDetails = `Registered new Certified COA in GxP Ledger for Batch ${newCoa.batchId} (${newCoa.strain}). Total THC: ${newCoa.totalThc.toFixed(3)}%. Signed Certificate Issued: ${newCoa.complianceSignature.substring(0, 16)}...`;
    const auditEntry: Omit<AuditLog, "hash"> = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: userContext?.userId || "system-agent",
      userRole: userContext?.userRole || "Operator",
      tenantId,
      action: "COA_REGISTRY_WRITE",
      details: auditDetails,
      category: "DATA_CHANGE",
    };

    const hashedLog: AuditLog = {
      ...auditEntry,
      hash: createAuditHash(auditEntry),
    };
    await saveAuditLog(hashedLog, token);

    res.status(201).json(newCoa);
  });

  return router;
}