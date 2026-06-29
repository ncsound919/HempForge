/**
 * reportTemplates.ts
 * Deterministic typed template functions for all 5 HempForge report types.
 * Each template takes structured data and returns a complete document object.
 * LLM is called ONLY once per report, at the end, for the optional executive
 * summary paragraph. All tables, metrics, and structured sections are assembled
 * here without any LLM dependency.
 *
 * Tier: 1/2 (deterministic) for body; Tier 3/4 (LLM) only for executiveSummary.
 */

import { calculateCompliance, evaluateCOACompliance } from './complianceEngine';
import { classifyOutput } from './provenanceEngine';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ReportMetadata {
  reportId: string;
  tenantId: string;
  generatedAt: string;     // ISO timestamp
  generatedBy: string;     // userId
  reportType: ReportType;
  outputClassification: string;
}

export type ReportType =
  | 'coa_summary'
  | 'compliance_audit'
  | 'metrc_reconciliation'
  | 'trend_analysis'
  | 'exception';

export interface ReportDocument {
  metadata: ReportMetadata;
  sections: ReportSection[];
  executiveSummary?: string;  // populated by LLM after assembly
}

export interface ReportSection {
  title: string;
  type: 'table' | 'metric_grid' | 'timeline' | 'list' | 'narrative_placeholder';
  data: unknown;
}

// ---------------------------------------------------------------------------
// 1. COA Summary Report
// ---------------------------------------------------------------------------

export interface COASummaryParams {
  tenantId: string;
  generatedBy: string;
  coa: {
    batchId: string;
    productName: string;
    productType: string;
    labName: string;
    testDate: string;
    thca: number;
    d9thc: number;
    cbd?: number;
    moisture?: number;
    pesticides?: 'pass' | 'fail' | 'not_tested';
    heavyMetals?: 'pass' | 'fail' | 'not_tested';
    microbials?: 'pass' | 'fail' | 'not_tested';
  };
  auditChainValid: boolean;
  metrcStatus: string;
}

export function buildCOASummaryReport(params: COASummaryParams): ReportDocument {
  const { coa } = params;
  const compliance = calculateCompliance(coa.thca, coa.d9thc);
  const coaEval = evaluateCOACompliance(coa);

  const sections: ReportSection[] = [
    {
      title: 'Batch Identity',
      type: 'metric_grid',
      data: {
        'Batch ID': coa.batchId,
        'Product Name': coa.productName,
        'Product Type': coa.productType,
        'Lab Name': coa.labName,
        'Test Date': coa.testDate,
        'Metrc Status': params.metrcStatus,
      },
    },
    {
      title: 'Cannabinoid Profile',
      type: 'table',
      data: [
        { analyte: 'THCA', result: `${coa.thca.toFixed(3)}%`, limit: '—', status: 'informational' },
        { analyte: 'D9-THC', result: `${coa.d9thc.toFixed(3)}%`, limit: '≤ 0.3%', status: compliance.status },
        { analyte: 'Total THC (post-decarb)', result: `${compliance.totalThc.toFixed(3)}%`, limit: '≤ 0.3%', status: compliance.status },
        ...(coa.cbd !== undefined ? [{ analyte: 'CBD', result: `${coa.cbd.toFixed(3)}%`, limit: '—', status: 'informational' }] : []),
        ...(coa.moisture !== undefined ? [{ analyte: 'Moisture', result: `${coa.moisture.toFixed(2)}%`, limit: '≤ 15%', status: coa.moisture <= 15 ? 'pass' : 'fail' }] : []),
      ],
    },
    {
      title: 'Safety Panel',
      type: 'table',
      data: [
        { panel: 'Pesticides', status: coa.pesticides ?? 'not_tested' },
        { panel: 'Heavy Metals', status: coa.heavyMetals ?? 'not_tested' },
        { panel: 'Microbials', status: coa.microbials ?? 'not_tested' },
      ],
    },
    {
      title: 'Compliance Determination',
      type: 'metric_grid',
      data: {
        'Overall Status': coaEval.overallStatus,
        'Audit Chain': params.auditChainValid ? 'Intact' : 'BROKEN',
        'Decarboxylation Correction Applied': 'Yes (THCA × 0.877 + D9-THC)',
      },
    },
    {
      title: 'Executive Summary',
      type: 'narrative_placeholder',
      data: { prompt: 'Generate a 2–3 sentence executive summary of this COA result for a hemp compliance officer.' },
    },
  ];

  return {
    metadata: buildMetadata(params.tenantId, params.generatedBy, 'coa_summary'),
    sections,
  };
}

// ---------------------------------------------------------------------------
// 2. Compliance Audit Report
// ---------------------------------------------------------------------------

