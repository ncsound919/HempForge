/**
 * tests/fixtures/coa.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sample COA payloads for API tests. All fields are deterministic so tests
 * can assert on them. The compliance math is computed against the same
 * constants as production (0.877 conversion, 0.3 threshold) — values chosen
 * to land in known compliance buckets.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import crypto from "crypto";

export interface CoaFixture {
  batchId: string;
  strain: string;
  thca: number;
  d9thc: number;
  totalThc: number;
  status: "Compliant" | "At Risk" | "Non-Compliant";
  recommendation?: string;
  labName: string;
}

/** Compliant sample (THCa 0.20, D9 0.02 → total ~0.195) */
export function compliantCoa(overrides: Partial<CoaFixture> = {}): CoaFixture {
  return {
    batchId: overrides.batchId ?? `B-${crypto.randomUUID().slice(0, 8)}`,
    strain: overrides.strain ?? "Lifter CBD",
    thca: overrides.thca ?? 0.20,
    d9thc: overrides.d9thc ?? 0.02,
    totalThc: overrides.totalThc ?? 0.195,
    status: overrides.status ?? "Compliant",
    labName: overrides.labName ?? "Wilmington Analytical",
  };
}

/** At-risk sample (THCa 0.28, D9 0.04 → total ~0.286) */
export function atRiskCoa(overrides: Partial<CoaFixture> = {}): CoaFixture {
  return {
    batchId: overrides.batchId ?? `B-${crypto.randomUUID().slice(0, 8)}`,
    strain: overrides.strain ?? "Hawaiian Haze",
    thca: overrides.thca ?? 0.28,
    d9thc: overrides.d9thc ?? 0.04,
    totalThc: overrides.totalThc ?? 0.286,
    status: overrides.status ?? "At Risk",
    labName: overrides.labName ?? "Wilmington Analytical",
  };
}

/** Non-compliant sample (THCa 0.40, D9 0.05 → total ~0.401) */
export function nonCompliantCoa(overrides: Partial<CoaFixture> = {}): CoaFixture {
  return {
    batchId: overrides.batchId ?? `B-${crypto.randomUUID().slice(0, 8)}`,
    strain: overrides.strain ?? "Forbidden Sample",
    thca: overrides.thca ?? 0.40,
    d9thc: overrides.d9thc ?? 0.05,
    totalThc: overrides.totalThc ?? 0.401,
    status: overrides.status ?? "Non-Compliant",
    labName: overrides.labName ?? "Wilmington Analytical",
  };
}