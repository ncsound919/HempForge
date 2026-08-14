/**
 * src/assistant/assistantEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic assistant engine.
 *
 * The "assistant" is NOT a chat model. It is a rule-based intent classifier
 * + template answer renderer + retrieval-augmented provenance. Every response
 * exposes the exact rules that fired and the documents that informed the
 * answer.
 *
 * Intent taxonomy (rule-based):
 *   - compliance.calculate      → route to /api/compliance/calculate
 *   - compliance.status         → explain NC 0.3% threshold + FDA 0.4mg cap
 *   - coa.parse                 → instructions for /api/coas
 *   - coa.verify                → instructions for /api/coas/verify/:id
 *   - literature.search         → route to /api/literature/search
 *   - literature.trends         → explain Mann-Kendall results
 *   - audit.verify              → explain chain integrity
 *   - risk.explain              → explain a risk score
 *   - autonomy.run              → route to /api/autonomy/run
 *   - settings.ollama           → local-model configuration
 *   - help.navigation           → list of pages
 *   - fallback                  → retrieve top-K docs and show them
 */

import { tenantRetrievalIndex } from "./retrievalIndex";

export type Intent =
  | "compliance.calculate"
  | "compliance.status"
  | "coa.parse"
  | "coa.verify"
  | "literature.search"
  | "literature.trends"
  | "audit.verify"
  | "risk.explain"
  | "autonomy.run"
  | "settings.ollama"
  | "help.navigation"
  | "fallback";

export interface RuleHit {
  rule: string;
  matched: string;
  weight: number;
}

export interface AssistantAnswer {
  intent: Intent;
  confidence: number;
  templateId: string;
  title: string;
  body: string;
  steps: Array<{ label: string; detail: string }>;
  firedRules: RuleHit[];
  citations: Array<{ id: string; source: string; title: string; score: number }>;
  nextActions: Array<{ label: string; path: string; method?: string }>;
  warnings: string[];
  provenance: {
    method: "rule-based-intent+retrieval";
    intentsEvaluated: number;
    rulesFired: number;
    documentsRetrieved: number;
  };
}

// ---------------------------------------------------------------------------
// Intent classifier — pure rule scoring
// ---------------------------------------------------------------------------

interface IntentRule {
  intent: Intent;
  patterns: RegExp[];
  baseWeight: number;
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: "compliance.calculate",
    patterns: [
      /\bcalculate\s+total\s*thc\b/i,
      /\btotal\s*thc\s*=\b/i,
      /\bthca\b.*?\bd9\b/i,
      /\b(thca|d9\s?-?\s?thc|0\.877)\b/i,
    ],
    baseWeight: 1.0,
  },
  {
    intent: "compliance.status",
    patterns: [
      /\b(compliant|non-?compliant|at[- ]risk)\b/i,
      /\b(threshold|0\.3\s?%|0\.25\s?%|0\.4\s?mg)\b/i,
      /\bnorth\s+carolina\b/i,
      /\bfda\s+serving\b/i,
      /\bdry[- ]?weight\b/i,
    ],
    baseWeight: 0.8,
  },
  {
    intent: "coa.parse",
    patterns: [
      /\bparse\s+(a\s+)?(coa|certificate)\b/i,
      /\bocr\b/i,
      /\bextract\s+(thca|cannabinoid|analyte)\b/i,
      /\bimport\s+(a\s+)?(coa|pdf|scan)\b/i,
    ],
    baseWeight: 0.9,
  },
  {
    intent: "coa.verify",
    patterns: [
      /\bverify\s+(a\s+)?(coa|certificate|public)\b/i,
      /\bqr\s+code\b/i,
      /\bpublic\s+verification\b/i,
    ],
    baseWeight: 0.9,
  },
  {
    intent: "literature.search",
    patterns: [
      /\b(search|find|lookup)\s+(paper|publication|study|article)\b/i,
      /\bpubmed\b/i,
      /\bcannabinoid\s+(study|research)\b/i,
    ],
    baseWeight: 0.8,
  },
  {
    intent: "literature.trends",
    patterns: [
      /\btrend(s|ing)?\b/i,
      /\bmann[- ]?kendall\b/i,
      /\bz[- ]?score\b/i,
      /\banomal(y|ies)\b/i,
    ],
    baseWeight: 0.85,
  },
  {
    intent: "audit.verify",
    patterns: [
      /\baudit\s+(chain|log|trail)\b/i,
      /\bhash\s+chain\b/i,
      /\balcoa\+/i,
      /\bchain\s+integrity\b/i,
    ],
    baseWeight: 0.9,
  },
  {
    intent: "risk.explain",
    patterns: [
      /\b(risk\s+score|risk\s+level|high\s+risk|critical)\b/i,
      /\bwhy\s+(is\s+this|flagged|risk)\b/i,
    ],
    baseWeight: 0.8,
  },
  {
    intent: "autonomy.run",
    patterns: [
      /\b(run|start|trigger)\s+(the\s+)?(autonomy|platform|pipeline|cycle)\b/i,
      /\bautonomous\b/i,
      /\bingest\s+papers\b/i,
      /\bsimulate\s+now\b/i,
    ],
    baseWeight: 0.85,
  },
  {
    intent: "settings.ollama",
    patterns: [
      /\b(ollama|local\s+model|llama)\b/i,
      /\binstall\s+(ollama|a\s+model)\b/i,
      /\bcors\b/i,
    ],
    baseWeight: 0.7,
  },
  {
    intent: "help.navigation",
    patterns: [
      /\b(how\s+do\s+i|where\s+is|how\s+to|navigate)\b/i,
      /\b(show|list)\s+(pages?|tabs?|sections?|routes)\b/i,
    ],
    baseWeight: 0.6,
  },
];

