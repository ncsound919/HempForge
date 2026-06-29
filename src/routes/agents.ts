/**
 * routes/agents.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Paper / scene / OCR pipeline endpoints. Delegates to paperPipelineServer
 * which holds the actual extraction logic.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import {
  extractSceneEndpoint,
  ocrDocumentEndpoint,
  enrichSceneEndpoint,
  generateFiguresEndpoint,
  fullPipelineEndpoint,
} from "../lib/paperPipelineServer";

export function agentsRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  router.post("/extract-scene", deps.authMiddleware, extractSceneEndpoint);
  router.post("/ocr-document", deps.authMiddleware, ocrDocumentEndpoint);
  router.post("/enrich-scene", deps.authMiddleware, enrichSceneEndpoint);
  router.post("/generate-figures", deps.authMiddleware, generateFiguresEndpoint);
  router.post("/run-full", deps.authMiddleware, fullPipelineEndpoint);

  return router;
}