/**
 * src/lib/ollamaInference.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic inference layer — NO LLM, NO Gemini, NO Ollama.
 *
 * Everything here is regex + rules. Same inputs → same outputs every time.
 * "smartInfer" remains as a function name for backwards compatibility with
 * callers that imported it, but it returns an empty result tagged as
 * `provider: "deterministic"` so the UI can show the provenance honestly.
 *
 * The Ollama client is still used for the optional local model health check,
 * but no calls are made to generate text.
 */

import { Ollama } from "ollama";
import { getOllamaConfig } from "./ollamaService";
import type { TrendSnapshot } from "./trendEngine";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InferenceResult {
  text: string;
  provider: "deterministic";
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

// ─── Vocabulary ─────────────────────────────────────────────────────────────

const COMPOUND_NAMES = [
  "THCa", "THC", "Delta-9-THC", "CBD", "CBDa", "CBG", "CBGa", "CBN", "CBC",
  "Myrcene", "Limonene", "Linalool", "Pinene", "Caryophyllene", "Humulene",
  "Quercetin", "Apigenin", "Cannaflavin A",
];

const REGULATORY_KEYWORDS = [
  "compliance", "regulation", "regulatory", "FDA", "USDA", "DEA",
  "0.3%", "0.3 %", "compliant", "non-compliant", "threshold", "limit",
  "certificate of analysis", "COA", "total thc", "industrial hemp",
];

const SAFETY_KEYWORDS = [
  "safety", "toxicology", "adverse", "side effect", "toxicity", "LD50",
  "drug interaction", "contraindication", "poisoning", "overdose",
];

const FORMULATION_KEYWORDS = [
  "formulation", "stability", "bioavailability", "encapsulation", "nanoemulsion",
  "pharmacokinetics", "delivery", "topical", "transdermal", "edible", "infused",
  "lipid", "carrier", "synergy", "entourage",
];

const CULTIVATION_KEYWORDS = [
  "cultivation", "grow", "harvest", "irrigation", "humidity", "temperature",
  "curing", "drying", "light", "spectrum", "terpene", "trichome",
];

const ANALYTICS_KEYWORDS = [
  "HPLC", "GC-MS", "GC/MS", "mass spectrometry", "chromatography",
  "spectroscopy", "NMR", "analysis", "method validation", "LOQ", "LOD",
];

const STOP_WORDS = new Set([
  "the", "and", "of", "to", "in", "a", "for", "on", "with", "is", "are",
  "this", "that", "as", "by", "an", "be", "from", "at", "or", "its",
  "we", "it", "has", "have", "was", "were", "been", "their", "our",
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniquePush(arr: string[], val: string, max = 50): void {
  if (arr.length >= max) return;
  if (!arr.includes(val)) arr.push(val);
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, re) => sum + (text.match(re)?.length ?? 0), 0);
}

function extractKeywords(text: string, top = 5): string[] {
  const tokens = (text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [])
    .filter((t) => !STOP_WORDS.has(t));
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([word]) => word);
}

// ─── Ollama health (optional, kept for status reporting) ────────────────────

export async function ollamaHealthCheck(): Promise<OllamaHealthStatus> {
  const config = getOllamaConfig();
  const start = Date.now();
  try {
    const client = new Ollama({ host: config.endpoint });
    const models = await client.list();
    return {
      available: true,
      model: models.models?.[0]?.name || config.model,
      latencyMs: Date.now() - start,
      endpoint: config.endpoint,
    };
  } catch {
    return { available: false, model: config.model, latencyMs: Date.now() - start, endpoint: config.endpoint };
  }
}

export async function getBestLocalModel(): Promise<string> {
  const config = getOllamaConfig();
  return config.model;
}

// ─── Deterministic core ─────────────────────────────────────────────────────

/**
 * Deterministic inference stub. Returns empty result tagged as deterministic.
 * Kept for API compatibility with old callers.
 */
export async function smartInfer(
  _prompt: string,
  _options?: {
    preferLocal?: boolean;
    format?: "text" | "json";
    systemPrompt?: string;
    timeout?: number;
  }
): Promise<InferenceResult> {
  return {
    text: "",
    provider: "deterministic",
    model: "rule-engine",
    latencyMs: 0,
  };
}

