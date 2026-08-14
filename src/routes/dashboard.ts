/**
 * routes/dashboard.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Dashboard aggregation endpoints (summary, activity, audit run, export).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { normalizeCoaForDecisioning } from "../lib/coaNormalizer";
import {
  createAuditHash,
  getAuditLogs,
  saveAuditLog,
  signCoa,
} from "../services/backendServices";
import { TenantRepository } from "../lib/firebaseRepo";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

function computeDashboardSummary(coas: any[]) {
  const normalizedCoas = coas.map(c => {
    return normalizeCoaForDecisioning({
      batchId: c.batchId,
      productName: c.strain || c.productName,
      productType: c.productType || "Flower",
      labName: c.labName,
      testDate: c.testDate || c.uploadDate,
      thca: c.thca !== undefined ? Number(c.thca) : 0,
      d9thc: c.d9thc !== undefined ? Number(c.d9thc) : 0,
      cbd: c.cbd !== undefined ? Number(c.cbd) : undefined,
      moisture: c.moisture !== undefined ? Number(c.moisture) : undefined,
    });
  });

  const totalBatches = normalizedCoas.length;
  const compliant = normalizedCoas.filter((c) => c.status === "compliant").length;
  const atRisk = normalizedCoas.filter((c) => c.status === "borderline").length;
  const nonCompliant = normalizedCoas.filter((c) => c.status === "non_compliant").length;
  const complianceRate = totalBatches > 0 ? Math.round((compliant / totalBatches) * 100) : 0;

  const averageTotalThc =
    totalBatches > 0
      ? parseFloat((normalizedCoas.reduce((sum, c) => sum + Number(c.totalThc || 0), 0) / totalBatches).toFixed(3))
      : 0;

  const highestRisk = [...normalizedCoas].sort((a, b) => Number(b.totalThc || 0) - Number(a.totalThc || 0))[0] || null;

  const nearThresholdCount = normalizedCoas.filter((c) => {
    const total = Number(c.totalThc || 0);
    return total >= 0.25 && total < 0.3;
  }).length;

  const recentUploads = [...coas]
    .sort((a, b) => new Date(b.uploadDate || 0).getTime() - new Date(a.uploadDate || 0).getTime())
    .slice(0, 5);

  return {
    totalBatches,
    compliant,
    atRisk,
    nonCompliant,
    complianceRate,
    averageTotalThc,
    nearThresholdCount,
    highestRisk,
    recentUploads,
  };
}

export function dashboardRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── GET /api/dashboard/summary ────────────────────────────────────────────
  router.get("/summary", deps.authMiddleware, async (req, res) => {
    const tenantId = req.authContext?.tenantId || DEFAULT_TENANT;

    try {
      const repo = new TenantRepository<any>("coas", tenantId);
      const coas = await repo.list();
      const summary = computeDashboardSummary(coas);
      res.json({
        tenantId,
        generatedAt: new Date().toISOString(),
        summary,
      });
    } catch (err: any) {
      console.error("Dashboard summary error:", err);
      res.status(500).json({ error: "Failed to generate dashboard summary" });
    }
  });

  // ─── GET /api/dashboard/activity ───────────────────────────────────────────
  router.get("/activity", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    const token = req.firebaseToken as string;
    const tenantId = userContext?.tenantId || DEFAULT_TENANT;
    const limit = Math.min(Number(req.query.limit || 10), 50);

    try {
      const logs = await getAuditLogs(token);
      const items = logs
        .filter((log) => log.tenantId === tenantId)
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
        .slice(0, limit)
        .map((log) => ({
          id: log.id,
          timestamp: log.timestamp,
          action: log.action,
          category: log.category,
          details: log.details,
          userRole: log.userRole,
        }));

      res.json({ items, count: items.length });
    } catch (err: any) {
      console.error("Dashboard activity error:", err);
      res.status(500).json({ error: "Failed to load dashboard activity" });
    }
  });

  // ─── POST /api/dashboard/run-audit ─────────────────────────────────────────
  router.post("/run-audit", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    const token = req.firebaseToken as string;
    const tenantId = userContext?.tenantId || DEFAULT_TENANT;

    try {
      const repo = new TenantRepository<any>("coas", tenantId);
      const coas = await repo.list();

      const evaluated = coas.map((coa: any) => {
        const normalized = normalizeCoaForDecisioning({
          batchId: coa.batchId,
          productName: coa.strain || coa.productName,
          productType: coa.productType,
          labName: coa.labName,
          testDate: coa.testDate,
          thca: coa.thca !== undefined ? Number(coa.thca) : 0,
          d9thc: coa.d9thc !== undefined ? Number(coa.d9thc) : 0,
        });

        const statusMapped = normalized.status === 'compliant' ? 'Compliant' : (normalized.status === 'borderline' ? 'At Risk' : 'Non-Compliant');

        const recommendation = coa.recommendation ||
          (statusMapped === "Non-Compliant"
            ? "Divert batch to remediation or extraction review due to threshold breach."
            : statusMapped === "At Risk"
              ? "Monitor variance closely; batch is approaching threshold."
              : undefined);

        return {
          ...coa,
          totalThc: normalized.totalThc,
          status: statusMapped,
          recommendation,
          complianceSignature: signCoa({
            ...coa,
            totalThc: normalized.totalThc,
            status: statusMapped,
            recommendation,
          }),
        };
      });

      for (const coa of evaluated) {
        await repo.save({ ...coa });
      }

      const summary = computeDashboardSummary(evaluated);

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "system-agent",
        userRole: userContext?.userRole || "Operator",
        tenantId,
        action: "DASHBOARD_LEDGER_AUDIT",
        details: `Interactive dashboard audit executed across ${evaluated.length} COAs. Compliance: ${summary.compliant}, At Risk: ${summary.atRisk}, Non-Compliant: ${summary.nonCompliant}.`,
        category: "AI_INFERENCE",
      };

      const hashedAudit: AuditLog = {
        ...auditEntry,
        hash: createAuditHash(auditEntry),
      };

      await saveAuditLog(hashedAudit, token);

      res.json({
        success: true,
        summary,
        updatedCount: evaluated.length,
        auditLog: hashedAudit,
      });
    } catch (err: any) {
      console.error("Dashboard audit error:", err);
      res.status(500).json({ error: "Dashboard audit failed" });
    }
  });

  // ─── POST /api/dashboard/export ────────────────────────────────────────────
  router.post("/export", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    const token = req.firebaseToken as string;
    const tenantId = userContext?.tenantId || DEFAULT_TENANT;
    const { status = "All", search = "", sort = "newest" } = req.body || {};

    try {
      const repo = new TenantRepository<any>("coas", tenantId);
      let coas = await repo.list();

      const normalizedSearch = String(search).trim().toLowerCase();

      coas = coas.filter((coa: any) => {
        const matchesStatus = status === "All" ? true : coa.status === status;
        const matchesSearch =
          normalizedSearch.length === 0
            ? true
            : [coa.batchId, coa.strain, coa.status, coa.recommendation || ""]
                .join(" ")
                .toLowerCase()
                .includes(normalizedSearch);

        return matchesStatus && matchesSearch;
      });

      coas.sort((a: any, b: any) => {
        switch (sort) {
          case "oldest":
            return new Date(a.uploadDate || 0).getTime() - new Date(b.uploadDate || 0).getTime();
          case "highest-thc":
            return Number(b.totalThc || 0) - Number(a.totalThc || 0);
          case "lowest-thc":
            return Number(a.totalThc || 0) - Number(b.totalThc || 0);
          case "strain":
            return String(a.strain || "").localeCompare(String(b.strain || ""));
          case "newest":
          default:
            return new Date(b.uploadDate || 0).getTime() - new Date(a.uploadDate || 0).getTime();
        }
      });

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "system-agent",
        userRole: userContext?.userRole || "Operator",
        tenantId,
        action: "DASHBOARD_EXPORT",
        details: `Dashboard export executed with status='${status}', search='${normalizedSearch}', sort='${sort}', resultCount=${coas.length}.`,
        category: "DATA_CHANGE",
      };

      const hashedAudit: AuditLog = {
        ...auditEntry,
        hash: createAuditHash(auditEntry),
      };

      await saveAuditLog(hashedAudit, token);

      res.json({
        exportedAt: new Date().toISOString(),
        count: coas.length,
        rows: coas,
      });
    } catch (err: any) {
      console.error("Dashboard export error:", err);
      res.status(500).json({ error: "Export failed" });
    }
  });

  return router;
}