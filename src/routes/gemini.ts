/**
 * routes/gemini.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Google GenAI endpoints. All rate-limited per user. Fall back to heuristic
 * / Ollama / regex when GEMINI_API_KEY is absent — every fallback path emits
 * a provenance label so the UI can flag outputs accordingly.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { GoogleGenAI, Type } from "@google/genai";
import crypto from "crypto";
import {
  checkGeminiRateLimit,
  GEMINI_LIMIT_MAX_REQUESTS,
  isValidGeminiKey,
  saveAuditLog,
  createAuditHash,
} from "../services/backendServices";
import { calculateDecarbKinetics } from "../lib/complianceEngine";
import {
  runSpecialistChat,
  generateAcademicPaper,
  parseCOAText,
} from "../lib/geminiService";
import {
  createHeuristicProvenance,
  createLiveAIProvenance,
  createSimulatedProvenance,
} from "../lib/provenanceEngine";
import { parseCOAWithRegex } from "../lib/coaParser";
import { ollamaHealthCheck, parseCOAWithInference } from "../lib/ollamaInference";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

export function geminiRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── POST /api/gemini/chat ─────────────────────────────────────────────────
  router.post("/chat", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    const userId = userContext?.userId || "unknown-user";

    const rateLimit = checkGeminiRateLimit(userId);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "Too Many Requests",
        details: `Gemini rate limit exceeded. Please try again after ${new Date(rateLimit.resetTime).toLocaleTimeString()}. Limit: ${GEMINI_LIMIT_MAX_REQUESTS} requests per minute.`,
      });
    }

    const { message } = req.body;
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-20) : [];
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!isValidGeminiKey(apiKey)) {
      const query = message.toLowerCase();
      const signals: Record<string, { score: number; keywords: string[] }> = {
        Chemistry: { score: 0, keywords: ["decarb", "crude", "distill", "temp", "heat", "kinetics", "celsius", "°c", "flash", "boil", "solvent", "extraction", "chromatography", "column", "hplc", "thca %", "potency", "conversion"] },
        Literature: { score: 0, keywords: ["pubmed", "study", "research", "paper", "journal", "clinical", "trial", "cbc", "cbg", "cbn", "thcv", "scan", "literature", "publication", "article", "biorxiv", "doi"] },
        Cultivation: { score: 0, keywords: ["cure", "drying", "humid", "harvest", "yield", "trim", "dry", "flower", "greenhouse", "soil", "light", "irrigate", "pheno", "genetic", "clone", "seed"] },
        Compliance: { score: 0, keywords: ["compliant", "limit", "threshold", "0.3", "regulatory", "audit", "legal", "ncda", "fda", "usda", "license", "certify", "gxp", "alcoa", "label"] },
        Formulation: { score: 0, keywords: ["blend", "ratio", "formula", "mix", "emulsion", "beverage", "capsule", "tincture", "topical", "isolate", "carrier", "mg", "dose", "serving"] },
      };

      for (const [, sig] of Object.entries(signals)) {
        for (const kw of sig.keywords) {
          if (query.includes(kw)) sig.score += 1;
        }
      }

      const bestAgent = Object.entries(signals).sort((a, b) => b[1].score - a[1].score)[0];
      const agentType = bestAgent[1].score > 0 ? bestAgent[0] : "Compliance";

      const agentResponses: Record<string, string> = {
        Chemistry:
          "Based on the query profile, a thermal kinetics assessment is indicated. Standard decarboxylation modeling at 120°C for 45 minutes with a rate constant of approximately 0.0085 min⁻¹ would yield a conversion factor of ~0.877 for THCa to Δ9-THC. For precise results, configure GEMINI_API_KEY for live computation with your actual batch parameters.",
        Literature:
          "The query matches literature/searc h-related patterns. Cross-referencing the indexed research corpus... Use the literature search endpoint (/api/literature/search) with specific query terms, or configure GEMINI_API_KEY for live literature synthesis across PubMed, OpenAlex, and Europe PMC sources.",
        Cultivation:
          "Cultivation parameters detected. Post-harvest environmental conditions significantly affect cannabinoid preservation. Curing at 15°C and 62% RH has been shown to preserve 96%+ of acidic cannabinoid states. For batch-specific correlation analysis, ingest your environmental logs and configure GEMINI_API_KEY.",
        Compliance:
          "Under the current North Carolina legal threshold, any product with a Total THC dry-weight concentration above 0.3% is classified as non-compliant hemp. Use /api/compliance/calculate with your THCa and D9-THC values for a deterministic compliance verdict based on the 0.877 conversion formula.",
        Formulation:
          "Formulation or dosing parameters detected. The federal cap for infused beverages and edibles is 0.4mg Δ9-THC per serving. Use /api/compliance/calculate with productType='Infused-Edible' and cumulativeThcMg to validate your formulation against regulatory limits.",
      };

      let responseText = agentResponses[agentType] || agentResponses["Compliance"];
      responseText +=
        "\n\n*(Note: GEMINI_API_KEY is not configured. This response is based on keyword-pattern matching rather than live AI inference. Configure your API key in Settings to activate live Gemini intelligence).*";

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "system-agent",
        userRole: userContext?.userRole || "Operator",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
        action: "AI_SIMULATED_RESPONSE",
        details: `Simulated chat session response under agent category '${agentType}'. Prompt: "${message.substring(0, 50)}..."`,
        category: "AI_INFERENCE",
      };
      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      const heuristicResponse = createHeuristicProvenance(
        { text: responseText, agentType, simulated: true },
        {
          method: "keyword-signal-scoring",
          inputs: { message: message.substring(0, 100), detectedAgent: agentType },
          userId: userContext?.userId || "system-agent",
          userRole: userContext?.userRole || "Operator",
          tenantId: userContext?.tenantId || DEFAULT_TENANT,
        }
      );

      return res.json(heuristicResponse);
    }

    try {
      const contents: any[] = [];
      if (Array.isArray(history)) {
        history.forEach((h: any) => {
          if (h.role === "user" || h.role === "model" || h.role === "agent") {
            const role = h.role === "agent" ? "model" : h.role;
            contents.push({ role, parts: [{ text: h.content || "" }] });
          }
        });
      }
      contents.push({ role: "user", parts: [{ text: message }] });

      const { text, agentType } = await runSpecialistChat(apiKey, contents);

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "unknown-user",
        userRole: userContext?.userRole || "Operator",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
        action: "GEMINI_AGENT_CHATTED",
        details: `Gemini live chat invocation completed. Specialist Agent: '${agentType}'. Token payload calculated, and integrity verified.`,
        category: "AI_INFERENCE",
      };
      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      const liveResponse = createLiveAIProvenance(
        { text, agentType, simulated: false },
        {
          model: "gemini-2.5-flash",
          inputs: { messageLength: message.length, historyLength: history.length },
          steps: ["User message received", "History context assembled", "Gemini inference executed", "Agent type extracted"],
          userId: userContext?.userId || "unknown-user",
          userRole: userContext?.userRole || "Operator",
          tenantId: userContext?.tenantId || DEFAULT_TENANT,
        }
      );
      res.json(liveResponse);
    } catch (err: any) {
      console.error("Gemini Chat API Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/gemini/generate-paper + /api/gemini/research ───────────────
  router.post(
    ["/generate-paper", "/research"],
    deps.authMiddleware,
    async (req, res) => {
      const userContext = req.authContext;
      const userId = userContext?.userId || "unknown-user";
      const userRole = userContext?.userRole;

      if (userRole !== "Lab Admin" && userRole !== "Quality Auditor") {
        return res.status(403).json({
          error: "Forbidden: Authorized 'Lab Admin' or 'Quality Auditor' role is required for the research pipeline",
        });
      }

      const rateLimit = checkGeminiRateLimit(userId);
      if (!rateLimit.allowed) {
        return res.status(429).json({
          error: "Too Many Requests",
          details: `Gemini rate limit exceeded. Please try again after ${new Date(rateLimit.resetTime).toLocaleTimeString()}. Limit: ${GEMINI_LIMIT_MAX_REQUESTS} requests per minute.`,
        });
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
      } = req.body;

      const apiKey = process.env.GEMINI_API_KEY?.trim();

      const kinetics = calculateDecarbKinetics({ thca, d9thc, temp, duration });
      const { rateConstant, finalThca, finalD9Thc, totalThcComputed, isCompliant } = kinetics;

      if (!isValidGeminiKey(apiKey)) {
        const title = `Thermodynamic Optimization and Extraction Kinetics of Acidic Cannabinoids in ${strain} Cultivars`;
        const abstract = `This research report evaluates the decarboxylation pathways of ${strain} containing ${thca}% THCa and ${d9thc}% delta-9-THC under a high-temperature kinetic model at ${temp}°C for ${duration} minutes. Using Arrhenius kinetics, the degradation slopes show a final THCa concentration of ${finalThca.toFixed(2)}% and converted delta-9-THC of ${finalD9Thc.toFixed(3)}%, maintaining a regulatory status of ${isCompliant ? "COMPLIANT" : "NON-COMPLIANT"}.`;

        const markdown = `# ${title}

## Section I: Abstract
${abstract}

## Section II: Introduction & Cultivar Properties
Industrial hemp processing requires careful thermal management to preserve compliance thresholds while maximizing potential active species. We analyze **${strain}** containing starting concentrations of **${thca}% THCa** and **${d9thc}% Δ9-THC** with an initial moisture matrix of **${moisture}%**.

## Section III: Methodology & Thermal Decarboxylation Modeling
Thermal conversion was executed at **${temp}°C** for a duration of **${duration} minutes**. Arrhenius decay coefficients were calculated based on the base degradation rate $k = 8.0 \\times 10^{-5} \\times \\exp(0.058 \\times (T - 25))$.
- Temperature Factor: ${temp}°C
- Duration Logged: ${duration} mins
- Rate Constant ($k$): ${rateConstant.toFixed(5)} min⁻¹

## Section IV: HPLC Chromatogram & Kinetic Results
The physical conversion slope yielded the following final profiles:
- Remaining THCa: **${finalThca.toFixed(3)}%**
- Activated Δ9-THC: **${finalD9Thc.toFixed(3)}%**
- Total Computed THC: **${totalThcComputed.toFixed(3)}%**

### Simulated Chromatogram Peaks
\`\`\`
[Retention Time (min)]  | [Compound]  | [Intensity (mAU)]
--------------------------------------------------------
2.45                    | CBDa        | ████████████████ 154
3.88                    | Δ9-THC      | ${"█".repeat(Math.round(Math.min(20, finalD9Thc * 2)))} ${finalD9Thc.toFixed(2)}%
5.12                    | THCa        | ${"█".repeat(Math.round(Math.min(20, finalThca * 2)))} ${finalThca.toFixed(2)}%
\`\`\`

## Section V: Compliance & Entourage Integration
With a total computed THC profile of **${totalThcComputed.toFixed(3)}%**, this batch is classified as **${isCompliant ? "REGULATORY COMPLIANT (PASS)" : "COMPLIANCE BREACH (FAIL)"}** under NC Department of Agriculture guidelines. Formulation of entourage ratios incorporating **${blendRatios}** is advised to optimize synergic efficacy.

## Section VI: Methodology Note
Trend analysis and kinetic models are computed deterministically from the provided batch parameters. References should be sourced from the indexed literature corpus via the research library. Configure GEMINI_API_KEY to enable live citation generation from PubMed/OpenAlex sources.`;

        const parsedData = {
          title,
          abstract,
          markdown,
          compounds: blendRatios.split(",").map((s: string) => s.trim()).filter(Boolean),
          dosage: `${temp}°C Decarb Slope (${duration} min)`,
          outcomes: `Kinetic model: ${strain} at ${temp}°C yields Total THC of ${totalThcComputed.toFixed(3)}% — ${isCompliant ? "COMPLIANT" : "OVERLIMIT"}. Configure GEMINI_API_KEY for live AI-generated academic papers with real citations.`,
          simulated: true,
        };

        const auditEntry: Omit<AuditLog, "hash"> = {
          id: `log-${Date.now()}`,
          timestamp: new Date().toISOString(),
          userId: userContext?.userId || "system-agent",
          userRole: userContext?.userRole || "Operator",
          tenantId: userContext?.tenantId || DEFAULT_TENANT,
          action: "AI_PAPER_SIMULATED",
          details: `⚠️ SIMULATED: Generated research paper template for strain '${strain}' under ${temp}°C thermal model. Status: ${isCompliant ? "Compliant" : "Non-compliant"}. GEMINI_API_KEY not configured — output is deterministic template, NOT live AI inference.`,
          category: "AI_INFERENCE",
        };
        const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
        await saveAuditLog(hashedAudit, req.firebaseToken as string);

        const simulatedResponse = createSimulatedProvenance(parsedData, {
          reason: "GEMINI_API_KEY not configured or invalid",
          fallbackMethod: "deterministic-kinetics-template",
          inputs: { strain, thca, d9thc, moisture, temp, duration, blendRatios, templateType },
          userId: userContext?.userId || "system-agent",
          userRole: userContext?.userRole || "Operator",
          tenantId: userContext?.tenantId || DEFAULT_TENANT,
        });

        return res.json(simulatedResponse);
      }

      try {
        const generated = await generateAcademicPaper(apiKey, {
          strain,
          thca,
          d9thc,
          moisture,
          temp,
          duration,
          blendRatios,
          templateType,
          finalThca,
          finalD9Thc,
          totalThcComputed,
          isCompliant,
        });

        const auditEntry: Omit<AuditLog, "hash"> = {
          id: `log-${Date.now()}`,
          timestamp: new Date().toISOString(),
          userId: userContext?.userId || "unknown-user",
          userRole: userContext?.userRole || "Operator",
          tenantId: userContext?.tenantId || DEFAULT_TENANT,
          action: "RESEARCH_PAPER_GENERATED",
          details: `Gemini generated ${templateType} for Batch '${strain}' under ${temp}°C model. Computed Total THC: ${totalThcComputed.toFixed(3)}%.`,
          category: "AI_INFERENCE",
        };
        const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
        await saveAuditLog(hashedAudit, req.firebaseToken as string);

        const liveResponse = createLiveAIProvenance(
          { ...generated, simulated: false },
          {
            model: "gemini-2.5-flash",
            inputs: { strain, thca, d9thc, moisture, temp, duration, blendRatios, templateType },
            steps: ["Kinetics calculated", "Gemini paper generation invoked", "Structured JSON response parsed"],
            userId: userContext?.userId || "unknown-user",
            userRole: userContext?.userRole || "Operator",
            tenantId: userContext?.tenantId || DEFAULT_TENANT,
          }
        );
        res.json(liveResponse);
      } catch (err: any) {
        console.error("Gemini Paper Generation Error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ─── POST /api/gemini/parse-coa ────────────────────────────────────────────
  router.post("/parse-coa", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    const userId = userContext?.userId || "unknown-user";

    const rateLimit = checkGeminiRateLimit(userId);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "Too Many Requests",
        details: `Gemini rate limit exceeded. Please try again after ${new Date(rateLimit.resetTime).toLocaleTimeString()}. Limit: ${GEMINI_LIMIT_MAX_REQUESTS} requests per minute.`,
      });
    }

    const { coaRawText } = req.body;
    if (!coaRawText) {
      return res.status(400).json({ error: "Raw COA text/OCR payload is required" });
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!isValidGeminiKey(apiKey)) {
      // Try Ollama first
      try {
        const ollamaHealth = await ollamaHealthCheck();
        if (ollamaHealth.available) {
          const parsed = await parseCOAWithInference(coaRawText);
          if (parsed && parsed.batchId) {
            parsed.simulated = false;
            parsed.note = `Parsed via local Ollama (${ollamaHealth.model})`;

            const auditEntry: Omit<AuditLog, "hash"> = {
              id: `log-${Date.now()}`,
              timestamp: new Date().toISOString(),
              userId: userContext?.userId || "system-agent",
              userRole: userContext?.userRole || "Operator",
              tenantId: userContext?.tenantId || DEFAULT_TENANT,
              action: "OLLAMA_COA_PARSE",
              details: `Ollama parsed COA for strain '${parsed.strain}' (THCa ${parsed.thca}%, D9 ${parsed.d9thc}%). Status: ${parsed.status}. Model: ${ollamaHealth.model}.`,
              category: "AI_INFERENCE",
            };
            const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
            await saveAuditLog(hashedAudit, req.firebaseToken as string);
            return res.json(parsed);
          }
        }
      } catch (ollamaErr) {
        console.warn("Ollama COA parse failed, falling back to regex:", ollamaErr);
      }

      const generatedBatchId = `B-${crypto.randomUUID().slice(0, 8)}`;
      const parseResult = parseCOAWithRegex(coaRawText, generatedBatchId);

      const parsedCoa = {
        batchId: parseResult.batchId,
        strain: parseResult.strain,
        thca: parseResult.thca,
        d9thc: parseResult.d9thc,
        totalThc: parseResult.totalThc,
        status: parseResult.status,
        recommendation: parseResult.recommendation || undefined,
        confidence: parseResult.confidence,
        simulated: true,
        note: `⚠️ HEURISTIC FALLBACK: Parsed using regex pattern matching (GEMINI_API_KEY not configured, Ollama unavailable). Confidence: ${(parseResult.confidence * 100).toFixed(0)}%. Do NOT use for compliance decisions without verified lab analysis.`,
      };

      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "system-agent",
        userRole: userContext?.userRole || "Operator",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
        action: "AI_SIMULATED_OCR",
        details: `⚠️ HEURISTIC FALLBACK: Regex-based COA parsing for strain '${parseResult.strain}' (THCa ${parseResult.thca}%, D9 ${parseResult.d9thc}%). Computed status: ${parseResult.status}. Confidence: ${(parseResult.confidence * 100).toFixed(0)}%. Both Gemini and Ollama unavailable.`,
        category: "AI_INFERENCE",
      };
      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      const heuristicResponse = createHeuristicProvenance(parsedCoa, {
        method: "regex-pattern-extraction",
        inputs: { coaTextLength: coaRawText.length, extractedStrain: parseResult.strain, extractedThca: parseResult.thca, extractedD9thc: parseResult.d9thc, confidence: parseResult.confidence },
        userId: userContext?.userId || "system-agent",
        userRole: userContext?.userRole || "Operator",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
      });

      return res.json(heuristicResponse);
    }

    try {
      const parsedData = await parseCOAText(apiKey, coaRawText);
      parsedData.simulated = false;

      const auditDetails = `Gemini structured COA OCR parse complete for Batch ${parsedData.batchId} (${parsedData.strain}). Validated Total THC: ${parsedData.totalThc}%. Status: ${parsedData.status}.`;
      const auditEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "unknown-user",
        userRole: userContext?.userRole || "Operator",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
        action: "BATCH_INGEST_OCR",
        details: auditDetails,
        category: "AI_INFERENCE",
      };
      const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
      await saveAuditLog(hashedAudit, req.firebaseToken as string);

      const liveResponse = createLiveAIProvenance(parsedData, {
        model: "gemini-2.5-flash",
        inputs: { coaTextLength: coaRawText.length },
        steps: ["Raw COA text received", "Gemini structured extraction invoked", "JSON response parsed", "Compliance status determined"],
        userId: userContext?.userId || "unknown-user",
        userRole: userContext?.userRole || "Operator",
        tenantId: userContext?.tenantId || DEFAULT_TENANT,
      });

      res.json(liveResponse);
    } catch (err: any) {
      console.error("COA Ingestion API Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/gemini/extract ──────────────────────────────────────────────
  router.post("/extract", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    if (!userContext?.userId) {
      return res.status(401).json({ error: "Unauthorized: Missing identity context" });
    }

    const { title, abstract } = req.body;
    if (!title && !abstract) {
      return res.status(400).json({ error: "Title or abstract required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!isValidGeminiKey(apiKey)) {
      return res.status(500).json({ error: "Gemini API key is not configured or invalid." });
    }

    const rateLimit = checkGeminiRateLimit(userContext.userId);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "Too Many Requests",
        details: `Gemini rate limit exceeded. Please try again after ${new Date(rateLimit.resetTime).toLocaleTimeString()}. Limit: ${GEMINI_LIMIT_MAX_REQUESTS} requests per minute.`,
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `
Analyze the following scientific paper text.
Title: ${title}
Abstract: ${abstract}

Extract the following information:
1. Compounds: Array of chemical compound names, like THCa, CBD, Terpenes, etc.
2. Dosage: A short string summarizing any dosage, concentration, ratio, or measurement metric (e.g., "5μM / 5μM concentration ratio"). If none, say "N/A".
3. Outcomes: A brief 1-2 sentence summary of the key findings, efficacy, or study result.

Return this EXACTLY as a JSON object matching this schema:
{
  "compounds": ["compound1", "compound2"],
  "dosage": "string",
  "outcomes": "string"
}
`;
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              compounds: { type: Type.ARRAY, items: { type: Type.STRING } },
              dosage: { type: Type.STRING },
              outcomes: { type: Type.STRING },
            },
            required: ["compounds", "dosage", "outcomes"],
          },
          temperature: 0.1,
        },
      });
      const parsed = JSON.parse(response.text || "{}");
      res.json(parsed);
    } catch (err: any) {
      console.error("Literature extract error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}