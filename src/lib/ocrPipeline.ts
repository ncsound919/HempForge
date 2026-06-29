import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

export interface OcrResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
  }>;
  pageCount: number;
}

export interface DocumentSection {
  type:
    | "abstract"
    | "introduction"
    | "methods"
    | "results"
    | "discussion"
    | "conclusion"
    | "references"
    | "figures"
    | "unknown";
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

export interface DocumentSections {
  sections: DocumentSection[];
  title?: string;
  authors?: string[];
  doi?: string;
}

export interface HempEntity {
  name: string;
  concentration?: number;
  unit?: string;
}

export interface HempEntities {
  compounds: HempEntity[];
  strains: string[];
  methods: string[];
  parameters: Array<{ name: string; value: number; unit: string }>;
}

export type DocumentType =
  | "coa"
  | "research_paper"
  | "sop"
  | "regulatory"
  | "patent"
  | "notes"
  | "unknown";

const SECTION_PATTERNS: Array<{
  type: DocumentSection["type"];
  pattern: RegExp;
}> = [
  { type: "abstract", pattern: /^abstract[\s:.—–-]*/im },
  { type: "introduction", pattern: /^introduction[\s:.—–-]*/im },
  { type: "methods", pattern: /^(?:methods?|materials?\s+and\s+methods?|methodology|experimental\s+(?:design|procedure|section))[\s:.—–-]*/im },
  { type: "results", pattern: /^(?:results?(?:\s+and\s+discussion)?|findings?|observations?)[\s:.—–-]*/im },
  { type: "discussion", pattern: /^discussion[\s:.—–-]*/im },
  { type: "conclusion", pattern: /^(?:conclusions?|summary|concluding\s+remarks?)[\s:.—–-]*/im },
  { type: "references", pattern: /^(?:references?|bibliography|literature\s+cited|works?\s+cited)[\s:.—–-]*/im },
  { type: "figures", pattern: /^(?:figures?|tables?|appendix|appendices)[\s:.—–-]*/im },
];

export const COMPOUND_NAMES = [
  "THC", "THCa", "THC-A", "THC-a", "Delta-9-THC", "Δ9-THC", "D9-THC",
  "CBD", "CBDa", "CBD-A", "CBG", "CBGa", "CBN", "CBC", "CBDA",
  "CBL", "CBT", "Δ8-THC", "Delta-8-THC", "THCV", "THCv",
  "CBDV", "CBGV", "CBE", "CBT",
];

const STRAIN_PATTERNS = [
  /strain[:\s]+([A-Z][a-zA-Z0-9\s\-]+(?:flower|bud|kush|haze|diesel|glue|cake|pie|dream|wine|gold|lemon|berry|punch| OG| feminized| regular)?)/gi,
  /(?:cultivar|variety|cultivar\s+name)[:\s]+([A-Z][a-zA-Z0-9\s\-]+)/gi,
  /batch\s+(?:id|name|strain)[:\s]+([A-Z][a-zA-Z0-9\s\-]+)/gi,
];

const EXTRACTION_METHODS = [
  "CO2", "supercritical CO2", "subcritical CO2", "ethanol", "hydrocarbon",
  "butane", "propane", "BHO", "PHO", "live resin", "distillate",
  "isolate", "full spectrum", "broad spectrum", "winterization",
  "decarboxylation", "purging", "short path distillation",
  "rotary evaporation", "chromatography", "HPLC", "flash chromatography",
  "solventless", "rosin", "rosin press", "bubble hash", "dry sift",
  "ice water hash", "mechanical separation",
];

const PARAMETER_PATTERNS = [
  { name: "Temperature", pattern: /(?:temperature|temp)[:\s]+(\d+(?:\.\d+)?)\s*(?:°?[CcFf]|degrees?\s*(?:Celsius|Fahrenheit))/gi },
  { name: "Duration", pattern: /(?:duration|time|incubation|cook(?:ing)?\s+time|extraction\s+time)[:\s]+(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?|hrs?|hours?|sec(?:ond)?s?|days?)/gi },
  { name: "Pressure", pattern: /(?:pressure)[:\s]+(\d+(?:\.\d+)?)\s*(?:psi|bar|atm|mPa)/gi },
  { name: "Flow Rate", pattern: /(?:flow\s+rate)[:\s]+(\d+(?:\.\d+)?)\s*(?:mL\/min|L\/min|gpm)/gi },
  { name: "pH", pattern: /pH[:\s]+(\d+(?:\.\d+)?)/gi },
  { name: "Mesh Size", pattern: /(\d+[-–]\d+)\s*(?:micron|µm|mesh)/gi },
];

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function lower(input: string): string {
  return normalizeWhitespace(input).toLowerCase();
}

export async function ocrImage(
  buffer: Buffer,
  mimeType: string
): Promise<OcrResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");

