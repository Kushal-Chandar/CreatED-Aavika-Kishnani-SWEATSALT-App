import { describe, it, expect } from "vitest";
import { smoothSeries } from "./smoothSeries";

describe("smoothSeries", () => {
  it("returns the series unchanged for a window of 1", () => {
    expect(smoothSeries([1, 5, 2, 9], 1)).toEqual([1, 5, 2, 9]);
  });

  it("preserves the input length", () => {
    expect(smoothSeries([1, 2, 3, 4, 5], 3)).toHaveLength(5);
  });

  it("leaves a flat series unchanged", () => {
    expect(smoothSeries([4, 4, 4, 4], 3)).toEqual([4, 4, 4, 4]);
  });

  it("dampens an isolated spike", () => {
    const result = smoothSeries([0, 0, 10, 0, 0], 3);
    expect(result[2]).toBeLessThan(10);
    expect(result[2]).toBeGreaterThan(0);
  });
});
