/**
 * tests/validation/external-standards.spec.ts
 *
 * VALIDATION, not unit testing.
 *
 * The unit tests assert the code equals itself ("DECARB_CONVERSION_FACTOR is
 * 0.877"). That cannot catch a wrong constant. These tests instead compare the
 * implementation against sources that exist OUTSIDE this repository:
 *
 *   A. The statutory definition of total THC
 *      - 2018 Farm Bill / 7 CFR 990: hemp = "not more than 0.3 percent" total
 *        delta-9 THC on a dry weight basis
 *      - USDA AMS Laboratory Testing Guidelines: the total is "derived from the
 *        sum of the THC and THCA content", post-decarboxylation
 *      - the 0.877 factor as the THCA->THC molar-mass ratio (CO2 loss)
 *
 *   B. Published THCA-A decarboxylation kinetics
 *      - Wang et al. (2016), Cannabis Cannabinoid Res 1(1): first-order rate
 *        constants k(80 degC)=1.8e-4, k(95 degC)=6.6e-4, k(110 degC)=1.83e-3 s^-1
 *      - Perrotin-Brunel et al. (2011), J Mol Struct 987:67-73: Ea = 84.8 kJ/mol
 *      - Moreno et al. (2020), Ind Eng Chem Res 59(46): first-order, 80-160 degC
 *
 *   C. COA text layouts that must parse to known ground-truth values.
 *
 * A failure here is a FINDING. Where the external data disagrees with the
 * implementation, the implementation is wrong or must be labelled unvalidated.
 */

import { test, expect } from "@playwright/test";
import {
  calculateTotalThc,
  determineComplianceStatus,
  calculateDecarbKinetics,
  DECARB_CONVERSION_FACTOR,
} from "../../src/lib/complianceEngine.js";
import { parseCOAWithRegex } from "../../src/lib/coaParser.js";

// ─────────────────────────────────────────────────────────────────────────────
// A. The statutory total-THC definition
// ─────────────────────────────────────────────────────────────────────────────

// IUPAC standard atomic weights (abridged). THCA is C22H30O4; decarboxylation
// removes CO2 to give delta-9-THC, C21H30O2.
const C = 12.011;
const H = 1.008;
const O = 15.999;
const THCA_MW = 22 * C + 30 * H + 4 * O; // 358.48 g/mol
const THC_MW = 21 * C + 30 * H + 2 * O; // 314.47 g/mol

