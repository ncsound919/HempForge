/**
 * routes/ollama.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Local Ollama inference endpoints. Health check, generic inference, flyer
 * generation, document classification.
 *
 * NOTE: Currently shares the Gemini rate limiter. This is a known limitation
 * — tracked for Phase 5+. Splitting them is straightforward: instantiate a
 * dedicated limiter in backendServices.ts and pass it through.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import {
  checkGeminiRateLimit,
  saveAuditLog,
  createAuditHash,
} from "../services/backendServices";
import {
  ollamaHealthCheck,
  inferWithOllama,
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
      console.error("test-db error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/ollama/infer ────────────────────────────────────────────────
  router.post("/infer", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    const userId = userContext?.userId || "unknown-user";

    const rateLimit = checkGeminiRateLimit(userId);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "Too Many Requests",
        details: `Rate limit exceeded. Please try again after ${new Date(rateLimit.resetTime).toLocaleTimeString()}.`,
      });
    }

    const { prompt, model, format, timeout: rawTimeout } = req.body;
    const timeout = Math.min(Number(rawTimeout) || 15_000, 60_000);
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required and must be a string" });
    }

    try {
      const result = await inferWithOllama(prompt, {
        model,
        format: format || "text",
        timeout: timeout || 15_000,
      });

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "system-agent",
        userRole: userContext?.userRole || "Operator",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
        action: "OLLAMA_INFERENCE",
        details: `Local Ollama inference completed. Model: ${result.model}. Latency: ${result.latencyMs}ms. Provider: ${result.provider}.`,
        category: "AI_INFERENCE",
      };
      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      res.json(result);
    } catch (err: any) {
      console.error("Ollama Inference Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
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
        action: "OLLAMA_FLYER_GEN",
        details: `AI-generated flyer content for paper '${paper.title}'. Headline: "${flyer.headline}"`,
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
    const userContext = req.authContext;
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