export interface ComplianceAuditParams {
  tenantId: string;
  generatedBy: string;
  periodStart: string;
  periodEnd: string;
  batches: Array<{
    batchId: string;
    thca: number;
    d9thc: number;
    status: string;
    testDate: string;
  }>;
  auditChainValid: boolean;
  auditBreaks: Array<{ entryId: string; timestamp: number }>;
}

export function buildComplianceAuditReport(params: ComplianceAuditParams): ReportDocument {
  const batchRows = params.batches.map((b) => {
    const c = calculateCompliance(b.thca, b.d9thc);
    return {
      batchId: b.batchId,
      testDate: b.testDate,
      d9thc: `${b.d9thc.toFixed(3)}%`,
      totalThc: `${c.totalThc.toFixed(3)}%`,
      status: c.status,
      metrcStatus: b.status,
    };
  });

  const compliantCount = batchRows.filter((r) => r.status === 'compliant').length;
  const nonCompliantCount = batchRows.filter((r) => r.status === 'non_compliant').length;
  const borderlineCount = batchRows.filter((r) => r.status === 'borderline').length;

  const sections: ReportSection[] = [
    {
      title: 'Audit Period',
      type: 'metric_grid',
      data: {
        'Period Start': params.periodStart,
        'Period End': params.periodEnd,
        'Total Batches': params.batches.length,
        'Compliant': compliantCount,
        'Non-Compliant': nonCompliantCount,
        'Borderline': borderlineCount,
        'Compliance Rate': `${((compliantCount / params.batches.length) * 100).toFixed(1)}%`,
      },
    },
    {
      title: 'Batch Compliance Detail',
      type: 'table',
      data: batchRows,
    },
    {
      title: 'Audit Chain Status',
      type: 'metric_grid',
      data: {
        'Chain Integrity': params.auditChainValid ? 'INTACT' : 'BROKEN',
        'Detected Breaks': params.auditBreaks.length,
        ...(params.auditBreaks.length > 0 && {
          'Break Entry IDs': params.auditBreaks.map((b) => b.entryId).join(', '),
        }),
      },
    },
    {
      title: 'Executive Summary',
      type: 'narrative_placeholder',
      data: { prompt: 'Summarize this compliance audit period for a regulatory reviewer in 3 sentences.' },
    },
  ];

  return {
    metadata: buildMetadata(params.tenantId, params.generatedBy, 'compliance_audit'),
    sections,
  };
}

// ---------------------------------------------------------------------------
// 3. Metrc Reconciliation Report
// ---------------------------------------------------------------------------

export interface MetrcReconciliationParams {
  tenantId: string;
  generatedBy: string;
  packages: Array<{
    metrcTag: string;
    productName: string;
    quantity: number;
    uom: string;
    metrcStatus: string;
    localStatus: string;
    discrepancy: boolean;
    discrepancyDetail?: string;
  }>;
}

export function buildMetrcReconciliationReport(params: MetrcReconciliationParams): ReportDocument {
  const discrepancies = params.packages.filter((p) => p.discrepancy);

  const sections: ReportSection[] = [
    {
      title: 'Reconciliation Summary',
      type: 'metric_grid',
      data: {
        'Total Packages': params.packages.length,
        'Reconciled': params.packages.length - discrepancies.length,
        'Discrepancies Found': discrepancies.length,
        'Discrepancy Rate': `${((discrepancies.length / params.packages.length) * 100).toFixed(1)}%`,
      },
    },
    {
      title: 'All Packages',
      type: 'table',
      data: params.packages.map((p) => ({
        'Metrc Tag': p.metrcTag,
        'Product': p.productName,
        'Quantity': `${p.quantity} ${p.uom}`,
        'Metrc Status': p.metrcStatus,
        'Local Status': p.localStatus,
        'Discrepancy': p.discrepancy ? `⚠ ${p.discrepancyDetail ?? 'Status mismatch'}` : '✓',
      })),
    },
    ...(discrepancies.length > 0
      ? [{
          title: 'Discrepancy Detail',
          type: 'table' as const,
          data: discrepancies.map((p) => ({
            'Metrc Tag': p.metrcTag,
            'Product': p.productName,
            'Issue': p.discrepancyDetail ?? 'Metrc/local status mismatch',
            'Metrc Status': p.metrcStatus,
            'Local Status': p.localStatus,
          })),
        }]
      : []),
    {
      title: 'Executive Summary',
      type: 'narrative_placeholder',
      data: { prompt: 'Summarize this Metrc reconciliation for a compliance manager.' },
    },
  ];

  return {
    metadata: buildMetadata(params.tenantId, params.generatedBy, 'metrc_reconciliation'),
    sections,
  };
}

// ---------------------------------------------------------------------------
// 4. Trend Analysis Report
// ---------------------------------------------------------------------------

