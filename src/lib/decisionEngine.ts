/**
 * decisionEngine.ts
 * Pure rule-based decision layer. Answers all operational yes/no and
 * categorical questions without LLM. Eliminates Gemini calls from:
 *   - POST /api/compliance/calculate
 *   - POST /api/workflows (stage transitions)
 *   - POST /api/coas (compliance summary)
 *   - GET  /api/dashboard/summary (alert thresholds)
 *
 * Tier: 1 (deterministic) — no API keys, no network calls.
 */

import { calculateCompliance, evaluateCOACompliance } from './complianceEngine';
import { verifyAuditChain } from './auditEngine';
import { hasPermission, requirePermission } from './permissionsEngine';
import { classifyOutput } from './provenanceEngine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplianceStatus = 'compliant' | 'non_compliant' | 'borderline' | 'unknown';
export type DispositionRecommendation = 'release' | 'hold' | 'reject' | 'retest';
export type AlertSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * complianceEngine.calculateCompliance() returns status as
 * 'Compliant' | 'At Risk' | 'Non-Compliant', while this module's
 * ComplianceStatus uses a different literal set. Map between them so
 * comparisons against ComplianceStatus values actually match.
 */
function toDecisionComplianceStatus(status: string): ComplianceStatus {
  switch (status) {
    case 'Compliant': return 'compliant';
    case 'At Risk': return 'borderline';
    case 'Non-Compliant': return 'non_compliant';
    default: return 'unknown';
  }
}

export interface BatchReleaseParams {
  thca: number;          // percentage
  d9thc: number;         // percentage
  auditLogs: Array<{ id: string; hash: string; previousHash: string; timestamp: number }>;
  metrcStatus: string;   // e.g. 'Submitted', 'Approved', 'Rejected'
  requiredApprovals: string[];
  completedApprovals: string[];
  productType: string;
}

export interface BatchReleaseDecision {
  ready: boolean;
  reasons: string[];
  complianceStatus: ComplianceStatus;
  auditIntact: boolean;
  metrcApproved: boolean;
  approvalsComplete: boolean;
  outputClassification: string;
}

export interface COAAlertParams {
  thca: number;
  d9thc: number;
  previousD9thc?: number;  // prior test result for trend deviation check
  trendDeviation?: number; // from trendEngine — z-score or % shift
  testLabCertified: boolean;
  testDate: Date;
}

export interface COAAlertDecision {
  shouldAlert: boolean;
  severity: AlertSeverity;
  reasons: string[];
  outputClassification: string;
}

export interface DispositionParams {
  complianceStatus: ComplianceStatus;
  productType: string;
  auditIntact: boolean;
  metrcStatus: string;
  failureCategory?: 'thc_limit' | 'missing_data' | 'audit_break' | 'lab_error';
}

export interface DispositionDecision {
  recommendation: DispositionRecommendation;
  rationale: string;
  outputClassification: string;
}

export interface WorkflowTransitionParams {
  tenantId: string;
  userId: string;
  userRole: string;
  fromStage: string;
  toStage: string;
  complianceStatus?: ComplianceStatus;
  requiredPermission: string;
}

export interface WorkflowTransitionDecision {
  permitted: boolean;
  reasons: string[];
  outputClassification: string;
}

// ---------------------------------------------------------------------------
// 1. Batch Release Decision
// ---------------------------------------------------------------------------

/**
 * Determines if a batch is ready for release.
 * Checks: compliance thresholds + audit chain integrity + Metrc status + approvals.
 * No LLM involved.
 */
