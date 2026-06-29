/**
 * HempForge Compliance Engine
 * 
 * Deterministic, independently testable module for all compliance calculations.
 * Implements NC Department of Agriculture / Federal FDA threshold logic.
 * 
 * Processing Integrity: Every computation is complete, valid, accurate, timely, and authorized.
 * Scientific Validity: Separates observed data from deterministic formula outputs.
 */

// ─── Constants ────────────────────────────────────────────────────────────────
/** THCa to Δ9-THC conversion factor per USP decarboxylation stoichiometry */
export const DECARB_CONVERSION_FACTOR = 0.877;

/** NC legal dry-weight Total THC threshold (%) */
export const NC_TOTAL_THC_THRESHOLD = 0.3;

/** NC "At Risk" warning threshold (%) */
export const NC_AT_RISK_THRESHOLD = 0.25;

/** Federal FDA cap for infused edibles/beverages (mg per serving) */
export const FDA_SERVING_CAP_MG = 0.4;

/** Arrhenius base rate constant for THCa thermal degradation */
export const ARRHENIUS_BASE_RATE = 0.00008;

/** Arrhenius temperature coefficient */
export const ARRHENIUS_TEMP_COEFF = 0.058;

/** Reference temperature for Arrhenius model (°C) */
export const ARRHENIUS_REF_TEMP = 25;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComplianceStatus = "Compliant" | "At Risk" | "Non-Compliant";

export interface ComplianceInput {
  thca?: number;
  d9thc?: number;
  totalThc?: number;
  productType?: "Flower" | "Concentrate" | "Infused-Edible" | "Topical";
  servingSizeGrams?: number;
  cumulativeThcMg?: number;
}

export interface ComplianceResult {
  calculatedTotal: number;
  status: ComplianceStatus;
  alerts: string[];
  /** Processing integrity metadata */
  processingIntegrity: {
    formula: string;
    inputs: Record<string, number | string | undefined>;
    computedAt: string;
    governingAuthority: string;
    thresholds: {
      nonCompliant: string;
      atRisk: string;
      servingCap: string;
    };
  };
}

export interface DecarbKineticsInput {
  thca: number;
  d9thc: number;
  temp: number;
  duration: number;
}

export interface DecarbKineticsResult {
  rateConstant: number;
  finalThca: number;
  finalD9Thc: number;
  totalThcComputed: number;
  isCompliant: boolean;
  /** Scientific validity: separates formula outputs from inputs */
  methodology: {
    model: "Arrhenius first-order decay";
    formula: string;
    conversionFactor: number;
    referenceTemp: number;
    outputType: "deterministic_formula";
  };
}

export interface COAComplianceInput {
  thca: number;
  d9thc: number;
}

export interface COAComplianceResult {
  totalThc: number;
  status: ComplianceStatus;
  recommendation: string;
}

// ─── Core Calculations ────────────────────────────────────────────────────────

/**
 * Calculate Total THC using the regulatory formula: (THCa × 0.877) + Δ9-THC
 * This is a deterministic formula output, not an AI inference.
 */
export function calculateTotalThc(thca: number, d9thc: number): number {
  if (typeof thca !== "number" || isNaN(thca) || thca < 0) {
    throw new Error(`Invalid THCa value: ${thca}. Must be a non-negative number.`);
  }
  if (typeof d9thc !== "number" || isNaN(d9thc) || d9thc < 0) {
    throw new Error(`Invalid Δ9-THC value: ${d9thc}. Must be a non-negative number.`);
  }
  return parseFloat(((thca * DECARB_CONVERSION_FACTOR) + d9thc).toFixed(3));
}

/**
 * Determine compliance status from a calculated Total THC value.
 */
export function determineComplianceStatus(totalThc: number): ComplianceStatus {
  if (totalThc > NC_TOTAL_THC_THRESHOLD) return "Non-Compliant";
  if (totalThc >= NC_AT_RISK_THRESHOLD) return "At Risk";
  return "Compliant";
}

/**
 * Full compliance calculation with processing integrity metadata.
 * SOC 2 Processing Integrity: complete, valid, accurate, timely, authorized.
 */
