import { afterEach, describe, expect, it, vi } from "vitest";
import { isWebBluetoothSupported } from "./webBluetoothSupport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isWebBluetoothSupported", () => {
  it("returns true when navigator.bluetooth exists", () => {
    vi.stubGlobal("navigator", { bluetooth: {} });
    expect(isWebBluetoothSupported()).toBe(true);
  });

  it("returns false when navigator.bluetooth is absent (e.g. iOS Safari)", () => {
    vi.stubGlobal("navigator", {});
    expect(isWebBluetoothSupported()).toBe(false);
  });
});
