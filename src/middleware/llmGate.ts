/**
 * llmGate.ts
 * Tiered LLM routing middleware for HempForge.
 *
 * Every route that may call an LLM passes through this middleware first.
 * It probes API key validity and Ollama reachability, then attaches
 * `req.llmAvailable` so each route can select the correct execution tier
 * at call time — without hard-failing if a key is absent.
 *
 * Tier resolution (lowest-cost tier wins):
 *   Tier 1/2 — deterministic engines (no LLM needed)        → always available
 *   Tier 3   — Ollama (local LLM)                           → if ollamaReachable
 *   Tier 4   — Gemini (cloud LLM)                           → if geminiKeyValid
 *
 * The platform NEVER throws a 500 because a key is missing.
 * It returns a deterministic result and sets `usedTier` in the response.
 */

import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMAvailability {
  gemini: boolean;
  ollama: boolean;
  /** Highest tier currently available (3=Ollama, 4=Gemini, 2=deterministic only) */
  bestTier: 2 | 3 | 4;
}

declare global {
  namespace Express {
    interface Request {
      llmAvailable: LLMAvailability;
    }
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const OLLAMA_HEALTH_TIMEOUT_MS = 1500;
const GEMINI_KEY_MIN_LENGTH = 20;

// ---------------------------------------------------------------------------
// Probe functions
// ---------------------------------------------------------------------------

/** Validates that the Gemini API key looks structurally correct. */
export function isValidGeminiKey(key: string | undefined): boolean {
  if (!key || typeof key !== 'string') return false;
  return key.trim().length >= GEMINI_KEY_MIN_LENGTH && key.startsWith('AI');
}

/** Hits the Ollama /api/tags endpoint with a short timeout. */
export async function ollamaReachable(baseUrl: string = OLLAMA_BASE_URL): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_HEALTH_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware. Attach to any route that may invoke an LLM.
 *
 * Usage:
 *   router.post('/api/reports/generate', llmGate, reportHandler);
 *
 * In the handler:
 *   if (req.llmAvailable.bestTier >= 4) { // use Gemini }
 *   else if (req.llmAvailable.bestTier >= 3) { // use Ollama }
 *   else { // return deterministic result only }
 */
export async function llmGate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiValid = isValidGeminiKey(geminiKey);
  const ollamaUp = await ollamaReachable();

  let bestTier: 2 | 3 | 4;
  if (geminiValid) bestTier = 4;
  else if (ollamaUp) bestTier = 3;
  else bestTier = 2;

  req.llmAvailable = {
    gemini: geminiValid,
    ollama: ollamaUp,
    bestTier,
  };

  next();
}

// ---------------------------------------------------------------------------
// Route-level helper — use inside handlers after llmGate runs
// ---------------------------------------------------------------------------

/**
 * Returns the best available LLM caller, or null if only deterministic
 * tier is available. Allows routes to gracefully degrade inline:
 *
 *   const llm = selectLLM(req.llmAvailable);
 *   const narrative = llm ? await llm(prompt) : null;
 */
export function selectLLM(
  availability: LLMAvailability
): ((prompt: string) => Promise<string>) | null {
  if (availability.bestTier === 4) {
    return async (prompt: string) => {
      const { generateGeminiResponse } = await import('../lib/geminiService');
      return generateGeminiResponse(prompt);
    };
  }
  if (availability.bestTier === 3) {
    return async (prompt: string) => {
      const { generateOllamaResponse } = await import('../lib/ollamaService');
      return generateOllamaResponse(prompt);
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Response helper — stamps tier provenance on every response
// ---------------------------------------------------------------------------

/**
 * Wraps a response body with tier metadata so callers always know
 * how the result was produced.
 *
 *   return res.json(withTierMeta(req.llmAvailable, { compliance, trends }));
 */
export function withTierMeta<T extends object>(
  availability: LLMAvailability,
  body: T
): T & { _meta: { usedTier: number; llmAvailable: LLMAvailability } } {
  return {
    ...body,
    _meta: {
      usedTier: availability.bestTier,
      llmAvailable: availability,
    },
  };
}
