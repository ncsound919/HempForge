import { calculateCompliance, evaluateCOACompliance } from './complianceEngine';
import { type ComplianceStatus } from './decisionEngine'; // Assuming ComplianceStatus is exported from decisionEngine
import { createFormulaProvenance } from './provenanceEngine'; // Assuming createFormulaProvenance exists

// Define the COA structure expected by the helper
export interface COAInput {
  batchId?: string;
  productName?: string;
  productType?: string;
  labName?: string;
  testDate?: string;
  thca: number;
  d9thc: number;
  cbd?: number;
  moisture?: number;
  pesticides?: 'pass' | 'fail' | 'not_tested';
  heavyMetals?: 'pass' | 'fail' | 'not_tested';
  microbials?: 'pass' | 'fail' | 'not_tested';
  confidence?: number;
}

// Define the output structure for the normalized COA
interface NormalizedCoa {
  batchId: string;
  strain: string;
  thca: number;
  d9thc: number;
  totalThc: number;
  status: ComplianceStatus;
  recommendation: string;
  confidence: number;
  provenance: ReturnType<typeof createFormulaProvenance>;
}

/**
 * Helper function to normalize COA data for decisioning and reporting.
 * Recalculates compliance metrics and determines recommendation.
 */
export function normalizeCoaForDecisioning(coa: COAInput): NormalizedCoa {
  const complianceResult = calculateCompliance({ thca: coa.thca, d9thc: coa.d9thc });
  const evaluationResult = evaluateCOACompliance(coa);

  // Map compliance status from complianceEngine to decisionEngine's format
  let decisionComplianceStatus: ComplianceStatus;
  switch (complianceResult.status) {
    case 'Compliant':
      decisionComplianceStatus = 'compliant';
      break;
    case 'At Risk':
      decisionComplianceStatus = 'borderline';
      break;
    case 'Non-Compliant':
      decisionComplianceStatus = 'non_compliant';
      break;
    default:
      decisionComplianceStatus = 'unknown';
  }

  // Determine recommendation based on evaluation result
  let recommendation = evaluationResult.recommendation;
  if (!recommendation) {
    // Fallback recommendation logic if evaluationResult.recommendation is missing
    if (decisionComplianceStatus === 'non_compliant') {
      recommendation = 'reject';
    } else if (decisionComplianceStatus === 'borderline') {
      recommendation = 'retest';
    } else {
      recommendation = 'release';
    }
  }

  // Use a default confidence if not provided by regex parsing
  const confidence = typeof coa.confidence === 'number' ? coa.confidence : 0.8; // Default confidence

  const provenance = createFormulaProvenance({
    formula: 'Total THC = (THCa * 0.877) + D9THC',
    governingAuthority: 'NC Dept of Agriculture',
    computedAt: new Date().toISOString(),
    thresholds: {
      nonCompliant: '> 0.3',
      atRisk: '>= 0.25',
    }
  }, {
    formula: 'Total THC = (THCa * 0.877) + D9THC',
    userId: 'system-normalize',
    userRole: 'System Worker',
    tenantId: 'system-tenant',
  });

  return {
    batchId: coa.batchId || `B-${Date.now()}`,
    strain: coa.productName || 'Unknown Strain', // Assuming productName is a good proxy for strain here
    thca: coa.thca,
    d9thc: coa.d9thc,
    totalThc: complianceResult.calculatedTotal,
    status: decisionComplianceStatus,
    recommendation: recommendation,
    confidence: confidence,
    provenance: provenance as ReturnType<typeof createFormulaProvenance>, // Type assertion for clarity
  };
}
