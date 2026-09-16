export const DECARB_CONVERSION_FACTOR = 0.877;
export const NC_TOTAL_THC_THRESHOLD = 0.3;
export const NC_AT_RISK_THRESHOLD = 0.25;
export const FDA_SERVING_CAP_MG = 0.4;

// ── Decarboxylation kinetics (calibrated to published data) ──────────────────
// THCA-A -> THC is a pseudo-first-order reaction. The Arrhenius parameters below
// are a least-squares fit of ln k vs 1/T to the measured rate constants in
//   Wang et al. (2016), Cannabis Cannabinoid Res 1(1) — THCA-A in cannabis
//   extracts: k(80 degC)=1.8e-4, k(95 degC)=6.6e-4, k(110 degC)=1.83e-3 s^-1
//   (Perrotin-Brunel et al. 2011 and Moreno et al. 2020 report the same order
//   of reaction; Ea = 84.8-88 kJ/mol across studies)
// The fit reproduces the published rate constants to within ~6%:
//   80 degC 1.85e-4, 95 degC 6.21e-4, 110 degC 1.89e-3 s^-1.
//
// HONEST LIMITS: the literature reports roughly 2x scatter between studies and
// sample types (flower vs extract) and the rate depends on plant mass and
// oxygen. This is a CENTRAL ESTIMATE for THCA-A in extracts over ~80-160 degC,
// not a precision prediction. In particular it was previously an ad-hoc
// expression (8.0e-5 * exp(0.058*(T-25))) that ran 5.6-9.9x too slow and
// implied Ea ~65 kJ/mol; see tests/validation/external-standards.spec.ts.
export const DECARB_R_J_PER_MOL_K = 8.314;
export const DECARB_EA_J_PER_MOL = 87058; // 87.1 kJ/mol
export const DECARB_A_PER_SEC = 1.398e9; // s^-1

/** First-order THCA-A decarboxylation rate constant, per second, at tempC. */
export function decarbRateConstantPerSecond(tempC: number): number {
  const T = tempC + 273.15;
  return DECARB_A_PER_SEC * Math.exp(-DECARB_EA_J_PER_MOL / (DECARB_R_J_PER_MOL_K * T));
}

export function calculateTotalThc(thca: number, d9thc: number): number {
  if (thca < 0 || d9thc < 0 || isNaN(thca) || isNaN(d9thc)) {
    throw new Error('Invalid values');
  }
  // Returned UNROUNDED: the compliance verdict must be computed from the true
  // value. Rounding to 3 dp here let a batch at 0.30002% read as 0.300 and be
  // reported "At Risk" instead of non-compliant. Round only for display.
  return (thca * DECARB_CONVERSION_FACTOR) + d9thc;
}

export function determineComplianceStatus(totalThc: number): 'Compliant' | 'At Risk' | 'Non-Compliant' {
  if (totalThc > 0.3) return 'Non-Compliant';
  if (totalThc >= 0.25) return 'At Risk';
  return 'Compliant';
}

export function calculateCompliance(params: { thca?: number, d9thc?: number, totalThc?: number, productType?: string, servingSizeGrams?: number, cumulativeThcMg?: number }) {
  let calculatedTotal = params.totalThc !== undefined ? params.totalThc : calculateTotalThc(params.thca || 0, params.d9thc || 0);
  let status = determineComplianceStatus(calculatedTotal);
  let alerts: string[] = [];
  
  if (status === 'At Risk') {
    alerts.push('Borderline level detected. Monitor closely.');
  }

  if (params.productType === 'Infused-Edible' && params.cumulativeThcMg && params.cumulativeThcMg > 0.4) {
    status = 'Non-Compliant';
    alerts.push('serving limit exceeded');
  }
  
  return {
    status,
    calculatedTotal,
    alerts,
    processingIntegrity: {
      formula: 'Total THC = (THCa * 0.877) + D9THC',
      governingAuthority: 'NC Dept of Agriculture',
      computedAt: new Date().toISOString(),
      thresholds: {
        nonCompliant: '> 0.3',
        atRisk: '>= 0.25'
      }
    }
  };
}

export function evaluateCOACompliance(params: { thca: number, d9thc: number }) {
  const totalThc = calculateTotalThc(params.thca, params.d9thc);
  const status = determineComplianceStatus(totalThc);
  let recommendation = '';
  
  if (status === 'Compliant') recommendation = 'Within compliance window';
  else if (status === 'At Risk') recommendation = 'Monitor closely';
  else recommendation = 'Divert or destroy';
  
  return { status, totalThc, recommendation };
}

export function calculateDecarbKinetics(params: { thca: number, d9thc: number, temp: number, duration: number }) {
  if (params.thca < 0) throw new Error('Invalid THCa');

  // `duration` is in MINUTES (callers pass minutes; see agentEngine.ts
  // `durationMin` and gemini.ts "for N minutes"), so convert the per-second
  // Arrhenius constant.
  const rateConstant = decarbRateConstantPerSecond(params.temp) * 60;
  const finalThca = params.thca * Math.exp(-rateConstant * params.duration);
  const finalD9Thc = params.d9thc + (params.thca - finalThca) * DECARB_CONVERSION_FACTOR;
  const totalThcComputed = (finalThca * DECARB_CONVERSION_FACTOR) + finalD9Thc;
  const isCompliant = totalThcComputed <= NC_TOTAL_THC_THRESHOLD;

  return {
    rateConstant,
    finalThca,
    finalD9Thc,
    totalThcComputed,
    isCompliant,
    methodology: {
      model: 'Arrhenius first-order decay (calibrated to Wang et al. 2016)',
      outputType: 'deterministic_formula',
      conversionFactor: DECARB_CONVERSION_FACTOR,
      activationEnergyJPerMol: DECARB_EA_J_PER_MOL,
      preExponentialPerSec: DECARB_A_PER_SEC,
      durationUnit: 'minutes',
      uncertainty: '~2x between published studies; central estimate for THCA-A in extracts, ~80-160 degC',
    }
  };
}

export interface BatchRiskScore {
  score: number;        // 0-100 risk score
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];    // contributing factors
}

export function scoreBatchRisk(batch: { thca?: number; d9thc?: number; totalThc?: number; productType?: string; status?: string }): BatchRiskScore {
  const compliance = calculateCompliance({
    thca: batch.thca,
    d9thc: batch.d9thc,
    totalThc: batch.totalThc,
    productType: batch.productType,
  });

  const factors: string[] = [];
  let score = 0;

  // Base score from total THC
  if (compliance.calculatedTotal > 0.3) {
    score += 50;
    factors.push('Total THC exceeds 0.3% limit');
  } else if (compliance.calculatedTotal >= 0.25) {
    score += 25;
    factors.push('Total THC in at-risk range (0.25-0.3%)');
  }

  // Product type factor
  if (batch.productType === 'Infused-Edible') {
    score += 10;
    factors.push('Infused edible product type');
  }

  // Existing status factor
  if (batch.status === 'Non-Compliant') {
    score += 30;
    factors.push('Previously flagged non-compliant');
  } else if (batch.status === 'At Risk') {
    score += 15;
    factors.push('Previously flagged at-risk');
  }

  // Alerts factor
  score += compliance.alerts.length * 5;

  // Cap score at 100
  score = Math.min(100, score);

  let level: BatchRiskScore['level'];
  if (score >= 70) level = 'critical';
  else if (score >= 40) level = 'high';
  else if (score >= 20) level = 'medium';
  else level = 'low';

  return { score, level, factors };
}
