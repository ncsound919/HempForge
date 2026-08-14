/**
 * routes/compliance.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic compliance threshold engine. Pure math, no AI. The result
 * is wrapped in a formula-provenance envelope so the UI can distinguish
 * computed verdicts from AI-generated commentary.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import type { Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { calculateCompliance } from "../lib/complianceEngine";
import { createFormulaProvenance } from "../lib/provenanceEngine";
import { DEFAULT_TENANT } from "../config";

export function complianceRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── POST /api/compliance/calculate ────────────────────────────────────────
  // Input validation (SaaS hardening): numeric bounds for the THC inputs,
  // string bounds for productType. Boundary/negative/absurd inputs are
  // rejected with 400 instead of being fed into the engine.
  router.post(
    "/calculate",
    deps.authMiddleware,
    [
      body("thca").optional().isFloat({ min: 0, max: 100 }).withMessage("thca must be a number in [0,100]"),
      body("d9thc").optional().isFloat({ min: 0, max: 100 }).withMessage("d9thc must be a number in [0,100]"),
      body("totalThc").optional().isFloat({ min: 0, max: 100 }).withMessage("totalThc must be a number in [0,100]"),
      body("productType").optional().isString().trim().isLength({ min: 1, max: 80 }).withMessage("productType must be a short string"),
      body("servingSizeGrams").optional().isFloat({ min: 0, max: 10000 }).withMessage("servingSizeGrams must be a non-negative number"),
      body("cumulativeThcMg").optional().isFloat({ min: 0, max: 100000 }).withMessage("cumulativeThcMg must be a non-negative number"),
      body("strain").optional().isString().trim().isLength({ max: 500 }).withMessage("strain must be a short string"),
    ],
    (req: Request, res: Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: "Invalid compliance input", details: errors.array().map((e) => e.msg) });
      }

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
          userId: userContext?.userId || "unknown",
          userRole: userContext?.userRole || "Operator",
          tenantId: userContext?.tenantId || DEFAULT_TENANT,
        }
      );

      res.json(response);
    }
  );

  return router;
}