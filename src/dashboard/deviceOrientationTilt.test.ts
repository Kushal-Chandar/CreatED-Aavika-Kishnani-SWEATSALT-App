import { describe, expect, it } from "vitest";
import { tiltFromGravity } from "./deviceOrientationTilt";

describe("tiltFromGravity", () => {
  it("reads flat, screen-up as zero tilt", () => {
    const { rotateX, rotateY } = tiltFromGravity(0, 0, 9.8);
    expect(rotateX).toBeCloseTo(0, 5);
    expect(rotateY).toBeCloseTo(0, 5);
  });

  it("reads gravity pulling toward -y as a positive rotateX", () => {
    const { rotateX, rotateY } = tiltFromGravity(0, -9.8, 0);
    expect(rotateX).toBeCloseTo(45, 5);
    expect(rotateY).toBeCloseTo(0, 5);
  });

  it("reads gravity pulling toward +x as a positive rotateY", () => {
    const { rotateX, rotateY } = tiltFromGravity(9.8, 0, 0);
    expect(rotateX).toBeCloseTo(0, 5);
    expect(rotateY).toBeCloseTo(45, 5);
  });

  it("clamps extreme angles to +/-45 degrees", () => {
    const { rotateX, rotateY } = tiltFromGravity(100, -100, 0.001);
    expect(rotateX).toBe(45);
    expect(rotateY).toBe(45);
  });
});
