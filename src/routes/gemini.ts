/**
 * routes/gemini.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * DEPRECATED ROUTE — preserved at /api/gemini/* for backwards compatibility
 * but every endpoint now returns a deterministic response with provenance.
 *
 * No LLM. No Gemini. No Ollama. The endpoints act as adapters around the
 * `parseCOADeterministic` regex parser and the kinetics engine.
 *
 *   POST /api/gemini/chat             — keyword routing to canned responses
 *   POST /api/gemini/parse-coa        — regex COA parser
 *   POST /api/gemini/generate-paper   — deterministic kinetics report
 *   POST /api/gemini/research         — alias for /generate-paper
 *   POST /api/gemini/extract          — regex metadata extraction
 */
import { Router, RequestHandler } from "express";
import {
  createAuditHash,
  saveAuditLog,
} from "../services/backendServices";
import { calculateDecarbKinetics } from "../lib/complianceEngine";
import { parseCOADeterministic } from "../lib/ollamaInference";
import { parseCOAWithRegex } from "../lib/coaParser";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

type ParsedCoaResponse = {
  batchId: string;
  strain: string;
  thca: number;
  d9thc: number;
  totalThc: number;
  status: "Compliant" | "At Risk" | "Non-Compliant";
  recommendation?: string;
  confidence?: number;
  simulated: true;
  note: string;
};

function buildKeywordResponse(message: string): { text: string; agentType: string } {
  const query = (message || "").toLowerCase();
  const signals: Record<string, { score: number; keywords: string[] }> = {
    Chemistry: { score: 0, keywords: ["decarb", "crude", "distill", "temp", "heat", "kinetics", "celsius", "°c", "flash", "boil", "solvent", "extraction", "chromatography", "column", "hplc", "potency", "conversion"] },
    Literature: { score: 0, keywords: ["pubmed", "study", "research", "paper", "journal", "clinical", "trial", "cbc", "cbg", "cbn", "thcv", "scan", "literature", "publication", "article", "biorxiv", "doi"] },
    Cultivation: { score: 0, keywords: ["cure", "drying", "humid", "harvest", "yield", "trim", "dry", "flower", "greenhouse", "soil", "light", "irrigate", "pheno", "genetic", "clone", "seed"] },
    Compliance: { score: 0, keywords: ["compliant", "limit", "threshold", "0.3", "regulatory", "audit", "legal", "ncda", "fda", "usda", "license", "certify", "gxp", "alcoa", "label"] },
    Formulation: { score: 0, keywords: ["blend", "ratio", "formula", "mix", "emulsion", "beverage", "capsule", "tincture", "topical", "isolate", "carrier", "mg", "dose", "serving"] },
  };

  for (const sig of Object.values(signals)) {
    for (const kw of sig.keywords) {
      if (query.includes(kw)) sig.score += 1;
    }
  }

  const best = Object.entries(signals).sort((a, b) => b[1].score - a[1].score)[0];
  const agentType = best && best[1].score > 0 ? best[0] : "Compliance";

  const responses: Record<string, string> = {
    Chemistry:
      "Thermal decarboxylation kinetics: at 120°C for 45 min, the rate constant is k ≈ 0.0085 min⁻¹ (Arrhenius first-order). Conversion factor THCa→Δ9-THC is 0.877. Use POST /api/compliance/calculate with your THCa and D9 values for a deterministic verdict.",
    Literature:
      "Literature search uses PubMed, OpenAlex, Europe PMC, Semantic Scholar, bioRxiv, and CORE. Use POST /api/literature/search with a query string. The autonomous agent ingests new papers every 5 minutes.",
    Cultivation:
      "Curing at 15°C and 62% RH preserves >96% of acidic cannabinoid states (Peschel 2017). Ingest your environmental logs via the local folder indexer (./local-research, ./vault) and the agent will correlate against literature.",
    Compliance:
      "NC threshold: any product with Total THC dry-weight > 0.3% is non-compliant hemp. Total THC = (THCa × 0.877) + Δ9-THC. Use POST /api/compliance/calculate. The compliance sweep cron runs every 6 hours.",
    Formulation:
      "FDA cap for infused beverages and edibles is 0.4mg Δ9-THC per serving. POST /api/compliance/calculate with productType='Infused-Edible' and cumulativeThcMg to validate your formulation.",
  };

  return {
    text: responses[agentType] ?? responses.Compliance,
    agentType,
  };
}

