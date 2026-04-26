import { describe, it, expect } from "vitest";
import {
  formatRefineryDuration,
  secondsToMinutes,
  computeMethodCostAndTime,
  getRefineryLocation,
  getRefineryMaterial,
  getRefineryMethod,
  getMaterialMaxBaseRate,
  getLocationBonusRate,
  getMethodYieldMultiplier,
  computeRefineryJob,
  refineryMethods,
  MAX_YIELD_PER_240,
  METHOD_BASELINE_SCU,
} from "../../src/refineryConfig.js";

describe("formatRefineryDuration", () => {
  it("returns '0s' for zero or negative", () => {
    expect(formatRefineryDuration(0)).toBe("0s");
    expect(formatRefineryDuration(-100)).toBe("0s");
    expect(formatRefineryDuration(NaN)).toBe("0s");
  });

  it("formats seconds only", () => {
    expect(formatRefineryDuration(45)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatRefineryDuration(90)).toBe("1m 30s");
    expect(formatRefineryDuration(600)).toBe("10m 0s");
  });

  it("formats hours and minutes", () => {
    expect(formatRefineryDuration(3600)).toBe("1h 0m");
    expect(formatRefineryDuration(5400)).toBe("1h 30m");
    expect(formatRefineryDuration(16 * 3600)).toBe("16h 0m");
  });
});

describe("secondsToMinutes", () => {
  it("converts seconds to whole minutes", () => {
    expect(secondsToMinutes(3600)).toBe(60);
    expect(secondsToMinutes(90)).toBe(2);
    expect(secondsToMinutes(600)).toBe(10);
  });

  it("returns 0 for zero or negative", () => {
    expect(secondsToMinutes(0)).toBe(0);
    expect(secondsToMinutes(-60)).toBe(0);
    expect(secondsToMinutes(NaN)).toBe(0);
  });
});

describe("getRefineryLocation", () => {
  it("finds a location by name", () => {
    const loc = getRefineryLocation("Levski");
    expect(loc.name).toBe("Levski");
    expect(loc.system).toBe("Nyx");
  });

  it("falls back to first entry for unknown names", () => {
    const loc = getRefineryLocation("Nonexistent");
    expect(loc).toBeDefined();
    expect(loc.name).toBeTruthy();
  });
});

describe("getRefineryMaterial", () => {
  it("finds a material by name", () => {
    const mat = getRefineryMaterial("Construction Salvage");
    expect(mat.name).toBe("Construction Salvage");
    expect(typeof mat.maxBaseRate).toBe("number");
  });

  it("falls back to first entry for unknown names", () => {
    const mat = getRefineryMaterial("Unknown Material");
    expect(mat).toBeDefined();
  });
});

describe("getRefineryMethod", () => {
  it("finds a method by name", () => {
    const method = getRefineryMethod("Cormack Method");
    expect(method.name).toBe("Cormack Method");
    expect(typeof method.yieldPer240).toBe("number");
  });

  it("falls back to first entry for unknown names", () => {
    const method = getRefineryMethod("Fake Method");
    expect(method).toBeDefined();
  });
});

describe("getMaterialMaxBaseRate", () => {
  it("returns the maxBaseRate for known materials", () => {
    expect(getMaterialMaxBaseRate("Construction Salvage")).toBe(0.15);
    expect(getMaterialMaxBaseRate("Construction Pieces")).toBe(0.20);
    expect(getMaterialMaxBaseRate("Construction Rubble")).toBe(0.30);
  });

  it("returns 0 for unknown materials", () => {
    expect(getMaterialMaxBaseRate("Unknown")).toBe(0);
  });
});

describe("getLocationBonusRate", () => {
  it("converts percent bonus to decimal", () => {
    const levski = getRefineryLocation("Levski");
    expect(getLocationBonusRate(levski, "Construction Salvage")).toBe(0.09);
    expect(getLocationBonusRate(levski, "Construction Rubble")).toBe(0.08);
  });

  it("returns 0 for materials with no bonus", () => {
    const levski = getRefineryLocation("Levski");
    expect(getLocationBonusRate(levski, "Construction Pieces")).toBe(0);
  });

  it("returns 0 for null location", () => {
    expect(getLocationBonusRate(null, "Construction Salvage")).toBe(0);
  });
});

describe("getMethodYieldMultiplier", () => {
  it("returns 1.0 for the highest-yield method", () => {
    const highYield = refineryMethods.reduce((best, m) =>
      m.yieldPer240 > best.yieldPer240 ? m : best
    );
    expect(getMethodYieldMultiplier(highYield)).toBeCloseTo(1.0);
  });

  it("returns a value between 0 and 1 for all methods", () => {
    for (const method of refineryMethods) {
      const multiplier = getMethodYieldMultiplier(method);
      expect(multiplier).toBeGreaterThan(0);
      expect(multiplier).toBeLessThanOrEqual(1);
    }
  });

  it("returns 0 for null input", () => {
    expect(getMethodYieldMultiplier(null)).toBe(0);
  });
});

describe("computeMethodCostAndTime", () => {
  it("scales linearly from the 240 SCU baseline", () => {
    const result = computeMethodCostAndTime({ scu: 240, methodName: "Cormack Method" });
    const method = getRefineryMethod("Cormack Method");
    expect(result.cost).toBeCloseTo(method.costPer240);
    expect(result.timeSeconds).toBeCloseTo(method.timeSeconds);
  });

  it("halves cost and time for half the SCU", () => {
    const full = computeMethodCostAndTime({ scu: 240, methodName: "Cormack Method" });
    const half = computeMethodCostAndTime({ scu: 120, methodName: "Cormack Method" });
    expect(half.cost).toBeCloseTo(full.cost / 2);
    expect(half.timeSeconds).toBeCloseTo(full.timeSeconds / 2);
  });
});

describe("computeRefineryJob", () => {
  it("returns expected fields", () => {
    const result = computeRefineryJob({
      scu: 240,
      materialName: "Construction Salvage",
      methodName: "Dinyx Solventation",
      locationName: "Levski",
    });
    expect(result).toHaveProperty("baseYieldRate");
    expect(result).toHaveProperty("locationBonusRate");
    expect(result).toHaveProperty("baseYield");
    expect(result).toHaveProperty("refineryBonusYield");
    expect(result).toHaveProperty("totalYield");
    expect(result).toHaveProperty("cost");
    expect(result).toHaveProperty("timeSeconds");
  });

  it("totalYield = baseYield + refineryBonusYield", () => {
    const result = computeRefineryJob({
      scu: 100,
      materialName: "Construction Salvage",
      methodName: "Cormack Method",
      locationName: "Levski",
    });
    expect(result.totalYield).toBeCloseTo(result.baseYield + result.refineryBonusYield);
  });

  it("applies Levski bonus for Construction Salvage", () => {
    const withBonus = computeRefineryJob({
      scu: 100,
      materialName: "Construction Salvage",
      methodName: "Cormack Method",
      locationName: "Levski",
    });
    const noBonus = computeRefineryJob({
      scu: 100,
      materialName: "Construction Salvage",
      methodName: "Cormack Method",
      locationName: "ARC-L1",
    });
    expect(withBonus.totalYield).toBeGreaterThan(noBonus.totalYield);
  });

  it("returns zero yield for zero SCU input", () => {
    const result = computeRefineryJob({
      scu: 0,
      materialName: "Construction Salvage",
      methodName: "Cormack Method",
      locationName: "ARC-L1",
    });
    expect(result.totalYield).toBe(0);
    expect(result.cost).toBe(0);
  });
});
