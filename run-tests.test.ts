import crypto from "crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createAuditHash,
  signCoa,
  checkGeminiRateLimit,
  checkLitRateLimit,
  isValidGeminiKey,
  deriveTenantAndRole
} from "./src/services/backendServices";

import {
  calculateCompliance,
  calculateDecarbKinetics,
  calculateTotalThc,
  determineComplianceStatus,
  evaluateCOACompliance,
  DECARB_CONVERSION_FACTOR,
  NC_TOTAL_THC_THRESHOLD,
  NC_AT_RISK_THRESHOLD,
  FDA_SERVING_CAP_MG,
} from "./src/lib/complianceEngine";

import {
  createLiveAIProvenance,
  createSimulatedProvenance,
  createFormulaProvenance,
  createHeuristicProvenance,
  labelDemoData,
} from "./src/lib/provenanceEngine";

import {
  computeAuditHash,
  computeLegacyAuditHash,
  createChainedAuditEntry,
  verifyAuditChain,
  initializeChainState,
  getChainState,
} from "./src/lib/auditEngine";

import {
  parseCOAWithRegex,
  extractStrain,
  extractThca,
  extractD9Thc,
  extractBatchId,
} from "./src/lib/coaParser";

// These functions are now imported from complianceEngine.ts
// Tests below verify the extracted module matches the original behavior

describe("1. Audit Hash Integrity Verification (ALCOA++)", () => {
  const baseLog = {
    id: "log-12345",
    timestamp: "2026-06-27T23:00:00Z",
    userId: "user-123",
    userRole: "Quality Auditor",
    tenantId: "Global-Hemp-Wilson",
    action: "CSA_AGENT_VALIDATED",
    details: "FDA validation test run.",
    category: "AI_INFERENCE" as const
  };

  it("should be deterministic for identical content", () => {
    expect(createAuditHash(baseLog)).toBe(createAuditHash(baseLog));
  });

  it("should return a valid sha256 hex digest of exactly 64 characters", () => {
    const hash = createAuditHash(baseLog);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should change when details or payload is tampered with", () => {
    const changed = { ...baseLog, details: "Tampered details" };
    expect(createAuditHash(baseLog)).not.toBe(createAuditHash(changed));
  });

  it("should change when the action is modified", () => {
    const changed = { ...baseLog, action: "OTHER_ACTION" };
    expect(createAuditHash(baseLog)).not.toBe(createAuditHash(changed));
  });
});

describe("2. GxP Cryptographic COA Signatures", () => {
  beforeEach(() => {
    process.env.COA_SIGNING_SECRET = "test-coa-signing-secret-key-123";
  });

  afterEach(() => {
    delete process.env.COA_SIGNING_SECRET;
  });

  it("should generate deterministic signatures for identical payloads", () => {
    const coa = {
      id: "coa-100",
      batchId: "B-8803",
      strain: "Lifter CBD",
      totalThc: 0.185,
      status: "Compliant"
    };
    expect(signCoa(coa)).toBe(signCoa(coa));
  });

  it("should change when potency or critical payload parameters change", () => {
    const coa1 = { id: "coa-100", batchId: "B-8803", strain: "Lifter CBD", totalThc: 0.185, status: "Compliant" };
    const coa2 = { ...coa1, totalThc: 0.312 }; // Exceeds threshold
    expect(signCoa(coa1)).not.toBe(signCoa(coa2));
  });
});

