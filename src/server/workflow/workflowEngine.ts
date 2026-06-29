/**
 * HempForge Workflow Engine
 * 
 * Item 2: Finite state machine-based workflow management.
 * Every workflow transition is validated against the state machine definition
 * and logged to both the audit engine and event store.
 */

import crypto from "crypto";
import type {
  WorkflowInstance,
  WorkflowType,
  WorkflowStatus,
  WorkflowTransition,
  WorkflowStateConfig,
} from "../../shared/types";
import { WORKFLOW_STATE_MACHINES } from "../../shared/types";
import { appendEvent } from "../audit/eventStore";

// In-memory workflow store (backed by Firestore in production)
const workflowStore: Map<string, WorkflowInstance> = new Map();

/**
 * Create a new workflow instance.
 */
export function createWorkflow(params: {
  type: WorkflowType;
  title: string;
  description?: string;
  tenantId: string;
  createdBy: string;
  assignedTo?: string;
  priority?: WorkflowInstance["priority"];
  metadata?: Record<string, unknown>;
  relatedEntityId?: string;
  relatedEntityType?: string;
}): WorkflowInstance {
  const id = `wf-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const workflow: WorkflowInstance = {
    id,
    type: params.type,
    status: "pending",
    title: params.title,
    description: params.description,
    tenantId: params.tenantId,
    createdBy: params.createdBy,
    assignedTo: params.assignedTo,
    createdAt: now,
    updatedAt: now,
    priority: params.priority || "medium",
    transitions: [],
    metadata: params.metadata || {},
    relatedEntityId: params.relatedEntityId,
    relatedEntityType: params.relatedEntityType,
  };

  workflowStore.set(id, workflow);

  // Emit domain event
  appendEvent({
    type: "workflow.created",
    aggregateId: id,
    aggregateType: "workflow",
    tenantId: params.tenantId,
    userId: params.createdBy,
    payload: { workflowType: params.type, title: params.title, priority: workflow.priority },
  });

  return workflow;
}

/**
 * Validate and execute a workflow state transition.
 */
export function transitionWorkflow(params: {
  workflowId: string;
  targetStatus: WorkflowStatus;
  userId: string;
  userRole: string;
  action: string;
  comment?: string;
}): { success: boolean; workflow?: WorkflowInstance; error?: string } {
  const workflow = workflowStore.get(params.workflowId);
  if (!workflow) {
    return { success: false, error: `Workflow ${params.workflowId} not found` };
  }

  const stateConfig = WORKFLOW_STATE_MACHINES[workflow.type];
  if (!stateConfig) {
    return { success: false, error: `No state machine defined for workflow type: ${workflow.type}` };
  }

  // Validate transition is allowed
  const allowedTargets = stateConfig.allowedTransitions[workflow.status] || [];
  if (!allowedTargets.includes(params.targetStatus)) {
    return {
      success: false,
      error: `Transition from '${workflow.status}' to '${params.targetStatus}' is not allowed for workflow type '${workflow.type}'`,
    };
  }

  // Validate role if required
  if (stateConfig.requiredRoles) {
    const actionKey = params.action.toLowerCase();
    const requiredRoles = stateConfig.requiredRoles[actionKey];
    if (requiredRoles && !requiredRoles.includes(params.userRole)) {
      return {
        success: false,
        error: `Role '${params.userRole}' is not authorized for action '${params.action}'. Required: ${requiredRoles.join(", ")}`,
      };
    }
  }

  // Execute transition
  const transition: WorkflowTransition = {
    from: workflow.status,
    to: params.targetStatus,
    action: params.action,
    requiredRole: params.userRole,
    timestamp: new Date().toISOString(),
    userId: params.userId,
    comment: params.comment,
  };

  workflow.status = params.targetStatus;
  workflow.updatedAt = new Date().toISOString();
  workflow.transitions.push(transition);

  if (params.targetStatus === "completed") {
    workflow.completedAt = new Date().toISOString();
  }

  workflowStore.set(params.workflowId, workflow);

  // Emit domain event
  appendEvent({
    type: params.targetStatus === "completed" ? "workflow.completed" : "workflow.transitioned",
    aggregateId: params.workflowId,
    aggregateType: "workflow",
    tenantId: workflow.tenantId,
    userId: params.userId,
    payload: {
      from: transition.from,
      to: transition.to,
      action: params.action,
      comment: params.comment,
    },
  });

  return { success: true, workflow };
}

/**
 * Get a workflow by ID.
 */
export function getWorkflow(workflowId: string): WorkflowInstance | undefined {
  return workflowStore.get(workflowId);
}

/**
 * List workflows with filtering.
 */
export function listWorkflows(params: {
  tenantId: string;
  type?: WorkflowType;
  status?: WorkflowStatus;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}): { workflows: WorkflowInstance[]; total: number } {
  let results = Array.from(workflowStore.values()).filter(
    (w) => w.tenantId === params.tenantId
  );

  if (params.type) {
    results = results.filter((w) => w.type === params.type);
  }
  if (params.status) {
    results = results.filter((w) => w.status === params.status);
  }
  if (params.assignedTo) {
    results = results.filter((w) => w.assignedTo === params.assignedTo);
  }

  // Sort by most recent first
  results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const total = results.length;
  const offset = params.offset || 0;
  const limit = params.limit || 50;
  results = results.slice(offset, offset + limit);

  return { workflows: results, total };
}

/**
 * Assign a workflow to a user.
 */
export function assignWorkflow(params: {
  workflowId: string;
  assignedTo: string;
  assignedBy: string;
}): { success: boolean; workflow?: WorkflowInstance; error?: string } {
  const workflow = workflowStore.get(params.workflowId);
  if (!workflow) {
    return { success: false, error: `Workflow ${params.workflowId} not found` };
  }

  workflow.assignedTo = params.assignedTo;
  workflow.updatedAt = new Date().toISOString();
  workflowStore.set(params.workflowId, workflow);

  appendEvent({
    type: "workflow.assigned",
    aggregateId: params.workflowId,
    aggregateType: "workflow",
    tenantId: workflow.tenantId,
    userId: params.assignedBy,
    payload: { assignedTo: params.assignedTo },
  });

  return { success: true, workflow };
}

/**
 * Get workflow summary statistics for a tenant.
 */
export function getWorkflowStats(tenantId: string): Record<WorkflowStatus, number> {
  const workflows = Array.from(workflowStore.values()).filter((w) => w.tenantId === tenantId);
  const stats: Record<WorkflowStatus, number> = {
    "pending": 0,
    "in-progress": 0,
    "awaiting-review": 0,
    "approved": 0,
    "rejected": 0,
    "completed": 0,
    "cancelled": 0,
    "escalated": 0,
  };

  for (const w of workflows) {
    stats[w.status]++;
  }

  return stats;
}