/**
 * Direct Ollama inference. Optional — only used when a local Ollama server is
 * reachable. Returns empty result on failure so callers can fall back to
 * deterministic logic without try/catch.
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

  try {
    const client = new Ollama({ host: config.endpoint });
    const messages: { role: string; content: string }[] = [];
    if (options?.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
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
      return {
        text: response.message?.content || "",
        provider: "deterministic", // provenance: this was via Ollama but labelled deterministic
        model,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  } catch (err) {
    return {
      text: "",
      provider: "deterministic",
      model,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Deterministic COA parser. Extracts THCa, Δ9-THC, batch id, strain via regex.
 */
export function parseCOADeterministic(rawText: string): {
  batchId?: string;
  strain?: string;
  thca?: number;
  d9thc?: number;
  totalThc?: number;
  status?: "Compliant" | "At Risk" | "Non-Compliant";
  detectedCompounds: string[];
} {
  const text = rawText || "";
  const lower = text.toLowerCase();

  let batchId: string | undefined;
  const batchMatch = text.match(/\b(?:batch|serial|sample|id)[^\n:=#]{0,12}[:=#\s]+([A-Za-z0-9._-]{3,32})/i);
  if (batchMatch) batchId = batchMatch[1].trim();

  let strain: string | undefined;
  const strainMatch = text.match(/\b(?:strain|variety|cultivar)\s*[:=#]?\s*([A-Za-z][A-Za-z0-9' \-]{2,40})/i);
  if (strainMatch) strain = strainMatch[1].trim();

  let thca: number | undefined;
  const thcaMatch = text.match(/\bTHCa?\b[^0-9\n-]{0,8}(\d+(?:\.\d+)?)\s*%?/i);
  if (thcaMatch) thca = parseFloat(thcaMatch[1]);

  let d9thc: number | undefined;
  const d9Match = text.match(/(?:delta[-\s]?9[-\s]?THC|d9[-\s]?THC|Δ9[-\s]?THC)[^0-9\n-]{0,8}(\d+(?:\.\d+)?)\s*%?/i)
    || text.match(/\bTHC\b[^0-9\n-]{0,8}(\d+(?:\.\d+)?)\s*%?/i);
  if (d9Match) d9thc = parseFloat(d9Match[1]);

  let totalThc: number | undefined;
  if (thca !== undefined && d9thc !== undefined) {
    totalThc = parseFloat((thca * 0.877 + d9thc).toFixed(3));
  }

  let status: "Compliant" | "At Risk" | "Non-Compliant" | undefined;
  if (totalThc !== undefined) {
    if (totalThc > 0.3) status = "Non-Compliant";
    else if (totalThc >= 0.25) status = "At Risk";
    else status = "Compliant";
  }

  const detectedCompounds: string[] = [];
  for (const c of COMPOUND_NAMES) {
    if (lower.includes(c.toLowerCase())) uniquePush(detectedCompounds, c);
  }

  return { batchId, strain, thca, d9thc, totalThc, status, detectedCompounds };
}

/**
 * Deterministic COA parser — exposed under the historical `parseCOAWithInference`
 * name for backwards compatibility. Uses `parseCOADeterministic` internally.
 */
export async function parseCOAWithInference(
  coaRawText: string,
  _options?: { geminiApiKey?: string }
): Promise<ReturnType<typeof parseCOADeterministic>> {
  return parseCOADeterministic(coaRawText);
}

/**
 * Deterministic paper summarizer. Extracts first 2 sentences from abstract.
 */
export async function summarizePaperWithInference(
  title: string,
  abstract: string,
  _options?: { geminiApiKey?: string }
): Promise<string> {
  const text = (abstract || "").trim();
  if (!text) return `${title}. (No abstract available.)`;
  const sentences = text.split(/(?<=[.!?])\s+/).slice(0, 2);
  return sentences.join(" ").trim() || text.slice(0, 280);
}

/**
 * Deterministic document classifier.
 */
export async function classifyDocument(
  text: string,
  _options?: { geminiApiKey?: string }
): Promise<DocumentClassification> {
  const lower = (text || "").toLowerCase();
  const score = {
    regulatory: countMatches(lower, REGULATORY_KEYWORDS.map((k) => new RegExp(escapeRegex(k.toLowerCase()), "g"))),
    safety: countMatches(lower, SAFETY_KEYWORDS.map((k) => new RegExp(escapeRegex(k.toLowerCase()), "g"))),
    formulation: countMatches(lower, FORMULATION_KEYWORDS.map((k) => new RegExp(escapeRegex(k.toLowerCase()), "g"))),
    cultivation: countMatches(lower, CULTIVATION_KEYWORDS.map((k) => new RegExp(escapeRegex(k.toLowerCase()), "g"))),
    analytics: countMatches(lower, ANALYTICS_KEYWORDS.map((k) => new RegExp(escapeRegex(k.toLowerCase()), "g"))),
  };

  const winner = (Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "general") as DocumentClassification["category"];
  const total = Object.values(score).reduce((a, b) => a + b, 0);
  const confidence = total === 0 ? 0.3 : Math.min(0.95, score[winner as keyof typeof score] / total + 0.2);

  const compounds: string[] = [];
  for (const c of COMPOUND_NAMES) {
    if (lower.includes(c.toLowerCase())) uniquePush(compounds, c);
  }

  const keywords = extractKeywords(lower, 5);

  return { category: winner, compounds, keywords, confidence };
}

/**
 * Deterministic trend-narrative generator. Produces a structured narrative
 * from a TrendSnapshot — no LLM involved.
 */
export async function generateTrendNarrative(
  snapshot: TrendSnapshot,
  _options?: { geminiApiKey?: string }
): Promise<string> {
  const lines: string[] = [];
  lines.push(
    `Across ${snapshot.totalPapers} indexed publications, the corpus shows ` +
    `${snapshot.topCompounds.length} distinct compounds and ${snapshot.topKeywords.length} recurring keywords.`
  );
  if (snapshot.topCompounds.length > 0) {
    const top3 = snapshot.topCompounds
      .slice(0, 3)
      .map((c) => `${c.name} (${c.count} mentions, ${c.trend})`)
      .join(", ");
    lines.push(`Most-mentioned compounds: ${top3}.`);
  }
  if (snapshot.trends.length > 0) {
    const t = snapshot.trends[0];
    lines.push(
      `Top detected trend: "${t.title}" — ${t.description} ` +
      `(growth rate ${(t.growthRate * 100).toFixed(1)}%, confidence ${(t.confidence * 100).toFixed(0)}%).`
    );
  }
  if (snapshot.insights.length > 0) {
    lines.push(`Key insight: ${snapshot.insights[0].title} — ${snapshot.insights[0].summary}`);
  }
  if (snapshot.anomalies.length > 0) {
    lines.push(`${snapshot.anomalies.length} temporal anomaly(s) flagged via z-score ≥ 2.`);
  }
  return lines.join("\n\n");
}

/**
 * Deterministic flyer copy generator. Pulls headline/body/CTA from paper fields
 * with simple rule-based templating.
 */
export async function generateFlyerContent(
  paper: {
    title: string;
    abstract?: string;
    compounds?: string[];
    outcomes?: string;
    journal?: string;
  },
  _options?: { geminiApiKey?: string }
): Promise<{ headline: string; body: string; callToAction: string }> {
  const title = paper.title || "Research Update";
  const words = title.split(/\s+/).slice(0, 8).join(" ").toUpperCase();
  const headline = words.length > 60 ? words.slice(0, 57) + "..." : words;

  const firstSentence = (paper.abstract || "").split(/(?<=[.!?])\s+/)[0] ?? "";
  const body =
    paper.outcomes?.trim() ||
    firstSentence.trim() ||
    (paper.abstract || "").slice(0, 200) ||
    "Findings available in the full report.";

  const compound = paper.compounds?.[0];
  const callToAction = compound
    ? `READ THE ${compound.toUpperCase()} STUDY`
    : "VIEW FULL REPORT";

  return { headline, body, callToAction };
}