test.describe("A. Statutory definition (2018 Farm Bill / USDA AMS)", () => {
  test("the 0.877 factor equals the THCA->THC molar-mass ratio", () => {
    expect(THCA_MW).toBeCloseTo(358.48, 1);
    expect(THC_MW).toBeCloseTo(314.47, 1);
    const molarRatio = THC_MW / THCA_MW;
    expect(
      Math.abs(DECARB_CONVERSION_FACTOR - molarRatio),
      `factor ${DECARB_CONVERSION_FACTOR} vs molar ratio ${molarRatio.toFixed(5)}`,
    ).toBeLessThan(0.001);
  });

  test("total THC is d9 + 0.877 * THCA", () => {
    const cases = [
      { thca: 0.31, d9: 0.02 }, // the HempForge Swarm fixture
      { thca: 0.2, d9: 0.02 },
      { thca: 0.0, d9: 0.3 },
      { thca: 1.0, d9: 0.5 },
      { thca: 12.4, d9: 0.05 },
    ];
    for (const { thca, d9 } of cases) {
      const expected = parseFloat((d9 + 0.877 * thca).toFixed(3));
      expect(
        calculateTotalThc(thca, d9),
        `thca=${thca}, d9=${d9}`,
      ).toBeCloseTo(expected, 3);
    }
  });

  test("the 0.3% limit is inclusive — 'not more than 0.3 percent'", () => {
    expect(determineComplianceStatus(0.299)).not.toBe("Non-Compliant");
    expect(determineComplianceStatus(0.3)).not.toBe("Non-Compliant");
    expect(determineComplianceStatus(0.301)).toBe("Non-Compliant");
  });

  test("a batch above the limit must not be rounded INTO compliance", () => {
    // 0.3421% THCA alone is 0.30002% total THC — still above the 0.3% limit.
    const raw = 0.877 * 0.3421;
    expect(raw).toBeGreaterThan(0.3);
    const rounded = calculateTotalThc(0.3421, 0);
    const status = determineComplianceStatus(rounded);
    expect(
      status,
      `raw total ${raw.toFixed(6)} was rounded to ${rounded} -> '${status}'`,
    ).toBe("Non-Compliant");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Published THCA-A decarboxylation kinetics
// ─────────────────────────────────────────────────────────────────────────────

// Wang et al. 2016, Table 2 — THCA-A first-order rate constants in cannabis
// extracts (converted from the paper's k x 10^3 s^-1 column).
const WANG_2016 = [
  { tempC: 80, k: 1.8e-4 },
  { tempC: 95, k: 6.6e-4 },
  { tempC: 110, k: 1.83e-3 },
];
const PUBLISHED_EA_KJ = { min: 84.8, max: 88.0 }; // Perrotin-Brunel 2011 / Wang 2016

// The engine's rate constant is per-MINUTE (callers pass minutes; see
// agentEngine.ts `durationMin` and gemini.ts "for N minutes").
function engineKPerSecond(tempC: number): number {
  const r = calculateDecarbKinetics({ thca: 100, d9thc: 0, temp: tempC, duration: 1 });
  const kPerMinute = -Math.log(r.finalThca / 100) / 1;
  return kPerMinute / 60;
}

function engineActivationEnergyKj(t1: number, t2: number): number {
  const R = 8.314e-3; // kJ/mol/K
  const k1 = engineKPerSecond(t1);
  const k2 = engineKPerSecond(t2);
  return (R * Math.log(k2 / k1)) / (1 / (t1 + 273.15) - 1 / (t2 + 273.15));
}

test.describe("B. Published THCA-A decarboxylation kinetics", () => {
  for (const { tempC, k } of WANG_2016) {
    test(`k(${tempC} degC) within 3x of Wang et al. 2016 (${k.toExponential(1)} s^-1)`, () => {
      const got = engineKPerSecond(tempC);
      const ratio = got / k;
      expect(
        ratio,
        `engine ${got.toExponential(2)} s^-1 vs published ${k.toExponential(2)} s^-1 — off by ${ratio.toFixed(2)}x`,
      ).toBeGreaterThan(1 / 3);
      expect(ratio).toBeLessThan(3);
    });
  }

  test("activation energy is within the published range (84.8-88 kJ/mol)", () => {
    const ea = engineActivationEnergyKj(80, 110);
    expect(
      ea,
      `engine Ea ${ea.toFixed(1)} kJ/mol vs published ${PUBLISHED_EA_KJ.min}-${PUBLISHED_EA_KJ.max}`,
    ).toBeGreaterThan(PUBLISHED_EA_KJ.min * 0.9);
    expect(ea).toBeLessThan(PUBLISHED_EA_KJ.max * 1.1);
  });

  test("THCA mass balance is conserved (no matter created or destroyed)", () => {
    const r = calculateDecarbKinetics({ thca: 10, d9thc: 0.05, temp: 120, duration: 60 });
    // Every THCA molecule lost becomes 0.877 units of THC.
    const lost = 10 - r.finalThca;
    const gained = r.finalD9Thc - 0.05;
    expect(gained, `lost ${lost.toFixed(3)} THCA -> gained ${gained.toFixed(3)} THC`).toBeCloseTo(
      lost * 0.877,
      3,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. COA parsing against known ground truth
// ─────────────────────────────────────────────────────────────────────────────

test.describe("C. COA parsing", () => {
  test("reads explicit delta-9 THC and THCa rows", () => {
    const text = [
      "Certificate of Analysis",
      "Sample Name: Cherry Wine",
      "Batch ID: HF-2024-0917",
      "Delta-9 THC: 0.05 %",
      "THCa: 0.31 %",
      "CBD: 12.40 %",
    ].join("\n");
    const r = parseCOAWithRegex(text, "unknown");
    expect(r.thca, "THCa row").toBeCloseTo(0.31, 2);
    expect(r.d9thc, "delta-9 row").toBeCloseTo(0.05, 2);
    expect(r.totalThc).toBeCloseTo(0.322, 2);
    expect(r.batchId).toBe("HF-2024-0917");
  });

  test("does not report a 'Total THC' row as delta-9 THC", () => {
    // Plenty of real COAs label the summed value simply "Total THC". That is
    // NOT delta-9 THC, and treating it as such corrupts the statutory sum.
    const text = ["Certificate of Analysis", "Total THC: 0.32 %", "CBD: 12.40 %"].join("\n");
    const r = parseCOAWithRegex(text, "unknown");
    expect(
      r.d9thc,
      `parsed delta-9 THC = ${r.d9thc} from a 'Total THC' row`,
    ).not.toBeCloseTo(0.32, 2);
  });

  test("does not double-count when both THCa and THCA appear", () => {
    const text = ["Certificate of Analysis", "THCA: 0.31 %", "THCa: 0.31 %"].join("\n");
    const r = parseCOAWithRegex(text, "unknown");
    expect(r.thca).toBeCloseTo(0.31, 2);
  });
});
