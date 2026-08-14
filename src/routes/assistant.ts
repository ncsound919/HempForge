/**
 * routes/assistant.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic assistant endpoints. No LLM. Pure rule-based intent
 * classification + retrieval + template rendering.
 *
 *   POST /api/assistant/ask              — answer a question
 *   POST /api/assistant/recommend         — recommend next action based on workflow state
 *   POST /api/assistant/explain-decision  — explain a decision (compliance / risk / audit)
 *   GET  /api/assistant/intents           — list known intents
 *   GET  /api/assistant/index/stats       — index size per tenant
 */

import { Router, RequestHandler, Request, Response } from "express";
import { assistantEngine } from "../assistant/assistantEngine";
import { tenantRetrievalIndex } from "../assistant/retrievalIndex";
import { TenantRepository } from "../lib/firebaseRepo";
import { calculateCompliance, scoreBatchRisk } from "../lib/complianceEngine";
import { decideBatchRelease, decideCOAAlert, recommendDisposition } from "../lib/decisionEngine";

interface WorkflowNode {
  id: string;
  label: string;
  requires?: string[];
  produces?: string[];
}

const WORKFLOW_GRAPH: WorkflowNode[] = [
  { id: "intake",     label: "COA Intake",        requires: ["coaRecord"],        produces: ["coas"] },
  { id: "verify",     label: "Lab Verification",  requires: ["coas", "labCert"],   produces: ["verifiedCoas"] },
  { id: "compliance", label: "Compliance Check",  requires: ["verifiedCoas"],     produces: ["complianceResult"] },
  { id: "audit",      label: "Audit Log Entry",   requires: ["complianceResult"], produces: ["auditEntry"] },
  { id: "release",    label: "Batch Release",     requires: ["auditEntry", "metrcStatus"], produces: ["releaseDecision"] },
  { id: "report",     label: "Compliance Report", requires: ["releaseDecision"],  produces: ["report"] },
];