describe("3. Multi-Tenant Role & Scope Derivation Engine", () => {
  it("should default Gmail accounts to the global shared tenant", () => {
    const context = deriveTenantAndRole({ email: "operator@gmail.com" });
    expect(context.tenantId).toBe("Global-Hemp-Wilson");
  });

  it("should default registered admin email to global shared tenant", () => {
    const originalAdminEmail = process.env.ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = "admin@hempforge.lan";
    const context = deriveTenantAndRole({ email: "admin@hempforge.lan" });
    expect(context.tenantId).toBe("Global-Hemp-Wilson");
    if (originalAdminEmail) {
      process.env.ADMIN_EMAIL = originalAdminEmail;
    } else {
      delete process.env.ADMIN_EMAIL;
    }
  });

  it("should derive isolated custom tenant ID for corporate/private domains", () => {
    const context = deriveTenantAndRole({ email: "analyst@carolinahemplabs.com" });
    expect(context.tenantId).toBe("Tenant-carolinahemplabs-com");
  });

  it("should correctly identify Quality Auditor roles based on email keywords", () => {
    const context = deriveTenantAndRole({ email: "gxp-auditor-9@carolinahemplabs.com" });
    expect(context.userRole).toBe("Quality Auditor");
  });

  it("should default other private accounts to Lab Admin", () => {
    const context = deriveTenantAndRole({ email: "lab-tech@carolinahemplabs.com" });
    expect(context.userRole).toBe("Lab Admin");
  });

  it("should respect existing explicit claims if available in the token", () => {
    const context = deriveTenantAndRole({
      email: "guest@domain.com",
      tenantId: "Custom-Tenant-Special",
      role: "Guest Observer"
    });
    expect(context.tenantId).toBe("Custom-Tenant-Special");
    expect(context.userRole).toBe("Guest Observer");
  });
});

describe("4. Gemini API Key Structural Validator", () => {
  it("should fail validation for empty or unconfigured placeholders", () => {
    expect(isValidGeminiKey(undefined)).toBe(false);
    expect(isValidGeminiKey("")).toBe(false);
    expect(isValidGeminiKey("MY_GEMINI_API_KEY")).toBe(false);
  });

  it("should pass validation for structurally valid Gemini key signatures", () => {
    expect(isValidGeminiKey("AIzaSyD_some-secret-key-signature-here-12345")).toBe(true);
  });
});

describe("5. Deterministic API Rate Limiter (Mocked Timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow up to 10 requests within a single rate limiting window", () => {
    const uid = "auditor-test-uid";
    let allowedCount = 0;

    for (let i = 0; i < 10; i++) {
      const res = checkGeminiRateLimit(uid);
      if (res.allowed) allowedCount++;
    }

    expect(allowedCount).toBe(10);
  });

  it("should block request 11 within the exact same window", () => {
    const uid = "auditor-test-uid";

    for (let i = 0; i < 10; i++) {
      checkGeminiRateLimit(uid);
    }

    const res = checkGeminiRateLimit(uid);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
  });

  it("should restore rate limits after window has elapsed", () => {
    const uid = "auditor-test-uid";

    for (let i = 0; i < 11; i++) {
      checkGeminiRateLimit(uid);
    }

    // Advance 61 seconds (Window is 60s)
    vi.advanceTimersByTime(61 * 1000);

    const res = checkGeminiRateLimit(uid);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(9);
  });
});

describe("6. GxP Cannabinoid Decarboxylation Arrhenius Kinetics", () => {
  it("should calculate positive rate constant showing non-zero thermal energy", () => {
    const k = calculateDecarbKinetics({ thca: 15.0, d9thc: 0.05, temp: 120, duration: 60 });
    expect(k.rateConstant).toBeGreaterThan(0);
  });

  it("should demonstrate THCa degradation over a thermal curve", () => {
    const k = calculateDecarbKinetics({ thca: 15.0, d9thc: 0.05, temp: 120, duration: 60 });
    expect(k.finalThca).toBeLessThan(15.0);
  });

  it("should simulate activation of Delta-9-THC matching chemical stoichiometry", () => {
    const k = calculateDecarbKinetics({ thca: 15.0, d9thc: 0.05, temp: 120, duration: 60 });
    expect(k.finalD9Thc).toBeGreaterThan(0.05);
  });

  it("should mark borderline levels as compliant or non-compliant correctly", () => {
    const compliant = calculateDecarbKinetics({ thca: 0.20, d9thc: 0.02, temp: 100, duration: 30 });
    expect(compliant.isCompliant).toBe(true);

    const nonCompliant = calculateDecarbKinetics({ thca: 0.35, d9thc: 0.04, temp: 120, duration: 45 });
    expect(nonCompliant.isCompliant).toBe(false);
  });

  it("should include methodology metadata for scientific validity", () => {
    const k = calculateDecarbKinetics({ thca: 15.0, d9thc: 0.05, temp: 120, duration: 60 });
    expect(k.methodology.model).toBe("Arrhenius first-order decay");
    expect(k.methodology.outputType).toBe("deterministic_formula");
    expect(k.methodology.conversionFactor).toBe(DECARB_CONVERSION_FACTOR);
  });

  it("should reject negative inputs", () => {
    expect(() => calculateDecarbKinetics({ thca: -1, d9thc: 0.05, temp: 120, duration: 60 })).toThrow();
  });
});

