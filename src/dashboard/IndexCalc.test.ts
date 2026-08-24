import { describe, it, expect } from "vitest";
import { computeHeatIndex } from "./IndexCalc";

describe("computeHeatIndex", () => {
  it("returns 0 at the minimum of every range", () => {
    expect(computeHeatIndex({ gsr: 0.2, hr: 50, temp: 30 })).toBe(0);
  });

  it("returns 100 at the maximum of every range", () => {
    expect(computeHeatIndex({ gsr: 20, hr: 180, temp: 39 })).toBe(100);
  });

  it("returns a mid-range score for mid-range inputs", () => {
    const score = computeHeatIndex({ gsr: 10.1, hr: 115, temp: 34.5 });
    expect(score).toBeGreaterThanOrEqual(45);
    expect(score).toBeLessThanOrEqual(55);
  });

  it("clamps out-of-range inputs instead of exceeding 0-100", () => {
    expect(computeHeatIndex({ gsr: 999, hr: 999, temp: 999 })).toBe(100);
    expect(computeHeatIndex({ gsr: -999, hr: -999, temp: -999 })).toBe(0);
  });
});
