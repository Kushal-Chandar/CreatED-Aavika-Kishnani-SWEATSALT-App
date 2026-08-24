import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockDataSource } from "./mockDataSource";
import type { Reading, ConnectionStatus } from "./types";

describe("MockDataSource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits a reading for each of gsr, hr, temp, imu every tick", () => {
    const source = new MockDataSource();
    const readings: Reading[] = [];
    source.onReading((r) => readings.push(r));

    source.start();
    vi.advanceTimersByTime(1000);

    const seen = new Set(readings.map((r) => r.source));
    expect(seen).toEqual(new Set(["gsr", "hr", "temp", "imu"]));
  });

  it("reports connected status on start", () => {
    const source = new MockDataSource();
    const statuses: ConnectionStatus[] = [];
    source.onStatusChange((s) => statuses.push(s));

    source.start();

    expect(statuses).toEqual(["connected"]);
  });

  it("stops emitting readings after stop()", () => {
    const source = new MockDataSource();
    const readings: Reading[] = [];
    source.onReading((r) => readings.push(r));

    source.start();
    vi.advanceTimersByTime(1000);
    const countAfterFirstTick = readings.length;
    source.stop();
    vi.advanceTimersByTime(2000);

    expect(readings.length).toBe(countAfterFirstTick);
  });

  it("periodically simulates a disconnect, then reconnects, so the alert UI is exercised without manual setup", () => {
    const source = new MockDataSource();
    const statuses: ConnectionStatus[] = [];
    source.onStatusChange((s) => statuses.push(s));

    source.start();
    vi.advanceTimersByTime(26_000);
    expect(statuses).toEqual(["connected", "disconnected"]);

    vi.advanceTimersByTime(4_000);
    expect(statuses).toEqual(["connected", "disconnected", "connected"]);
  });

  it("emits no readings while simulating a disconnect", () => {
    const source = new MockDataSource();
    const readings: Reading[] = [];
    source.onReading((r) => readings.push(r));

    source.start();
    vi.advanceTimersByTime(26_000);
    const countAtDisconnect = readings.length;
    vi.advanceTimersByTime(1000);

    expect(readings.length).toBe(countAtDisconnect);
  });

  it("reports device info on start", () => {
    const source = new MockDataSource();
    const infos: Array<{ id: string; name: string }> = [];
    source.onDeviceInfo((info) => infos.push(info));

    source.start();

    expect(infos).toHaveLength(1);
    expect(infos[0].id).toBeTruthy();
    expect(infos[0].name).toBeTruthy();
  });

  it("reports a slowly-draining battery percentage on each tick", () => {
    const source = new MockDataSource();
    const levels: number[] = [];
    source.onBattery((percent) => levels.push(percent));

    source.start();
    vi.advanceTimersByTime(3000);

    expect(levels).toHaveLength(3);
    expect(levels[0]).toBeGreaterThanOrEqual(0);
    expect(levels[0]).toBeLessThanOrEqual(100);
    expect(levels[2]).toBeLessThanOrEqual(levels[0]);
  });
});
