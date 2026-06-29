/**
 * HempForge Shared Types
 * 
 * Canonical type definitions shared between frontend and backend.
 * These types enforce data provenance, workflow state, and enterprise structure.
 */

// ─── Output Classification (Item 1: Remove Illusion) ─────────────────────────

/**
 * Every API response and UI data card MUST declare its data source classification.
 * This eliminates ambiguity between live operational data and simulated/demo content.
 */
export type OutputClassification =
  | "production-real"       // Live verified data from authenticated sources
  | "deterministic-formula" // Computed from known constants/formulas
  | "live-ai-inference"     // Real-time AI model output
  | "heuristic-fallback"    // Pattern-matching approximation
  | "simulated"             // Generated when dependencies unavailable
  | "demo-only";            // Seeded test data, never for production

/**
 * Human-readable labels for UI display
 */
export const OUTPUT_CLASSIFICATION_LABELS: Record<OutputClassification, string> = {
  "production-real": "Live",
  "deterministic-formula": "Calculated",
  "live-ai-inference": "AI Generated",
  "heuristic-fallback": "Heuristic",
  "simulated": "Simulated",
  "demo-only": "Demo Only",
};

/**
 * Color scheme for classification badges
 */
export const OUTPUT_CLASSIFICATION_COLORS: Record<OutputClassification, { bg: string; text: string; border: string }> = {
  "production-real": { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-500/50" },
  "deterministic-formula": { bg: "bg-blue-900/30", text: "text-blue-300", border: "border-blue-500/50" },
  "live-ai-inference": { bg: "bg-purple-900/30", text: "text-purple-300", border: "border-purple-500/50" },
  "heuristic-fallback": { bg: "bg-amber-900/30", text: "text-amber-300", border: "border-amber-500/50" },
  "simulated": { bg: "bg-red-900/30", text: "text-red-300", border: "border-red-500/50" },
  "demo-only": { bg: "bg-gray-900/30", text: "text-gray-400", border: "border-gray-500/50" },
};

/**
 * Standard API response envelope with data source tagging.
 * All API endpoints MUST wrap responses in this envelope.
 */
export interface TaggedResponse<T = unknown> {
  data: T;
  _dataSource: OutputClassification;
  _timestamp: string;
  _tenantId: string;
  _disclaimers?: string[];
}

// ─── Workflow Types (Item 2: Workflow Hub) ────────────────────────────────────

export type WorkflowType =
  | "sample-intake"
  | "test-execution"
  | "coa-review"
  | "exception-management"
  | "release-approval"
  | "customer-delivery"
  | "audit-readiness";

export type WorkflowStatus =
  | "pending"
  | "in-progress"
  | "awaiting-review"
  | "approved"
  | "rejected"
  | "completed"
  | "cancelled"
  | "escalated";

export interface WorkflowTransition {
  from: WorkflowStatus;
  to: WorkflowStatus;
  action: string;
  requiredRole?: string;
  timestamp: string;
  userId: string;
  comment?: string;
}

export interface WorkflowInstance {
  id: string;
  type: WorkflowType;
  status: WorkflowStatus;
  title: string;
  description?: string;
  tenantId: string;
  createdBy: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  priority: "low" | "medium" | "high" | "critical";
  transitions: WorkflowTransition[];
  metadata: Record<string, unknown>;
  relatedEntityId?: string;
  relatedEntityType?: string;
}

// ─── Workflow State Machine Definition ────────────────────────────────────────

export interface WorkflowStateConfig {
  allowedTransitions: Record<WorkflowStatus, WorkflowStatus[]>;
  requiredRoles?: Record<string, string[]>;
}

export const WORKFLOW_STATE_MACHINES: Record<WorkflowType, WorkflowStateConfig> = {
  "sample-intake": {
    allowedTransitions: {
      "pending": ["in-progress", "cancelled"],
      "in-progress": ["awaiting-review", "cancelled"],
      "awaiting-review": ["approved", "rejected"],
      "approved": ["completed"],
      "rejected": ["in-progress", "cancelled"],
      "completed": [],
      "cancelled": [],
      "escalated": ["in-progress", "cancelled"],
    },
  },
  "test-execution": {
    allowedTransitions: {
      "pending": ["in-progress", "cancelled"],
      "in-progress": ["awaiting-review", "escalated", "cancelled"],
      "awaiting-review": ["approved", "rejected", "escalated"],
      "approved": ["completed"],
      "rejected": ["in-progress"],
      "completed": [],
      "cancelled": [],
      "escalated": ["in-progress", "awaiting-review"],
    },
  },
  "coa-review": {
    allowedTransitions: {
      "pending": ["in-progress"],
      "in-progress": ["awaiting-review"],
      "awaiting-review": ["approved", "rejected"],
      "approved": ["completed"],
      "rejected": ["in-progress"],
      "completed": [],
      "cancelled": [],
      "escalated": ["awaiting-review"],
    },
    requiredRoles: {
      "approve": ["Quality Auditor", "Lab Admin"],
      "reject": ["Quality Auditor", "Lab Admin"],
    },
  },
  "exception-management": {
    allowedTransitions: {
      "pending": ["in-progress", "escalated"],
      "in-progress": ["awaiting-review", "escalated"],
      "awaiting-review": ["approved", "rejected"],
      "approved": ["completed"],
      "rejected": ["in-progress", "escalated"],
      "completed": [],
      "cancelled": [],
      "escalated": ["in-progress", "awaiting-review"],
    },
  },
  "release-approval": {
    allowedTransitions: {
      "pending": ["awaiting-review"],
      "in-progress": ["awaiting-review"],
      "awaiting-review": ["approved", "rejected"],
      "approved": ["completed"],
      "rejected": ["pending"],
      "completed": [],
      "cancelled": [],
      "escalated": ["awaiting-review"],
    },
    requiredRoles: {
      "approve": ["Quality Auditor", "Lab Admin"],
    },
  },
  "customer-delivery": {
    allowedTransitions: {
      "pending": ["in-progress"],
      "in-progress": ["completed", "cancelled"],
      "awaiting-review": ["approved"],
      "approved": ["completed"],
      "rejected": [],
      "completed": [],
      "cancelled": [],
      "escalated": ["in-progress"],
    },
  },
  "audit-readiness": {
    allowedTransitions: {
      "pending": ["in-progress"],
      "in-progress": ["awaiting-review"],
      "awaiting-review": ["approved", "rejected"],
      "approved": ["completed"],
      "rejected": ["in-progress"],
      "completed": [],
      "cancelled": [],
      "escalated": ["in-progress"],
    },
  },
};

// ─── Event Sourcing Types (Item 8: Trust) ────────────────────────────────────

export type DomainEventType =
  | "workflow.created"
  | "workflow.transitioned"
  | "workflow.assigned"
  | "workflow.completed"
  | "coa.uploaded"
  | "coa.reviewed"
  | "coa.approved"
  | "coa.rejected"
  | "coa.signed"
  | "sample.received"
  | "sample.tested"
  | "report.generated"
  | "report.approved"
  | "report.published"
  | "integration.synced"
  | "metric.recorded";

export interface DomainEvent {
  id: string;
  type: DomainEventType;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  userId: string;
  timestamp: string;
  payload: Record<string, unknown>;
  metadata: {
    correlationId?: string;
    causationId?: string;
    version: number;
  };
}

// ─── Enterprise / Multi-Site Types (Item 9) ──────────────────────────────────

export type OrgRole =
  | "System Admin"
  | "Org Admin"
  | "Site Admin"
  | "Quality Auditor"
  | "Lab Admin"
  | "Operator"
  | "Viewer";

export interface OrgHierarchy {
  id: string;
  name: string;
  parentId?: string;
  type: "enterprise" | "region" | "site";
  tenantId: string;
  settings: Record<string, unknown>;
  createdAt: string;
}

export interface EnterprisePermission {
  userId: string;
  orgId: string;
  role: OrgRole;
  scope: "org" | "site" | "cross-site";
  grantedBy: string;
  grantedAt: string;
}

// ─── ROI Metrics Types (Item 10) ─────────────────────────────────────────────

export type MetricType =
  | "turnaround-time"
  | "manual-review-steps"
  | "non-compliance-incidents"
  | "right-first-time-rate"
  | "audit-prep-duration"
  | "literature-to-decision-time";

export interface ROIMetric {
  id: string;
  type: MetricType;
  value: number;
  unit: string;
  tenantId: string;
  siteId?: string;
  recordedAt: string;
  period: "daily" | "weekly" | "monthly";
  metadata?: Record<string, unknown>;
}

// ─── Integration Types (Item 6) ──────────────────────────────────────────────

export type IntegrationType =
  | "lims"
  | "instrument"
  | "metrc"
  | "erp"
  | "e-signature"
  | "customer-portal"
  | "quality-system";

export type IntegrationStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "syncing"
  | "pending-setup";

export interface IntegrationConfig {
  id: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  tenantId: string;
  config: Record<string, unknown>;
  lastSyncAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Report Types (Item 7) ───────────────────────────────────────────────────

export type ReportType =
  | "coa"
  | "executive-summary"
  | "regulatory-brief"
  | "research-paper"
  | "customer-packet"
  | "audit-report";

export type ReportStatus =
  | "draft"
  | "in-review"
  | "approved"
  | "published"
  | "archived";

export interface EvidenceBlock {
  id: string;
  type: "data" | "calculation" | "reference" | "observation";
  content: unknown;
  sourceId: string;
  sourceType: string;
  verificationStatus: "verified" | "unverified" | "pending";
  provenanceHash: string;
  timestamp: string;
}

export interface ReportTemplate {
  id: string;
  type: ReportType;
  name: string;
  sections: ReportSection[];
  tenantId: string;
  version: number;
  createdAt: string;
}

export interface ReportSection {
  id: string;
  title: string;
  order: number;
  evidenceBlockIds: string[];
  content?: string;
}

export interface ReportInstance {
  id: string;
  templateId: string;
  type: ReportType;
  title: string;
  status: ReportStatus;
  tenantId: string;
  createdBy: string;
  reviewedBy?: string;
  approvedBy?: string;
  evidenceBlocks: EvidenceBlock[];
  sections: ReportSection[];
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

// ─── Analytics / Intelligence Types (Items 3, 4) ─────────────────────────────

export interface AnomalyDetection {
  id: string;
  metric: string;
  value: number;
  expectedRange: { min: number; max: number };
  deviation: number;
  severity: "low" | "medium" | "high" | "critical";
  detectedAt: string;
  tenantId: string;
  context: Record<string, unknown>;
}

export interface MethodDriftWarning {
  id: string;
  methodName: string;
  parameter: string;
  currentMean: number;
  historicalMean: number;
  drift: number;
  pValue: number;
  significance: "not-significant" | "warning" | "significant";
  detectedAt: string;
  tenantId: string;
  sampleSize: number;
}

export interface BatchRiskForecast {
  id: string;
  batchId: string;
  strain: string;
  riskScore: number;
  riskFactors: { factor: string; weight: number; value: number }[];
  recommendation: string;
  confidence: number;
  forecastedAt: string;
  tenantId: string;
}

export interface BacktestQuery {
  id: string;
  hypothesis: string;
  parameters: Record<string, unknown>;
  dateRange: { start: string; end: string };
  filters: Record<string, unknown>;
  tenantId: string;
  createdBy: string;
  createdAt: string;
}

export interface BacktestResult {
  id: string;
  queryId: string;
  outcome: string;
  metrics: Record<string, number>;
  dataPoints: number;
  confidence: number;
  visualization: { type: string; data: unknown };
  executedAt: string;
  executionTimeMs: number;
}

// ─── Data Asset Schemas (Item 5) ─────────────────────────────────────────────

export interface BatchHistory {
  id: string;
  batchId: string;
  strain: string;
  tenantId: string;
  siteId?: string;
  harvestDate?: string;
  processingDate?: string;
  events: { timestamp: string; event: string; userId: string }[];
  coaIds: string[];
  complianceStatus: "compliant" | "non-compliant" | "pending";
  metadata: Record<string, unknown>;
}

export interface StrainPerformance {
  id: string;
  strain: string;
  tenantId: string;
  totalBatches: number;
  complianceRate: number;
  avgTotalThc: number;
  avgThca: number;
  avgD9Thc: number;
  varianceThc: number;
  lastUpdated: string;
}

export interface MethodPerformance {
  id: string;
  methodName: string;
  instrumentId?: string;
  tenantId: string;
  totalRuns: number;
  avgTurnaroundHours: number;
  repeatabilityRsd: number;
  reproducibilityRsd: number;
  lastCalibration?: string;
  lastUpdated: string;
}
