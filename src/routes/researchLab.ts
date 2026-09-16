/**
 * routes/researchLab.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The Research Lab's document → scene pipeline. These endpoints existed only on
 * the client (SceneVisualizationTab) and 404'd in production:
 *
 *   POST /api/ocr/extract    — multipart file -> text + classified compounds/params
 *   POST /api/scene/generate — OCR text -> deterministic SceneSpec
 *
 * All logic lives in the existing deterministic libs (ocrPipeline,
 * sceneExtractor); this only wires them to the routes the UI calls.
 */
import { Router, RequestHandler } from "express";
import multer from "multer";
import {
  ocrPdf,
  ocrImage,
  extractHempEntities,
  detectSections,
  classifyDocument,
} from "../lib/ocrPipeline";
import { extractSceneFromText } from "../lib/sceneExtractor";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export function researchLabRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  router.post(
    "/ocr/extract",
    deps.authMiddleware,
    upload.single("file"),
    async (req, res) => {
      const file = (req as any).file as
        | { buffer: Buffer; mimetype: string; originalname?: string }
        | undefined;
      if (!file) return res.status(400).json({ error: "file is required" });

      try {
        const isPdf =
          file.mimetype === "application/pdf" ||
          /\.pdf$/i.test(file.originalname || "");
        const ocr = isPdf
          ? await ocrPdf(file.buffer)
          : await ocrImage(file.buffer, file.mimetype);

        const entities = extractHempEntities(ocr.text);
        const documentType = classifyDocument(ocr.text, detectSections(ocr.text));

        res.json({
          text: ocr.text,
          documentType,
          compounds: entities.compounds,
          parameters: entities.parameters,
        });
      } catch (e: any) {
        res.status(422).json({ error: e?.message || "OCR extraction failed" });
      }
    }
  );

  router.post("/scene/generate", deps.authMiddleware, (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!text.trim()) return res.status(400).json({ error: "text is required" });
    try {
      res.json(extractSceneFromText(text));
    } catch (e: any) {
      res.status(422).json({ error: e?.message || "Scene generation failed" });
    }
  });

  return router;
}
