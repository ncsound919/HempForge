/**
 * HempForge COA (Certificate of Analysis) Parser Module
 * 
 * Independently testable COA text extraction using regex patterns.
 * Used as fallback when both Gemini and Ollama are unavailable.
 * 
 * Criterion 9: Domain logic in testable module, not buried in route handlers.
 * Criterion 5: Processing integrity with confidence scoring.
 */

import { evaluateCOACompliance, type ComplianceStatus } from "./complianceEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface COAParseResult {
  batchId: string;
  strain: string;
  thca: number;
  d9thc: number;
  totalThc: number;
  status: ComplianceStatus;
  recommendation: string;
  /** Confidence score 0-1 indicating extraction reliability */
  confidence: number;
  /** Which fields were extracted vs defaulted */
  extractionDetails: {
    strainExtracted: boolean;
    thcaExtracted: boolean;
    d9thcExtracted: boolean;
    batchIdExtracted: boolean;
  };
}

// ─── Regex Patterns ───────────────────────────────────────────────────────────

const STRAIN_PATTERNS = [
  /strain:\s*([^\n\r,]+)/i,
  /strain\s+name:\s*([^\n\r,]+)/i,
  /cultivar:\s*([^\n\r,]+)/i,
  /sample\s+name:\s*([^\n\r,]+)/i,
  /product\s+name:\s*([^\n\r,]+)/i,
];

const THCA_PATTERNS = [
  /thca:\s*([0-9.]+)/i,
  /thc-a:\s*([0-9.]+)/i,
  /thca\s*%?\s*[:=]\s*([0-9.]+)/i,
  /Δ9-thca:\s*([0-9.]+)/i,
  /total\s+thca:\s*([0-9.]+)/i,
];

const D9THC_PATTERNS = [
  /delta-9-thc:\s*([0-9.]+)/i,
  /d9-thc:\s*([0-9.]+)/i,
  /Δ9-thc:\s*([0-9.]+)/i,
  /delta-9\s+thc:\s*([0-9.]+)/i,
  /d9thc:\s*([0-9.]+)/i,
];

const BATCH_ID_PATTERNS = [
  /batch\s*(?:id|#|number|no\.?):\s*([^\n\r,]+)/i,
  /sample\s*(?:id|#|number):\s*([^\n\r,]+)/i,
  /lot\s*(?:id|#|number):\s*([^\n\r,]+)/i,
  /certificate\s*(?:id|#|number):\s*([^\n\r,]+)/i,
];

/** Known strain names for keyword matching */
const KNOWN_STRAINS: Record<string, string> = {
  lifter: "Lifter CBD",
  cherry: "Cherry Wine",
  hawaiian: "Hawaiian Haze",
  dream: "Carolina Dream",
  sour: "Sour Space Candy",
  suver: "Suver Haze",
  elektra: "Elektra",
  special: "Special Sauce",
};

// ─── Parser Functions ─────────────────────────────────────────────────────────

/**
 * Extract strain name from COA text.
 */
export function extractStrain(text: string): { value: string; extracted: boolean } {
  // Try regex patterns first
  for (const pattern of STRAIN_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { value: match[1].trim(), extracted: true };
    }
  }

  // Try known strain keywords
  const lower = text.toLowerCase();
  for (const [keyword, strainName] of Object.entries(KNOWN_STRAINS)) {
    if (lower.includes(keyword)) {
      return { value: strainName, extracted: true };
    }
  }

  return { value: "Unknown Strain", extracted: false };
}

/**
 * Extract THCa percentage from COA text.
 */
export function extractThca(text: string): { value: number; extracted: boolean } {
  for (const pattern of THCA_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const val = parseFloat(match[1]);
      if (!isNaN(val) && val >= 0 && val <= 100) {
        return { value: val, extracted: true };
      }
    }
  }
  return { value: 0, extracted: false };
}

/**
 * Extract Δ9-THC percentage from COA text.
 */
export function extractD9Thc(text: string): { value: number; extracted: boolean } {
  for (const pattern of D9THC_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const val = parseFloat(match[1]);
      if (!isNaN(val) && val >= 0 && val <= 100) {
        return { value: val, extracted: true };
      }
    }
  }
  // Fallback: generic THC pattern (only if no THCa match to avoid confusion)
  const genericMatch = text.match(/thc:\s*([0-9.]+)/i);
  if (genericMatch) {
    const val = parseFloat(genericMatch[1]);
    if (!isNaN(val) && val >= 0 && val <= 100) {
      return { value: val, extracted: true };
    }
  }
  return { value: 0, extracted: false };
}

/**
 * Extract batch/sample ID from COA text.
 */
export function extractBatchId(text: string): { value: string; extracted: boolean } {
  for (const pattern of BATCH_ID_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { value: match[1].trim(), extracted: true };
    }
  }
  return { value: "", extracted: false };
}

/**
 * Parse COA text using regex patterns with confidence scoring.
 * Returns structured result with extraction details.
 */
export function parseCOAWithRegex(coaText: string, generatedBatchId: string): COAParseResult {
  const strain = extractStrain(coaText);
  const thca = extractThca(coaText);
  const d9thc = extractD9Thc(coaText);
  const batchId = extractBatchId(coaText);

  // Calculate compliance using the compliance engine
  const compliance = evaluateCOACompliance({
    thca: thca.value,
    d9thc: d9thc.value,
  });

  // Calculate confidence based on how many fields were actually extracted
  const extractedCount = [strain.extracted, thca.extracted, d9thc.extracted, batchId.extracted]
    .filter(Boolean).length;
  const confidence = extractedCount / 4;

  return {
    batchId: batchId.extracted ? batchId.value : generatedBatchId,
    strain: strain.value,
    thca: thca.value,
    d9thc: d9thc.value,
    totalThc: compliance.totalThc,
    status: compliance.status,
    recommendation: compliance.recommendation,
    confidence,
    extractionDetails: {
      strainExtracted: strain.extracted,
      thcaExtracted: thca.extracted,
      d9thcExtracted: d9thc.extracted,
      batchIdExtracted: batchId.extracted,
    },
  };
}