  try {
    const { data } = await worker.recognize(buffer);

    const words: OcrResult["words"] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          for (const word of line.words ?? []) {
            words.push({
              text: word.text,
              bbox: {
                x0: word.bbox.x0,
                y0: word.bbox.y0,
                x1: word.bbox.x1,
                y1: word.bbox.y1,
              },
              confidence: word.confidence,
            });
          }
        }
      }
    }

    return {
      text: data.text,
      confidence: data.confidence,
      words,
      pageCount: 1,
    };
  } finally {
    await worker.terminate();
  }
}

export async function ocrPdf(buffer: Buffer): Promise<OcrResult & { scannedPdf: boolean }> {
  const parsed = await pdfParse(buffer);
  const text = normalizeWhitespace(parsed.text ?? "");
  const numPages = parsed.numpages ?? 1;
  const avgCharsPerPage = numPages > 0 ? text.length / numPages : text.length;

  const isScanned = avgCharsPerPage < 100;

  if (isScanned) {
    return {
      text: text || "[Scanned PDF — image-based OCR not available server-side. Use the browser-based OCR panel for scanned documents.]",
      confidence: 0,
      words: [],
      pageCount: numPages,
      scannedPdf: true,
    };
  }

  return {
    text,
    confidence: 95,
    words: [],
    pageCount: numPages,
    scannedPdf: false,
  };
}

export function detectSections(text: string): DocumentSections {
  const normalized = normalizeWhitespace(text);
  const lowerText = lower(normalized);
  const sections: DocumentSection[] = [];

  const titleMatch = normalized.match(/^([^\n]{5,200})/);
  const title = titleMatch ? normalizeWhitespace(titleMatch[1]) : undefined;

  const authorsMatch = normalized.match(
    /(?:^|\n)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)*)\s*(?:\n|$)/
  );
  const authors = authorsMatch
    ? authorsMatch[1]
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 2)
    : undefined;

  const doiMatch = normalized.match(
    /(?:doi[:\s]*|https?:\/\/doi\.org\/)?(10\.\d{4,}\/[^\s,]+)/i
  );
  const doi = doiMatch ? doiMatch[1] : undefined;

  for (let i = 0; i < SECTION_PATTERNS.length; i++) {
    const { type, pattern } = SECTION_PATTERNS[i];
    const match = lowerText.match(pattern);
    if (match && match.index !== undefined) {
      sections.push({
        type,
        title: match[0].replace(/[\s:.—–-]+$/, "").trim(),
        content: "",
        startIndex: match.index,
        endIndex: normalized.length,
      });
    }
  }

  sections.sort((a, b) => a.startIndex - b.startIndex);

  for (let i = 0; i < sections.length; i++) {
    sections[i].endIndex =
      i < sections.length - 1 ? sections[i + 1].startIndex : normalized.length;
    sections[i].content = normalizeWhitespace(
      normalized.slice(sections[i].startIndex, sections[i].endIndex)
    );
  }

  if (sections.length === 0 && normalized.length > 0) {
    sections.push({
      type: "unknown",
      title: "Full Document",
      content: normalized,
      startIndex: 0,
      endIndex: normalized.length,
    });
  }

  return { sections, title, authors, doi };
}

