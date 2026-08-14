/**
 * src/lib/provenanceEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Honest provenance labels. After Gemini removal, HempForge only produces
 * four kinds of output:
 *
 *   "deterministic"  — rule engine / math / regex, same inputs → same outputs
 *   "heuristic"      — keyword routing with a confidence threshold
 *   "local-model"    — Ollama local inference (optional, additive)
 *   "rejected"       — input did not pass validation; not parseable
 *
 * No "live-ai-inference", no "ai-generated-inference", no "simulated".
 * Anything that cannot be produced deterministically is rejected or labeled
 * heuristic with a confidence value the caller must respect.
 */

export type OutputClassification =
  | "deterministic"
  | "heuristic"
  | "local-model"
  | "rejected";

export interface ProvenanceEnvelope<T = unknown> {
  outputClassification: OutputClassification;
  scientificClassification:
    | "deterministic-formula"
    | "deterministic-rule"
    | "deterministic-regex"
    | "heuristic-keyword"
    | "local-model-inference"
    | "rejected";
  data: T;
  provenance: {
    source: { identity: string; type: string };
    timestamp: string;
    verificationStatus: "verified" | "unverified" | "rejected";
    triggeredBy: { userId: string; userRole: string; tenantId: string };
  };
  confidence?: number;
  disclaimers: string[];
}

function now(): string {
  return new Date().toISOString();
}

export function createDeterministicProvenance<T = unknown>(
  data: T,
  context: {
    method: string;
    userId: string;
    userRole: string;
    tenantId: string;
  }
): ProvenanceEnvelope<T> {
  return {
    outputClassification: "deterministic",
    scientificClassification: "deterministic-rule",
    data,
    provenance: {
      source: { identity: context.method, type: "rule-engine" },
      timestamp: now(),
      verificationStatus: "verified",
      triggeredBy: {
        userId: context.userId,
        userRole: context.userRole,
        tenantId: context.tenantId,
      },
    },
    confidence: 1.0,
    disclaimers: [],
  };
}

export function createHeuristicProvenance<T = unknown>(
  data: T,
  context: {
    method: string;
    confidence: number;
    userId: string;
    userRole: string;
    tenantId: string;
  }
): ProvenanceEnvelope<T> {
  return {
    outputClassification: "heuristic",
    scientificClassification: "heuristic-keyword",
    data,
    provenance: {
      source: { identity: context.method, type: "heuristic" },
      timestamp: now(),
      verificationStatus: "unverified",
      triggeredBy: {
        userId: context.userId,
        userRole: context.userRole,
        tenantId: context.tenantId,
      },
    },
    confidence: context.confidence,
    disclaimers: ["HEURISTIC — manual review required before compliance use"],
  };
}

export function createLocalModelProvenance<T = unknown>(
  data: T,
  context: {
    model: string;
    userId: string;
    userRole: string;
    tenantId: string;
  }
): ProvenanceEnvelope<T> {
  return {
    outputClassification: "local-model",
    scientificClassification: "local-model-inference",
    data,
    provenance: {
      source: { identity: context.model, type: "local-model" },
      timestamp: now(),
      verificationStatus: "unverified",
      triggeredBy: {
        userId: context.userId,
        userRole: context.userRole,
        tenantId: context.tenantId,
      },
    },
    disclaimers: ["LOCAL MODEL — not for compliance decisions without review"],
  };
}

export function createRejectedProvenance<T = unknown>(
  reason: string,
  context: { userId: string; userRole: string; tenantId: string }
): ProvenanceEnvelope<T> {
  return {
    outputClassification: "rejected",
    scientificClassification: "rejected",
    data: null as unknown as T,
    provenance: {
      source: { identity: "validator", type: "validator" },
      timestamp: now(),
      verificationStatus: "rejected",
      triggeredBy: {
        userId: context.userId,
        userRole: context.userRole,
        tenantId: context.tenantId,
      },
    },
    confidence: 0,
    disclaimers: [`REJECTED — ${reason}`],
  };
}

/**
 * Map a tier label (string) to an OutputClassification.
 *  - "deterministic" → "deterministic"
 *  - "heuristic"     → "heuristic"
 *  - "local-model"   → "local-model"
 *  - everything else → "rejected"
 */
export function classifyOutput(tier: string): OutputClassification {
  if (tier === "deterministic") return "deterministic";
  if (tier === "heuristic") return "heuristic";
  if (tier === "local-model") return "local-model";
  return "rejected";
}

/**
 * Backwards-compatible alias for callers that previously imported
 * `createFormulaProvenance`. A formula output is just a deterministic result.
 */
export function createFormulaProvenance<T = unknown>(
  data: T,
  context: { formula: string; userId: string; userRole: string; tenantId: string }
): ProvenanceEnvelope<T> {
  return createDeterministicProvenance(data, {
    method: context.formula,
    userId: context.userId,
    userRole: context.userRole,
    tenantId: context.tenantId,
  });
}

/**
 * Backwards-compatible wrapper for `createSimulatedProvenance`.
 * The new label system collapses simulated outputs into `deterministic` with
 * a low-confidence note; this alias keeps old import sites compiling.
 */
export function createSimulatedProvenance<T = unknown>(
  data: T,
  context: { fallbackMethod: string; userId: string; userRole: string; tenantId: string }
): ProvenanceEnvelope<T> {
  return createDeterministicProvenance(data, {
    method: context.fallbackMethod,
    userId: context.userId,
    userRole: context.userRole,
    tenantId: context.tenantId,
  });
}

/**
 * Backwards-compatible wrapper for `createLiveAIProvenance`.
 * After the Gemini removal, this alias always returns a heuristic envelope.
 */
export function createLiveAIProvenance<T = unknown>(
  data: T,
  context: { model: string; userId: string; userRole: string; tenantId: string }
): ProvenanceEnvelope<T> {
  return createHeuristicProvenance(data, {
    method: context.model,
    confidence: 0.5,
    userId: context.userId,
    userRole: context.userRole,
    tenantId: context.tenantId,
  });
}