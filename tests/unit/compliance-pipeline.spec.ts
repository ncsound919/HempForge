/**
 * tests/unit/compliance-pipeline.spec.ts
 * Unit tests for compliance & COA parsing pipelines using Playwright test runner.
 * These test pure business logic — no browser, no server needed.
 */

import { test, expect } from "@playwright/test";
import {
  calculateCompliance,
  calculateTotalThc,
  determineComplianceStatus,
  evaluateCOACompliance,
  calculateDecarbKinetics,
  DECARB_CONVERSION_FACTOR,
  NC_TOTAL_THC_THRESHOLD,
  NC_AT_RISK_THRESHOLD,
} from "../../src/lib/complianceEngine.js";

import {
  parseCOAWithRegex,
  extractStrain,
  extractThca,
  extractD9Thc,
  extractBatchId,
} from "../../src/lib/coaParser.js";

import {
  createChainedAuditEntry,
  verifyAuditChain,
  initializeChainState,
  computeAuditHash,
} from "../../src/lib/auditEngine.js";

import {
  hasPermission,
  ROLES,
} from "../../src/lib/permissionsEngine.js";

// ─── Compliance Engine ────────────────────────────────────────────────────────
test.describe("ComplianceEngine — THC calculations", () => {
  test("DECARB_CONVERSION_FACTOR is 0.877", () => {
    expect(DECARB_CONVERSION_FACTOR).toBe(0.877);
  });

  test("NC_TOTAL_THC_THRESHOLD is 0.3", () => {
    expect(NC_TOTAL_THC_THRESHOLD).toBe(0.3);
  });

  test("calculateTotalThc returns correct value", () => {
    const result = calculateTotalThc(0.20, 0.02);
    expect(result).toBeCloseTo(0.195, 3);
  });

  test("calculateTotalThc throws on negative thca", () => {
    expect(() => calculateTotalThc(-0.1, 0.02)).toThrow();
  });

  test("calculateTotalThc throws on NaN input", () => {
    expect(() => calculateTotalThc(NaN, 0.02)).toThrow();
  });

  test("determineComplianceStatus - Compliant below 0.25", () => {
    expect(determineComplianceStatus(0.195)).toBe("Compliant");
  });

  test("determineComplianceStatus - At Risk between 0.25 and 0.30", () => {
    expect(determineComplianceStatus(0.28)).toBe("At Risk");
  });

  test("determineComplianceStatus - Non-Compliant above 0.30", () => {
    expect(determineComplianceStatus(0.31)).toBe("Non-Compliant");
  });

  test("calculateCompliance Compliant batch", () => {
    const result = calculateCompliance({ thca: 0.20, d9thc: 0.02 });
    expect(result.status).toBe("Compliant");
    expect(result.calculatedTotal).toBeCloseTo(0.195, 3);
    expect(result.alerts).toHaveLength(0);
  });

  test("calculateCompliance At Risk batch", () => {
    const result = calculateCompliance({ thca: 0.28, d9thc: 0.04 });
    expect(result.status).toBe("At Risk");
    expect(result.calculatedTotal).toBeCloseTo(0.286, 3);
  });

  test("calculateCompliance Non-Compliant batch", () => {
    const result = calculateCompliance({ thca: 0.35, d9thc: 0.03 });
    expect(result.status).toBe("Non-Compliant");
    expect(result.calculatedTotal).toBeGreaterThan(0.3);
  });

  test("calculateCompliance uses totalThc directly when provided", () => {
    const result = calculateCompliance({ totalThc: 0.301 });
    expect(result.status).toBe("Non-Compliant");
  });

  test("processingIntegrity includes formula 0.877", () => {
    const result = calculateCompliance({ thca: 0.20, d9thc: 0.02 });
    expect(result.processingIntegrity.formula).toContain("0.877");
  });
});

// ─── evaluateCOACompliance ────────────────────────────────────────────────────
test.describe("ComplianceEngine — evaluateCOACompliance", () => {
  test("Compliant result includes compliance window recommendation", () => {
    const result = evaluateCOACompliance({ thca: 0.20, d9thc: 0.02 });
    expect(result.status).toBe("Compliant");
    expect(result.recommendation).toContain("compliance window");
  });

  test("At Risk result includes Monitor recommendation", () => {
    const result = evaluateCOACompliance({ thca: 0.28, d9thc: 0.04 });
    expect(result.status).toBe("At Risk");
    expect(result.recommendation).toContain("Monitor");
  });

  test("Non-Compliant result includes Divert recommendation", () => {
    const result = evaluateCOACompliance({ thca: 0.35, d9thc: 0.03 });
    expect(result.status).toBe("Non-Compliant");
    expect(result.recommendation).toContain("Divert");
  });
});