export function decideBatchRelease(params: BatchReleaseParams): BatchReleaseDecision {
  const reasons: string[] = [];

  // Compliance
  const compliance = calculateCompliance({ thca: params.thca, d9thc: params.d9thc });
  const complianceStatus = compliance.status as ComplianceStatus;
  if (complianceStatus === 'non_compliant') {
    reasons.push(`Non-compliant: D9-THC ${params.d9thc.toFixed(3)}% exceeds 0.3% limit`);
  }

  // Audit chain
  const auditResult = verifyAuditChain(params.auditLogs);
  const auditIntact = auditResult.valid;
  if (!auditIntact) {
    reasons.push(`Audit chain broken at entry: ${auditResult.brokenAt ?? 'unknown'}`);
  }

  // Metrc status
  const METRC_APPROVED_STATES = ['Submitted', 'Approved', 'Active'];
  const metrcApproved = METRC_APPROVED_STATES.includes(params.metrcStatus);
  if (!metrcApproved) {
    reasons.push(`Metrc status "${params.metrcStatus}" is not an approved release state`);
  }

  // Required approvals
  const missing = params.requiredApprovals.filter(
    (a) => !params.completedApprovals.includes(a)
  );
  const approvalsComplete = missing.length === 0;
  if (!approvalsComplete) {
    reasons.push(`Missing approvals: ${missing.join(', ')}`);
  }

  const ready =
    complianceStatus !== 'non_compliant' &&
    auditIntact &&
    metrcApproved &&
    approvalsComplete;

  return {
    ready,
    reasons,
    complianceStatus,
    auditIntact,
    metrcApproved,
    approvalsComplete,
    outputClassification: classifyOutput('deterministic', 'decisionEngine.decideBatchRelease'),
  };
}

// ---------------------------------------------------------------------------
// 2. COA Alert Decision
// ---------------------------------------------------------------------------

const THC_HARD_LIMIT = 0.3;
const THC_BORDERLINE_BUFFER = 0.05; // within 0.05% of limit → medium alert
const TREND_DEVIATION_HIGH_THRESHOLD = 2.5; // z-score
const TREND_DEVIATION_MEDIUM_THRESHOLD = 1.5;

/**
 * Determines whether a COA result should trigger an alert and at what severity.
 * Uses threshold comparison + trend deviation — no LLM.
 */
export function decideCOAAlert(params: COAAlertParams): COAAlertDecision {
  const reasons: string[] = [];
  let severity: AlertSeverity = 'none';

  // Hard limit breach
  if (params.d9thc > THC_HARD_LIMIT) {
    severity = 'critical';
    reasons.push(`D9-THC ${params.d9thc.toFixed(3)}% exceeds federal 0.3% limit`);
  } else if (params.d9thc > THC_HARD_LIMIT - THC_BORDERLINE_BUFFER) {
    severity = severityMax(severity, 'high');
    reasons.push(`D9-THC ${params.d9thc.toFixed(3)}% is within borderline buffer of 0.3% limit`);
  }

  // Trend deviation
  if (params.trendDeviation !== undefined) {
    if (params.trendDeviation >= TREND_DEVIATION_HIGH_THRESHOLD) {
      severity = severityMax(severity, 'high');
      reasons.push(`Trend deviation z-score ${params.trendDeviation.toFixed(2)} exceeds high threshold`);
    } else if (params.trendDeviation >= TREND_DEVIATION_MEDIUM_THRESHOLD) {
      severity = severityMax(severity, 'medium');
      reasons.push(`Trend deviation z-score ${params.trendDeviation.toFixed(2)} exceeds medium threshold`);
    }
  }

  // Uncertified lab
  if (!params.testLabCertified) {
    severity = severityMax(severity, 'medium');
    reasons.push('Test lab is not certified — result reliability unverified');
  }

  // Stale test date (>90 days)
  const ageDays = (Date.now() - params.testDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > 90) {
    severity = severityMax(severity, 'low');
    reasons.push(`COA is ${Math.floor(ageDays)} days old — retest recommended`);
  }

  return {
    shouldAlert: severity !== 'none',
    severity,
    reasons,
    outputClassification: classifyOutput('deterministic', 'decisionEngine.decideCOAAlert'),
  };
}

// ---------------------------------------------------------------------------
// 3. Disposition Recommendation
// ---------------------------------------------------------------------------

/**
 * Rule matrix: complianceStatus × failureCategory × productType → disposition.
 * Covers 100% of common cases without LLM.
 */
