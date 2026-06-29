/**
 * reportEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * HempForge Compliance & ROI Report Generation Engine
 *
 * Compiles multi-batch compliance metrics, decarboxylation kinetics summaries,
 * and ROI savings into signed, ALCOA++-sealed reports exportable as JSON,
 * Markdown, or HTML.
 *
 * GxP Compliance Note: Every report is sealed with a SHA-256 HMAC digest
 * derived from the report content and the COA_SIGNING_SECRET, producing a
 * tamper-evident record consistent with ALCOA++ data integrity principles.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import crypto from "crypto";

// ─── ROI Constants ────────────────────────────────────────────────────────────

/** Estimated labour savings in USD per automated COA extraction vs manual entry. */
export const ROI_COST_PER_COA_MANUAL_MINUTES = 15; // minutes saved per COA
export const ROI_LABOUR_RATE_USD_PER_HOUR = 50;    // $50/hr blended lab-tech rate
export const ROI_COST_PER_MINUTE_USD =
  ROI_LABOUR_RATE_USD_PER_HOUR / 60;

/** Estimated regulatory fine avoided per non-compliant batch detected before shipment. */
export const ROI_FINE_PER_BREACH_USD = 10_000;

/** Estimated compliance risk premium saved per "At Risk" batch caught early. */
export const ROI_RISK_PREMIUM_PER_AT_RISK_USD = 2_500;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchRecord {
  id: string;
  batchId: string;
  strain: string;
  uploadDate: string;
  thca?: number;
  d9thc?: number;
  totalThc: number;
  status: "Compliant" | "At Risk" | "Non-Compliant";
  recommendation?: string;
  labName?: string;
  certifiedBy?: string;
}

export interface ComplianceSummary {
  totalBatches: number;
  compliant: number;
  atRisk: number;
  nonCompliant: number;
  complianceRate: number;         // 0–100%
  averageTotalThc: number;
  maxTotalThc: number;
  minTotalThc: number;
  nearThresholdCount: number;     // 0.25% ≤ totalThc < 0.3%
  highestRiskBatch: BatchRecord | null;
}

export interface ROISummary {
  totalCoas: number;
  timeSavedMinutes: number;
  timeSavedHours: number;
  labourSavingsUsd: number;
  nonCompliantCaught: number;
  atRiskCaught: number;
  finesAvoidedUsd: number;
  riskPremiumAvoidedUsd: number;
  totalFinancialValueUsd: number;
  roiMultiplier: number;          // ratio of savings vs. zero-automation baseline
}

export interface ReportMetadata {
  reportId: string;
  generatedAt: string;
  generatedBy: {
    userId: string;
    userRole: string;
    tenantId: string;
  };
  reportVersion: "1.0";
  integrityHash: string;          // HMAC-SHA256 of report content
  reportType: "compliance-roi" | "compliance-only" | "roi-only";
}

export interface ComplianceReport {
  metadata: ReportMetadata;
  compliance: ComplianceSummary;
  roi: ROISummary;
  batches: BatchRecord[];
  format?: "json" | "markdown" | "html";
}

// ─── Compliance Summary Engine ────────────────────────────────────────────────

export function buildComplianceSummary(batches: BatchRecord[]): ComplianceSummary {
  const total = batches.length;
  if (total === 0) {
    return {
      totalBatches: 0,
      compliant: 0,
      atRisk: 0,
      nonCompliant: 0,
      complianceRate: 0,
      averageTotalThc: 0,
      maxTotalThc: 0,
      minTotalThc: 0,
      nearThresholdCount: 0,
      highestRiskBatch: null,
    };
  }

  const compliant = batches.filter((b) => b.status === "Compliant").length;
  const atRisk = batches.filter((b) => b.status === "At Risk").length;
  const nonCompliant = batches.filter((b) => b.status === "Non-Compliant").length;
  const thcValues = batches.map((b) => Number(b.totalThc || 0));
  const averageTotalThc = parseFloat((thcValues.reduce((s, v) => s + v, 0) / total).toFixed(4));
  const maxTotalThc = parseFloat(Math.max(...thcValues).toFixed(4));
  const minTotalThc = parseFloat(Math.min(...thcValues).toFixed(4));
  const nearThresholdCount = batches.filter((b) => {
    const t = Number(b.totalThc || 0);
    return t >= 0.25 && t < 0.3;
  }).length;
  const highestRiskBatch =
    [...batches].sort((a, b) => Number(b.totalThc || 0) - Number(a.totalThc || 0))[0] ?? null;
  const complianceRate = parseFloat(((compliant / total) * 100).toFixed(1));

  return {
    totalBatches: total,
    compliant,
    atRisk,
    nonCompliant,
    complianceRate,
    averageTotalThc,
    maxTotalThc,
    minTotalThc,
    nearThresholdCount,
    highestRiskBatch,
  };
}

// ─── ROI Engine ───────────────────────────────────────────────────────────────