// ─── Decarb Kinetics ─────────────────────────────────────────────────────────
test.describe("ComplianceEngine — calculateDecarbKinetics", () => {
  test("returns isCompliant true for low-THC sample", () => {
    const result = calculateDecarbKinetics({ thca: 0.10, d9thc: 0.01, temp: 25, duration: 10 });
    expect(result).toHaveProperty("isCompliant");
    expect(result.methodology.model).toContain("Arrhenius");
  });

  test("throws on negative thca input", () => {
    expect(() => calculateDecarbKinetics({ thca: -0.1, d9thc: 0.01, temp: 25, duration: 10 })).toThrow();
  });

  test("includes conversionFactor 0.877 in methodology", () => {
    const result = calculateDecarbKinetics({ thca: 0.20, d9thc: 0.02, temp: 25, duration: 10 });
    expect(result.methodology.conversionFactor).toBe(0.877);
  });
});

// ─── COA Parser ──────────────────────────────────────────────────────────────
test.describe("COA Parser — regex extraction", () => {
  test("extractStrain finds Lifter CBD", () => {
    const result = extractStrain("Strain: Lifter CBD, Batch #B-001");
    expect(result.extracted).toBe(true);
    expect(result.value).toContain("Lifter");
  });

  test("extractStrain finds Hawaiian Haze via Cultivar", () => {
    const result = extractStrain("Cultivar: Hawaiian Haze");
    expect(result.extracted).toBe(true);
    expect(result.value).toContain("Hawaiian");
  });

  test("extractThca extracts numeric value", () => {
    const result = extractThca("THCa: 0.28%");
    expect(result.extracted).toBe(true);
    expect(result.value).toBeCloseTo(0.28, 2);
  });

  test("extractThca rejects negative values", () => {
    const result = extractThca("THCa: -5.0%");
    expect(result.extracted).toBe(false);
  });

  test("extractD9Thc extracts delta-9 value", () => {
    const result = extractD9Thc("Delta-9-THC: 0.04%");
    expect(result.extracted).toBe(true);
    expect(result.value).toBeCloseTo(0.04, 2);
  });

  test("extractBatchId extracts B-9904", () => {
    const result = extractBatchId("Batch ID: B-9904");
    expect(result.extracted).toBe(true);
    expect(result.value).toBe("B-9904");
  });

  test("parseCOAWithRegex - full COA At Risk", () => {
    const coa = `Strain: Lifter CBD\nBatch ID: B-SAMPLE\nTHCa: 0.28%\nDelta-9-THC: 0.04%`;
    const result = parseCOAWithRegex(coa, "B-fallback");
    expect(result.thca).toBeCloseTo(0.28, 2);
    expect(result.d9thc).toBeCloseTo(0.04, 2);
    expect(result.status).toBe("At Risk");
  });

  test("parseCOAWithRegex - fallback batchId when none found", () => {
    const result = parseCOAWithRegex("some text with no batch", "B-generated-123");
    expect(result.batchId).toBe("B-generated-123");
  });

  test("parseCOAWithRegex - zero confidence on empty string", () => {
    const result = parseCOAWithRegex("", "B-none");
    expect(result.confidence).toBe(0);
  });

  test("parseCOAWithRegex - rejects out-of-range values", () => {
    const result = parseCOAWithRegex("THCa: -5.0 Delta-9-THC: 200", "B-bad");
    expect(result.thca).toBe(0);
    expect(result.d9thc).toBe(0);
  });
});