export function extractHempEntities(text: string): HempEntities {
  const lowerText = lower(text);

  const compounds: HempEntity[] = [];
  for (const name of COMPOUND_NAMES) {
    const regex = new RegExp(
      `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:\\s]*(\\d+(?:\\.\\d+)?)\\s*(%|mg\\/g|mg\\/kg|ppm|mg|g)?`,
      "gi"
    );
    let match = regex.exec(text);
    if (match) {
      const concentration = parseFloat(match[1]);
      const unit = match[2] || "%";
      compounds.push({ name, concentration, unit });
    } else if (lowerText.includes(name.toLowerCase())) {
      compounds.push({ name });
    }
  }

  const strainSet = new Set<string>();
  for (const pattern of STRAIN_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const strain = normalizeWhitespace(match[1]);
      if (strain.length >= 2 && strain.length <= 60) {
        strainSet.add(strain);
      }
    }
  }

  const methodsSet = new Set<string>();
  for (const method of EXTRACTION_METHODS) {
    if (lowerText.includes(method.toLowerCase())) {
      methodsSet.add(method);
    }
  }

  const parameters: HempEntities["parameters"] = [];
  for (const { name, pattern } of PARAMETER_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = parseFloat(match[1]);
      const unitMatch = match[0].match(
        /(?:°?[CcFf]|degrees?\s*(?:Celsius|Fahrenheit)|min(?:ute)?s?|hrs?|hours?|sec(?:ond)?s?|days?|psi|bar|atm|mPa|mL\/min|L\/min|gpm|micron|µm|mesh)/i
      );
      const unit = unitMatch ? unitMatch[0] : "";
      parameters.push({ name, value, unit });
    }
  }

  return {
    compounds,
    strains: Array.from(strainSet),
    methods: Array.from(methodsSet),
    parameters,
  };
}

const COA_KEYWORDS = [
  "certificate of analysis", "coa", "potency", "compliant", "compliance",
  "total thc", "total cbd", "lab result", "analytical", "assay",
  "batch id", "sample id", "moisture", "terpene profile",
];

const PAPER_KEYWORDS = [
  "abstract", "methods", "results", "discussion", "conclusion",
  "references", "doi", "journal", "peer-reviewed", "experiment",
  "hypothesis", "statistical", "p-value", "figure", "table",
];

const SOP_KEYWORDS = [
  "procedure", "step", "protocol", "standard operating procedure",
  "sop", "workflow", "instruction", "preamble", "scope",
  "purpose", "responsibility", "precaution",
];

const REGULATORY_KEYWORDS = [
  "regulation", "federal register", "usda", "fda", "state law",
  "compliance", "licensing", "permit", "inspection", "ncda",
  "gxp", "iso 17025", "accreditation", "enforcement",
];

const PATENT_KEYWORDS = [
  "patent", "claims", "invention", "prior art", "embodiment",
  "apparatus", "system and method", "wherein", "said",
];

export function classifyDocument(
  text: string,
  sections: DocumentSections
): DocumentType {
  const lowerText = lower(text);
  const sectionTypes = new Set(sections.sections.map((s) => s.type));

  const scoreKeywords = (keywords: string[]): number => {
    let score = 0;
    for (const kw of keywords) {
      if (lowerText.includes(kw)) score += 2;
    }
    return score;
  };

  let scores: Array<{ type: DocumentType; score: number }> = [
    { type: "coa", score: scoreKeywords(COA_KEYWORDS) },
    { type: "research_paper", score: scoreKeywords(PAPER_KEYWORDS) },
    { type: "sop", score: scoreKeywords(SOP_KEYWORDS) },
    { type: "regulatory", score: scoreKeywords(REGULATORY_KEYWORDS) },
    { type: "patent", score: scoreKeywords(PATENT_KEYWORDS) },
  ];

  if (sectionTypes.has("abstract") && sectionTypes.has("methods")) {
    scores.find((s) => s.type === "research_paper")!.score += 6;
  }
  if (sectionTypes.has("references")) {
    scores.find((s) => s.type === "research_paper")!.score += 3;
  }
  if (sectionTypes.has("results") && sectionTypes.has("discussion")) {
    scores.find((s) => s.type === "research_paper")!.score += 4;
  }

  if (lowerText.includes("certificate of analysis")) {
    scores.find((s) => s.type === "coa")!.score += 8;
  }
  if (lowerText.includes("standard operating procedure")) {
    scores.find((s) => s.type === "sop")!.score += 8;
  }
  if (lowerText.match(/\bclaims?\b.*\binvention\b/i)) {
    scores.find((s) => s.type === "patent")!.score += 6;
  }

  scores.sort((a, b) => b.score - a.score);

  if (scores[0].score < 4) {
    if (text.length < 500) return "notes";
    return "unknown";
  }

  return scores[0].type;
}