export function calculateCompliance(input: ComplianceInput): ComplianceResult {
  const calculatedTotal = input.thca !== undefined && input.d9thc !== undefined
    ? calculateTotalThc(input.thca, input.d9thc)
    : parseFloat((input.totalThc || 0).toFixed(3));

  let status: ComplianceStatus = determineComplianceStatus(calculatedTotal);
  const alerts: string[] = [];

  if (calculatedTotal > NC_TOTAL_THC_THRESHOLD) {
    alerts.push(`Dry weight Total THC (${calculatedTotal}%) exceeds legal NC standard ≤${NC_TOTAL_THC_THRESHOLD}% (Nov 2026 Caps).`);
  } else if (calculatedTotal >= NC_AT_RISK_THRESHOLD) {
    alerts.push(`Dry weight Total THC (${calculatedTotal}%) approaches maximum legal threshold. Risk of harvest drift or extraction spike.`);
  }

  if (input.productType === "Infused-Edible" && input.cumulativeThcMg && input.cumulativeThcMg > FDA_SERVING_CAP_MG) {
    status = "Non-Compliant";
    alerts.push(`Cumulative THC dosage (${input.cumulativeThcMg}mg/serving) violates strict upcoming Federal cap of ${FDA_SERVING_CAP_MG}mg per serving.`);
  }

  return {
    calculatedTotal,
    status,
    alerts,
    processingIntegrity: {
      formula: `Total THC = (THCa × ${DECARB_CONVERSION_FACTOR}) + Δ9-THC`,
      inputs: {
        thca: input.thca,
        d9thc: input.d9thc,
        totalThc: input.totalThc,
        productType: input.productType,
        cumulativeThcMg: input.cumulativeThcMg,
      },
      computedAt: new Date().toISOString(),
      governingAuthority: "NC Dept of Agriculture / Federal FDA",
      thresholds: {
        nonCompliant: `>${NC_TOTAL_THC_THRESHOLD}%`,
        atRisk: `≥${NC_AT_RISK_THRESHOLD}% and ≤${NC_TOTAL_THC_THRESHOLD}%`,
        servingCap: `>${FDA_SERVING_CAP_MG}mg/serving (Infused-Edible only)`,
      },
    },
  };
}

/**
 * Decarboxylation kinetics using Arrhenius first-order decay model.
 * Scientific validity: clearly labeled as deterministic formula output.
 */
export function calculateDecarbKinetics(input: DecarbKineticsInput): DecarbKineticsResult {
  const { thca, d9thc, temp, duration } = input;

  if (thca < 0 || d9thc < 0 || temp < 0 || duration < 0) {
    throw new Error("All kinetics inputs must be non-negative.");
  }

  const rateConstant = ARRHENIUS_BASE_RATE * Math.exp(ARRHENIUS_TEMP_COEFF * (temp - ARRHENIUS_REF_TEMP));
  const finalThca = thca * Math.exp(-rateConstant * duration);
  const convertedThc = thca - finalThca;
  const finalD9Thc = d9thc + (convertedThc * DECARB_CONVERSION_FACTOR);
  const totalThcComputed = finalD9Thc + (finalThca * DECARB_CONVERSION_FACTOR);
  const isCompliant = totalThcComputed <= NC_TOTAL_THC_THRESHOLD;

  return {
    rateConstant,
    finalThca,
    finalD9Thc,
    totalThcComputed,
    isCompliant,
    methodology: {
      model: "Arrhenius first-order decay",
      formula: `k = ${ARRHENIUS_BASE_RATE} × exp(${ARRHENIUS_TEMP_COEFF} × (T - ${ARRHENIUS_REF_TEMP})); THCa(t) = THCa₀ × exp(-k × t)`,
      conversionFactor: DECARB_CONVERSION_FACTOR,
      referenceTemp: ARRHENIUS_REF_TEMP,
      outputType: "deterministic_formula",
    },
  };
}

/**
 * COA-specific compliance determination with recommendation generation.
 */
export function evaluateCOACompliance(input: COAComplianceInput): COAComplianceResult {
  const totalThc = calculateTotalThc(input.thca, input.d9thc);
  const status = determineComplianceStatus(totalThc);

  let recommendation = "";
  if (status === "Non-Compliant") {
    recommendation = "Divert batch immediately to extraction or remediation. Delayed harvest contributed to pre-decarb THC synthesis spike.";
  } else if (status === "At Risk") {
    recommendation = "Monitor nearby fields closely. Variance levels indicate upcoming batches will test over limits.";
  } else {
    recommendation = "Batch within acceptable compliance window. Standard curing humidity preservation advised.";
  }

  return { totalThc, status, recommendation };
}