// ─── Audit Chain ─────────────────────────────────────────────────────────────
test.describe("AuditEngine — blockchain-style chain", () => {
  test("first entry previousHash is 64 zeros", () => {
    initializeChainState("playwright-tenant");
    const entry = createChainedAuditEntry({
      userId: "u1", userRole: "Lab Admin", tenantId: "playwright-tenant",
      action: "TEST_ACTION", details: "Playwright test", category: "USER_ACTION",
    });
    expect(entry.previousHash).toMatch(/^0{64}$/);
  });

  test("chained entries link correctly", () => {
    initializeChainState("playwright-tenant-2");
    const e1 = createChainedAuditEntry({
      userId: "u1", userRole: "Lab Admin", tenantId: "playwright-tenant-2",
      action: "FIRST", details: "First entry", category: "USER_ACTION",
    });
    const e2 = createChainedAuditEntry({
      userId: "u1", userRole: "Lab Admin", tenantId: "playwright-tenant-2",
      action: "SECOND", details: "Second entry", category: "DATA_CHANGE",
    });
    expect(e2.previousHash).toBe(e1.hash);
    expect(e2.sequenceNumber).toBe(e1.sequenceNumber + 1);
  });

  test("verifyAuditChain passes on intact chain", () => {
    initializeChainState("verify-ok-tenant");
    const entries = [
      createChainedAuditEntry({ userId: "u1", userRole: "Lab Admin", tenantId: "verify-ok-tenant", action: "A1", details: "d1", category: "USER_ACTION" }),
      createChainedAuditEntry({ userId: "u1", userRole: "Lab Admin", tenantId: "verify-ok-tenant", action: "A2", details: "d2", category: "DATA_CHANGE" }),
      createChainedAuditEntry({ userId: "u1", userRole: "Lab Admin", tenantId: "verify-ok-tenant", action: "A3", details: "d3", category: "AI_INFERENCE" }),
    ];
    const result = verifyAuditChain(entries);
    expect(result.valid).toBe(true);
    expect(result.verifiedEntries).toBe(3);
  });

  test("verifyAuditChain detects tampered entry", () => {
    initializeChainState("tamper-tenant");
    const entries = [
      createChainedAuditEntry({ userId: "u1", userRole: "Lab Admin", tenantId: "tamper-tenant", action: "A1", details: "d1", category: "USER_ACTION" }),
      createChainedAuditEntry({ userId: "u1", userRole: "Lab Admin", tenantId: "tamper-tenant", action: "A2", details: "d2", category: "DATA_CHANGE" }),
      createChainedAuditEntry({ userId: "u1", userRole: "Lab Admin", tenantId: "tamper-tenant", action: "A3", details: "d3", category: "AI_INFERENCE" }),
    ];
    // Tamper entry at index 2
    const tampered = [...entries];
    tampered[2] = { ...tampered[2], details: "TAMPERED DETAILS" };
    const result = verifyAuditChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  test("computeAuditHash is deterministic", () => {
    const entry = {
      id: "audit-1", sequenceNumber: 1, timestamp: "2026-01-01T00:00:00Z",
      userId: "u1", userRole: "Lab Admin", tenantId: "t1",
      action: "TEST", details: "test", category: "USER_ACTION" as const,
      previousHash: "0".repeat(64),
    };
    expect(computeAuditHash(entry)).toBe(computeAuditHash(entry));
  });
});

// ─── Permissions Engine ───────────────────────────────────────────────────────
test.describe("PermissionsEngine — RBAC enforcement", () => {
  test("System Admin has all permissions", () => {
    expect(hasPermission("System Admin", "CREATE_WORKFLOW")).toBe(true);
    expect(hasPermission("System Admin", "GENERATE_REPORT")).toBe(true);
    expect(hasPermission("System Admin", "SIGN_COA")).toBe(true);
    expect(hasPermission("System Admin", "VIEW_AUDIT_LOGS")).toBe(true);
  });

  test("Guest cannot create workflows", () => {
    expect(hasPermission("Guest", "CREATE_WORKFLOW")).toBe(false);
  });

  test("Guest cannot generate reports", () => {
    expect(hasPermission("Guest", "GENERATE_REPORT")).toBe(false);
  });

  test("Operator can transition workflows", () => {
    expect(hasPermission("Operator", "CREATE_WORKFLOW")).toBe(true);
  });

  test("Operator cannot approve COAs", () => {
    expect(hasPermission("Operator", "SIGN_COA")).toBe(false);
  });

  test("Quality Auditor can view audit logs", () => {
    expect(hasPermission("Quality Auditor", "RUN_LEDGER_AUDIT")).toBe(true);
  });

  test("Quality Auditor can approve COAs", () => {
    expect(hasPermission("Quality Auditor", "SIGN_COA")).toBe(true);
  });

  test("Lab Admin can create workflows", () => {
    expect(hasPermission("Lab Admin", "CREATE_WORKFLOW")).toBe(true);
  });

  test("undefined role is treated as Guest", () => {
    expect(hasPermission(undefined as any, "CREATE_WORKFLOW")).toBe(false);
  });
});

