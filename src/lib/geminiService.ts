import { GoogleGenAI, Type } from "@google/genai";

let genaiClient: GoogleGenAI | null = null;

function getGenaiClient(apiKey: string): GoogleGenAI {
  if (!genaiClient || (genaiClient as any)._apiKey !== apiKey) {
    genaiClient = new GoogleGenAI({ apiKey });
    (genaiClient as any)._apiKey = apiKey;
  }
  return genaiClient;
}

export async function runSpecialistChat(apiKey: string, contents: any[]): Promise<{ text: string; agentType: string }> {
  try {
    const ai = getGenaiClient(apiKey);

    const systemInstruction = `You are the HempForge Swarm Orchestrator, an AI-powered compliance and analytical chemistry expert for the hemp/cannabis industries in North Carolina and federally.
You guide users through Total THC testing calculations: (THCa * 0.877) + Delta-9 THC, and FDA serving caps (0.4mg per serving of beverages/infused edibles).
You can represent different specialist agent roles depending on the topic:
- "Chemistry": For thermal decarboxylation, extraction kinetics, crude distillation profiles, or chromatography.
- "Literature": For PubMed, clinical studies, cannabinoid formulation (e.g. THCa + CBC), or patent scans.
- "Cultivation": For grow parameters, curing humidity vs THCa preservation, and harvest timing correlations.
- "Compliance" or "Orchestrator": For regulatory rules, dry weight pass/fail parameters, and GxP guidelines.

Decide which specialist agent you are representing and start your response with a line indicating that, for example: "[AGENT_TYPE: Chemistry]" or "[AGENT_TYPE: Literature]" or "[AGENT_TYPE: Cultivation]" or "[AGENT_TYPE: Compliance]".
Provide highly scientific, accurate, and GxP-compliant responses. Mention citations, chemical reaction details, or regulatory standards where appropriate. Keep responses concise and professional.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: {
        systemInstruction,
        temperature: 0.2
      }
    });

    const text = response.text || "";
    let agentType = "Compliance";
    let cleanedText = text;
    const match = text.match(/\[AGENT_TYPE:\s*([^\]]+)\]/i);
    if (match) {
      agentType = match[1].trim();
      cleanedText = text.replace(/\[AGENT_TYPE:\s*[^\]]+\]/i, "").trim();
    }

    return { text: cleanedText, agentType };
  } catch (err) {
    console.error("Gemini Chat API Error inside service:", err);
    throw err;
  }
}

export async function generateAcademicPaper(
  apiKey: string,
  params: {
    templateType: string;
    strain: string;
    thca: number;
    d9thc: number;
    moisture: number;
    temp: number;
    duration: number;
    blendRatios: string;
    finalThca: number;
    finalD9Thc: number;
    totalThcComputed: number;
    isCompliant: boolean;
  }
): Promise<any> {
  const {
    templateType,
    strain,
    thca,
    d9thc,
    moisture,
    temp,
    duration,
    blendRatios,
    finalThca,
    finalD9Thc,
    totalThcComputed,
    isCompliant
  } = params;
  try {
    const ai = getGenaiClient(apiKey);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are an elite, peer-reviewed academic scientist, laboratory researcher, and regulatory specialist in hemp chemistry.
Generate a comprehensive, professional ${templateType} based on the following input parameters:
- Strain Cultivar: ${strain}
- Starting THCa: ${thca}%
- Starting Δ9-THC: ${d9thc}%
- Moisture: ${moisture}%
- Decarboxylation Temperature: ${temp}°C
- Decarboxylation Duration: ${duration} minutes
- Synergistic Entourage Compounds: ${blendRatios}
- Computed kinetics show: Final THCa: ${finalThca.toFixed(3)}%, Activated Δ9-THC: ${finalD9Thc.toFixed(3)}%, Total THC: ${totalThcComputed.toFixed(3)}%, Regulatory Status: ${isCompliant ? "COMPLIANT" : "OVERLIMIT"}.

Return a structured JSON object containing:
1. "title": A credible academic title for the paper.
2. "abstract": A concise, formal abstract summarizing objectives, methods, outcomes, and compliance status.
3. "markdown": The complete, highly detailed research paper written in structured, professional Markdown format, including Section headers, Introduction, Methodology with kinetics, Results & Discussion with an ASCII peaks chart, Compliance Audit review, and Academic References.
4. "compounds": An array of isolated cannabinoids featured in the paper (e.g. ["THCa", "CBC", "CBD"]).
5. "dosage": Selected thermal or blend ratio dose (e.g. "120°C Thermal Slope").
6. "outcomes": A high-impact, one-sentence laboratory finding or regulatory directive.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "A formal, scholarly title for the paper." },
            abstract: { type: Type.STRING, description: "A structured abstract of the paper." },
            markdown: { type: Type.STRING, description: "The full paper formatted as Markdown with sections, references, and tables." },
            compounds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "cannabinoids or terpenes mentioned." },
            dosage: { type: Type.STRING, description: "Optimal dose or thermal processing condition." },
            outcomes: { type: Type.STRING, description: "A concise 1-sentence outcome conclusion." }
          },
          required: ["title", "abstract", "markdown", "compounds", "dosage", "outcomes"]
        },
        temperature: 0.3
      }
    });

    const text = response.text || "{}";
    return JSON.parse(text);
  } catch (err) {
    console.error("Gemini Paper Generation Error inside service:", err);
    throw err;
  }
}

export async function parseCOAText(apiKey: string, coaRawText: string): Promise<any> {
  try {
    const ai = getGenaiClient(apiKey);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are an expert OCR and Layout-Understanding Parsing Agent for North Carolina hemp lab Certificates of Analysis (COAs).
Extract the chemistry metrics from this raw, unstructured OCR text payload. Compute the Total THC accurately using the scientific and regulatory formula:
Total THC = (THCa * 0.877) + Delta-9-THC.

Here is the unstructured COA text:
---
${coaRawText}
---`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            batchId: { type: Type.STRING, description: "Extract the official Batch ID or serial number (e.g. B-9904). If none is found, generate a compliant serial starting with B- followed by 4 digits." },
            strain: { type: Type.STRING, description: "Hemp/Cannabis strain name identified (e.g., Lifter CBD, Carolina Dream)." },
            thca: { type: Type.NUMBER, description: "THCa percentage detected as a floating-point number (e.g. 0.35)." },
            d9thc: { type: Type.NUMBER, description: "Delta-9-THC (or Δ9-THC) percentage detected as a floating-point number (e.g. 0.03)." },
            totalThc: { type: Type.NUMBER, description: "Calculated Total THC value exactly using: (THCa * 0.877) + Delta-9-THC." },
            status: { type: Type.STRING, description: "Must be 'Compliant' if Total THC <= 0.3%, 'At Risk' if Total THC is >= 0.25% and <= 0.3%, and 'Non-Compliant' if Total THC > 0.3%." },
            recommendation: { type: Type.STRING, description: "Detailed regulatory guidance if At Risk or Non-Compliant. If compliant, suggest standard curing humidity preservation advice." }
          },
          required: ["batchId", "strain", "thca", "d9thc", "totalThc", "status"]
        },
        temperature: 0.1
      }
    });

    const text = response.text || "{}";
    return JSON.parse(text);
  } catch (err) {
    console.error("Gemini COA OCR Parse Error inside service:", err);
    throw err;
  }
}
