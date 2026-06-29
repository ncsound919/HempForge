/**
 * HempForge ROI Metrics Service
 * 
 * Item 10: Track and surface operational metrics that prove ROI.
 * Automatically captures turnaround time, compliance rates, and efficiency metrics.
 */

import crypto from "crypto";
import ss from "simple-statistics";
import type { ROIMetric, MetricType } from "../../shared/types";
import { appendEvent } from "../audit/eventStore";

// In-memory metrics store (backed by Firestore in production)
const metricsStore: ROIMetric[] = [];

/**
 * Record a new ROI metric data point.
 */
export function recordMetric(params: {
  type: MetricType;
  value: number;
  unit: string;
  tenantId: string;
  siteId?: string;
  period?: ROIMetric["period"];
  metadata?: Record<string, unknown>;
}): ROIMetric {
  const metric: ROIMetric = {
    id: `metric-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    type: params.type,
    value: params.value,
    unit: params.unit,
    tenantId: params.tenantId,
    siteId: params.siteId,
    recordedAt: new Date().toISOString(),
    period: params.period || "daily",
    metadata: params.metadata,
  };

  metricsStore.push(metric);

  appendEvent({
    type: "metric.recorded",
    aggregateId: metric.id,
    aggregateType: "roi-metric",
    tenantId: params.tenantId,
    userId: "system",
    payload: { type: params.type, value: params.value, unit: params.unit },
  });

  return metric;
}

/**
 * Get metrics for a tenant with optional filtering.
 */
export function getMetrics(params: {
  tenantId: string;
  type?: MetricType;
  siteId?: string;
  since?: string;
  until?: string;
  period?: ROIMetric["period"];
  limit?: number;
}): ROIMetric[] {
  let results = metricsStore.filter((m) => m.tenantId === params.tenantId);

  if (params.type) {
    results = results.filter((m) => m.type === params.type);
  }
  if (params.siteId) {
    results = results.filter((m) => m.siteId === params.siteId);
  }
  if (params.period) {
    results = results.filter((m) => m.period === params.period);
  }
  if (params.since) {
    const sinceTime = new Date(params.since).getTime();
    results = results.filter((m) => new Date(m.recordedAt).getTime() >= sinceTime);
  }
  if (params.until) {
    const untilTime = new Date(params.until).getTime();
    results = results.filter((m) => new Date(m.recordedAt).getTime() <= untilTime);
  }

  results.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());

  if (params.limit) {
    results = results.slice(0, params.limit);
  }

  return results;
}

/**
 * Compute ROI summary statistics for a metric type.
 */
export function computeMetricSummary(params: {
  tenantId: string;
  type: MetricType;
  since?: string;
}): {
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  trend: "improving" | "stable" | "declining";
  percentChange: number;
} | null {
  const metrics = getMetrics({ tenantId: params.tenantId, type: params.type, since: params.since });

  if (metrics.length < 2) return null;

  const values = metrics.map((m) => m.value);
  const mean = ss.mean(values);
  const median = ss.median(values);
  const stdDev = ss.standardDeviation(values);
  const min = ss.min(values);
  const max = ss.max(values);

  // Calculate trend using linear regression
  const dataPoints = metrics.map((m, i) => [i, m.value] as [number, number]);
  const regression = ss.linearRegression(dataPoints);
  const slope = regression.m;

  // For metrics where lower is better (turnaround time, manual steps, incidents)
  const lowerIsBetter: MetricType[] = [
    "turnaround-time",
    "manual-review-steps",
    "non-compliance-incidents",
    "audit-prep-duration",
    "literature-to-decision-time",
  ];

  const isLowerBetter = lowerIsBetter.includes(params.type);

  let trend: "improving" | "stable" | "declining";
  if (Math.abs(slope) < stdDev * 0.1) {
    trend = "stable";
  } else if ((slope < 0 && isLowerBetter) || (slope > 0 && !isLowerBetter)) {
    trend = "improving";
  } else {
    trend = "declining";
  }

  // Calculate percent change (first vs last period)
  const oldValue = metrics[metrics.length - 1].value;
  const newValue = metrics[0].value;
  const percentChange = oldValue !== 0 ? ((newValue - oldValue) / oldValue) * 100 : 0;

  return {
    count: metrics.length,
    mean,
    median,
    stdDev,
    min,
    max,
    trend,
    percentChange,
  };
}

/**
 * Get a full ROI dashboard summary for a tenant.
 */
export function getROIDashboard(tenantId: string): {
  metrics: Record<MetricType, ReturnType<typeof computeMetricSummary>>;
  overallHealth: "excellent" | "good" | "needs-attention" | "critical";
  highlights: string[];
} {
  const metricTypes: MetricType[] = [
    "turnaround-time",
    "manual-review-steps",
    "non-compliance-incidents",
    "right-first-time-rate",
    "audit-prep-duration",
    "literature-to-decision-time",
  ];

  const metrics: Record<string, ReturnType<typeof computeMetricSummary>> = {};
  const highlights: string[] = [];
  let improvingCount = 0;
  let decliningCount = 0;

  for (const type of metricTypes) {
    const summary = computeMetricSummary({ tenantId, type });
    metrics[type] = summary;

    if (summary) {
      if (summary.trend === "improving") {
        improvingCount++;
        highlights.push(`${type}: ${Math.abs(summary.percentChange).toFixed(1)}% improvement`);
      } else if (summary.trend === "declining") {
        decliningCount++;
        highlights.push(`${type}: ${Math.abs(summary.percentChange).toFixed(1)}% decline — attention needed`);
      }
    }
  }

  let overallHealth: "excellent" | "good" | "needs-attention" | "critical";
  if (decliningCount === 0 && improvingCount >= 3) {
    overallHealth = "excellent";
  } else if (decliningCount <= 1) {
    overallHealth = "good";
  } else if (decliningCount <= 3) {
    overallHealth = "needs-attention";
  } else {
    overallHealth = "critical";
  }

  return {
    metrics: metrics as Record<MetricType, ReturnType<typeof computeMetricSummary>>,
    overallHealth,
    highlights,
  };
}
