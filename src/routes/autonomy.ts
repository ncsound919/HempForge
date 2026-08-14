/**
 * routes/autonomy.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Public endpoints for inspecting and triggering the autonomous agent pipeline.
 *
 *   GET  /api/autonomy/status          — last cycle + per-skill status
 *   POST /api/autonomy/run             — kick a cycle on demand (returns cycle report)
 *   GET  /api/autonomy/cycles          — recent cycle summaries
 *   GET  /api/autonomy/skills          — list registered skills
 *   GET  /api/autonomy/runs            — recent per-skill runs
 */

import { Router, RequestHandler } from "express";
import { TenantRepository } from "../lib/firebaseRepo";
import { agentEngine, listSkills } from "../agents/agentEngine";
import { runAutonomyNow } from "../agents/autonomyLoop";
import { structuredLog } from "../lib/structuredLogger";

export function autonomyRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  router.get("/status", deps.authMiddleware, async (req, res) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const cyclesRepo = new TenantRepository<any>("agentCycles", tenantId);
    const runsRepo = new TenantRepository<any>("agentRuns", tenantId);
    const benchRepo = new TenantRepository<any>("experimentBenchmarks", tenantId);
    const exptsRepo = new TenantRepository<any>("experimentQueue", tenantId);
    const cycles = await cyclesRepo.list();
    cycles.sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const last = cycles[0] || null;

    const skills = listSkills().map((s) => ({
      id: s.id,
      phase: s.phase,
      description: s.description,
    }));

    // Aggregate per-skill last-run summary across the last 200 runs
    const recentRuns = (await runsRepo.list())
      .sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 200);
    const skillStats = new Map<string, { lastRunAt: string; lastStatus: string; totalRuns: number; avgDurationMs: number; lastSummary: string }>();
    for (const run of recentRuns) {
      const existing = skillStats.get(run.skillId);
      if (existing) {
        existing.totalRuns++;
        existing.avgDurationMs = (existing.avgDurationMs * (existing.totalRuns - 1) + run.durationMs) / existing.totalRuns;
      } else {
        skillStats.set(run.skillId, {
          lastRunAt: run.startedAt,
          lastStatus: run.status,
          totalRuns: 1,
          avgDurationMs: run.durationMs,
          lastSummary: run.summary,
        });
      }
    }

    // Frontier coverage from benchmark records
    const benchmarks = await benchRepo.list();
    const frontierBenchmarkBreakdown = benchmarks.reduce((acc: any, b: any) => {
      const f = b.frontier ?? "minorCannabinoids";
      acc[f] = (acc[f] ?? 0) + 1;
      return acc;
    }, {});

    // Pending experiment proposals per frontier
    const queuedExpts = await exptsRepo.list();
    const frontierQueueBreakdown = queuedExpts
      .filter((e: any) => e.status === "proposed")
      .reduce((acc: any, e: any) => {
        const f = e.frontier ?? "minorCannabinoids";
        acc[f] = (acc[f] ?? 0) + 1;
        return acc;
      }, {});

    res.json({
      tenantId,
      lastCycle: last,
      totalCycles: cycles.length,
      skills,
      skillStats: Object.fromEntries(skillStats),
      frontiers: {
        benchmarked: frontierBenchmarkBreakdown,
        queued: frontierQueueBreakdown,
        coveredFrontiers: [...new Set([
          ...Object.keys(frontierBenchmarkBreakdown),
          ...Object.keys(frontierQueueBreakdown),
        ])],
      },
      pipeline: {
        ingestCron: "every 6 hours",
        queueExperimentsCron: "every 12 hours (frontier-aware)",
        benchmarkCron: "every 12 hours (offset 6h)",
        publishCron: "daily at 03:00 ET",
        promoteCron: "weekly Sunday 04:00 ET",
        ollamaProbeCron: "every minute",
      },
      mode: "fully-deterministic",
    });
  });

  router.post("/run", deps.authMiddleware, async (req, res) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    structuredLog("info", `autonomy.route: Manual cycle triggered for ${tenantId} by ${req.authContext?.userId}`, {});
    try {
      const report = await runAutonomyNow(tenantId);
      res.json(report);
    } catch (err: any) {
      structuredLog("error", "autonomy.route: Manual cycle failed", { error: String(err) });
      res.status(500).json({ error: "Cycle failed", details: err?.message || String(err) });
    }
  });

  router.post("/run-skill", deps.authMiddleware, async (req, res) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const skillId = (req.body?.skillId ?? "").toString();
    if (!skillId) return res.status(400).json({ error: "skillId is required" });
    const result = await agentEngine.runSkillByName(skillId, tenantId);
    if (!result) return res.status(404).json({ error: `Skill not found: ${skillId}` });
    res.json(result);
  });

  router.get("/cycles", deps.authMiddleware, async (req, res) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const cyclesRepo = new TenantRepository<any>("agentCycles", tenantId);
    const cycles = await cyclesRepo.list();
    cycles.sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const limit = Math.min(parseInt(String(req.query.limit ?? "25"), 10) || 25, 100);
    res.json({ cycles: cycles.slice(0, limit) });
  });

  router.get("/runs", deps.authMiddleware, async (req, res) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

    const runsRepo = new TenantRepository<any>("agentRuns", tenantId);
    const runs = await runsRepo.list();
    runs.sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
    res.json({ runs: runs.slice(0, limit) });
  });

  router.get("/skills", deps.authMiddleware, async (_req, res) => {
    const skills = listSkills().map((s) => ({
      id: s.id,
      phase: s.phase,
      description: s.description,
    }));
    res.json({ skills });
  });

  return router;
}