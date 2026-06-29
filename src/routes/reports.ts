/**
 * routes/reports.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Compliance & ROI report generation. Synchronous for now — Phase 6 will
 * move this to a job queue with polling.
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
import { requirePermission } from "../lib/permissionsEngine";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

export function reportsRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── POST /api/reports/generate ────────────────────────────────────────────
  router.post(
    "/generate",
    deps.authMiddleware,
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

        const report = generateReport(
          batches,
          {
            userId: userContext?.userId || "system",
            userRole: userContext?.userRole || "Operator",
            tenantId,
          },
          reportType as any
        );

        if (adminDb) {
          await adminDb.collection("complianceReports").doc(report.metadata.reportId).set({
            ...report.metadata,
            compliance: report.compliance,
            roi: report.roi,
            tenantId,
          });
        }

        const auditEntry: Omit<AuditLog, "hash"> = {
          id: `log-${Date.now()}`,
          timestamp: new Date().toISOString(),
          userId: userContext?.userId || "system",
          userRole: userContext?.userRole || "Operator",
          tenantId,
          action: "REPORT_GENERATED",
          details: `Compliance & ROI report generated. ID: ${report.metadata.reportId}. Batches: ${batches.length}. Compliance rate: ${report.compliance.complianceRate}%. Total ROI: $${report.roi.totalFinancialValueUsd.toLocaleString()}.`,
          category: "DATA_CHANGE",
        };
        const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
        await saveAuditLog(hashedAudit, token);

        if (format === "markdown") {
          res.setHeader("Content-Type", "text/markdown");
          return res.send(formatReportAsMarkdown(report));
        }
        if (format === "html") {
          res.setHeader("Content-Type", "text/html");
          return res.send(formatReportAsHtml(report));
        }

        res.json({ report, auditLog: hashedAudit });
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