export interface TrendAnalysisParams {
  tenantId: string;
  generatedBy: string;
  trendSnapshot: {
    trend: 'increasing' | 'decreasing' | 'stable';
    slope?: number;
    pValue?: number;
    anomalies: Array<{ batchId: string; value: number; zScore: number; timestamp: string }>;
    burstEvents: Array<{ start: string; end: string; count: number }>;
    riskScore: number;
    analysisWindow: string;
  };
  dataPoints: Array<{ date: string; d9thc: number; batchId: string }>;
}

export function buildTrendAnalysisReport(params: TrendAnalysisParams): ReportDocument {
  const { trendSnapshot } = params;

  const sections: ReportSection[] = [
    {
      title: 'Trend Overview',
      type: 'metric_grid',
      data: {
        'Trend Direction': trendSnapshot.trend,
        'Analysis Window': trendSnapshot.analysisWindow,
        'Mann-Kendall Slope': trendSnapshot.slope?.toFixed(6) ?? 'N/A',
        'p-value': trendSnapshot.pValue?.toFixed(4) ?? 'N/A',
        'Regulatory Risk Score': `${trendSnapshot.riskScore.toFixed(2)} / 10`,
        'Anomalies Detected': trendSnapshot.anomalies.length,
        'Burst Events': trendSnapshot.burstEvents.length,
      },
    },
    {
      title: 'D9-THC Time Series',
      type: 'timeline',
      data: params.dataPoints,
    },
    ...(trendSnapshot.anomalies.length > 0
      ? [{
          title: 'Anomaly Detail',
          type: 'table' as const,
          data: trendSnapshot.anomalies.map((a) => ({
            'Batch ID': a.batchId,
            'D9-THC': `${a.value.toFixed(3)}%`,
            'Z-Score': a.zScore.toFixed(2),
            'Date': a.timestamp,
          })),
        }]
      : []),
    ...(trendSnapshot.burstEvents.length > 0
      ? [{
          title: 'Burst Events',
          type: 'table' as const,
          data: trendSnapshot.burstEvents,
        }]
      : []),
    {
      title: 'Executive Summary',
      type: 'narrative_placeholder',
      data: { prompt: 'Interpret this D9-THC trend analysis for a hemp compliance officer in 3 sentences.' },
    },
  ];

  return {
    metadata: buildMetadata(params.tenantId, params.generatedBy, 'trend_analysis'),
    sections,
  };
}

// ---------------------------------------------------------------------------
// 5. Exception Report
// ---------------------------------------------------------------------------

export interface ExceptionReportParams {
  tenantId: string;
  generatedBy: string;
  periodStart: string;
  periodEnd: string;
  exceptions: Array<{
    exceptionId: string;
    type: 'compliance_failure' | 'audit_break' | 'metrc_discrepancy' | 'threshold_breach' | 'missing_approval';
    severity: 'low' | 'medium' | 'high' | 'critical';
    batchId?: string;
    description: string;
    detectedAt: string;
    resolvedAt?: string;
    status: 'open' | 'resolved' | 'escalated';
  }>;
}

export function buildExceptionReport(params: ExceptionReportParams): ReportDocument {
  const open = params.exceptions.filter((e) => e.status === 'open');
  const resolved = params.exceptions.filter((e) => e.status === 'resolved');
  const escalated = params.exceptions.filter((e) => e.status === 'escalated');
  const critical = params.exceptions.filter((e) => e.severity === 'critical');

  const sections: ReportSection[] = [
    {
      title: 'Exception Summary',
      type: 'metric_grid',
      data: {
        'Period': `${params.periodStart} – ${params.periodEnd}`,
        'Total Exceptions': params.exceptions.length,
        'Open': open.length,
        'Resolved': resolved.length,
        'Escalated': escalated.length,
        'Critical': critical.length,
      },
    },
    {
      title: 'Exception Register',
      type: 'table',
      data: params.exceptions.map((e) => ({
        'ID': e.exceptionId,
        'Type': e.type,
        'Severity': e.severity.toUpperCase(),
        'Batch': e.batchId ?? '—',
        'Description': e.description,
        'Detected': e.detectedAt,
        'Resolved': e.resolvedAt ?? '—',
        'Status': e.status,
      })),
    },
    {
      title: 'Executive Summary',
      type: 'narrative_placeholder',
      data: { prompt: 'Summarize the open exceptions and their risk implications in 3 sentences.' },
    },
  ];

  return {
    metadata: buildMetadata(params.tenantId, params.generatedBy, 'exception'),
    sections,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMetadata(
  tenantId: string,
  generatedBy: string,
  reportType: ReportType
): ReportMetadata {
  return {
    reportId: `${reportType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    generatedAt: new Date().toISOString(),
    generatedBy,
    reportType,
    outputClassification: classifyOutput('deterministic', `reportTemplates.build_${reportType}`),
  };
}
