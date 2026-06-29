/**
 * routes/scheduler.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scheduled job CRUD. Admin-only writes; reads require Lab Admin or higher.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { adminDb } from "../services/backendServices";

function isAdminRole(role: string | undefined): boolean {
  return role === "Admin" || role === "System Admin";
}

export function schedulerRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── GET /api/scheduler/jobs ───────────────────────────────────────────────
  router.get("/jobs", deps.authMiddleware, async (req, res) => {
    const { tenantId } = req.authContext || {};
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    if (!adminDb) return res.status(503).json({ error: "Database not initialized" });

    try {
      const snap = await adminDb.collection("schedulerJobs").where("tenantId", "==", tenantId).get();
      const jobs = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      res.json({ jobs });
    } catch (err: any) {
      console.error("Scheduler jobs fetch error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/scheduler/jobs ──────────────────────────────────────────────
  router.post("/jobs", deps.authMiddleware, async (req, res) => {
    const { tenantId, userRole } = req.authContext || {};
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    if (!isAdminRole(userRole)) {
      return res.status(403).json({ error: "Forbidden: Admin role required" });
    }
    if (!adminDb) return res.status(503).json({ error: "Database not initialized" });

    const { name, cronString, frequency, targetEmail, targetFocus } = req.body || {};
    if (!name || !cronString || !frequency || !targetEmail || !targetFocus) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const newJob = {
      name,
      cronString,
      frequency,
      targetEmail,
      targetFocus,
      status: "active" as const,
      lastRun: null,
      nextRunHint: null,
      createdAt: new Date().toISOString(),
      lastResult: null,
      tenantId,
    };

    try {
      const ref = await adminDb.collection("schedulerJobs").add(newJob);
      res.json({ job: { id: ref.id, ...newJob } });
    } catch (err: any) {
      console.error("Scheduler job create error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── PATCH /api/scheduler/jobs/:id ─────────────────────────────────────────
  router.patch("/jobs/:id", deps.authMiddleware, async (req, res) => {
    const { tenantId, userRole } = req.authContext || {};
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    if (!isAdminRole(userRole)) {
      return res.status(403).json({ error: "Forbidden: Admin role required" });
    }
    if (!adminDb) return res.status(503).json({ error: "Database not initialized" });

    const { id } = req.params;
    const { name, cronString, frequency, targetEmail, targetFocus, status } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (cronString !== undefined) updates.cronString = cronString;
    if (frequency !== undefined) updates.frequency = frequency;
    if (targetEmail !== undefined) updates.targetEmail = targetEmail;
    if (targetFocus !== undefined) updates.targetFocus = targetFocus;
    if (status !== undefined) updates.status = status;
    updates.updatedAt = new Date().toISOString();

    try {
      await adminDb.collection("schedulerJobs").doc(id).update(updates);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Scheduler job update error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── DELETE /api/scheduler/jobs/:id ────────────────────────────────────────
  router.delete("/jobs/:id", deps.authMiddleware, async (req, res) => {
    const { tenantId, userRole } = req.authContext || {};
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    if (!isAdminRole(userRole)) {
      return res.status(403).json({ error: "Forbidden: Admin role required" });
    }
    if (!adminDb) return res.status(503).json({ error: "Database not initialized" });

    const { id } = req.params;

    try {
      const docRef = adminDb.collection("schedulerJobs").doc(id);
      const doc = await docRef.get();
      if (!doc.exists) return res.status(404).json({ error: "Job not found" });
      if (doc.data()?.tenantId !== tenantId) return res.status(403).json({ error: "Forbidden" });
      await docRef.delete();
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Scheduler job delete error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}