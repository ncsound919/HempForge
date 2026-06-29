/**
 * routes/verify.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Public COA verification endpoint. No auth required — anyone with the COA
 * ID (typically via QR scan on packaging) can verify cryptographic
 * authenticity of the dry-weight metrics.
 *
 * Uses firebase-admin directly (bypasses our getCoas helper) because there
 * is no tenant context to scope by. The COA itself contains its own
 * tenantId; we just confirm the signature is intact.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { param } from "express-validator";
import { adminDb, signCoa } from "../services/backendServices";

export function verifyRouter(): Router {
  const router = Router();

  router.get(
    "/verify/:id",
    [param("id").isString().trim().notEmpty().escape()],
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      const { id } = req.params;

      if (!adminDb) {
        return res.status(503).json({
          error: "Service Unavailable: Live registry DB is not initialized.",
        });
      }

      try {
        const doc = await adminDb.collection("coas").doc(id).get();
        if (!doc.exists) {
          return res.status(404).json({
            error: "Certificate not found",
            details: `No COA with ID ${id} registered in the public GxP compliance ledger.`,
          });
        }
        const coa = doc.data();
        if (!coa) {
          return res.status(404).json({ error: "Certificate empty" });
        }

        const expectedSignature = signCoa(coa);
        const signatureMatches = coa.complianceSignature === expectedSignature;

        res.json({
          ...coa,
          signatureMatches,
          verifiedAt: new Date().toISOString(),
          verificationStatus: signatureMatches ? "VERIFIED_VALID" : "SIGNATURE_CORRUPTED",
          disclaimer:
            "This document is a certified digital copy of North Carolina hemp GxP compliance metrics. Any modification of dry weight metrics invalidates the cryptographic signature.",
        });
      } catch (err: any) {
        console.error("Public COA verification error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  return router;
}