interface PlannerDecision {
  action: "respond" | "tool_call" | "ask_clarifying_question";
  agentType: string;
  message: string;
  toolName?: string;
  args?: Record<string, unknown>;
  confidence: number;
}

/**
 * Deterministic planner for the Swarm Orchestrator harness. Given the harness
 * planner input (objective + tool list + trace), pick the next action. Emits the
 * same JSON shape the harness expects from a model, so the loop runs LLM-free:
 *   step 1  -> choose a tool based on the objective keywords
 *   step 2+ -> finalize (a tool already produced an observation)
 */
export function planHarnessDecision(input: string): PlannerDecision {
  const objective = (input.match(/User objective:\s*([\s\S]*?)(?:\n\s*\n|Recent conversation)/i)?.[1] || input).toLowerCase();

  // A tool has already run -> produce the final answer.
  if (/Latest observation from/i.test(input) || /Trace so far:(?!\s*none)/i.test(input)) {
    return {
      action: "respond",
      agentType: "Reporting",
      message: "Deterministic run complete — the computed result is shown in the observation above.",
      confidence: 0.9,
    };
  }

  const num = (re: RegExp): number | undefined => {
    const m = input.match(re);
    return m ? Number(m[1]) : undefined;
  };

  if (/thc|potency|decarb|calculat|complian|percent/.test(objective)) {
    const thca = num(/thca[^\d]{0,12}([\d.]+)/i);
    const d9 =
      num(/d9\s*-?\s*thc[^\d]{0,12}([\d.]+)/i) ??
      num(/delta\s*[- ]?9[^\d]{0,12}([\d.]+)/i);
    if (thca === undefined && d9 === undefined) {
      return {
        action: "ask_clarifying_question",
        agentType: "Compliance",
        message: "Provide the THCa and Delta-9 THC percentages (dry weight) so I can compute total THC.",
        confidence: 0.7,
      };
    }
    return {
      action: "tool_call",
      agentType: "Compliance",
      message: "Computing dry-weight total THC.",
      toolName: "calculate_total_thc",
      args: { thca: thca ?? 0, d9thc: d9 ?? 0 },
      confidence: 0.95,
    };
  }

  if (/cached|summar/.test(objective)) {
    return { action: "tool_call", agentType: "Literature", message: "Reading cached literature signals.", toolName: "get_cached_literature", args: {}, confidence: 0.9 };
  }

  if (/literature|search|pubmed|study|studies|curing|stability|paper|research/.test(objective)) {
    const query = objective.replace(/\s+/g, " ").trim().slice(0, 120) || "hemp compliance";
    return { action: "tool_call", agentType: "Literature", message: "Searching the literature.", toolName: "search_literature", args: { query }, confidence: 0.9 };
  }

  if (/coa|audit|batch|batches|review/.test(objective)) {
    return { action: "tool_call", agentType: "Compliance", message: "Retrieving COA records.", toolName: "get_coas", args: {}, confidence: 0.9 };
  }

  return {
    action: "respond",
    agentType: "Orchestrator",
    message: "I can compute total THC, audit COAs, search literature, or summarize cached literature. Which would you like?",
    confidence: 0.6,
  };
}

