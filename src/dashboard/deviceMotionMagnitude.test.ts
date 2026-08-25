import { describe, it, expect } from "vitest";
import { magnitudeToG } from "./deviceMotionMagnitude";

describe("magnitudeToG", () => {
  it("reads ~1g for gravity alone on one axis", () => {
    expect(magnitudeToG(0, 0, 9.80665)).toBeCloseTo(1, 2);
  });

  it("combines all three axes into one magnitude", () => {
    // 3-4-5 triangle scaled so the magnitude is exactly 5 m/s^2
    expect(magnitudeToG(3, 4, 0)).toBeCloseTo(5 / 9.80665, 4);
  });

  it("clamps huge shakes to the mock range's max of 4g", () => {
    expect(magnitudeToG(500, 500, 500)).toBe(4);
  });

  it("returns 0 for no acceleration at all", () => {
    expect(magnitudeToG(0, 0, 0)).toBe(0);
  });
});
