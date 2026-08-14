import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";
import {
  createPipeline, getPipelineStatus, getPipelineResults,
  sendMessage, listProjects, listRuns, getRunDetail,
  stopPipeline, getPipelineStages, healthCheck,
} from "../lib/researchClawClient.ts";
import { HttpError } from "../middleware/errorHandler";

export function researchclawRouter(authMiddleware?: RequestHandler): Router {
  const router = Router();
  if (authMiddleware) router.use(authMiddleware);

  router.get("/health", async (_req: Request, res: Response) => {
    const ok = await healthCheck();
    res.json({ status: ok ? "ok" : "unreachable" });
  });

  router.get("/stages", async (_req: Request, res: Response) => {
    const stages = await getPipelineStages();
    res.json(stages);
  });

  router.post("/pipelines", async (req: Request, res: Response) => {
    const { topic, configOverrides, autoApprove } = req.body;
    const result = await createPipeline({
      topic, configOverrides, autoApprove,
    });
    res.json(result);
  });

  router.get("/pipelines/_active/status", async (_req: Request, res: Response) => {
    const status = await getPipelineStatus("_active");
    res.json(status);
  });

  router.post("/pipelines/_active/stop", async (_req: Request, res: Response) => {
    const result = await stopPipeline();
    res.json(result);
  });

  router.get("/pipelines/:id", async (req: Request, res: Response) => {
    const detail = await getRunDetail(req.params.id);
    res.json(detail);
  });

  router.get("/pipelines/:id/results", async (req: Request, res: Response) => {
    const results = await getPipelineResults(req.params.id);
    res.json(results);
  });

  router.post("/pipelines/:id/chat", async (req: Request, res: Response) => {
    const { message } = req.body;
    if (!message) { res.status(400).json({ error: "message required" }); return; }
    const result = await sendMessage(req.params.id, message);
    res.json(result);
  });

  router.get("/runs", async (_req: Request, res: Response) => {
    const runs = await listRuns();
    res.json({ runs });
  });

  router.get("/projects", async (_req: Request, res: Response) => {
    const projects = await listProjects();
    res.json({ projects });
  });

  return router;
}