export function geminiRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── POST /api/gemini/chat ─────────────────────────────────────────────────
  router.post("/chat", deps.authMiddleware, async (req, res) => {
    const message = req.body?.message;
    if (!message) return res.status(400).json({ error: "Message is required" });

    // The Swarm Orchestrator harness sends its system prompt + planner input and
    // expects a JSON planner decision back. Produce one deterministically so the
    // harness works with no LLM (it is the "model" in the deterministic era).
    const isHarnessPlanner = /Decide the next best action/i.test(message);
    let text: string;
    let agentType: string;
    let method: string;

    if (isHarnessPlanner) {
      const decision = planHarnessDecision(message);
      text = JSON.stringify(decision);
      agentType = decision.agentType;
      method = "deterministic-planner";
    } else {
      const r = buildKeywordResponse(message);
      text = r.text;
      agentType = r.agentType;
      method = "keyword-signal-scoring";
    }

    const auditEntry: Omit<AuditLog, "hash"> = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: req.authContext?.userId || "system-agent",
      userRole: req.authContext?.userRole || "Operator",
      tenantId: req.authContext?.tenantId || DEFAULT_TENANT,
      action: "DETERMINISTIC_CHAT",
      details: `Keyword-routed response under category '${agentType}'.`,
      category: "AI_INFERENCE",
    };
    await saveAuditLog({ ...auditEntry, hash: createAuditHash(auditEntry) } as any, req.firebaseToken as string);

    res.json({
      text,
      agentType,
      simulated: true,
      provenance: {
        method,
        model: "rule-engine",
      },
    });
  });

  // ─── POST /api/gemini/parse-coa ────────────────────────────────────────────
  router.post("/parse-coa", deps.authMiddleware, async (req, res) => {
    const coaRawText = req.body?.coaRawText;
    if (!coaRawText) return res.status(400).json({ error: "Raw COA text is required" });

    const deterministic = parseCOADeterministic(coaRawText);
    let parsed: ParsedCoaResponse;
    if (deterministic.thca !== undefined && deterministic.d9thc !== undefined) {
      const generatedBatchId = deterministic.batchId || `B-${Math.random().toString(36).slice(2, 10)}`;
      parsed = {
        batchId: generatedBatchId,
        strain: deterministic.strain || "Unknown",
        thca: deterministic.thca,
        d9thc: deterministic.d9thc,
        totalThc: deterministic.totalThc ?? 0,
        status: deterministic.status ?? "Compliant",
        confidence: 0.8,
        simulated: true,
        note: "Parsed via deterministic regex + arithmetic. No LLM involved. Verify with lab before compliance filing.",
      };
    } else {
      // Fall back to the existing regex parser if our primary one misses.
      const fallback = parseCOAWithRegex(coaRawText, `B-${Math.random().toString(36).slice(2, 10)}`);
      parsed = {
        batchId: fallback.batchId,
        strain: fallback.strain,
        thca: fallback.thca,
        d9thc: fallback.d9thc,
        totalThc: fallback.totalThc,
        status: fallback.status,
        confidence: fallback.confidence ?? 0.5,
        simulated: true,
        note: "Parsed via legacy regex parser. Verify fields before compliance filing.",
      };
    }

    const auditEntry: Omit<AuditLog, "hash"> = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: req.authContext?.userId || "system-agent",
      userRole: req.authContext?.userRole || "Operator",
      tenantId: req.authContext?.tenantId || DEFAULT_TENANT,
      action: "DETERMINISTIC_COA_PARSE",
      details: `Parsed COA ${parsed.batchId} (${parsed.strain}) → THCa ${parsed.thca}% / D9 ${parsed.d9thc}% / Total ${parsed.totalThc}% (${parsed.status}).`,
      category: "AI_INFERENCE",
    };
    await saveAuditLog({ ...auditEntry, hash: createAuditHash(auditEntry) } as any, req.firebaseToken as string);

    res.json(parsed);
  });

  // ─── POST /api/gemini/generate-paper + /api/gemini/research ───────────────
  router.post(["/generate-paper", "/research"], deps.authMiddleware, async (req, res) => {
    const userRole = req.authContext?.userRole;
    if (userRole !== "Lab Admin" && userRole !== "Quality Auditor") {
      return res.status(403).json({ error: "Forbidden: 'Lab Admin' or 'Quality Auditor' role required" });
    }

    const {
      strain = "Carolina Dream",
      thca = 15.0,
      d9thc = 0.05,
      moisture = 12.0,
      temp = 120,
      duration = 60,
      blendRatios = "THCa, CBC, CBD",
      templateType = "Academic Journal Paper",
    } = req.body || {};

    const kinetics = calculateDecarbKinetics({ thca, d9thc, temp, duration });
    const { rateConstant, finalThca, finalD9Thc, totalThcComputed, isCompliant } = kinetics;

    const title = `Thermodynamic Optimization and Extraction Kinetics of Acidic Cannabinoids in ${strain} Cultivars`;
    const abstract = `This research report evaluates the decarboxylation pathways of ${strain} containing ${thca}% THCa and ${d9thc}% Δ9-THC under a high-temperature kinetic model at ${temp}°C for ${duration} minutes. Using Arrhenius kinetics, the degradation slopes show a final THCa concentration of ${finalThca.toFixed(2)}% and converted Δ9-THC of ${finalD9Thc.toFixed(3)}%, regulatory status: ${isCompliant ? "COMPLIANT" : "NON-COMPLIANT"}.`;

    const markdown = `# ${title}

## Abstract
${abstract}

## Methodology & Thermal Decarboxylation Modeling
Thermal conversion executed at **${temp}°C** for **${duration} minutes**.
Arrhenius: $k = 8.0 \\times 10^{-5} \\times \\exp(0.058 \\times (T - 25))$

- Starting THCa: ${thca}%
- Starting Δ9-THC: ${d9thc}%
- Rate constant ($k$): ${rateConstant.toFixed(5)} min⁻¹
- Final THCa: **${finalThca.toFixed(3)}%**
- Final Δ9-THC: **${finalD9Thc.toFixed(3)}%**
- Total Computed THC: **${totalThcComputed.toFixed(3)}%** — ${isCompliant ? "REGULATORY COMPLIANT (PASS)" : "COMPLIANCE BREACH (FAIL)"}

## Compliance Note
Total THC = (THCa × 0.877) + Δ9-THC. NC threshold 0.3%. Verify with the autonomous compliance sweep (every 6h) and consult your QA reviewer before publishing.

## Formulation Guidance
Suggested entourage ratios incorporating **${blendRatios}** to optimize synergic efficacy.

*Deterministic, no LLM. Generated by HempForge rule engine.*`;

    const auditEntry: Omit<AuditLog, "hash"> = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: req.authContext?.userId || "system-agent",
      userRole: req.authContext?.userRole || "Operator",
      tenantId: req.authContext?.tenantId || DEFAULT_TENANT,
      action: "DETERMINISTIC_PAPER_GENERATED",
      details: `Generated deterministic paper for ${strain} at ${temp}°C for ${duration}min. Total THC ${totalThcComputed.toFixed(3)}% (${isCompliant ? "Compliant" : "Non-compliant"}).`,
      category: "AI_INFERENCE",
    };
    await saveAuditLog({ ...auditEntry, hash: createAuditHash(auditEntry) } as any, req.firebaseToken as string);

    res.json({
      title,
      abstract,
      markdown,
      compounds: String(blendRatios).split(",").map((s) => s.trim()).filter(Boolean),
      dosage: `${temp}°C Decarb Slope (${duration} min)`,
      outcomes: `Kinetic model: ${strain} at ${temp}°C yields Total THC of ${totalThcComputed.toFixed(3)}% — ${isCompliant ? "COMPLIANT" : "OVERLIMIT"}.`,
      templateType,
      simulated: true,
      provenance: { method: "deterministic-kinetics-template", model: "rule-engine" },
    });
  });

  // ─── POST /api/gemini/extract ──────────────────────────────────────────────
  router.post("/extract", deps.authMiddleware, async (req, res) => {
    const title = req.body?.title || "";
    const abstract = req.body?.abstract || "";
    if (!title && !abstract) {
      return res.status(400).json({ error: "Title or abstract required" });
    }

    const text = `${title}\n${abstract}`.toLowerCase();
    const COMPOUNDS = ["THCa", "THC", "Δ9-THC", "CBD", "CBG", "CBN", "CBC", "Myrcene", "Limonene", "Linalool", "Pinene", "Caryophyllene", "Humulene"];
    const compounds = COMPOUNDS.filter((c) => text.includes(c.toLowerCase()));

    const dosageMatch = text.match(/(\d+(?:\.\d+)?)\s*(mg\/kg|μg\/ml|ug\/ml|%|ppm|mg\/ml|mg\b)/);
    const dosage = dosageMatch ? `${dosageMatch[1]}${dosageMatch[2]}` : "N/A";

    const outcomes = (abstract || "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").trim() || "N/A";

    res.json({ compounds, dosage, outcomes });
  });

  return router;
}