function classifyIntent(query: string): { intent: Intent; score: number; hits: RuleHit[] } {
  const hits: RuleHit[] = [];
  let bestIntent: Intent = "fallback";
  let bestScore = 0;

  for (const rule of INTENT_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      const m = query.match(pattern);
      if (m) {
        const w = rule.baseWeight;
        score += w;
        hits.push({ rule: `${rule.intent}:${pattern.source}`, matched: m[0], weight: w });
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIntent = rule.intent;
    }
  }

  // Confidence: normalize against max possible weight (4 patterns × 1.0 = 4.0)
  const maxScore = INTENT_RULES.reduce((m, r) => Math.max(m, r.patterns.length * r.baseWeight), 0);
  const confidence = Math.min(1, bestScore / Math.max(1, maxScore / 4));
  return { intent: bestIntent, score: bestScore, hits };
}

// ---------------------------------------------------------------------------
// Templates — every intent has a fixed template renderer
// ---------------------------------------------------------------------------

interface Template {
  id: string;
  title: (q: string) => string;
  body: (q: string) => string;
  steps: Array<{ label: string; detail: string }>;
  nextActions: Array<{ label: string; path: string; method?: string }>;
}

const TEMPLATES: Record<Intent, Template> = {
  "compliance.calculate": {
    id: "tpl.compliance.calculate",
    title: () => "Calculate Total THC (Deterministic)",
    body: () =>
      `Total THC = (THCa × 0.877) + Δ9-THC. The 0.877 factor is the mass-loss ` +
      `ratio for converting THCa to Δ9-THC during decarboxylation. ` +
      `North Carolina classifies hemp as containing ≤ 0.3% Total THC on a ` +
      `dry-weight basis (NCGS §106-568.51).`,
    steps: [
      { label: "Gather inputs", detail: "THCa (% by dry weight) and Δ9-THC (%)" },
      { label: "Apply formula", detail: "Total THC = (THCa × 0.877) + Δ9THC" },
      { label: "Classify", detail: "≤ 0.25% Compliant · 0.25–0.30% At Risk · > 0.30% Non-Compliant" },
      { label: "Edible cap", detail: "For infused edibles, also enforce ≤ 0.4 mg Δ9-THC per serving (FDA)" },
    ],
    nextActions: [
      { label: "Open Compliance Calculator", path: "/lab" },
      { label: "POST /api/compliance/calculate", path: "/api/compliance/calculate", method: "POST" },
    ],
  },
  "compliance.status": {
    id: "tpl.compliance.status",
    title: () => "Compliance Status Thresholds",
    body: () =>
      `HempForge uses three deterministic thresholds: Compliant (Total THC < 0.25%), ` +
      `At Risk (0.25–0.30%), and Non-Compliant (> 0.30%). For infused edibles the FDA ` +
      `serving cap is 0.4 mg Δ9-THC per serving.`,
    steps: [
      { label: "Total THC band", detail: "0.25 / 0.30% boundary per NC Dept of Agriculture" },
      { label: "Edible cap", detail: "0.4 mg Δ9-THC / serving per FDA" },
      { label: "Deterministic", detail: "Pure math — no LLM" },
    ],
    nextActions: [
      { label: "Open Compliance Calculator", path: "/lab" },
      { label: "View Policy", path: "/api/security/policy" },
    ],
  },
  "coa.parse": {
    id: "tpl.coa.parse",
    title: () => "Parse a Certificate of Analysis",
    body: () =>
      `COA parsing runs entirely on deterministic regex + schema matching — no LLM. ` +
      `Use the COA Intake screen to upload a PDF/PNG or paste raw text.`,
    steps: [
      { label: "Upload", detail: "Drop a PDF, PNG, or paste OCR text into COA Intake" },
      { label: "Extract", detail: "Regex + schema extraction captures THCa, Δ9-THC, batch id, strain" },
      { label: "Sign", detail: "Compliance signature is computed server-side and audited" },
      { label: "Verify", detail: "Public COA verification works without authentication" },
    ],
    nextActions: [
      { label: "Open COA Intake", path: "/intake" },
      { label: "POST /api/coas", path: "/api/coas", method: "POST" },
    ],
  },
  "coa.verify": {
    id: "tpl.coa.verify",
    title: () => "Verify a COA",
    body: () =>
      `Public verification at GET /api/coas/verify/:id requires no auth. ` +
      `It confirms the COA exists in the registry and the cryptographic signature ` +
      `matches the canonical fields (id, batchId, strain, totalThc, status).`,
    steps: [
      { label: "Scan QR", detail: "Use the QR code on the package to deep-link to the verifier" },
      { label: "Verify", detail: "GET /api/coas/verify/:id" },
      { label: "Audit", detail: "Each verification generates an immutable audit log entry" },
    ],
    nextActions: [
      { label: "Open Public Verifier", path: "/verify/demo" },
      { label: "GET /api/coas/verify/:id", path: "/api/coas/verify/demo" },
    ],
  },
  "literature.search": {
    id: "tpl.literature.search",
    title: () => "Search the Literature Corpus",
    body: () =>
      `HempForge pulls from PubMed, OpenAlex, Europe PMC, Semantic Scholar, ` +
      `bioRxiv, and CORE. New papers are auto-ingested every 5 minutes by the ` +
      `autonomous pipeline.`,
    steps: [
      { label: "Search", detail: "POST /api/literature/search with a query string" },
      { label: "Tag", detail: "Compounds and regulatory keywords are auto-tagged" },
      { label: "Persist", detail: "Papers land in researchPapers, tagged and indexed" },
    ],
    nextActions: [
      { label: "Open Literature Feeds", path: "/vault" },
      { label: "Run Autonomy Now", path: "/autonomy" },
    ],
  },
  "literature.trends": {
    id: "tpl.literature.trends",
    title: () => "Trend Analysis (Mann-Kendall + z-score)",
    body: () =>
      `Trend detection uses the non-parametric Mann-Kendall test for monotonic ` +
      `trend and z-score (≥ 2) for anomalies. Both are deterministic and surface ` +
      `the test statistic in the UI.`,
    steps: [
      { label: "Mann-Kendall", detail: "S statistic and z-score per keyword/compound" },
      { label: "Anomalies", detail: "z-score ≥ 2 flagged as low/medium/high" },
      { label: "Refresh", detail: "Trends recomputed every hour by the autonomous pipeline" },
    ],
    nextActions: [
      { label: "Open Knowledge Vault", path: "/vault" },
      { label: "GET /api/literature/trends-insights", path: "/api/literature/trends-insights" },
    ],
  },
  "audit.verify": {
    id: "tpl.audit.verify",
    title: () => "Verify the Audit Chain",
    body: () =>
      `Every audit entry is SHA-256 hash-chained (ALCOA+). Chain verification ` +
      `re-walks every link and reports the broken sequence number if any entry ` +
      `was tampered with. Quality Auditor or Lab Admin role required.`,
    steps: [
      { label: "Re-verify", detail: "POST /api/audit/verify-chain" },
      { label: "Auto-scan", detail: "Runs hourly via the autonomous agent pipeline" },
      { label: "Alert", detail: "Breaks persisted to auditAlerts with severity 'critical'" },
    ],
    nextActions: [
      { label: "View Audit Logs", path: "/api/audit/logs" },
      { label: "Run Verification", path: "/api/audit/verify-chain" },
    ],
  },
  "risk.explain": {
    id: "tpl.risk.explain",
    title: () => "Risk Score Breakdown",
    body: () =>
      `Risk is computed by ` +
      `scoreBatchRisk(batch) — a 0-100 additive score: base THC band (+25/+50), ` +
      `product type (+10 for edibles), prior flag status (+15/+30), and per-alert ` +
      `(+5). Levels: low (<20), medium (<40), high (<70), critical (≥70).`,
    steps: [
      { label: "Total THC", detail: "≤ 0.25% = 0 · 0.25–0.30% = +25 · > 0.30% = +50" },
      { label: "Product type", detail: "Infused-Edible = +10" },
      { label: "Status", detail: "At Risk = +15 · Non-Compliant = +30" },
      { label: "Alerts", detail: "+5 per active compliance alert" },
    ],
    nextActions: [
      { label: "Open Dashboard", path: "/" },
      { label: "GET /api/dashboard/summary", path: "/api/dashboard/summary" },
    ],
  },
  "autonomy.run": {
    id: "tpl.autonomy.run",
    title: () => "Run Platform Autonomy",
    body: () =>
      `The autonomous agent pipeline runs every 5 minutes (short cycle) and ` +
      `every 60 minutes (full cycle). Skills: ingest literature → analyze papers → ` +
      `run kinetics simulations → score regulatory risk → generate compliance ` +
      `report → verify audit chain. You can also trigger a cycle on demand.`,
    steps: [
      { label: "Short cycle", detail: "5 min — ingest + analyze" },
      { label: "Full cycle", detail: "60 min — ingest + analyze + simulate + score + report + verify" },
      { label: "On demand", detail: "POST /api/autonomy/run" },
      { label: "Live status", detail: "GET /api/autonomy/status" },
    ],
    nextActions: [
      { label: "Open Autonomy", path: "/autonomy" },
      { label: "POST /api/autonomy/run", path: "/api/autonomy/run", method: "POST" },
    ],
  },
  "settings.ollama": {
    id: "tpl.settings.ollama",
    title: () => "Local Model (Optional)",
    body: () =>
      `HempForge is fully deterministic — it does not require Ollama. ` +
      `If you do install Ollama, run it on the loopback address and HempForge ` +
      `will use it for optional local-model features. Otherwise every response ` +
      `is generated by the rule engine.`,
    steps: [
      { label: "Install", detail: "Download from https://ollama.com" },
      { label: "Allow CORS", detail: "Set OLLAMA_ORIGINS=* before launching" },
      { label: "Start", detail: "ollama serve (default port 11434)" },
      { label: "Verify", detail: "GET /api/ollama/health" },
    ],
    nextActions: [
      { label: "Open Settings", path: "/settings" },
      { label: "GET /api/ollama/health", path: "/api/ollama/health" },
    ],
  },
  "help.navigation": {
    id: "tpl.help.navigation",
    title: () => "HempForge Pages",
    body: () =>
      `HempForge has one page per capability. The sidebar collapses everything ` +
      `into the fewest actions that get work done.`,
    steps: [
      { label: "/", detail: "Dashboard — pipeline status + recent activity" },
      { label: "/intake", detail: "COA Intake — upload, parse, register" },
      { label: "/agent", detail: "Assistant — deterministic Q&A + recommendations" },
      { label: "/lab", detail: "Research Lab — kinetics simulations + decarb model" },
      { label: "/vault", detail: "Knowledge Vault — ingested literature + trends" },
      { label: "/workflows", detail: "Workflows — pipeline stages + ROI" },
      { label: "/settings", detail: "Settings — configuration + capabilities" },
      { label: "/autonomy", detail: "Autonomy — live pipeline status + Run Now" },
    ],
    nextActions: [
      { label: "Dashboard", path: "/" },
      { label: "Run Autonomy Now", path: "/autonomy" },
    ],
  },
  fallback: {
    id: "tpl.fallback",
    title: (q) => `Best match for: "${q}"`,
    body: () =>
      `HempForge does not generate freeform answers. Instead it retrieves the most ` +
      `relevant documents from your tenant's indexed corpus and surfaces them with ` +
      `their provenance. If nothing matches, ask a specific question about compliance, ` +
      `COAs, literature, audit, risk, autonomy, or navigation.`,
    steps: [
      { label: "Try a specific topic", detail: "compliance · COA · literature · audit · risk · autonomy" },
    ],
    nextActions: [
      { label: "Open Autonomy", path: "/autonomy" },
      { label: "Open Dashboard", path: "/" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Engine entry point
// ---------------------------------------------------------------------------

export class AssistantEngine {
  async answer(tenantId: string, query: string): Promise<AssistantAnswer> {
    const { intent, score, hits } = classifyIntent(query);
    const template = TEMPLATES[intent];

    // Retrieve top-K docs for fallback + provenance context
    const retrieved = intent === "fallback"
      ? await tenantRetrievalIndex.search(tenantId, query, 5)
      : await tenantRetrievalIndex.search(tenantId, query, 3);

    const confidence = intent === "fallback"
      ? Math.min(0.6, retrieved.length > 0 ? retrieved[0].score / 5 : 0.1)
      : Math.min(1, 0.5 + score * 0.1);

    const warnings: string[] = [];
    if (intent === "fallback" && retrieved.length === 0) {
      warnings.push("No matching documents indexed for this tenant yet.");
    }

    return {
      intent,
      confidence: Number(confidence.toFixed(2)),
      templateId: template.id,
      title: template.title(query),
      body: template.body(query),
      steps: template.steps,
      firedRules: hits,
      citations: retrieved.map((r) => ({
        id: r.doc.id,
        source: r.doc.source,
        title: r.doc.title,
        score: Number(r.score.toFixed(3)),
      })),
      nextActions: template.nextActions,
      warnings,
      provenance: {
        method: "rule-based-intent+retrieval",
        intentsEvaluated: INTENT_RULES.length,
        rulesFired: hits.length,
        documentsRetrieved: retrieved.length,
      },
    };
  }
}

export const assistantEngine = new AssistantEngine();