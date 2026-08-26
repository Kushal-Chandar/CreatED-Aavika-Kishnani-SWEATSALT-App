import { afterEach, describe, expect, it, vi } from "vitest";
import { BleDataSource } from "./bleDataSource";

function fakeDevice() {
  const listeners: Record<string, () => void> = {};
  return {
    addEventListener: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
    }),
    gatt: { connect: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn() },
    fireDisconnect: () => listeners["gattserverdisconnected"]?.(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BleDataSource", () => {
  it("prompts the device picker on first start", async () => {
    const device = fakeDevice();
    const requestDevice = vi.fn().mockResolvedValue(device);
    vi.stubGlobal("navigator", { bluetooth: { requestDevice } });

    const source = new BleDataSource();
    await source.start();

    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(device.gatt.connect).toHaveBeenCalledTimes(1);
  });

  it("reconnects to the same paired device on retry, without re-prompting", async () => {
    const device = fakeDevice();
    const requestDevice = vi.fn().mockResolvedValue(device);
    vi.stubGlobal("navigator", { bluetooth: { requestDevice } });

    const source = new BleDataSource();
    await source.start();

    device.fireDisconnect();
    await source.start();

    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(device.gatt.connect).toHaveBeenCalledTimes(2);
  });

  it("re-prompts after stop() clears the paired device", async () => {
    const device = fakeDevice();
    const requestDevice = vi.fn().mockResolvedValue(device);
    vi.stubGlobal("navigator", { bluetooth: { requestDevice } });

    const source = new BleDataSource();
    await source.start();
    source.stop();
    await source.start();

    expect(requestDevice).toHaveBeenCalledTimes(2);
  });
});
