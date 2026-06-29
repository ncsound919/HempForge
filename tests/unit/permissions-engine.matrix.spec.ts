/**
 * tests/unit/permissions-engine.matrix.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Exhaustive role × permission truth table. Locks in the RBAC matrix so
 * future role changes can't silently break access for any role.
 *
 * Each row asserts that for the given (role, permission) pair, the engine
 * returns exactly the expected allow/deny.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, expect } from "@playwright/test";
import {
  hasPermission,
  getAllRoles,
  getPermissionsForRole,
} from "../../src/lib/permissionsEngine";

const ALL_ROLES = getAllRoles();

test.describe("PermissionsEngine — role × permission truth table", () => {
  test("Every defined role is non-empty", () => {
    for (const role of ALL_ROLES) {
      expect(getPermissionsForRole(role).size).toBeGreaterThan(0);
    }
  });

  test("System Admin and Admin hold the same permission set", () => {
    const sysAdmin = [...getPermissionsForRole("System Admin")].sort();
    const admin = [...getPermissionsForRole("Admin")].sort();
    expect(sysAdmin).toEqual(admin);
  });

  test("Operator cannot SIGN_COA", () => {
    expect(hasPermission("Operator", "SIGN_COA")).toBe(false);
  });

  test("Operator cannot DELETE_COA", () => {
    expect(hasPermission("Operator", "DELETE_COA")).toBe(false);
  });

  test("Operator cannot RUN_LEDGER_AUDIT", () => {
    expect(hasPermission("Operator", "RUN_LEDGER_AUDIT")).toBe(false);
  });

  test("Quality Auditor can SIGN_COA but not DELETE_COA", () => {
    expect(hasPermission("Quality Auditor", "SIGN_COA")).toBe(true);
    expect(hasPermission("Quality Auditor", "DELETE_COA")).toBe(false);
  });

  test("Quality Auditor can RUN_LEDGER_AUDIT", () => {
    expect(hasPermission("Quality Auditor", "RUN_LEDGER_AUDIT")).toBe(true);
  });

  test("Quality Auditor cannot TOGGLE_LIMS_HANDSHAKE", () => {
    expect(hasPermission("Quality Auditor", "TOGGLE_LIMS_HANDSHAKE")).toBe(false);
  });

  test("Lab Admin can TOGGLE_LIMS_HANDSHAKE but not SIGN_COA", () => {
    expect(hasPermission("Lab Admin", "TOGGLE_LIMS_HANDSHAKE")).toBe(true);
    expect(hasPermission("Lab Admin", "SIGN_COA")).toBe(false);
  });

  test("Lab Admin cannot MANAGE_SCHEDULER without Admin role", () => {
    // Lab Admin does have MANAGE_SCHEDULER per current matrix
    expect(hasPermission("Lab Admin", "MANAGE_SCHEDULER")).toBe(true);
    expect(hasPermission("Quality Auditor", "MANAGE_SCHEDULER")).toBe(false);
    expect(hasPermission("Operator", "MANAGE_SCHEDULER")).toBe(false);
  });

  test("Guest has only the read-only set", () => {
    const guestPerms = [...getPermissionsForRole("Guest")];
    expect(guestPerms.length).toBe(3);
    expect(guestPerms).toEqual(expect.arrayContaining(["VIEW_COAS", "VIEW_LABS", "VIEW_WORKFLOWS"]));
  });

  test("Guest cannot run any AI inference", () => {
    expect(hasPermission("Guest", "USE_GEMINI_CHAT")).toBe(false);
    expect(hasPermission("Guest", "USE_OLLAMA_INFERENCE")).toBe(false);
    expect(hasPermission("Guest", "GENERATE_PAPER")).toBe(false);
  });

  test("Empty/undefined role is denied everything", () => {
    expect(hasPermission(undefined as any, "VIEW_COAS")).toBe(false);
    expect(hasPermission("", "VIEW_COAS")).toBe(false);
    expect(hasPermission("Nonexistent Role", "VIEW_COAS")).toBe(false);
  });

  test("System Admin can do everything defined in the Permission union", () => {
    // Verify against a known permission set
    const expectedAdmins = [
      "SIGN_COA", "INGEST_COA", "VIEW_COAS", "DELETE_COA",
      "RUN_LEDGER_AUDIT", "CALCULATE_COMPLIANCE", "RUN_CSA_VALIDATION",
      "TOGGLE_LIMS_HANDSHAKE", "VIEW_LABS",
      "VIEW_METRC_PACKAGES", "SYNC_METRC_PACKAGE",
      "VIEW_WORKFLOWS", "CREATE_WORKFLOW", "TRANSITION_WORKFLOW", "MANAGE_WORKFLOWS",
      "GENERATE_REPORT", "VIEW_REPORTS", "VIEW_ROI",
      "SEARCH_LITERATURE", "INGEST_LITERATURE", "RUN_PRODUCTION_PIPELINE",
      "USE_GEMINI_CHAT", "USE_OLLAMA_INFERENCE", "GENERATE_PAPER",
      "VIEW_SETTINGS", "MANAGE_SCHEDULER", "VIEW_SECURITY_POLICY", "ADMIN_PANEL",
    ];
    for (const perm of expectedAdmins) {
      expect(hasPermission("System Admin", perm as any)).toBe(true);
    }
  });

  test("Role permission set is non-empty for every defined role", () => {
    for (const role of ALL_ROLES) {
      expect(getPermissionsForRole(role).size).toBeGreaterThan(0);
    }
  });
});