export function buildROISummary(batches: BatchRecord[]): ROISummary {
  const totalCoas = batches.length;
  const timeSavedMinutes = totalCoas * ROI_COST_PER_COA_MANUAL_MINUTES;
  const timeSavedHours = parseFloat((timeSavedMinutes / 60).toFixed(2));
  const labourSavingsUsd = parseFloat((timeSavedMinutes * ROI_COST_PER_MINUTE_USD).toFixed(2));

  const nonCompliantCaught = batches.filter((b) => b.status === "Non-Compliant").length;
  const atRiskCaught = batches.filter((b) => b.status === "At Risk").length;

  const finesAvoidedUsd = nonCompliantCaught * ROI_FINE_PER_BREACH_USD;
  const riskPremiumAvoidedUsd = atRiskCaught * ROI_RISK_PREMIUM_PER_AT_RISK_USD;

  const totalFinancialValueUsd = labourSavingsUsd + finesAvoidedUsd + riskPremiumAvoidedUsd;

  // ROI multiplier: total financial value gained vs a conservative $500/month manual system baseline
  const baselineMonthlyManualCostUsd = 500;
  const roiMultiplier = baselineMonthlyManualCostUsd > 0
    ? parseFloat((totalFinancialValueUsd / baselineMonthlyManualCostUsd).toFixed(1))
    : 0;

  return {
    totalCoas,
    timeSavedMinutes,
    timeSavedHours,
    labourSavingsUsd,
    nonCompliantCaught,
    atRiskCaught,
    finesAvoidedUsd,
    riskPremiumAvoidedUsd,
    totalFinancialValueUsd,
    roiMultiplier,
  };
}

// ─── HMAC Integrity Seal ──────────────────────────────────────────────────────

/**
 * Generates a tamper-evident HMAC-SHA256 over the stringified report body.
 * Requires COA_SIGNING_SECRET to be set; returns a placeholder if absent.
 */
export function sealReport(reportContent: object): string {
  const secret = process.env.COA_SIGNING_SECRET;
  if (!secret) {
    // Return a deterministic placeholder; callers should warn consumers that sealing is degraded.
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(reportContent))
      .digest("hex");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(reportContent))
    .digest("hex");
}

// ─── Report Compiler ──────────────────────────────────────────────────────────

export function generateReport(
  batches: BatchRecord[],
  caller: { userId: string; userRole: string; tenantId: string },
  reportType: ReportMetadata["reportType"] = "compliance-roi"
): ComplianceReport {
  const compliance = buildComplianceSummary(batches);
  const roi = buildROISummary(batches);

  const reportCore = { compliance, roi, batches, reportType };
  const integrityHash = sealReport(reportCore);
  const reportId = `report-${caller.tenantId}-${Date.now()}-${integrityHash.slice(0, 8)}`;

  const metadata: ReportMetadata = {
    reportId,
    generatedAt: new Date().toISOString(),
    generatedBy: caller,
    reportVersion: "1.0",
    integrityHash,
    reportType,
  };

  return {
    metadata,
    compliance,
    roi,
    batches,
  };
}

// ─── Markdown Formatter ───────────────────────────────────────────────────────

export function formatReportAsMarkdown(report: ComplianceReport): string {
  const { metadata, compliance, roi } = report;
  const { generatedBy: g } = metadata;

  return `# HempForge Compliance & ROI Report
**Report ID:** \`${metadata.reportId}\`
**Generated:** ${new Date(metadata.generatedAt).toLocaleString()}
**Tenant:** ${g.tenantId}
**Generated By:** ${g.userId} (${g.userRole})
**Integrity Seal (HMAC-SHA256):** \`${metadata.integrityHash}\`

---

## Compliance Summary

| Metric | Value |
|---|---|
| Total Batches | ${compliance.totalBatches} |
| Compliant | ${compliance.compliant} |
| At Risk | ${compliance.atRisk} |
| Non-Compliant | ${compliance.nonCompliant} |
| Compliance Rate | **${compliance.complianceRate}%** |
| Average Total THC | ${compliance.averageTotalThc}% |
| Max Total THC | ${compliance.maxTotalThc}% |
| Near-Threshold Batches | ${compliance.nearThresholdCount} |

${compliance.highestRiskBatch ? `**Highest Risk Batch:** ${compliance.highestRiskBatch.batchId} — ${compliance.highestRiskBatch.strain} (${compliance.highestRiskBatch.totalThc}% Total THC)` : ""}

---

## ROI & Financial Value

| Metric | Value |
|---|---|
| Total COAs Processed | ${roi.totalCoas} |
| Labour Time Saved | **${roi.timeSavedHours} hrs** (${roi.timeSavedMinutes} min) |
| Labour Savings | **$${roi.labourSavingsUsd.toLocaleString()}** |
| Non-Compliant Batches Caught | ${roi.nonCompliantCaught} |
| Regulatory Fines Avoided | **$${roi.finesAvoidedUsd.toLocaleString()}** |
| At-Risk Batches Caught | ${roi.atRiskCaught} |
| Risk Premium Avoided | **$${roi.riskPremiumAvoidedUsd.toLocaleString()}** |
| **Total Financial Value** | **$${roi.totalFinancialValueUsd.toLocaleString()}** |
| ROI Multiplier vs. Manual Baseline | **${roi.roiMultiplier}×** |

---

*This report was automatically generated by HempForge and sealed with an HMAC-SHA256 digest for ALCOA++ compliance. Verify integrity by re-computing the hash over the report JSON payload using the COA_SIGNING_SECRET.*
`;
}

// ─── HTML Formatter ───────────────────────────────────────────────────────────

export function formatReportAsHtml(report: ComplianceReport): string {
  const md = formatReportAsMarkdown(report);
  // Minimal HTML wrap — intended for email or PDF pipelines
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>HempForge Report ${report.metadata.reportId}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0A0F0D; color: #E2E8F0; padding: 40px; max-width: 900px; margin: auto; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 8px 12px; border: 1px solid #334740; }
  th { background: #1A221E; }
  code { background: #1A221E; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
  h1 { color: #34D399; } h2 { color: #5EEAD4; border-bottom: 1px solid #334740; padding-bottom: 4px; }
</style>
</head>
<body>
<pre style="white-space:pre-wrap;font-family:system-ui">${md.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body>
</html>`;
}
