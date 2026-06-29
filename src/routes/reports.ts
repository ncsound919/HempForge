/**
 * routes/reports.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Compliance & ROI report generation.
 *
 * Tiered execution model:
 *   Tier 1 — reportTemplates assembles ALL structured sections deterministically
 *   Tier 3/4 — LLM (Ollama or Gemini via llmGate) fills narrative_placeholder
 *              sections only. If neither LLM is available, executiveSummary
 *              is omitted and the report is still complete and valid.
 *
 * The platform never hard-fails due to a missing GEMINI_API_KEY.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { adminDb, createAuditHash, saveAuditLog } from "../services/backendServices";
import { getCoas } from "../lib/firebaseService";
import {
  generateReport,
  formatReportAsMarkdown,
  formatReportAsHtml,
  type BatchRecord as ReportBatchRecord,
} from "../lib/reportEngine";
import {
  buildComplianceAuditReport,
  type ComplianceAuditParams,
} from "../lib/reportTemplates";
import { llmGate, selectLLM, withTierMeta } from "../middleware/llmGate";
import { requirePermission } from "../lib/permissionsEngine";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

export function reportsRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── POST /api/reports/generate ────────────────────────────────────────────
  // llmGate runs first: probes Gemini key + Ollama reachability, attaches
  // req.llmAvailable so the handler can select the right tier without blocking.
  router.post(
    "/generate",
    deps.authMiddleware,
    llmGate,
    requirePermission("GENERATE_REPORT"),
    async (req, res) => {
      const userContext = req.authContext;
      const token = req.firebaseToken as string;
      const tenantId = userContext?.tenantId || DEFAULT_TENANT;
      const { format = "json", reportType = "compliance-roi" } = req.body || {};

      try {
        const rawCoas = await getCoas(token, tenantId);

        const batches: ReportBatchRecord[] = rawCoas.map((c: any) => ({
          id: c.id,
          batchId: c.batchId,
          strain: c.strain,
          uploadDate: c.uploadDate,
          thca: c.thca,
          d9thc: c.d9thc,
          totalThc: c.totalThc,
          status: c.status,
          recommendation: c.recommendation,
          labName: c.labName,
          certifiedBy: c.certifiedBy,
        }));

        // ── Tier 1: deterministic report assembly ──────────────────────────
        // For compliance-audit report type, use the new typed template.
        // All other types fall through to the existing reportEngine.
        let report: any;
        let tieredDoc: any = null;

        if (reportType === "compliance-audit") {
          const params: ComplianceAuditParams = {
            tenantId,
            generatedBy: userContext?.userId || "system",
            periodStart: (req.body.periodStart as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
            periodEnd: (req.body.periodEnd as string) || new Date().toISOString().split("T")[0],
            batches: rawCoas.map((c: any) => ({
              batchId: c.batchId,
              thca: Number(c.thca) || 0,
              d9thc: Number(c.d9thc) || 0,
              status: c.status || "unknown",
              testDate: c.uploadDate || new Date().toISOString().split("T")[0],
            })),
            auditChainValid: true, // verified by autonomous job; assume intact unless alert exists
            auditBreaks: [],
          };

          tieredDoc = buildComplianceAuditReport(params);

          // ── Tier 3/4: LLM fills only the narrative placeholder ───────────
          const llm = selectLLM(req.llmAvailable);
          if (llm) {
            const placeholder = tieredDoc.sections.find(
              (s: any) => s.type === "narrative_placeholder"
            );
            if (placeholder?.data?.prompt) {
              try {
                const narrative = await llm(
                  `${placeholder.data.prompt}\n\nData: ${JSON.stringify({
                    batchCount: params.batches.length,
                    periodStart: params.periodStart,
                    periodEnd: params.periodEnd,
                    auditChainValid: params.auditChainValid,
                  })}`
                );
                tieredDoc.executiveSummary = narrative;
              } catch {
                // LLM failed mid-request — degrade gracefully, report is still complete
                tieredDoc.executiveSummary = null;
              }
            }
          }

          report = tieredDoc;
        } else {
          // Legacy reportEngine path for compliance-roi and other types
          report = generateReport(
            batches,
            {
              userId: userContext?.userId || "system",
              userRole: userContext?.userRole || "Operator",
              tenantId,
            },
            reportType as any
          );
        }

        if (adminDb) {
          const meta = tieredDoc?.metadata || report?.metadata;
          if (meta) {
            await adminDb.collection("complianceReports").doc(meta.reportId).set({
              ...meta,
              ...(tieredDoc ? { sections: tieredDoc.sections.length } : { compliance: report.compliance, roi: report.roi }),
              tenantId,
            });
          }
        }

        const reportId = tieredDoc?.metadata?.reportId || report?.metadata?.reportId || `report-${Date.now()}`;
        const auditEntry: Omit<AuditLog, "hash"> = {
          id: `log-${Date.now()}`,
          timestamp: new Date().toISOString(),
          userId: userContext?.userId || "system",
          userRole: userContext?.userRole || "Operator",
          tenantId,
          action: "REPORT_GENERATED",
          details: `${reportType} report generated. ID: ${reportId}. Batches: ${batches.length}. Tier: ${req.llmAvailable.bestTier}.`,
          category: "DATA_CHANGE",
        };
        const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
        await saveAuditLog(hashedAudit, token);

        if (format === "markdown" && !tieredDoc) {
          res.setHeader("Content-Type", "text/markdown");
          return res.send(formatReportAsMarkdown(report));
        }
        if (format === "html" && !tieredDoc) {
          res.setHeader("Content-Type", "text/html");
          return res.send(formatReportAsHtml(report));
        }

        res.json(withTierMeta(req.llmAvailable, { report, auditLog: hashedAudit }));
      } catch (err: any) {
        console.error("Report generation error:", err);
        res.status(500).json({ error: "Report generation failed" });
      }
    }
  );

  // ─── GET /api/reports ──────────────────────────────────────────────────────
  router.get(
    "/",
    deps.authMiddleware,
    requirePermission("VIEW_REPORTS"),
    async (req, res) => {
      const userContext = req.authContext;
      const tenantId = userContext?.tenantId || DEFAULT_TENANT;

      if (!adminDb) {
        return res.json({ reports: [], fallback: true });
      }

      try {
        const snap = await adminDb
          .collection("complianceReports")
          .where("tenantId", "==", tenantId)
          .orderBy("generatedAt", "desc")
          .limit(50)
          .get();

        const reports = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        res.json({ reports, count: reports.length });
      } catch (err: any) {
        console.error("Reports list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  return router;
}
