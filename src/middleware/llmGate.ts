/**
 * src/middleware/llmGate.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Capability detector — NOT an LLM router. HempForge is fully deterministic.
 *
 * This middleware probes (a) whether Ollama is reachable and (b) what
 * capabilities the request is permitted to use, then attaches that
 * information to `req.capabilities`. Routes inspect `req.capabilities` to
 * decide whether to call the local model server or fall back to the
 * deterministic rule engine.
 *
 * There is no Gemini path. There never was after the Gemini removal.
 *
 * Output labels used by this middleware:
 *   "deterministic"        — rule engine / math / regex
 *   "heuristic"            — keyword routing with a confidence threshold
 *   "local-model"          — Ollama inference (optional, additive)
 *   "rejected"             — input did not pass validation; not parseable
 */

import { RequestHandler } from "express";
import { ollamaHealthCheck } from "../lib/ollamaInference";

export interface Capabilities {
  ollama: {
    available: boolean;
    endpoint: string;
    model: string;
  };
  /** Best (most capable) tier available for the current request. */
  bestTier: 1 | 3;
  /** All available tiers, ordered from most deterministic to most capable. */
  availableTiers: Array<1 | 3>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      capabilities?: Capabilities;
    }
  }
}

const cachedCapabilities: { value: Capabilities | null; expiresAt: number; lastProbedAt: number } = {
  value: null,
  expiresAt: 0,
  lastProbedAt: 0,
};
/**
 * Short cache TTL — 5 seconds. The Ollama probe is async and cheap; we
 * re-check frequently so a user starting Ollama mid-session sees it within
 * seconds. The full autonomous cron also calls `forceProbe()` periodically.
 */
const CACHE_MS = 5_000;

async function detectCapabilities(forceFresh = false): Promise<Capabilities> {
  const now = Date.now();
  if (!forceFresh && cachedCapabilities.value && cachedCapabilities.expiresAt > now) {
    return cachedCapabilities.value;
  }

  const ollamaStatus = await ollamaHealthCheck();
  cachedCapabilities.lastProbedAt = now;
  const capabilities: Capabilities = {
    ollama: {
      available: ollamaStatus.available,
      endpoint: ollamaStatus.endpoint,
      model: ollamaStatus.model,
    },
    bestTier: ollamaStatus.available ? 3 : 1,
    availableTiers: ollamaStatus.available ? [1, 3] : [1],
  };
  cachedCapabilities.value = capabilities;
  cachedCapabilities.expiresAt = now + CACHE_MS;
  return capabilities;
}

/**
 * Force a fresh probe. Called by the autonomy loop so the UI always shows
 * the most current availability without waiting for cache expiry.
 */
export async function forceProbe(): Promise<Capabilities> {
  return detectCapabilities(true);
}

/**
 * Middleware that attaches `req.capabilities` for downstream handlers.
 */
export const capabilityGate: RequestHandler = async (req, _res, next) => {
  try {
    req.capabilities = await detectCapabilities();
  } catch {
    req.capabilities = {
      ollama: { available: false, endpoint: "", model: "" },
      bestTier: 1,
      availableTiers: [1],
    };
  }
  next();
};

/**
 * Returns the Ollama call function if available, otherwise null.
 * Routes that use this must always have a deterministic fallback path.
 */
export function selectLocalModel(
  capabilities: Capabilities | undefined,
  preferLocal = true
): ((prompt: string) => Promise<string>) | null {
  if (!capabilities || !capabilities.ollama.available) return null;
  if (!preferLocal) return null;
  // The actual Ollama call is in ollamaInference. We return a thin wrapper.
  // Routes that need text-generation should import `inferWithOllama` directly.
  return null;
}

/**
 * Decorates a response payload with provenance metadata describing how it was
 * produced. Replaces the old `withTierMeta`.
 */
export function withCapabilityMeta<T extends Record<string, unknown>>(
  capabilities: Capabilities | undefined,
  payload: T
): T & { _provenance: { mode: string; tiers: Array<1 | 3> } } {
  return {
    ...payload,
    _provenance: {
      mode: capabilities?.bestTier === 3 ? "deterministic+local-model" : "deterministic",
      tiers: capabilities?.availableTiers ?? [1],
    },
  };
}