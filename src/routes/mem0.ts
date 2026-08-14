import { Router } from "express";
import type { Request, Response } from "express";
import {
  addMemory, searchMemory, getMemory, getAllMemories,
  updateMemory, deleteMemory, deleteAllMemories, getMemoryHistory, healthCheck,
} from "../lib/mem0Client";

interface MemoryInput {
  messages: unknown
  user_id?: unknown
  agent_id?: unknown
  run_id?: unknown
  metadata?: unknown
  infer?: unknown
  text?: unknown
  limit?: unknown
  threshold?: unknown
  query?: unknown
}

function validateMemoryInput(body: unknown): body is MemoryInput {
  return typeof body === "object" && body !== null && "messages" in body;
}

function validateSearchInput(body: unknown): body is MemoryInput {
  return typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).query === "string";
}

export function mem0Router(): Router {
  const router = Router();

  router.get("/health", async (_req: Request, res: Response) => {
    const ok = await healthCheck();
    res.json({ status: ok ? "ok" : "unreachable" });
  });

  router.post("/memories", async (req: Request, res: Response) => {
    if (!validateMemoryInput(req.body)) {
      res.status(400).json({ error: "messages required" });
      return;
    }
    const { messages, user_id, agent_id, run_id, metadata, infer } = req.body;
    const result = await addMemory({
      messages: messages as string | { role: string; content: string }[],
      userId: user_id as string | undefined,
      agentId: agent_id as string | undefined,
      runId: run_id as string | undefined,
      metadata: metadata as Record<string, unknown> | undefined,
      infer: infer as boolean | undefined,
    });
    res.json(result);
  });

  router.get("/memories", async (req: Request, res: Response) => {
    const { user_id, agent_id, run_id, limit } = req.query;
    const result = await getAllMemories({
      userId: user_id as string | undefined,
      agentId: agent_id as string | undefined,
      runId: run_id as string | undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(result);
  });

  router.get("/memories/:id", async (req: Request, res: Response) => {
    const item = await getMemory(req.params.id);
    if (!item) { res.status(404).json({ error: "not found" }); return; }
    res.json(item);
  });

  router.put("/memories/:id", async (req: Request, res: Response) => {
    const { text } = req.body;
    if (!text || typeof text !== "string") { res.status(400).json({ error: "text required" }); return; }
    const result = await updateMemory(req.params.id, text);
    res.json(result);
  });

  router.delete("/memories", async (req: Request, res: Response) => {
    const { user_id, agent_id, run_id } = req.body;
    if (!user_id && !agent_id && !run_id) {
      res.status(400).json({ error: "at least one filter required" });
      return;
    }
    const result = await deleteAllMemories({
      userId: user_id, agentId: agent_id, runId: run_id,
    });
    res.json(result);
  });

  router.delete("/memories/:id", async (req: Request, res: Response) => {
    const result = await deleteMemory(req.params.id);
    res.json(result);
  });

  router.get("/memories/:id/history", async (req: Request, res: Response) => {
    const history = await getMemoryHistory(req.params.id);
    res.json(history);
  });

  router.post("/search", async (req: Request, res: Response) => {
    if (!validateSearchInput(req.body)) {
      res.status(400).json({ error: "query required" });
      return;
    }
    const { query, user_id, agent_id, run_id, limit, threshold } = req.body;
    const result = await searchMemory({
      query: query as string,
      userId: user_id as string | undefined,
      agentId: agent_id as string | undefined,
      runId: run_id as string | undefined,
      limit: limit ? Number(limit) : undefined,
      threshold: threshold ? Number(threshold) : undefined,
    });
    res.json(result);
  });

  return router;
}
