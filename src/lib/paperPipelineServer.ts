import { Request, Response } from "express";
import { createRequire } from "module";
import { smartInfer } from "./ollamaInference.js";
import {
  SceneSpec,
  createDefaultSceneSpec,
  validateSceneSpec,
} from "./sceneSpecSchema.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

export interface OcrResult {
  text: string;
  confidence: number;
  language: string;
  pageCount: number;
}

export interface DocumentSections {
  title: string;
  abstract: string;
  introduction: string;
  methods: string;
  results: string;
  discussion: string;
  conclusion: string;
  references: string[];
}

export interface HempEntities {
  compounds: string[];
  strains: string[];
  equipment: string[];
  processes: string[];
  measurements: Record<string, string>;
}

export type DocumentType =
  | "coa"
  | "research_paper"
  | "regulatory_filing"
  | "sop"
  | "patent"
  | "unknown";

function extractSections(text: string): DocumentSections {
  const lower = text.toLowerCase();
  const find = (label: string): string => {
    const idx = lower.indexOf(label);
    if (idx === -1) return "";
    const start = idx + label.length;
    const rest = text.substring(start);
    const match = rest.match(/\n\n/);
    return match ? rest.substring(0, match.index).trim() : rest.trim();
  };

  return {
    title: find("title:").split("\n")[0] || text.split("\n")[0]?.trim() || "",
    abstract: find("abstract:"),
    introduction: find("introduction:"),
    methods: find("methods:") || find("methodology:"),
    results: find("results:"),
    discussion: find("discussion:"),
    conclusion: find("conclusion:") || find("conclusions:"),
    references: lower.includes("references:")
      ? text.substring(lower.indexOf("references:")).split("\n").filter((l) => l.trim())
      : [],
  };
}

function extractEntities(text: string): HempEntities {
  const compoundTerms = [
    "THCa", "THC", "CBD", "CBG", "CBN", "CBC", "THCV",
    "myrcene", "limonene", "linalool", "pinene", "caryophyllene",
  ];
  const strainTerms = [
    "Carolina Dream", "Sour Space Candy", "Lifter", "Cherry Wine",
    "Hawaiian Haze", "Special Sauce", "Suver Haze",
  ];
  const equipmentTerms = [
    "HPLC", "GC-MS", "rotary evaporator", "short path", "closed loop",
    "reactor", "chromatography", "filter press", "distillation",
  ];
  const processTerms = [
    "extraction", "decarboxylation", "distillation", "crystallization",
    "fermentation", "formulation", "harvest", "testing",
  ];

  const lower = text.toLowerCase();
  const findMatches = (terms: string[]) =>
    terms.filter((t) => lower.includes(t.toLowerCase()));

  const measurements: Record<string, string> = {};
  const measurePattern = /(\d+\.?\d*)\s*(%|mg|ppm|°C|°F|μM|mL|L|g|kg)/g;
  let m = measurePattern.exec(text);
  while (m) {
    measurements[m[0]] = m[0];
    m = measurePattern.exec(text);
  }

  return {
    compounds: findMatches(compoundTerms),
    strains: findMatches(strainTerms),
    equipment: findMatches(equipmentTerms),
    processes: findMatches(processTerms),
    measurements,
  };
}

function classifyDocument(text: string): DocumentType {
  const lower = text.toLowerCase();
  if (lower.includes("certificate of analysis") || lower.includes("coa")) return "coa";
  if (lower.includes("abstract") && (lower.includes("methods") || lower.includes("results")))
    return "research_paper";
  if (lower.includes("regulation") || lower.includes("compliance") || lower.includes("fda"))
    return "regulatory_filing";
  if (lower.includes("standard operating procedure") || lower.includes("sop"))
    return "sop";
  if (lower.includes("patent") || lower.includes("invention")) return "patent";
  return "unknown";
}