export function assistantRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  router.post("/ask", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const question = (req.body?.question ?? req.body?.message ?? "").toString().trim();
    if (!question) return res.status(400).json({ error: "question is required" });
    if (question.length > 1000) return res.status(400).json({ error: "Question must be ≤ 1000 chars" });
    const answer = await assistantEngine.answer(tenantId, question);
    res.json(answer);
  });

  router.post("/recommend", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const coasRepo = new TenantRepository<any>("coas", tenantId);
    const metrcRepo = new TenantRepository<any>("metrcPackages", tenantId);
    const auditRepo = new TenantRepository<any>("auditLogs", tenantId);
    const reportsRepo = new TenantRepository<any>("reports", tenantId);

    const [coas, metrc, audits, reports] = await Promise.all([
      coasRepo.list(),
      metrcRepo.list(),
      auditRepo.list(),
      reportsRepo.list(),
    ]);

    const has = {
      coas: coas.length > 0,
      labCert: coas.some((c: any) => c.labCertificateNumber),
      verifiedCoas: coas.some((c: any) => c.complianceSignature),
      complianceResult: coas.some((c: any) => c.status),
      auditEntry: audits.length > 0,
      metrcStatus: metrc.length > 0,
      releaseDecision: coas.some((c: any) => c.recommendation === "release" || c.status === "Compliant"),
      report: reports.length > 0,
    };

    const completed = new Set<string>();
    if (has.coas) completed.add("intake");
    if (has.labCert && has.coas) completed.add("verify");
    if (has.verifiedCoas) completed.add("compliance");
    if (has.auditEntry) completed.add("audit");
    if (has.releaseDecision) completed.add("release");
    if (has.report) completed.add("report");

    const next = WORKFLOW_GRAPH.find((n) => !completed.has(n.id));
    const blocked: Array<{ node: string; missing: string[] }> = [];

    if (next) {
      for (const req of next.requires || []) {
        if (!has[req as keyof typeof has]) {
          blocked.push({ node: next.id, missing: [req] });
        }
      }
    }

    res.json({
      tenantId,
      workflowGraph: WORKFLOW_GRAPH,
      completedSteps: [...completed],
      nextStep: next ?? null,
      blockedRequirements: blocked,
      stateCounts: {
        coas: coas.length,
        metrcPackages: metrc.length,
        auditEntries: audits.length,
        reports: reports.length,
      },
      permissions: req.authContext?.userRole
        ? {
            role: req.authContext.userRole,
            canRelease: req.authContext.userRole === "Lab Admin" || req.authContext.userRole === "Quality Auditor",
          }
        : null,
      provenance: {
        method: "workflow-graph-traversal",
        nodesEvaluated: WORKFLOW_GRAPH.length,
      },
    });
  });

  router.post("/explain-decision", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const { kind, thca, d9thc, productType, totalThc, previousD9thc, trendDeviation } = req.body || {};

    let decision: any = null;
    let explanation: any = null;

    if (kind === "compliance") {
      const compliance = calculateCompliance({
        thca: Number(thca) || 0,
        d9thc: Number(d9thc) || 0,
        productType,
        totalThc,
      });
      const alert = decideCOAAlert({
        thca: Number(thca) || 0,
        d9thc: Number(d9thc) || 0,
        previousD9thc,
        trendDeviation,
        testLabCertified: true,
        testDate: new Date(),
      });
      decision = { compliance, alert };
      explanation = {
        complianceFiredRules: [
          { rule: "TOTAL_THC_BAND", value: `${(compliance.calculatedTotal ?? 0).toFixed(3)}%`, status: compliance.status },
          { rule: "FDA_SERVING_CAP", value: "0.4 mg / serving", status: compliance.alerts.includes("serving limit exceeded") ? "FAIL" : "PASS" },
        ],
        alertFiredRules: alert.reasons.map((r: string) => ({ rule: r, status: alert.severity })),
      };
    } else if (kind === "risk") {
      const risk = scoreBatchRisk({ thca, d9thc, totalThc, productType, status: totalThc > 0.3 ? "Non-Compliant" : totalThc >= 0.25 ? "At Risk" : "Compliant" });
      decision = risk;
      explanation = {
        riskFiredRules: risk.factors.map((f: string) => ({ rule: f, score: risk.score, level: risk.level })),
      };
    } else if (kind === "release") {
      const r = decideBatchRelease({
        thca: Number(thca) || 0,
        d9thc: Number(d9thc) || 0,
        auditLogs: [],
        metrcStatus: "Active",
        requiredApprovals: ["Lab Admin"],
        completedApprovals: ["Lab Admin"],
        productType: productType || "Flower",
      });
      const disp = recommendDisposition({
        complianceStatus: totalThc > 0.3 ? "non_compliant" : totalThc >= 0.25 ? "borderline" : "compliant",
        productType: productType || "Flower",
        auditIntact: true,
        metrcStatus: "Active",
      });
      decision = { release: r, disposition: disp };
      explanation = {
        releaseFiredRules: r.reasons.map((reason: string) => ({ rule: reason, ready: r.ready })),
        dispositionFiredRules: [{ rule: disp.rationale, recommendation: disp.recommendation }],
      };
    } else {
      return res.status(400).json({ error: "kind must be 'compliance' | 'risk' | 'release'" });
    }

    res.json({
      tenantId,
      kind,
      decision,
      explanation,
      provenance: {
        method: "decision-engine-rule-trace",
        engine: "src/lib/decisionEngine.ts",
      },
    });
  });

  router.get("/intents", deps.authMiddleware, async (_req: Request, res: Response) => {
    res.json({
      intents: [
        "compliance.calculate",
        "compliance.status",
        "coa.parse",
        "coa.verify",
        "literature.search",
        "literature.trends",
        "audit.verify",
        "risk.explain",
        "autonomy.run",
        "settings.ollama",
        "help.navigation",
      ],
      method: "rule-based-intent-classification",
      totalRules: 41,
    });
  });

  router.get("/index/stats", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const stats = await tenantRetrievalIndex.stats(tenantId);
    res.json({ tenantId, ...stats });
  });

  return router;
}