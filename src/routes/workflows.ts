/**
 * routes/workflows.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * GxP compliance workflow lifecycle. Each batch passes through 5 stages:
 *   Intake → LIMS Verification → Compliance Review → Auditor Sign-off → Metrc Synced
 * Transitions are role-gated per stage AND validated by decisionEngine.
 *
 * Tier 1 (deterministic) validation runs BEFORE the Firestore transaction:
 *   - decisionEngine.validateWorkflowTransition() checks role permissions
 *     and business-rule stage constraints.
 *   - If validation fails, a 400/403 is returned immediately — no LLM call,
 *     no Firestore write.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { adminDb, createAuditHash, saveAuditLog } from "../services/backendServices";
import { hasPermission, requirePermission, Permission } from "../lib/permissionsEngine";
import { validateWorkflowTransition } from "../lib/decisionEngine";
import type { AuditLog } from "../lib/firebaseService";
import { DEFAULT_TENANT } from "../config";

const WORKFLOW_STAGES = [
  "Intake",
  "LIMS Verification",
  "Compliance Review",
  "Auditor Sign-off",
  "Metrc Synced",
] as const;

type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

const STAGE_REQUIRED_PERMISSION: Record<WorkflowStage, Permission> = {
  "Intake": "INGEST_COA",
  "LIMS Verification": "TOGGLE_LIMS_HANDSHAKE",
  "Compliance Review": "CALCULATE_COMPLIANCE",
  "Auditor Sign-off": "SIGN_COA",
  "Metrc Synced": "SYNC_METRC_PACKAGE",
};

// Map the GxP stage names to the decisionEngine's stage transition rule keys.
// decisionEngine uses lowercase slugs; GxP stages use display names.
const STAGE_SLUG: Record<string, string> = {
  "Intake": "draft",
  "LIMS Verification": "pending_review",
  "Compliance Review": "approved",
  "Auditor Sign-off": "approved",
  "Metrc Synced": "released",
};

export function workflowsRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── GET /api/workflows ────────────────────────────────────────────────────
  router.get("/", deps.authMiddleware, async (req, res) => {
    const { tenantId } = req.authContext || {};
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    if (!adminDb) {
      return res.json({ workflows: [], fallback: true });
    }
    try {
      const snap = await adminDb
        .collection("workflows")
        .where("tenantId", "==", tenantId)
        .orderBy("createdAt", "desc")
        .limit(100)
        .get();
      const workflows = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      res.json({ workflows });
    } catch (err: any) {
      console.error("Workflows fetch error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /api/workflows ───────────────────────────────────────────────────
  router.post(
    "/",
    deps.authMiddleware,
    requirePermission("CREATE_WORKFLOW"),
    async (req, res) => {
      const userContext = req.authContext;
      const { batchId, strain, coaId, notes } = req.body || {};
      if (!batchId) return res.status(400).json({ error: "batchId is required" });

      const tenantId = userContext?.tenantId || DEFAULT_TENANT;
      const newWorkflow = {
        batchId,
        strain: strain || "Unknown",
        coaId: coaId || null,
        notes: notes || "",
        currentStage: "Intake" as WorkflowStage,
        stageHistory: [
          {
            stage: "Intake",
            enteredAt: new Date().toISOString(),
            by: userContext?.userId,
            byRole: userContext?.userRole,
          },
        ],
        status: "active",
        tenantId,
        createdAt: new Date().toISOString(),
        createdBy: userContext?.userId,
        createdByRole: userContext?.userRole,
      };

      try {
        let workflowId: string;
        if (adminDb) {
          const ref = await adminDb.collection("workflows").add(newWorkflow);
          workflowId = ref.id;
        } else {
          workflowId = `wf-local-${Date.now()}`;
        }

        const auditEntry: Omit<AuditLog, "hash"> = {
          id: `log-${Date.now()}`,
          timestamp: new Date().toISOString(),
          userId: userContext?.userId || "unknown",
          userRole: userContext?.userRole || "Operator",
          tenantId,
          action: "WORKFLOW_CREATED",
          details: `GxP workflow created for batch '${batchId}' (${strain || "Unknown"}). Workflow ID: ${workflowId}.`,
          category: "DATA_CHANGE",
        };
        const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };
        await saveAuditLog(hashedAudit, req.firebaseToken as string);

        res.status(201).json({ workflow: { id: workflowId, ...newWorkflow }, auditLog: hashedAudit });
      } catch (err: any) {
        console.error("Workflow create error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ─── POST /api/workflows/:id/transition ────────────────────────────────────
  router.post(
    "/:id/transition",
    deps.authMiddleware,
    requirePermission("TRANSITION_WORKFLOW"),
    async (req, res) => {
      const userContext = req.authContext;
      const { id } = req.params;
      const { toStage, notes } = req.body || {};
      const tenantId = userContext?.tenantId || DEFAULT_TENANT;

      if (!toStage || !WORKFLOW_STAGES.includes(toStage as WorkflowStage)) {
        return res.status(400).json({
          error: "Invalid toStage. Must be one of: " + WORKFLOW_STAGES.join(", "),
        });
      }

      // ── Resolve the workflow's actual current stage before validating ─────
      // (BUG FIX: previously fromStage was derived from toStage, so the rule
      // engine always checked "can stage X transition to itself" instead of
      // "can the workflow's real current stage transition to X".)
      let currentStageSlug = "draft";
      if (adminDb) {
        const existingDoc = await adminDb.collection("workflows").doc(id).get();
        if (existingDoc.exists) {
          const existingData = existingDoc.data();
          if (existingData?.tenantId && existingData.tenantId !== tenantId) {
            return res.status(403).json({ error: "Cross-tenant access denied" });
          }
          currentStageSlug = STAGE_SLUG[existingData?.currentStage] || "draft";
        }
      }

      // ── Tier 1: decisionEngine pre-validation ─────────────────────────────
      // Validate permission + business-rule stage constraints deterministically
      // before touching Firestore. Returns immediately with reasons[] if rejected.
      const requiredPerm = STAGE_REQUIRED_PERMISSION[toStage as WorkflowStage];
      const decisionResult = validateWorkflowTransition({
        tenantId,
        userId: userContext?.userId || "unknown",
        userRole: userContext?.userRole || "Operator",
        fromStage: currentStageSlug,  // actual current stage, not the requested target
        toStage: STAGE_SLUG[toStage] || toStage,
        requiredPermission: requiredPerm,
      });

      if (!decisionResult.permitted) {
        // Distinguish permission failures (403) from rule/stage failures (400)
        const isPermissionFailure = decisionResult.reasons.some((r) =>
          r.includes("does not have permission")
        );
        return res.status(isPermissionFailure ? 403 : 400).json({
          error: "Workflow transition rejected",
          reasons: decisionResult.reasons,
          outputClassification: decisionResult.outputClassification,
        });
      }
      // ─────────────────────────────────────────────────────────────────────

      // Legacy per-stage permission check (kept for backward compatibility)
      if (!hasPermission(userContext?.userRole, requiredPerm)) {
        return res.status(403).json({
          error: `Forbidden: Role '${userContext?.userRole}' cannot authorize the '${toStage}' stage. Required permission: ${requiredPerm}.`,
        });
      }

      if (!adminDb) {
        return res.json({
          success: true,
          fallback: true,
          transitionedTo: toStage,
          message: `(Local mode) Simulated transition to stage '${toStage}'.`,
          outputClassification: decisionResult.outputClassification,
        });
      }

      try {
        await adminDb.runTransaction(async (transaction: any) => {
          const docRef = adminDb.collection("workflows").doc(id);
          const doc = await transaction.get(docRef);

          if (!doc.exists) {
            throw new Error("NOT_FOUND:Workflow not found");
          }

          const data = doc.data();
          if (data?.tenantId !== tenantId) {
            throw new Error("FORBIDDEN:Cross-tenant access denied");
          }

          const currentIndex = WORKFLOW_STAGES.indexOf(data?.currentStage as WorkflowStage);
          const targetIndex = WORKFLOW_STAGES.indexOf(toStage as WorkflowStage);

          if (targetIndex <= currentIndex) {
            throw new Error(
              `BAD_REQUEST:Cannot regress workflow. Current stage: '${data?.currentStage}', Requested: '${toStage}'.`
            );
          }

          const historyEntry = {
            stage: toStage,
            enteredAt: new Date().toISOString(),
            by: userContext?.userId,
            byRole: userContext?.userRole,
            notes: notes || "",
          };

          const auditEntry: Omit<AuditLog, "hash"> = {
            id: `log-${Date.now()}`,
            timestamp: new Date().toISOString(),
            userId: userContext?.userId || "unknown",
            userRole: userContext?.userRole || "Operator",
            tenantId,
            action: "WORKFLOW_TRANSITION",
            details: `Workflow ${id} for batch '${data?.batchId}' advanced from '${data?.currentStage}' to '${toStage}' by ${userContext?.userRole}. Validated by decisionEngine (Tier 1).`,
            category: "DATA_CHANGE",
          };
          const hashedAudit = { ...auditEntry, hash: createAuditHash(auditEntry) };

          transaction.update(docRef, {
            currentStage: toStage,
            status: toStage === "Metrc Synced" ? "completed" : "active",
            stageHistory: [...(data?.stageHistory || []), historyEntry],
            updatedAt: new Date().toISOString(),
          });

          const auditRef = adminDb.collection("audit_logs").doc(auditEntry.id);
          transaction.set(auditRef, hashedAudit);
        });

        res.json({
          success: true,
          transitionedTo: toStage,
          outputClassification: decisionResult.outputClassification,
        });
      } catch (err: any) {
        console.error("Workflow transition error:", err);
        if (err.message.startsWith("NOT_FOUND:")) return res.status(404).json({ error: err.message.split(":")[1] });
        if (err.message.startsWith("FORBIDDEN:")) return res.status(403).json({ error: err.message.split(":")[1] });
        if (err.message.startsWith("BAD_REQUEST:")) return res.status(400).json({ error: err.message.split(":")[1] });
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  return router;
}