export async function extractSceneEndpoint(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { text, paperId, sceneType } = req.body;

    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required and must be a string" });
      return;
    }

    const typeHint = sceneType
      ? `Prefer sceneType: "${sceneType}"`
      : "Choose the most appropriate sceneType.";

    const prompt = `Analyze the following scientific text and extract a SceneSpec for 3D visualization.
Text:
${text.substring(0, 4000)}

Return a JSON object with this exact structure:
{
  "title": "scene title",
  "description": "what the scene shows",
  "sceneType": one of ["molecule", "extraction_process", "field_trial", "comparative_analysis", "timeline", "compound_network", "formulation_pipeline"],
  "entities": [{"id": "e1", "type": "compound_class", "name": "THCa", "properties": {}}],
  "processes": [{"id": "p1", "type": "extraction", "name": "CO2 Extraction", "parameters": {}}],
  "relationships": [{"fromId": "e1", "toId": "e2", "type": "transforms_into"}],
  "parameters": [{"name": "Temperature", "value": 120, "unit": "°C", "category": "temperature"}]
}
${typeHint}`;

    const result = await smartInfer(prompt, { format: "json" });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      res.status(500).json({ error: "Failed to parse LLM response as JSON" });
      return;
    }

    const spec = createDefaultSceneSpec(
      (parsed.title as string) || "Extracted Scene",
      (parsed.sceneType as SceneSpec["sceneType"]) || "extraction_process"
    );

    if (typeof parsed.description === "string") spec.description = parsed.description;
    if (Array.isArray(parsed.entities)) spec.entities = parsed.entities as SceneSpec["entities"];
    if (Array.isArray(parsed.processes)) spec.processes = parsed.processes as SceneSpec["processes"];
    if (Array.isArray(parsed.relationships)) spec.relationships = parsed.relationships as SceneSpec["relationships"];
    if (Array.isArray(parsed.parameters)) spec.parameters = parsed.parameters as SceneSpec["parameters"];
    if (paperId) spec.paperId = paperId;
    spec.confidence = 0.75;

    if (!validateSceneSpec(spec)) {
      const fallback = createDefaultSceneSpec("Extracted Scene", "extraction_process");
      if (paperId) fallback.paperId = paperId;
      fallback.confidence = 0.4;
      res.json({ sceneSpec: fallback });
      return;
    }

    res.json({ sceneSpec: spec });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("extractSceneEndpoint error:", message);
    res.status(500).json({ error: "Scene extraction failed", details: message });
  }
}

export async function ocrDocumentEndpoint(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const file = (req as Request & { file?: { buffer: Buffer; mimetype: string; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "File upload is required" });
      return;
    }

    let fullText = "";
    let confidence = 0;
    let pageCount = 1;

    const isPdf =
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      const pdfData = await pdfParse(file.buffer);
      fullText = pdfData.text;
      pageCount = pdfData.numpages || 1;
      confidence = 0.9;
    } else {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      const { data } = await worker.recognize(file.buffer);
      fullText = data.text;
      confidence = data.confidence / 100;
      await worker.terminate();
    }

    const ocrResult: OcrResult = {
      text: fullText,
      confidence,
      language: "en",
      pageCount,
    };

    const sections = extractSections(fullText);
    const entities = extractEntities(fullText);
    const classification = classifyDocument(fullText);

    res.json({ ocrResult, sections, entities, classification });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("ocrDocumentEndpoint error:", message);
    res.status(500).json({ error: "OCR processing failed", details: message });
  }
}

export async function enrichSceneEndpoint(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { sceneSpec } = req.body;

    if (!sceneSpec || !validateSceneSpec(sceneSpec)) {
      res.status(400).json({ error: "Valid sceneSpec is required" });
      return;
    }

    const prompt = `Enhance this SceneSpec for 3D visualization. Improve descriptions, camera angles, and visual style.
SceneSpec:
${JSON.stringify(sceneSpec, null, 2)}

Return a JSON object with the SAME structure but enhanced description, camera, visualStyle, entities, and processes. Keep all IDs the same.`;

    const result = await smartInfer(prompt, { format: "json" });

    let enriched: Record<string, unknown>;
    try {
      enriched = JSON.parse(result.text);
    } catch {
      res.status(500).json({ error: "Failed to parse enriched response as JSON" });
      return;
    }

    const enrichedSpec: SceneSpec = {
      ...sceneSpec,
      ...(typeof enriched.description === "string" && { description: enriched.description }),
      ...(Array.isArray(enriched.entities) && { entities: enriched.entities as SceneSpec["entities"] }),
      ...(Array.isArray(enriched.processes) && { processes: enriched.processes as SceneSpec["processes"] }),
      ...(typeof enriched.camera === "object" && enriched.camera !== null && {
        camera: enriched.camera as SceneSpec["camera"],
      }),
      ...(typeof enriched.visualStyle === "object" && enriched.visualStyle !== null && {
        visualStyle: enriched.visualStyle as SceneSpec["visualStyle"],
      }),
      generatedAt: new Date().toISOString(),
    };

    res.json({ enrichedSceneSpec: enrichedSpec });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("enrichSceneEndpoint error:", message);
    res.status(500).json({ error: "Scene enrichment failed", details: message });
  }
}

