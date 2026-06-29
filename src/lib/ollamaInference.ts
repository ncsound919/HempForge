import { Ollama } from "ollama";
import { GoogleGenAI, Type } from "@google/genai";
import { getOllamaConfig } from "./ollamaService";
import type { TrendSnapshot } from "./trendEngine";

const genaiCache = new Map<string, GoogleGenAI>();

function getGenaiClient(apiKey: string): GoogleGenAI {
  let client = genaiCache.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    genaiCache.set(apiKey, client);
  }
  return client;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InferenceResult {
  text: string;
  provider: "ollama" | "gemini";
  model: string;
  latencyMs: number;
}

export interface OllamaHealthStatus {
  available: boolean;
  model: string;
  latencyMs: number;
  endpoint: string;
}

export interface DocumentClassification {
  category: "regulatory" | "safety" | "formulation" | "cultivation" | "analytics" | "general";
  compounds: string[];
  keywords: string[];
  confidence: number;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function extractJsonFromText(text: string): any {
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // Try to find JSON block in markdown
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      try {
        return JSON.parse(jsonBlockMatch[1].trim());
      } catch { /* continue */ }
    }
    // Try to find raw JSON object
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch { /* continue */ }
    }
    return null;
  }
}

function getBestLocalModelSync(): string {
  const config = getOllamaConfig();
  return config.model || "llama3.2";
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Health check for local Ollama. Returns availability, model name, and latency.
 */
export async function ollamaHealthCheck(): Promise<OllamaHealthStatus> {
  const config = getOllamaConfig();
  const start = Date.now();
  try {
    const client = new Ollama({ host: config.endpoint });
    const models = await client.list();
    const latencyMs = Date.now() - start;
    const modelName = models.models?.[0]?.name || config.model;
    return { available: true, model: modelName, latencyMs, endpoint: config.endpoint };
  } catch {
    return { available: false, model: config.model, latencyMs: Date.now() - start, endpoint: config.endpoint };
  }
}

/**
 * Detect and return the best available local Ollama model.
 */
export async function getBestLocalModel(): Promise<string> {
  const config = getOllamaConfig();
  try {
    const client = new Ollama({ host: config.endpoint });
    const models = await client.list();
    if (models.models && models.models.length > 0) {
      // Prefer the configured model, otherwise pick the first
      const preferred = models.models.find((m: any) => m.name.startsWith(config.model));
      return preferred?.name || models.models[0].name;
    }
  } catch { /* fall through */ }
  return config.model;
}

/**
 * Direct Ollama inference. Sends a prompt to the local Ollama instance.
 */
export async function inferWithOllama(
  prompt: string,
  options?: {
    model?: string;
    format?: "text" | "json";
    timeout?: number;
    systemPrompt?: string;
  }
): Promise<InferenceResult> {
  const config = getOllamaConfig();
  const model = options?.model || config.model;
  const timeout = options?.timeout || 10_000;
  const start = Date.now();

  const client = new Ollama({ host: config.endpoint });

  const messages: { role: string; content: string }[] = [];
  if (options?.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await client.chat({
      model,
      messages,
      stream: false,
      format: options?.format === "json" ? "json" : undefined,
      options: { temperature: 0.2 },
    });

    clearTimeout(timer);
    const text = response.message?.content || "";
    return { text, provider: "ollama", model, latencyMs: Date.now() - start };
  } catch (err: any) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Smart inference: tries Ollama first, falls back to Gemini if unavailable.
 */
export async function smartInfer(
  prompt: string,
  options?: {
    preferLocal?: boolean;
    format?: "text" | "json";
    systemPrompt?: string;
    geminiApiKey?: string;
    timeout?: number;
  }
): Promise<InferenceResult> {
  const preferLocal = options?.preferLocal !== false; // default true
  const geminiApiKey = options?.geminiApiKey || process.env.GEMINI_API_KEY?.trim();

  if (preferLocal) {
    try {
      const health = await ollamaHealthCheck();
      if (health.available) {
        return await inferWithOllama(prompt, {
          model: health.model,
          format: options?.format,
          timeout: options?.timeout || 10_000,
          systemPrompt: options?.systemPrompt,
        });
      }
    } catch (err) {
      console.warn("[smartInfer] Ollama unavailable, falling back to Gemini:", err);
    }
  }

  // Fall back to Gemini
  if (!geminiApiKey) {
    throw new Error("Neither local Ollama nor Gemini API key is available for inference.");
  }

  const ai = getGenaiClient(geminiApiKey);
  const start = Date.now();

  const config: any = {
    temperature: 0.2,
  };
  if (options?.format === "json") {
    config.responseMimeType = "application/json";
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config,
  });

  const text = (response as any).text || "";
  return { text, provider: "gemini", model: "gemini-2.5-flash", latencyMs: Date.now() - start };
}

// ─── Higher-Level Functions ─────────────────────────────────────────────────

/**
 * Parse COA text using the best available LLM.
 */
export async function parseCOAWithInference(
  coaRawText: string,
  options?: { geminiApiKey?: string }
): Promise<any> {
  const prompt = `You are an expert OCR parsing agent for North Carolina hemp Certificates of Analysis (COAs).
Extract chemistry metrics from this raw OCR text. Compute Total THC using: Total THC = (THCa * 0.877) + Delta-9-THC.

Raw COA text:
---
${coaRawText}
---

Return ONLY a JSON object with these fields:
- batchId (string): Batch ID or serial (e.g. B-9904). Generate one if missing.
- strain (string): Hemp strain name
- thca (number): THCa percentage as float (e.g. 0.35)
- d9thc (number): Delta-9-THC percentage as float (e.g. 0.03)
- totalThc (number): Calculated Total THC
- status (string): "Compliant" if <=0.3%, "At Risk" if >=0.25% and <=0.3%, "Non-Compliant" if >0.3%
- recommendation (string): Regulatory guidance`;

  const result = await smartInfer(prompt, {
    format: "json",
    preferLocal: true,
    geminiApiKey: options?.geminiApiKey,
    systemPrompt: "You are a precise hemp COA parser. Return only valid JSON.",
  });

  return extractJsonFromText(result.text) || {};
}

/**
 * Generate a paper summary/abstract using the best available LLM.
 */
export async function summarizePaperWithInference(
  title: string,
  abstract: string,
  options?: { geminiApiKey?: string }
): Promise<string> {
  const prompt = `Summarize the following research paper in 2-3 sentences suitable for a regulatory compliance digest.
Focus on: key findings, compounds studied, and regulatory implications.

Title: ${title}
Abstract: ${abstract}

Return ONLY the summary text (no JSON, no markdown).`;

  const result = await smartInfer(prompt, {
    format: "text",
    preferLocal: true,
    geminiApiKey: options?.geminiApiKey,
  });

  return result.text.trim();
}

/**
 * Classify a document into production categories.
 */
export async function classifyDocument(
  text: string,
  options?: { geminiApiKey?: string }
): Promise<DocumentClassification> {
  const prompt = `Analyze the following document text and classify it.

Text:
---
${text.substring(0, 2000)}
---

Return ONLY a JSON object with:
- category: one of "regulatory", "safety", "formulation", "cultivation", "analytics", "general"
- compounds: array of chemical compound names found (e.g. ["THCa", "CBD"])
- keywords: array of 3-5 key topic words
- confidence: number 0-1 indicating classification confidence`;

  const result = await smartInfer(prompt, {
    format: "json",
    preferLocal: true,
    geminiApiKey: options?.geminiApiKey,
    systemPrompt: "You are a precise document classifier for hemp/cannabis research. Return only valid JSON.",
  });

  const parsed = extractJsonFromText(result.text);
  return {
    category: parsed?.category || "general",
    compounds: parsed?.compounds || [],
    keywords: parsed?.keywords || [],
    confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 0.5,
  };
}

/**
 * Generate a human-readable narrative from trend snapshot data.
 */
export async function generateTrendNarrative(
  snapshot: TrendSnapshot,
  options?: { geminiApiKey?: string }
): Promise<string> {
  const topCompoundsStr = snapshot.topCompounds
    .slice(0, 5)
    .map(c => `${c.name} (${c.count} mentions, trend: ${c.trend})`)
    .join(", ");

  const topKeywordsStr = snapshot.topKeywords
    .slice(0, 5)
    .map(k => `${k.name} (${k.count})`)
    .join(", ");

  const trendsStr = snapshot.trends
    .slice(0, 3)
    .map(t => `${t.title}: ${t.description} (growth: ${(t.growthRate * 100).toFixed(1)}%)`)
    .join("; ");

  const prompt = `You are a hemp industry research analyst. Based on the following trend snapshot, generate a 2-3 paragraph narrative summary suitable for a compliance dashboard.

Data:
- Total papers analyzed: ${snapshot.totalPapers}
- Top compounds: ${topCompoundsStr || "none"}
- Top keywords: ${topKeywordsStr || "none"}
- Detected trends: ${trendsStr || "none"}
- Class distribution: ${JSON.stringify(snapshot.classDistribution)}
- Insights: ${snapshot.insights.slice(0, 3).map(i => `${i.title}: ${i.summary}`).join("; ") || "none"}

Write a professional, data-driven narrative. Return ONLY the narrative text.`;

  const result = await smartInfer(prompt, {
    format: "text",
    preferLocal: true,
    geminiApiKey: options?.geminiApiKey,
    systemPrompt: "You are a precise hemp industry analyst. Return only the narrative.",
  });

  return result.text.trim();
}

/**
 * Generate flyer headline and body content from a research paper.
 */
export async function generateFlyerContent(
  paper: {
    title: string;
    abstract?: string;
    compounds?: string[];
    outcomes?: string;
    journal?: string;
  },
  options?: { geminiApiKey?: string }
): Promise<{ headline: string; body: string; callToAction: string }> {
  const prompt = `Generate social media flyer content for a research paper. Return ONLY a JSON object with:
- headline: Punchy, attention-grabbing headline (max 8 words)
- body: 1-2 sentence summary of key findings for a professional audience
- callToAction: Short CTA phrase (max 6 words)

Paper:
Title: ${paper.title}
Abstract: ${paper.abstract || "N/A"}
Compounds: ${(paper.compounds || []).join(", ")}
Key Finding: ${paper.outcomes || "N/A"}
Published: ${paper.journal || "Internal Research"}`;

  const result = await smartInfer(prompt, {
    format: "json",
    preferLocal: true,
    geminiApiKey: options?.geminiApiKey,
    systemPrompt: "You are a concise marketing copywriter for scientific research. Return only valid JSON.",
  });

  const parsed = extractJsonFromText(result.text);
  return {
    headline: parsed?.headline || paper.title.toUpperCase().substring(0, 60),
    body: parsed?.body || paper.outcomes || paper.abstract?.substring(0, 200) || "Research findings available.",
    callToAction: parsed?.callToAction || "VIEW FULL REPORT",
  };
}
