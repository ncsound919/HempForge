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

// GxP Cannabinoid Decarboxylation Arrhenius kinetics
function calculateDecarbKinetics(thca: number, d9thc: number, temp: number, duration: number) {
  const conversionFactor = 0.877;
  const rateConstant = 0.00008 * Math.exp(0.058 * (temp - 25));
  const finalThca = thca * Math.exp(-rateConstant * duration);
  const convertedThc = thca - finalThca;
  const finalD9Thc = d9thc + (convertedThc * conversionFactor);
  const totalThcComputed = finalD9Thc + (finalThca * conversionFactor);
  const isCompliant = totalThcComputed <= 0.3;

  return {
    rateConstant,
    finalThca,
    finalD9Thc,
    totalThcComputed,
    isCompliant
  };
}

// Compliance evaluation threshold checker matching Express controller
function calculateComplianceStatus(input: {
  thca?: number;
  d9thc?: number;
  totalThc?: number;
  productType?: "Flower" | "Concentrate" | "Infused-Edible" | "Topical";
  cumulativeThcMg?: number;
}) {
  const calculatedTotal = input.thca !== undefined && input.d9thc !== undefined 
    ? parseFloat(((input.thca * 0.877) + input.d9thc).toFixed(3)) 
    : parseFloat((input.totalThc || 0).toFixed(3));

  let status: "Compliant" | "At Risk" | "Non-Compliant" = "Compliant";
  const alerts: string[] = [];

  if (calculatedTotal > 0.3) {
    status = "Non-Compliant";
    alerts.push(`Dry weight Total THC (${calculatedTotal}%) exceeds legal NC standard ≤0.300% (Nov 2026 Caps).`);
  } else if (calculatedTotal >= 0.25) {
    status = "At Risk";
    alerts.push(`Dry weight Total THC (${calculatedTotal}%) approaches maximum legal threshold. Risk of harvest drift or extraction spike.`);
  }

  if (input.productType === "Infused-Edible" && input.cumulativeThcMg && input.cumulativeThcMg > 0.4) {
    status = "Non-Compliant";
    alerts.push(`Cumulative THC dosage (${input.cumulativeThcMg}mg/serving) violates strict upcoming Federal cap of 0.4mg per serving.`);
  }

  return { calculatedTotal, status, alerts };
}

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
    const k = calculateDecarbKinetics(15.0, 0.05, 120, 60);
    expect(k.rateConstant).toBeGreaterThan(0);
  });

  it("should demonstrate THCa degradation over a thermal curve", () => {
    const k = calculateDecarbKinetics(15.0, 0.05, 120, 60);
    expect(k.finalThca).toBeLessThan(15.0);
  });

  it("should simulate activation of Delta-9-THC matching chemical stoichiometry", () => {
    const k = calculateDecarbKinetics(15.0, 0.05, 120, 60);
    expect(k.finalD9Thc).toBeGreaterThan(0.05);
  });

  it("should mark borderline levels as compliant or non-compliant correctly", () => {
    const compliant = calculateDecarbKinetics(0.20, 0.02, 100, 30);
    expect(compliant.isCompliant).toBe(true);

    const nonCompliant = calculateDecarbKinetics(0.35, 0.04, 120, 45);
    expect(nonCompliant.isCompliant).toBe(false);
  });
});

describe("7. Compliance Threshold Checker Engine", () => {
  it("should mark standard dry flower with low THC compliant", () => {
    const res = calculateComplianceStatus({ thca: 0.20, d9thc: 0.02, productType: "Flower" });
    expect(res.status).toBe("Compliant");
    expect(res.calculatedTotal).toBe(0.195);
    expect(res.alerts).toHaveLength(0);
  });

  it("should trigger 'At Risk' alert for borderline levels below threshold", () => {
    const res = calculateComplianceStatus({ thca: 0.28, d9thc: 0.04, productType: "Flower" });
    expect(res.status).toBe("At Risk");
    expect(res.calculatedTotal).toBe(0.286);
    expect(res.alerts.length).toBeGreaterThan(0);
  });

  it("should mark dry weight above 0.3% non-compliant", () => {
    const res = calculateComplianceStatus({ thca: 0.35, d9thc: 0.03, productType: "Flower" });
    expect(res.status).toBe("Non-Compliant");
    expect(res.calculatedTotal).toBe(0.337);
  });

  it("should trigger non-compliant serving limit on infused edibles exceeding 0.4mg per serving", () => {
    const res = calculateComplianceStatus({
      thca: 0.05,
      d9thc: 0.01,
      productType: "Infused-Edible",
      cumulativeThcMg: 0.45
    });
    expect(res.status).toBe("Non-Compliant");
    expect(res.alerts.some(a => a.includes("serving"))).toBe(true);
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
