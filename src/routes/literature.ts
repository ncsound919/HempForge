/**
 * routes/literature.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scientific literature ingest, search, trend analysis, and autonomous
 * pipeline control. Most endpoints delegate to literatureService and the
 * cron-driven jobs in src/jobs/.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { adminDb, createAuditHash, saveAuditLog } from "../services/backendServices";
import {
  ingestLiterature,
  HEMP_QUERY_TERMS,
} from "../lib/literatureService";
import {
  getLiteratureCache,
  saveLiteraturePaper,
} from "../lib/firebaseService";
import {
  runLiteratureProduction,
  runAutonomousTrendsAndSimulations,
} from "../jobs/literatureJobs";
import { runLocalFolderIndexing } from "../jobs/localFolderIndexer";
import { computeTrendSnapshot } from "../lib/trendEngine";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

function isElevatedRole(role: string | undefined): boolean {
  return role === "Lab Admin" || role === "Quality Auditor";
}

export function literatureRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── POST /api/literature/search ───────────────────────────────────────────
  router.post("/search", deps.authMiddleware, async (req, res) => {
    const { userId, tenantId, userRole } = req.authContext || {};
    if (!userId || !tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing user credentials in context" });
    }
    const { checkLitRateLimit } = await import("../services/backendServices");
    if (!checkLitRateLimit(userId)) {
      return res.status(429).json({ error: "Rate limit exceeded — 5 searches per minute" });
    }
    const { query } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }
    if (query.length > 500) {
      return res.status(400).json({ error: "Query must be 1-500 characters" });
    }
    try {
      const papers = await ingestLiterature(query, tenantId);

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId,
        userRole: userRole || "Operator",
        tenantId,
        action: "LITERATURE_SEARCH",
        details: `User executed academic literature search for '${query}'. Ingested/Returned: ${papers.length} publications.`,
        category: "SYSTEM_INTEGRATION",
      };
      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      res.json({ papers, count: papers.length });
    } catch (err: any) {
      console.error("Literature search error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/literature/ingest-defaults ───────────────────────────────────
  router.post("/ingest-defaults", deps.authMiddleware, async (req, res) => {
    const { userId, tenantId, userRole } = req.authContext || {};
    if (!userId || !tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing user credentials in context" });
    }
    if (!isElevatedRole(userRole)) {
      return res.status(403).json({ error: "Forbidden: Authorized roles Lab Admin or Quality Auditor are required" });
    }
    try {
      const results = await Promise.allSettled(
        HEMP_QUERY_TERMS.map((term) => ingestLiterature(term, tenantId))
      );
      const total = results.reduce((sum, r) => sum + (r.status === "fulfilled" ? r.value.length : 0), 0);

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId,
        userRole: userRole || "Operator",
        tenantId,
        action: "LITERATURE_INGEST_DEFAULTS",
        details: `User triggered default literature ingestion. Ingested total: ${total} papers across ${HEMP_QUERY_TERMS.length} queries.`,
        category: "SYSTEM_INTEGRATION",
      };
      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      res.json({ message: `Ingested ${total} papers across ${HEMP_QUERY_TERMS.length} default queries` });
    } catch (err: any) {
      console.error("Literature ingest-defaults error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /api/literature/cache ─────────────────────────────────────────────
  router.get("/cache", deps.authMiddleware, async (req, res) => {
    const { userId, tenantId } = req.authContext || {};
    if (!userId || !tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing credentials" });
    }
    try {
      const papers = await getLiteratureCache(req.firebaseToken as string, tenantId);
      res.json({ papers });
    } catch (err: any) {
      console.error("Literature cache error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/literature/ingest ───────────────────────────────────────────
  router.post("/ingest", deps.authMiddleware, async (req, res) => {
    const { userId, tenantId, userRole } = req.authContext || {};
    if (!userId || !tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing credentials" });
    }
    const { paper } = req.body;
    if (!paper || !paper.id) {
      return res.status(400).json({ error: "paper object with valid ID is required" });
    }
    try {
      await saveLiteraturePaper(paper, req.firebaseToken as string, tenantId);

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId,
        userRole: userRole || "Operator",
        tenantId,
        action: "LITERATURE_INGEST",
        details: `User ingested paper '${paper.title}' into the research workstation library.`,
        category: "DATA_CHANGE",
      };
      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      res.json({ success: true, paper });
    } catch (err: any) {
      console.error("Literature ingest error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /api/literature/trends-insights ───────────────────────────────────
  router.get("/trends-insights", deps.authMiddleware, async (req, res) => {
    const { tenantId } = req.authContext || {};
    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing tenant context" });
    }
    if (!adminDb) {
      return res.status(503).json({ error: "Database not initialized" });
    }
    try {
      const trendsSnap = await adminDb
        .collection("researchTrends")
        .where("tenantId", "==", tenantId)
        .orderBy("detectedAt", "desc")
        .limit(20)
        .get();

      const insightsSnap = await adminDb
        .collection("researchInsights")
        .where("tenantId", "==", tenantId)
        .orderBy("detectedAt", "desc")
        .limit(20)
        .get();

      const trends = trendsSnap.docs.map((doc: any) => doc.data());
      const insights = insightsSnap.docs.map((doc: any) => doc.data());

      res.json({ trends, insights });
    } catch (err: any) {
      console.error("Trends/insights error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /api/literature/simulations ───────────────────────────────────────
  router.get("/simulations", deps.authMiddleware, async (req, res) => {
    const { tenantId } = req.authContext || {};
    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing tenant context" });
    }
    if (!adminDb) {
      return res.status(503).json({ error: "Database not initialized" });
    }
    try {
      const snap = await adminDb
        .collection("experimentalTrials")
        .where("tenantId", "==", tenantId)
        .orderBy("date", "desc")
        .limit(30)
        .get();

      const simulations = snap.docs.map((doc: any) => doc.data());
      res.json({ simulations });
    } catch (err: any) {
      console.error("Simulations error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/literature/run-autonomous-pipeline ──────────────────────────
  router.post("/run-autonomous-pipeline", deps.authMiddleware, async (req, res) => {
    const { tenantId, userId, userRole } = req.authContext || {};
    if (!tenantId || !userId) {
      return res.status(401).json({ error: "Unauthorized: Missing credentials" });
    }
    const { query } = req.body || {};
    try {
      console.log(`[server] Manual request for autonomous pipeline run by user ${userId} (query: ${query || "all"})...`);

      await runLiteratureProduction(tenantId, query || undefined);

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId,
        userRole: userRole || "Operator",
        tenantId,
        action: "MANUAL_SWARM_PIPELINE_RUN",
        details: query
          ? `User manually triggered a targeted autonomous swarm run for query: '${query}'.`
          : "User manually forced execution of the multi-agent literature ingest, simulation conversion, and research drafting cycle.",
        category: "SYSTEM_INTEGRATION",
      };

      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      res.json({ message: "Autonomous swarm pipeline completed successfully!" });
    } catch (err: any) {
      console.error("Autonomous pipeline error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /api/literature/production/latest ─────────────────────────────────
  router.get("/production/latest", deps.authMiddleware, async (req, res) => {
    const { tenantId } = req.authContext || {};
    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing tenant context" });
    }
    if (!adminDb) {
      return res.status(503).json({ error: "Database not initialized" });
    }

    try {
      const snap = await adminDb
        .collection("researchProductionRuns")
        .where("tenantId", "==", tenantId)
        .orderBy("startedAt", "desc")
        .limit(1)
        .get();

      if (snap.empty) {
        return res.json({ run: null });
      }

      const run = snap.docs[0].data();
      let digest = null;

      if (run.digestId) {
        const digestSnap = await adminDb.collection("researchDigests").doc(run.digestId).get();
        digest = digestSnap.exists ? digestSnap.data() : null;
      }

      res.json({ run, digest });
    } catch (err: any) {
      console.error("Production/latest error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/literature/production/run ───────────────────────────────────
  router.post("/production/run", deps.authMiddleware, async (req, res) => {
    const { tenantId, userRole, userId } = req.authContext || {};
    if (!tenantId || !userId) {
      return res.status(401).json({ error: "Unauthorized: Missing tenant context" });
    }
    if (!isElevatedRole(userRole)) {
      return res.status(403).json({
        error: "Forbidden: Authorized roles 'Lab Admin' or 'Quality Auditor' are required",
      });
    }
    try {
      await runLiteratureProduction(tenantId);
      res.json({ success: true, message: "Deterministic literature production run started." });
    } catch (err: any) {
      console.error("Production/run error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /api/literature/trend-snapshot ─────────────────────────────────────
  router.get("/trend-snapshot", deps.authMiddleware, async (req, res) => {
    const { tenantId, userId } = req.authContext || {};
    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing tenant context" });
    }
    if (!adminDb) {
      return res.status(503).json({ error: "Database not initialized" });
    }
    const { checkLitRateLimit } = await import("../services/backendServices");
    if (!checkLitRateLimit(userId || "anonymous")) {
      return res.status(429).json({ error: "Rate limit exceeded for trend snapshot requests." });
    }
    try {
      const dateKey = new Date().toISOString().slice(0, 10);
      const snapshotId = `snapshot-${tenantId}-${dateKey}`;
      const snapRef = adminDb.collection("trendSnapshots").doc(snapshotId);
      const snapDoc = await snapRef.get();

      if (snapDoc.exists) {
        return res.json(snapDoc.data());
      }

      const snapshot = await computeTrendSnapshot(tenantId);
      if (!snapshot) {
        return res.status(500).json({ error: "Failed to compute trend snapshot" });
      }

      const payload = { ...snapshot, id: snapshotId, tenantId };
      await snapRef.set(payload, { merge: true });
      return res.json(payload);
    } catch (err: any) {
      console.error("Trend snapshot error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /api/literature/local-index/latest ────────────────────────────────
  router.get("/local-index/latest", deps.authMiddleware, async (req, res) => {
    const { tenantId } = req.authContext || {};
    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing tenant context" });
    }
    if (!adminDb) {
      return res.status(503).json({ error: "Database not initialized" });
    }
    try {
      const snap = await adminDb
        .collection("localResearchRuns")
        .where("tenantId", "==", tenantId)
        .orderBy("startedAt", "desc")
        .limit(1)
        .get();
      res.json({ run: snap.empty ? null : snap.docs[0].data() });
    } catch (err: any) {
      console.error("Local-index/latest error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/literature/local-index/run ──────────────────────────────────
  router.post("/local-index/run", deps.authMiddleware, async (req, res) => {
    const { tenantId, userRole } = req.authContext || {};
    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing tenant context" });
    }
    if (!isElevatedRole(userRole)) {
      return res.status(403).json({
        error: "Forbidden: Authorized roles 'Lab Admin' or 'Quality Auditor' are required",
      });
    }
    try {
      const { watch, enabled, autoPromoteToResearchPapers } = req.body || {};
      const folders = ["local-research", "vault"];
      await runLocalFolderIndexing({
        tenantId,
        folders,
        watch,
        enabled,
        autoPromoteToResearchPapers,
      });
      res.json({ success: true, message: "Local folder indexing completed." });
    } catch (err: any) {
      console.error("Local-index/run error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /api/literature/local-docs ────────────────────────────────────────
  router.get("/local-docs", deps.authMiddleware, async (req, res) => {
    const { tenantId } = req.authContext || {};
    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized: Missing tenant context" });
    }
    if (!adminDb) {
      return res.status(503).json({ error: "Database not initialized" });
    }
    try {
      const snap = await adminDb
        .collection("localResearchDocuments")
        .where("tenantId", "==", tenantId)
        .orderBy("indexedAt", "desc")
        .limit(100)
        .get();
      res.json({ documents: snap.docs.map((d: any) => d.data()) });
    } catch (err: any) {
      console.error("Local-docs error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}