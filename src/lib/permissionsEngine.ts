/**
 * permissionsEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Enterprise Role-Based Access Control (RBAC) & Attribute-Based Access Control
 * (ABAC) engine for HempForge.
 *
 * Defines canonical permission keys, maps them to user roles, and exposes
 * Express middleware and a frontend helper to gate functionality.
 *
 * GxP Compliance Note: All access decisions are logged at the call-site
 * to maintain the ALCOA++ principle of Attribution.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Permission Definitions ──────────────────────────────────────────────────

export type Permission =
  // COA / Batch lifecycle
  | "SIGN_COA"
  | "INGEST_COA"
  | "VIEW_COAS"
  | "DELETE_COA"

  // Compliance & Ledger
  | "RUN_LEDGER_AUDIT"
  | "CALCULATE_COMPLIANCE"
  | "RUN_CSA_VALIDATION"

  // LIMS / Lab
  | "TOGGLE_LIMS_HANDSHAKE"
  | "VIEW_LABS"

  // Metrc / Seed-to-Sale
  | "VIEW_METRC_PACKAGES"
  | "SYNC_METRC_PACKAGE"

  // Workflow
  | "VIEW_WORKFLOWS"
  | "CREATE_WORKFLOW"
  | "TRANSITION_WORKFLOW"
  | "MANAGE_WORKFLOWS"

  // Reports & ROI
  | "GENERATE_REPORT"
  | "VIEW_REPORTS"
  | "VIEW_ROI"

  // Literature & Research
  | "SEARCH_LITERATURE"
  | "INGEST_LITERATURE"
  | "RUN_PRODUCTION_PIPELINE"

  // AI Agents
  | "USE_GEMINI_CHAT"
  | "USE_OLLAMA_INFERENCE"
  | "GENERATE_PAPER"

  // Settings & Admin
  | "VIEW_SETTINGS"
  | "MANAGE_SCHEDULER"
  | "VIEW_SECURITY_POLICY"
  | "ADMIN_PANEL";

// ─── Role Definitions ────────────────────────────────────────────────────────

export type HempForgeRole =
  | "Quality Auditor"
  | "Lab Admin"
  | "Operator"
  | "Guest"
  | "System Admin"
  | "Admin";

// ─── Role → Permission Map ───────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<HempForgeRole, ReadonlySet<Permission>> = {
  "System Admin": new Set<Permission>([
    "SIGN_COA", "INGEST_COA", "VIEW_COAS", "DELETE_COA",
    "RUN_LEDGER_AUDIT", "CALCULATE_COMPLIANCE", "RUN_CSA_VALIDATION",
    "TOGGLE_LIMS_HANDSHAKE", "VIEW_LABS",
    "VIEW_METRC_PACKAGES", "SYNC_METRC_PACKAGE",
    "VIEW_WORKFLOWS", "CREATE_WORKFLOW", "TRANSITION_WORKFLOW", "MANAGE_WORKFLOWS",
    "GENERATE_REPORT", "VIEW_REPORTS", "VIEW_ROI",
    "SEARCH_LITERATURE", "INGEST_LITERATURE", "RUN_PRODUCTION_PIPELINE",
    "USE_GEMINI_CHAT", "USE_OLLAMA_INFERENCE", "GENERATE_PAPER",
    "VIEW_SETTINGS", "MANAGE_SCHEDULER", "VIEW_SECURITY_POLICY", "ADMIN_PANEL",
  ]),

  "Admin": new Set<Permission>([
    "SIGN_COA", "INGEST_COA", "VIEW_COAS", "DELETE_COA",
    "RUN_LEDGER_AUDIT", "CALCULATE_COMPLIANCE", "RUN_CSA_VALIDATION",
    "TOGGLE_LIMS_HANDSHAKE", "VIEW_LABS",
    "VIEW_METRC_PACKAGES", "SYNC_METRC_PACKAGE",
    "VIEW_WORKFLOWS", "CREATE_WORKFLOW", "TRANSITION_WORKFLOW", "MANAGE_WORKFLOWS",
    "GENERATE_REPORT", "VIEW_REPORTS", "VIEW_ROI",
    "SEARCH_LITERATURE", "INGEST_LITERATURE", "RUN_PRODUCTION_PIPELINE",
    "USE_GEMINI_CHAT", "USE_OLLAMA_INFERENCE", "GENERATE_PAPER",
    "VIEW_SETTINGS", "MANAGE_SCHEDULER", "VIEW_SECURITY_POLICY", "ADMIN_PANEL",
  ]),

  "Quality Auditor": new Set<Permission>([
    "SIGN_COA", "INGEST_COA", "VIEW_COAS",
    "RUN_LEDGER_AUDIT", "CALCULATE_COMPLIANCE", "RUN_CSA_VALIDATION",
    "VIEW_LABS",
    "VIEW_METRC_PACKAGES", "SYNC_METRC_PACKAGE",
    "VIEW_WORKFLOWS", "TRANSITION_WORKFLOW", "MANAGE_WORKFLOWS",
    "GENERATE_REPORT", "VIEW_REPORTS", "VIEW_ROI",
    "SEARCH_LITERATURE", "INGEST_LITERATURE", "RUN_PRODUCTION_PIPELINE",
    "USE_GEMINI_CHAT", "USE_OLLAMA_INFERENCE", "GENERATE_PAPER",
    "VIEW_SETTINGS", "VIEW_SECURITY_POLICY",
  ]),

  "Lab Admin": new Set<Permission>([
    "INGEST_COA", "VIEW_COAS",
    "CALCULATE_COMPLIANCE",
    "TOGGLE_LIMS_HANDSHAKE", "VIEW_LABS",
    "VIEW_METRC_PACKAGES",
    "VIEW_WORKFLOWS", "CREATE_WORKFLOW", "TRANSITION_WORKFLOW",
    "VIEW_REPORTS", "VIEW_ROI",
    "SEARCH_LITERATURE", "INGEST_LITERATURE", "RUN_PRODUCTION_PIPELINE",
    "USE_GEMINI_CHAT", "USE_OLLAMA_INFERENCE", "GENERATE_PAPER",
    "VIEW_SETTINGS", "MANAGE_SCHEDULER",
  ]),

  "Operator": new Set<Permission>([
    "INGEST_COA", "VIEW_COAS",
    "CALCULATE_COMPLIANCE",
    "VIEW_LABS",
    "VIEW_METRC_PACKAGES",
    "VIEW_WORKFLOWS", "CREATE_WORKFLOW",
    "VIEW_REPORTS",
    "SEARCH_LITERATURE",
    "USE_GEMINI_CHAT",
    "VIEW_SETTINGS",
  ]),

  "Guest": new Set<Permission>([
    "VIEW_COAS",
    "VIEW_LABS",
    "VIEW_WORKFLOWS",
  ]),
};

// ─── Core Permission Check ───────────────────────────────────────────────────

/**
 * Check whether a given role holds a specific permission.
 * This is pure and safe to use on the frontend too.
 */