export function recommendDisposition(params: DispositionParams): DispositionDecision {
  const { complianceStatus, auditIntact, metrcStatus, failureCategory, productType } = params;

  let recommendation: DispositionRecommendation;
  let rationale: string;

  if (!auditIntact) {
    recommendation = 'hold';
    rationale = 'Audit chain integrity failure — batch held pending investigation';
  } else if (complianceStatus === 'non_compliant') {
    if (failureCategory === 'lab_error') {
      recommendation = 'retest';
      rationale = 'Non-compliant result attributed to potential lab error — retest required';
    } else if (failureCategory === 'missing_data') {
      recommendation = 'hold';
      rationale = 'Non-compliant due to missing data — held pending data completion';
    } else {
      recommendation = 'reject';
      rationale = `Product type "${productType}" is non-compliant with D9-THC limits and does not qualify for retest`;
    }
  } else if (complianceStatus === 'borderline') {
    recommendation = 'retest';
    rationale = 'Borderline D9-THC result — confirmatory retest required before release';
  } else if (metrcStatus === 'Rejected') {
    recommendation = 'hold';
    rationale = 'Metrc package status is Rejected — held pending Metrc resolution';
  } else if (complianceStatus === 'compliant') {
    recommendation = 'release';
    rationale = 'All compliance, audit, and Metrc checks passed — batch cleared for release';
  } else {
    recommendation = 'hold';
    rationale = 'Compliance status unknown — held pending complete test data';
  }

  return {
    recommendation,
    rationale,
    outputClassification: classifyOutput('deterministic', 'decisionEngine.recommendDisposition'),
  };
}

// ---------------------------------------------------------------------------
// 4. Workflow Transition Validation
// ---------------------------------------------------------------------------

/** Stage transition rules beyond permissions — business logic constraints. */
const STAGE_TRANSITION_RULES: Record<string, {
  allowedNextStages: string[];
  requiresComplianceStatus?: ComplianceStatus[];
}> = {
  draft:        { allowedNextStages: ['pending_review'] },
  pending_review: { allowedNextStages: ['approved', 'revision_required', 'rejected'] },
  approved:     { allowedNextStages: ['released', 'quarantine'], requiresComplianceStatus: ['compliant', 'borderline'] },
  revision_required: { allowedNextStages: ['pending_review', 'rejected'] },
  released:     { allowedNextStages: ['archived'] },
  rejected:     { allowedNextStages: ['archived'] },
  quarantine:   { allowedNextStages: ['pending_review', 'rejected'] },
  archived:     { allowedNextStages: [] },
};

/**
 * Validates a workflow stage transition using permissionsEngine + business rules.
 * Replaces every route that calls Gemini to validate a stage change.
 */
export function validateWorkflowTransition(
  params: WorkflowTransitionParams
): WorkflowTransitionDecision {
  const reasons: string[] = [];

  // Permission check
  const permissionGranted = hasPermission(params.userRole, params.requiredPermission);
  if (!permissionGranted) {
    reasons.push(
      `Role "${params.userRole}" does not have permission "${params.requiredPermission}"`
    );
  }

  // Stage transition validity
  const rule = STAGE_TRANSITION_RULES[params.fromStage];
  if (!rule) {
    reasons.push(`Unknown source stage: "${params.fromStage}"`);
  } else if (!rule.allowedNextStages.includes(params.toStage)) {
    reasons.push(
      `Transition from "${params.fromStage}" to "${params.toStage}" is not permitted. ` +
      `Allowed: [${rule.allowedNextStages.join(', ')}]`
    );
  } else if (
    rule.requiresComplianceStatus &&
    params.complianceStatus &&
    !rule.requiresComplianceStatus.includes(params.complianceStatus)
  ) {
    reasons.push(
      `Stage "${params.toStage}" requires compliance status in ` +
      `[${rule.requiresComplianceStatus.join(', ')}], got "${params.complianceStatus}"`
    );
  }

  return {
    permitted: reasons.length === 0,
    reasons,
    outputClassification: classifyOutput('deterministic', 'decisionEngine.validateWorkflowTransition'),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: AlertSeverity[] = ['none', 'low', 'medium', 'high', 'critical'];

function severityMax(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}