export async function generateFiguresEndpoint(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { sceneSpecs, paperId } = req.body;

    if (!Array.isArray(sceneSpecs) || sceneSpecs.length === 0) {
      res.status(400).json({ error: "sceneSpecs array is required" });
      return;
    }

    const figures: Array<{
      paperId: string;
      sceneId: string;
      caption: string;
      resolution: { width: number; height: number };
      exportedAt: string;
    }> = [];

    for (const spec of sceneSpecs) {
      const entityNames = (spec.entities || []).map((e: { name: string }) => e.name);
      const processNames = (spec.processes || []).map((p: { name: string }) => p.name);
      const sceneTypeLabel = (spec.sceneType || "scene").replace(/_/g, " ");

      let caption = `3D visualization of ${sceneTypeLabel}`;
      if (entityNames.length > 0) caption += ` showing ${entityNames.join(", ")}`;
      if (processNames.length > 0) caption += ` with ${processNames.join(", ")}`;
      caption += `. ${spec.title || ""}.`;

      figures.push({
        paperId: paperId || spec.paperId || "unknown",
        sceneId: spec.id || `scene-${Date.now()}`,
        caption,
        resolution: { width: 1920, height: 1080 },
        exportedAt: new Date().toISOString(),
      });
    }

    res.json({ figures });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("generateFiguresEndpoint error:", message);
    res.status(500).json({ error: "Figure generation failed", details: message });
  }
}

export async function fullPipelineEndpoint(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const file = (req as Request & { file?: { buffer: Buffer; mimetype: string; originalname: string } }).file;
    const { paperId } = req.body;

    if (!file) {
      res.status(400).json({ error: "File upload is required" });
      return;
    }

    const isPdf =
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf");

    let fullText = "";

    if (isPdf) {
      const pdfData = await pdfParse(file.buffer);
      fullText = pdfData.text;
    } else {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      const { data } = await worker.recognize(file.buffer);
      fullText = data.text;
      await worker.terminate();
    }

    const sections = extractSections(fullText);
    const entities = extractEntities(fullText);
    const classification = classifyDocument(fullText);

    const scenePrompt = `Analyze this ${classification} document and create a SceneSpec for 3D visualization.
Title: ${sections.title}
Abstract: ${sections.abstract.substring(0, 1000)}
Key compounds: ${entities.compounds.join(", ")}
Key processes: ${entities.processes.join(", ")}

Return a JSON object matching this structure:
{
  "title": "scene title",
  "description": "what the scene shows",
  "sceneType": one of ["molecule", "extraction_process", "field_trial", "comparative_analysis", "timeline", "compound_network", "formulation_pipeline"],
  "entities": [{"id": "e1", "type": "compound_class", "name": "THCa", "properties": {}}],
  "processes": [{"id": "p1", "type": "extraction", "name": "CO2 Extraction", "parameters": {}}],
  "relationships": [{"fromId": "e1", "toId": "e2", "type": "transforms_into"}],
  "parameters": [{"name": "Temperature", "value": 120, "unit": "°C", "category": "temperature"}]
}`;

    let spec: SceneSpec;
    try {
      const inferResult = await smartInfer(scenePrompt, { format: "json" });
      const parsed: Record<string, unknown> = JSON.parse(inferResult.text);

      spec = createDefaultSceneSpec(
        (parsed.title as string) || sections.title || "Document Scene",
        (parsed.sceneType as SceneSpec["sceneType"]) || "extraction_process"
      );

      if (typeof parsed.description === "string") spec.description = parsed.description;
      if (Array.isArray(parsed.entities)) spec.entities = parsed.entities as SceneSpec["entities"];
      if (Array.isArray(parsed.processes)) spec.processes = parsed.processes as SceneSpec["processes"];
      if (Array.isArray(parsed.relationships)) spec.relationships = parsed.relationships as SceneSpec["relationships"];
      if (Array.isArray(parsed.parameters)) spec.parameters = parsed.parameters as SceneSpec["parameters"];
    } catch {
      spec = createDefaultSceneSpec(sections.title || "Uploaded Document", "extraction_process");
      spec.description = sections.abstract || "Scene generated from uploaded document";
      spec.confidence = 0.4;
    }

    if (paperId) spec.paperId = paperId;

    const entityNames = spec.entities.map((e) => e.name);
    const processNames = spec.processes.map((p) => p.name);
    const sceneTypeLabel = spec.sceneType.replace(/_/g, " ");

    let caption = `3D visualization of ${sceneTypeLabel}`;
    if (entityNames.length > 0) caption += ` showing ${entityNames.join(", ")}`;
    if (processNames.length > 0) caption += ` with ${processNames.join(", ")}`;
    caption += `. ${spec.title}.`;

    const figures = [
      {
        paperId: paperId || spec.paperId || "unknown",
        sceneId: spec.id,
        caption,
        resolution: { width: 1920, height: 1080 },
        exportedAt: new Date().toISOString(),
      },
    ];

    res.json({
      document: { sections, entities, classification, pageCount: fullText.split("\n").length },
      sceneSpec: spec,
      figures,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("fullPipelineEndpoint error:", message);
    res.status(500).json({ error: "Full pipeline failed", details: message });
  }
}