describe("7. Compliance Threshold Checker Engine (Module)", () => {
  it("should mark standard dry flower with low THC compliant", () => {
    const res = calculateCompliance({ thca: 0.20, d9thc: 0.02, productType: "Flower" });
    expect(res.status).toBe("Compliant");
    expect(res.calculatedTotal).toBe(0.195);
    expect(res.alerts).toHaveLength(0);
  });

  it("should trigger 'At Risk' alert for borderline levels below threshold", () => {
    const res = calculateCompliance({ thca: 0.28, d9thc: 0.04, productType: "Flower" });
    expect(res.status).toBe("At Risk");
    expect(res.calculatedTotal).toBe(0.286);
    expect(res.alerts.length).toBeGreaterThan(0);
  });

  it("should mark dry weight above 0.3% non-compliant", () => {
    const res = calculateCompliance({ thca: 0.35, d9thc: 0.03, productType: "Flower" });
    expect(res.status).toBe("Non-Compliant");
    expect(res.calculatedTotal).toBe(0.337);
  });

  it("should trigger non-compliant serving limit on infused edibles exceeding 0.4mg per serving", () => {
    const res = calculateCompliance({
      thca: 0.05,
      d9thc: 0.01,
      productType: "Infused-Edible",
      cumulativeThcMg: 0.45
    });
    expect(res.status).toBe("Non-Compliant");
    expect(res.alerts.some(a => a.includes("serving"))).toBe(true);
  });

  it("should include processing integrity metadata", () => {
    const res = calculateCompliance({ thca: 0.20, d9thc: 0.02, productType: "Flower" });
    expect(res.processingIntegrity).toBeDefined();
    expect(res.processingIntegrity.formula).toContain("0.877");
    expect(res.processingIntegrity.governingAuthority).toContain("NC Dept");
    expect(res.processingIntegrity.computedAt).toBeTruthy();
    expect(res.processingIntegrity.thresholds.nonCompliant).toContain("0.3");
  });

  it("should handle exact boundary value 0.3% as At Risk (strictly >0.3 is Non-Compliant)", () => {
    // 0.3% exactly falls in At Risk band: >=0.25 and <=0.3
    const atExactLimit = calculateCompliance({ totalThc: 0.3 });
    expect(atExactLimit.status).toBe("At Risk"); // >=0.25 and <=0.3

    const justOver = calculateCompliance({ totalThc: 0.301 });
    expect(justOver.status).toBe("Non-Compliant");
  });

  it("should handle zero values correctly", () => {
    const res = calculateCompliance({ thca: 0, d9thc: 0, productType: "Flower" });
    expect(res.status).toBe("Compliant");
    expect(res.calculatedTotal).toBe(0);
  });

  it("should reject negative THCa values", () => {
    expect(() => calculateTotalThc(-0.1, 0.02)).toThrow();
  });

  it("should reject NaN values", () => {
    expect(() => calculateTotalThc(NaN, 0.02)).toThrow();
  });
});

