import { describe, it, expect } from "vitest";
import { recentSeries } from "./sparklineData";
import type { LogEntry } from "../log/logStore";

const NOW = 1_000_000;
const WINDOW_MS = 10 * 60 * 1000;

function entry(source: string, value: number, ts: number): LogEntry {
  return { source, value, ts };
}

describe("recentSeries", () => {
  it("keeps only entries matching the requested source", () => {
    const entries = [entry("hr", 80, NOW), entry("gsr", 5, NOW)];
    expect(recentSeries(entries, "hr", NOW, WINDOW_MS, 24)).toEqual([80]);
  });

  it("excludes entries older than the window", () => {
    const entries = [entry("hr", 80, NOW - WINDOW_MS - 1), entry("hr", 82, NOW)];
    expect(recentSeries(entries, "hr", NOW, WINDOW_MS, 24)).toEqual([82]);
  });

  it("sorts by timestamp ascending regardless of input order", () => {
    const entries = [entry("hr", 82, NOW), entry("hr", 80, NOW - 1000)];
    expect(recentSeries(entries, "hr", NOW, WINDOW_MS, 24)).toEqual([80, 82]);
  });

  it("downsamples to maxPoints when the window has more entries", () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry("hr", i, NOW - (9 - i) * 1000));
    const result = recentSeries(entries, "hr", NOW, WINDOW_MS, 5);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe(0);
    expect(result[result.length - 1]).toBe(8);
  });
});
