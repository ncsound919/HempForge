/**
 * routes/ollama.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Local model endpoints. Health check, flyer generation, document
 * classification. All inference is now deterministic (rule-based) — Ollama
 * remains as an optional local model server, but is not required for any
 * feature.
 */
import { Router, RequestHandler } from "express";
import {
  saveAuditLog,
  createAuditHash,
} from "../services/backendServices";
import {
  ollamaHealthCheck,
  classifyDocument,
  generateFlyerContent,
} from "../lib/ollamaInference";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

export function ollamaRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── GET /api/ollama/health ────────────────────────────────────────────────
  router.get("/health", deps.authMiddleware, async (_req, res) => {
    try {
      const status = await ollamaHealthCheck();
      res.json(status);
    } catch (err: any) {
      console.error("ollama health error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/ollama/infer ────────────────────────────────────────────────
  router.post("/infer", deps.authMiddleware, async (req, res) => {
    return res.status(410).json({
      error: "Gone",
      details:
        "Cloud/local LLM inference is no longer available. HempForge is fully " +
        "deterministic. Use /api/autonomy/run to drive the agent pipeline.",
    });
  });

  // ─── POST /api/ollama/flyer ────────────────────────────────────────────────
  router.post("/flyer", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    const { paper } = req.body;
    if (!paper || !paper.title) {
      return res.status(400).json({ error: "paper with title is required" });
    }
    try {
      const flyer = await generateFlyerContent(paper);

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "system-agent",
        userRole: userContext?.userRole || "Operator",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
        action: "DETERMINISTIC_FLYER_GEN",
        details: `Generated deterministic flyer content for paper '${paper.title}'. Headline: "${flyer.headline}"`,
        category: "AI_INFERENCE",
      };
      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      res.json(flyer);
    } catch (err: any) {
      console.error("Flyer generation failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/ollama/classify ─────────────────────────────────────────────
  router.post("/classify", deps.authMiddleware, async (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }
    try {
      const classification = await classifyDocument(text);
      res.json(classification);
    } catch (err: any) {
      console.error("Classification failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}