describe("8. Live Integration Endpoints Checks", () => {
  const API_ROOT = process.env.TEST_API_ROOT || "http://localhost:3000";
  const RUN_LIVE = process.env.RUN_LIVE_INTEGRATION === "true";

  const maybeIt = RUN_LIVE ? it : it.skip;

  maybeIt("GET /api/health should return a healthy public report", async () => {
    const res = await fetch(`${API_ROOT}/api/health`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.timestamp).toBeDefined();
  });

  maybeIt("GET /api/users/profile should reject with 401 Unauthorized when missing header", async () => {
    const res = await fetch(`${API_ROOT}/api/users/profile`);
    expect(res.status).toBe(401);
  });

  maybeIt("POST /api/gemini/chat should reject with 401 Unauthorized when missing header", async () => {
    const res = await fetch(`${API_ROOT}/api/gemini/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello Compliance Agent" })
    });
    expect(res.status).toBe(401);
  });

  maybeIt("GET /api/coas should reject with 401 when unauthenticated", async () => {
    const res = await fetch(`${API_ROOT}/api/coas`);
    expect(res.status).toBe(401);
  });
});

// ─── NEW AUDIT CRITERIA TESTS ─────────────────────────────────────────────────

describe("9. Provenance & Truth Labeling (Criterion 1, 2, 3, 8)", () => {
  it("should create live AI provenance with correct classification", () => {
    const envelope = createLiveAIProvenance(
      { text: "Sample response", agentType: "Chemistry" },
      {
        model: "gemini-2.5-flash",
        inputs: { prompt: "test" },
        steps: ["inference"],
        userId: "user-1",
        userRole: "Lab Admin",
        tenantId: "Tenant-A",
      }
    );

    expect(envelope.outputClassification).toBe("live-ai-inference");
    expect(envelope.scientificClassification).toBe("ai-generated-inference");
    expect(envelope.provenance.source.identity).toBe("gemini-2.5-flash");
    expect(envelope.provenance.verificationStatus).toBe("ai-generated");
    expect(envelope.disclaimers.length).toBeGreaterThan(0);
    expect(envelope.provenance.triggeredBy.tenantId).toBe("Tenant-A");
  });

  it("should create simulated provenance with clear warnings", () => {
    const envelope = createSimulatedProvenance(
      { text: "Fallback content" },
      {
        reason: "GEMINI_API_KEY not configured",
        fallbackMethod: "keyword-matching",
        inputs: { message: "test" },
        userId: "user-1",
        userRole: "Operator",
        tenantId: "Tenant-A",
      }
    );

    expect(envelope.outputClassification).toBe("simulated");
    expect(envelope.scientificClassification).toBe("speculative-hypothesis");
    expect(envelope.provenance.verificationStatus).toBe("simulated");
    expect(envelope.disclaimers.some(d => d.includes("SIMULATED"))).toBe(true);
    expect(envelope.disclaimers.some(d => d.includes("MUST NOT"))).toBe(true);
  });

  it("should create formula provenance with verified status", () => {
    const envelope = createFormulaProvenance(
      { totalThc: 0.286, status: "At Risk" },
      {
        formula: "Total THC = (THCa × 0.877) + Δ9-THC",
        inputs: { thca: 0.28, d9thc: 0.04 },
        userId: "user-1",
        userRole: "Lab Admin",
        tenantId: "Tenant-A",
      }
    );

    expect(envelope.outputClassification).toBe("deterministic-formula");
    expect(envelope.scientificClassification).toBe("deterministic-formula");
    expect(envelope.provenance.verificationStatus).toBe("verified");
  });

  it("should create heuristic provenance with unverified status", () => {
    const envelope = createHeuristicProvenance(
      { text: "Pattern matched response" },
      {
        method: "keyword-signal-scoring",
        inputs: { query: "decarb temp" },
        userId: "user-1",
        userRole: "Operator",
        tenantId: "Tenant-A",
      }
    );

    expect(envelope.outputClassification).toBe("heuristic-fallback");
    expect(envelope.provenance.verificationStatus).toBe("unverified");
  });

  it("should label demo data with demo-only classification", () => {
    const envelope = labelDemoData(
      { productName: "Test Product", batchNumber: "BATCH-99" },
      "local-db-fallback.json seed data"
    );

    expect(envelope.outputClassification).toBe("demo-only");
    expect(envelope.provenance.verificationStatus).toBe("simulated");
    expect(envelope.disclaimers.some(d => d.includes("DEMO DATA"))).toBe(true);
  });

  it("should preserve provenance timestamp and triggeredBy context", () => {
    const before = new Date().toISOString();
    const envelope = createLiveAIProvenance(
      { result: "test" },
      {
        model: "test-model",
        inputs: {},
        steps: [],
        userId: "user-42",
        userRole: "Quality Auditor",
        tenantId: "Tenant-X",
      }
    );
    const after = new Date().toISOString();

    expect(envelope.provenance.timestamp >= before).toBe(true);
    expect(envelope.provenance.timestamp <= after).toBe(true);
    expect(envelope.provenance.triggeredBy.userId).toBe("user-42");
    expect(envelope.provenance.triggeredBy.userRole).toBe("Quality Auditor");
    expect(envelope.provenance.triggeredBy.tenantId).toBe("Tenant-X");
  });
});

describe("10. Audit Chain Integrity (Criterion 4 - ALCOA+ Tamper Evidence)", () => {
  beforeEach(() => {
    initializeChainState("test-tenant");
  });

  it("should create chain-linked audit entries with genesis hash for first entry", () => {
    const entry = createChainedAuditEntry({
      userId: "user-1",
      userRole: "Lab Admin",
      tenantId: "test-tenant",
      action: "TEST_ACTION",
      details: "Test details",
      category: "DATA_CHANGE",
    });

    expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.previousHash).toBe("0000000000000000000000000000000000000000000000000000000000000000");
    expect(entry.sequenceNumber).toBe(1);
  });

  it("should link subsequent entries to the previous hash", () => {
    const entry1 = createChainedAuditEntry({
      userId: "user-1",
      userRole: "Lab Admin",
      tenantId: "test-tenant",
      action: "FIRST_ACTION",
      details: "First entry",
      category: "DATA_CHANGE",
    });

    const entry2 = createChainedAuditEntry({
      userId: "user-1",
      userRole: "Lab Admin",
      tenantId: "test-tenant",
      action: "SECOND_ACTION",
      details: "Second entry",
      category: "DATA_CHANGE",
    });

    expect(entry2.previousHash).toBe(entry1.hash);
    expect(entry2.sequenceNumber).toBe(2);
  });

  it("should verify a valid audit chain", () => {
    const entries: any[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(createChainedAuditEntry({
        userId: "user-1",
        userRole: "Lab Admin",
        tenantId: "test-tenant",
        action: `ACTION_${i}`,
        details: `Details for entry ${i}`,
        category: "DATA_CHANGE",
      }));
    }

    const result = verifyAuditChain(entries);
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(5);
    expect(result.verifiedEntries).toBe(5);
  });

  it("should detect tampered entries in the chain", () => {
    const entries: any[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(createChainedAuditEntry({
        userId: "user-1",
        userRole: "Lab Admin",
        tenantId: "test-tenant",
        action: `ACTION_${i}`,
        details: `Details for entry ${i}`,
        category: "DATA_CHANGE",
      }));
    }

    // Tamper with entry 2
    entries[2].details = "TAMPERED DETAILS";

    const result = verifyAuditChain(entries);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it("should detect broken chain links", () => {
    const entries: any[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(createChainedAuditEntry({
        userId: "user-1",
        userRole: "Lab Admin",
        tenantId: "test-tenant",
        action: `ACTION_${i}`,
        details: `Details for entry ${i}`,
        category: "DATA_CHANGE",
      }));
    }

    // Break the chain link by modifying previousHash
    entries[3].previousHash = "0000000000000000000000000000000000000000000000000000000000000000";
    // Re-compute hash with broken link (simulates someone trying to re-hash after tampering)
    entries[3].hash = computeAuditHash(entries[3]);

    const result = verifyAuditChain(entries);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(3);
  });

  it("should compute deterministic hashes", () => {
    const entry = {
      id: "audit-123",
      sequenceNumber: 1,
      timestamp: "2026-06-29T12:00:00Z",
      userId: "user-1",
      userRole: "Lab Admin",
      tenantId: "test-tenant",
      action: "TEST",
      details: "test details",
      category: "DATA_CHANGE" as const,
      previousHash: "0000000000000000000000000000000000000000000000000000000000000000",
    };

    const hash1 = computeAuditHash(entry);
    const hash2 = computeAuditHash(entry);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should maintain separate chains per tenant (tenant isolation)", () => {
    initializeChainState("tenant-A");
    initializeChainState("tenant-B");

    const entryA = createChainedAuditEntry({
      userId: "user-A",
      userRole: "Lab Admin",
      tenantId: "tenant-A",
      action: "ACTION_A",
      details: "Tenant A action",
      category: "DATA_CHANGE",
    });

    const entryB = createChainedAuditEntry({
      userId: "user-B",
      userRole: "Lab Admin",
      tenantId: "tenant-B",
      action: "ACTION_B",
      details: "Tenant B action",
      category: "DATA_CHANGE",
    });

    // Both should be sequence 1 (independent chains)
    expect(entryA.sequenceNumber).toBe(1);
    expect(entryB.sequenceNumber).toBe(1);
    // Both link to genesis (first in their chain)
    expect(entryA.previousHash).toBe("0000000000000000000000000000000000000000000000000000000000000000");
    expect(entryB.previousHash).toBe("0000000000000000000000000000000000000000000000000000000000000000");
  });
});

describe("11. Tenant Isolation Verification (Criterion 6)", () => {
  it("should derive isolated tenants for different corporate domains", () => {
    const tenantA = deriveTenantAndRole({ email: "user@labcorp-a.com" });
    const tenantB = deriveTenantAndRole({ email: "user@labcorp-b.com" });

    expect(tenantA.tenantId).not.toBe(tenantB.tenantId);
    expect(tenantA.tenantId).toBe("Tenant-labcorp-a-com");
    expect(tenantB.tenantId).toBe("Tenant-labcorp-b-com");
  });

  it("should never allow empty tenantId", () => {
    const context = deriveTenantAndRole({ email: "test@domain.org" });
    expect(context.tenantId).toBeTruthy();
    expect(context.tenantId.length).toBeGreaterThan(0);
  });

  it("should use explicit tenantId from claims when available", () => {
    const context = deriveTenantAndRole({
      email: "user@gmail.com",
      tenantId: "Custom-Isolated-Tenant",
    });
    expect(context.tenantId).toBe("Custom-Isolated-Tenant");
  });

  it("should not accept whitespace-only tenantId from claims", () => {
    const context = deriveTenantAndRole({
      email: "user@corp.com",
      tenantId: "   ",
    });
    expect(context.tenantId).not.toBe("   ");
    expect(context.tenantId.trim().length).toBeGreaterThan(0);
  });
});

describe("12. COA Compliance Evaluation (Criterion 5 - Processing Integrity)", () => {
  it("should correctly evaluate compliant COA", () => {
    const result = evaluateCOACompliance({ thca: 0.20, d9thc: 0.02 });
    expect(result.status).toBe("Compliant");
    expect(result.totalThc).toBe(0.195);
    expect(result.recommendation).toContain("compliance window");
  });

  it("should correctly evaluate at-risk COA", () => {
    const result = evaluateCOACompliance({ thca: 0.28, d9thc: 0.04 });
    expect(result.status).toBe("At Risk");
    expect(result.totalThc).toBe(0.286);
    expect(result.recommendation).toContain("Monitor");
  });

  it("should correctly evaluate non-compliant COA", () => {
    const result = evaluateCOACompliance({ thca: 0.35, d9thc: 0.03 });
    expect(result.status).toBe("Non-Compliant");
    expect(result.totalThc).toBe(0.337);
    expect(result.recommendation).toContain("Divert");
  });

  it("should use correct conversion factor (0.877)", () => {
    // Verify: (0.342 * 0.877) + 0.001 = 0.299834 ≈ 0.3 → At Risk
    const result = evaluateCOACompliance({ thca: 0.342, d9thc: 0.001 });
    const expected = parseFloat(((0.342 * 0.877) + 0.001).toFixed(3));
    expect(result.totalThc).toBe(expected);
  });

  it("should handle precision at 0.3% boundary correctly", () => {
    // Exactly 0.3% should be "At Risk" (>= 0.25 and <= 0.3)
    const atExactLimit = calculateCompliance({ totalThc: 0.3 });
    expect(atExactLimit.status).toBe("At Risk");

    // Just above 0.3 (must exceed after toFixed(3) rounding)
    const over = calculateCompliance({ totalThc: 0.301 });
    expect(over.status).toBe("Non-Compliant");
  });
});

describe("13. Scientific Validity Classification (Criterion 8)", () => {
  it("should distinguish formula outputs from AI inferences in kinetics", () => {
    const kinetics = calculateDecarbKinetics({ thca: 15.0, d9thc: 0.05, temp: 120, duration: 60 });
    expect(kinetics.methodology.outputType).toBe("deterministic_formula");
    expect(kinetics.methodology.model).toBe("Arrhenius first-order decay");
  });

  it("should distinguish formula provenance from AI provenance", () => {
    const formulaEnv = createFormulaProvenance({ result: 0.286 }, {
      formula: "THCa * 0.877 + D9",
      inputs: { thca: 0.28, d9thc: 0.04 },
      userId: "u1", userRole: "Lab Admin", tenantId: "T1",
    });
    const aiEnv = createLiveAIProvenance({ result: "AI text" }, {
      model: "gemini-2.5-flash",
      inputs: { prompt: "test" },
      steps: ["inference"],
      userId: "u1", userRole: "Lab Admin", tenantId: "T1",
    });

    expect(formulaEnv.scientificClassification).toBe("deterministic-formula");
    expect(aiEnv.scientificClassification).toBe("ai-generated-inference");
    expect(formulaEnv.provenance.verificationStatus).toBe("verified");
    expect(aiEnv.provenance.verificationStatus).toBe("ai-generated");
  });

  it("should classify simulated outputs as speculative hypothesis", () => {
    const simEnv = createSimulatedProvenance({ content: "fake" }, {
      reason: "no API key",
      fallbackMethod: "template",
      inputs: {},
      userId: "u1", userRole: "Lab Admin", tenantId: "T1",
    });
    expect(simEnv.scientificClassification).toBe("speculative-hypothesis");
  });
});

describe("14. Legacy Audit Hash Backward Compatibility", () => {
  it("should produce same hashes as the legacy createAuditHash function", () => {
    const log = {
      id: "log-12345",
      timestamp: "2026-06-27T23:00:00Z",
      userId: "user-123",
      userRole: "Quality Auditor",
      action: "CSA_AGENT_VALIDATED",
      details: "FDA validation test run.",
      category: "AI_INFERENCE"
    };

    const legacyHash = createAuditHash(log as any);
    const newLegacyHash = computeLegacyAuditHash(log);
    expect(legacyHash).toBe(newLegacyHash);
  });
});

describe("15. Failure Honesty - Missing Dependency Handling (Criterion 10)", () => {
  it("should correctly validate Gemini key format", () => {
    expect(isValidGeminiKey(undefined)).toBe(false);
    expect(isValidGeminiKey("")).toBe(false);
    expect(isValidGeminiKey("MY_GEMINI_API_KEY")).toBe(false);
    expect(isValidGeminiKey("short")).toBe(false);
    expect(isValidGeminiKey("AIzaSyD_real-key-format-12345")).toBe(true);
  });

  it("should not silently accept placeholder keys", () => {
    expect(isValidGeminiKey("AIzaSy")).toBe(false); // too short
    expect(isValidGeminiKey("NotAIzaSy_something")).toBe(false); // wrong prefix
  });
});

describe("16. COA Parsing Accuracy (Ground-Truth Samples)", () => {
  const SAMPLE_COA_1 = `
    Certificate of Analysis
    Lab: Wilmington Analytical Chemistry Services
    Batch ID: B-9904
    Strain: Lifter CBD
    Sample Name: Lifter CBD - Lot 44
    THCa: 0.28%
    Delta-9-THC: 0.04%
    CBD: 14.2%
    CBG: 0.8%
    Date Tested: 2026-06-15
  `;

  const SAMPLE_COA_2 = `
    NC Hemp Lab Report
    Batch #: HWH-2026-001
    Cultivar: Hawaiian Haze
    THCA: 0.35
    D9-THC: 0.03
    Total Cannabinoids: 18.4%
    Status: Requires Review
  `;

  const SAMPLE_COA_MINIMAL = `
    Some random text about hemp
    thc: 0.05
    strain: Carolina Dream
  `;

  const SAMPLE_COA_EMPTY = "This document contains no parseable cannabinoid data.";

  it("should extract strain from explicit strain field", () => {
    const result = extractStrain(SAMPLE_COA_1);
    expect(result.extracted).toBe(true);
    expect(result.value).toContain("Lifter");
  });

  it("should extract strain from cultivar field", () => {
    const result = extractStrain(SAMPLE_COA_2);
    expect(result.extracted).toBe(true);
    expect(result.value).toContain("Hawaiian");
  });

  it("should extract THCa correctly", () => {
    const result = extractThca(SAMPLE_COA_1);
    expect(result.extracted).toBe(true);
    expect(result.value).toBe(0.28);
  });

  it("should extract D9-THC correctly", () => {
    const result = extractD9Thc(SAMPLE_COA_1);
    expect(result.extracted).toBe(true);
    expect(result.value).toBe(0.04);
  });

  it("should extract batch ID correctly", () => {
    const result = extractBatchId(SAMPLE_COA_1);
    expect(result.extracted).toBe(true);
    expect(result.value).toBe("B-9904");
  });

  it("should extract batch ID from alternative format", () => {
    const result = extractBatchId(SAMPLE_COA_2);
    expect(result.extracted).toBe(true);
    expect(result.value).toBe("HWH-2026-001");
  });

  it("should parse full COA with correct compliance status", () => {
    const result = parseCOAWithRegex(SAMPLE_COA_1, "B-fallback");
    expect(result.strain).toContain("Lifter");
    expect(result.thca).toBe(0.28);
    expect(result.d9thc).toBe(0.04);
    expect(result.totalThc).toBe(0.286);
    expect(result.status).toBe("At Risk");
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.extractionDetails.thcaExtracted).toBe(true);
    expect(result.extractionDetails.d9thcExtracted).toBe(true);
  });

  it("should detect non-compliant COA correctly", () => {
    const result = parseCOAWithRegex(SAMPLE_COA_2, "B-fallback");
    expect(result.thca).toBe(0.35);
    expect(result.d9thc).toBe(0.03);
    expect(result.status).toBe("Non-Compliant");
    expect(result.totalThc).toBeGreaterThan(0.3);
  });

  it("should have low confidence for minimal COA text", () => {
    const result = parseCOAWithRegex(SAMPLE_COA_MINIMAL, "B-fallback");
    expect(result.strain).toContain("Carolina Dream");
    expect(result.d9thc).toBe(0.05);
    expect(result.confidence).toBeLessThan(1.0);
  });

  it("should have zero confidence for empty/unparseable text", () => {
    const result = parseCOAWithRegex(SAMPLE_COA_EMPTY, "B-fallback");
    expect(result.confidence).toBe(0);
    expect(result.extractionDetails.strainExtracted).toBe(false);
    expect(result.extractionDetails.thcaExtracted).toBe(false);
    expect(result.extractionDetails.d9thcExtracted).toBe(false);
  });

  it("should use generated batch ID when none found in text", () => {
    const result = parseCOAWithRegex(SAMPLE_COA_EMPTY, "B-generated-123");
    expect(result.batchId).toBe("B-generated-123");
  });

  it("should not extract negative or absurd values", () => {
    const badText = "THCa: -5.0\nDelta-9-THC: 200";
    const result = parseCOAWithRegex(badText, "B-test");
    // -5 and 200 should be rejected (out of 0-100 range)
    expect(result.thca).toBe(0);
    expect(result.d9thc).toBe(0);
  });
});