export function hasPermission(role: string | undefined, permission: Permission): boolean {
  if (!role) return false;
  const set = ROLE_PERMISSIONS[role as HempForgeRole];
  if (!set) return false;
  return set.has(permission);
}

/**
 * Return the full set of permissions for a given role.
 */
export function getPermissionsForRole(role: string): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role as HempForgeRole] ?? new Set();
}

/**
 * Return all defined roles.
 */
export function getAllRoles(): HempForgeRole[] {
  return Object.keys(ROLE_PERMISSIONS) as HempForgeRole[];
}

// ─── Express Middleware Factory ──────────────────────────────────────────────

/**
 * Express middleware factory that gates a route to roles holding a required permission.
 *
 * Usage in server.ts:
 *   app.post("/api/reports/generate", authMiddleware, requirePermission("GENERATE_REPORT"), handler);
 */
export function requirePermission(permission: Permission) {
  return (req: any, res: any, next: any) => {
    const role: string | undefined = req.authContext?.userRole;

    if (!hasPermission(role, permission)) {
      return res.status(403).json({
        error: "Forbidden",
        details: `Your current role ('${role || "unknown"}') does not have permission to perform this action. Required permission: ${permission}.`,
        requiredPermission: permission,
        yourRole: role || "unknown",
      });
    }

    return next();
  };
}

// ─── Permission Summary (for audit / policy endpoint) ───────────────────────

/**
 * Serialize the current RBAC configuration for display in policy APIs or dashboards.
 */
export function exportPermissionsManifest(): Record<string, string[]> {
  const manifest: Record<string, string[]> = {};
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    manifest[role] = [...perms].sort();
  }
  return manifest;
}
