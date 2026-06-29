/**
 * routes/compliance.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic compliance threshold engine. Pure math, no AI. The result
 * is wrapped in a formula-provenance envelope so the UI can distinguish
 * computed verdicts from AI-generated commentary.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { calculateCompliance } from "../lib/complianceEngine";
import { createFormulaProvenance } from "../lib/provenanceEngine";
import { DEFAULT_TENANT } from "../config";

export function complianceRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── POST /api/compliance/calculate ────────────────────────────────────────
  router.post("/calculate", deps.authMiddleware, (req, res) => {
    const { thca, d9thc, totalThc, productType, servingSizeGrams, cumulativeThcMg } = req.body;
    const userContext = req.authContext;

    const result = calculateCompliance({
      thca,
      d9thc,
      totalThc,
      productType,
      servingSizeGrams,
      cumulativeThcMg,
    });

    const response = createFormulaProvenance(
      {
        calculatedTotal: result.calculatedTotal,
        status: result.status,
        alerts: result.alerts,
        timestamp: result.processingIntegrity.computedAt,
        governingAuthority: result.processingIntegrity.governingAuthority,
        processingIntegrity: result.processingIntegrity,
      },
      {
        formula: result.processingIntegrity.formula,
        inputs: { thca, d9thc, totalThc, productType, servingSizeGrams, cumulativeThcMg },
        userId: userContext?.userId || "unknown",
        userRole: userContext?.userRole || "Operator",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
      }
    );

    res.json(response);
  });

  return router;
}