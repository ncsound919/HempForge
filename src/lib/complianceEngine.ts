export const DECARB_CONVERSION_FACTOR = 0.877;
export const NC_TOTAL_THC_THRESHOLD = 0.3;
export const NC_AT_RISK_THRESHOLD = 0.25;
export const FDA_SERVING_CAP_MG = 0.4;

export function calculateTotalThc(thca: number, d9thc: number): number {
  if (thca < 0 || d9thc < 0 || isNaN(thca) || isNaN(d9thc)) {
    throw new Error('Invalid values');
  }
  return parseFloat(((thca * 0.877) + d9thc).toFixed(3));
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
  
  const rateConstant = 8.0e-5 * Math.exp(0.058 * (params.temp - 25));
  const finalThca = params.thca * Math.exp(-rateConstant * params.duration);
  const finalD9Thc = params.d9thc + (params.thca - finalThca) * 0.877;
  const totalThcComputed = parseFloat(((finalThca * 0.877) + finalD9Thc).toFixed(3));
  const isCompliant = totalThcComputed <= 0.3;
  
  return {
    rateConstant,
    finalThca,
    finalD9Thc,
    totalThcComputed,
    isCompliant,
    methodology: {
      model: 'Arrhenius first-order decay',
      outputType: 'deterministic_formula',
      conversionFactor: 0.877
    }
  };
}
