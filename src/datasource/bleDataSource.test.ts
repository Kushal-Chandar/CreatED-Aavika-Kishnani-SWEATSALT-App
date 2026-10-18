import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BleDataSource,
  SWEATSALT_SERVICE_UUID,
  CHAR_GSR_UUID,
  CHAR_HR_UUID,
  CHAR_TEMP_UUID,
  CHAR_IMU_UUID,
  DEVICE_INFO_SERVICE_UUID,
  MODEL_NUMBER_UUID,
  SERIAL_NUMBER_UUID,
  BATTERY_SERVICE_UUID,
  BATTERY_LEVEL_UUID,
} from "./bleDataSource";
import type { Reading, DeviceInfo } from "./types";

// Tiny EventTarget stand-in that supports several listeners per event and
// removal, so tests can see leaked/duplicated handlers.
function listenerRegistry() {
  const listeners: Record<string, Set<() => void>> = {};
  return {
    add(event: string, cb: () => void) {
      (listeners[event] ??= new Set()).add(cb);
    },
    remove(event: string, cb: () => void) {
      listeners[event]?.delete(cb);
    },
    fire(event: string) {
      [...(listeners[event] ?? [])].forEach((cb) => cb());
    },
    count(event: string) {
      return listeners[event]?.size ?? 0;
    },
  };
}

function fakeDevice(services: Record<string, ReturnType<typeof fakeService>> = {}) {
  const registry = listenerRegistry();
  const gatt: { connect: () => Promise<typeof gatt>; disconnect: () => void; getPrimaryService: (uuid: string | number) => Promise<unknown> } = {
    connect: vi.fn(() => Promise.resolve(gatt)) as unknown as () => Promise<typeof gatt>,
    disconnect: vi.fn(),
    getPrimaryService: vi.fn((uuid: string | number) => {
      const service = services[String(uuid)];
      if (!service) throw new Error(`no service mocked for ${uuid}`);
      return Promise.resolve(service);
    }),
  };
  return {
    addEventListener: vi.fn((event: string, cb: () => void) => registry.add(event, cb)),
    removeEventListener: vi.fn((event: string, cb: () => void) => registry.remove(event, cb)),
    gatt,
    fireDisconnect: () => registry.fire("gattserverdisconnected"),
    listenerCount: (event: string) => registry.count(event),
  };
}

function fakeCharacteristic() {
  const registry = listenerRegistry();
  return {
    value: undefined as DataView | undefined,
    startNotifications: vi.fn().mockResolvedValue(undefined),
    stopNotifications: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((event: string, cb: () => void) => registry.add(event, cb)),
    removeEventListener: vi.fn((event: string, cb: () => void) => registry.remove(event, cb)),
    readValue: vi.fn().mockResolvedValue(new DataView(new ArrayBuffer(0))),
    fireValueChanged(dv: DataView) {
      this.value = dv;
      registry.fire("characteristicvaluechanged");
    },
    listenerCount: () => registry.count("characteristicvaluechanged"),
  };
}

type FakeCharacteristic = ReturnType<typeof fakeCharacteristic>;

function fakeService(characteristics: Record<string, FakeCharacteristic>) {
  return {
    getCharacteristic: vi.fn((uuid: string | number) => {
      const char = characteristics[String(uuid)];
      if (!char) throw new Error(`no characteristic mocked for ${uuid}`);
      return Promise.resolve(char);
    }),
  };
}

function floatValue(n: number): DataView {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, n, true);
  return dv;
}

function textValue(s: string): DataView {
  return new DataView(new TextEncoder().encode(s).buffer);
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

  it("subscribes to the custom SweatSalt characteristics and forwards notified values as Readings", async () => {
    const gsrChar = fakeCharacteristic();
    const hrChar = fakeCharacteristic();
    const tempChar = fakeCharacteristic();
    const imuChar = fakeCharacteristic();
    const sweatSaltService = fakeService({
      [CHAR_GSR_UUID]: gsrChar,
      [CHAR_HR_UUID]: hrChar,
      [CHAR_TEMP_UUID]: tempChar,
      [CHAR_IMU_UUID]: imuChar,
    });
    const device = fakeDevice({ [SWEATSALT_SERVICE_UUID]: sweatSaltService });
    vi.stubGlobal("navigator", {
      bluetooth: { requestDevice: vi.fn().mockResolvedValue(device) },
    });

    const source = new BleDataSource();
    const readings: Reading[] = [];
    source.onReading((r) => readings.push(r));
    await source.start();

    gsrChar.fireValueChanged(floatValue(42.5));
    tempChar.fireValueChanged(floatValue(36.8));

    // float32 can't represent 36.8 exactly, so compare approximately
    expect(readings.map((r) => r.source)).toEqual(["gsr", "temp"]);
    expect(readings[0].value).toBeCloseTo(42.5, 4);
    expect(readings[1].value).toBeCloseTo(36.8, 4);
    expect(gsrChar.startNotifications).toHaveBeenCalledTimes(1);
    expect(hrChar.startNotifications).toHaveBeenCalledTimes(1);
    expect(imuChar.startNotifications).toHaveBeenCalledTimes(1);
  });

  it("reads Device Information and subscribes to the standard Battery Level characteristic", async () => {
    const modelChar = fakeCharacteristic();
    modelChar.readValue = vi.fn().mockResolvedValue(textValue("SS-MVP-1"));
    const serialChar = fakeCharacteristic();
    serialChar.readValue = vi.fn().mockResolvedValue(textValue("SS0001"));
    const devInfoService = fakeService({
      [MODEL_NUMBER_UUID]: modelChar,
      [SERIAL_NUMBER_UUID]: serialChar,
    });
    const batteryChar = fakeCharacteristic();
    const batteryService = fakeService({ [BATTERY_LEVEL_UUID]: batteryChar });
    const device = fakeDevice({
      [DEVICE_INFO_SERVICE_UUID]: devInfoService,
      [BATTERY_SERVICE_UUID]: batteryService,
    });
    vi.stubGlobal("navigator", {
      bluetooth: { requestDevice: vi.fn().mockResolvedValue(device) },
    });

    const source = new BleDataSource();
    let deviceInfo: DeviceInfo | undefined;
    source.onDeviceInfo((info) => (deviceInfo = info));
    let batteryPercent: number | undefined;
    source.onBattery((pct) => (batteryPercent = pct));
    await source.start();

    expect(deviceInfo).toEqual({ id: "SS0001", name: "SS-MVP-1" });

    const battDv = new DataView(new ArrayBuffer(1));
    battDv.setUint8(0, 73);
    batteryChar.fireValueChanged(battDv);
    expect(batteryPercent).toBe(73);
  });

  describe("listener cleanup", () => {
    function connectedSetup() {
      const gsrChar = fakeCharacteristic();
      const sensorChars = {
        [CHAR_GSR_UUID]: gsrChar,
        [CHAR_HR_UUID]: fakeCharacteristic(),
        [CHAR_TEMP_UUID]: fakeCharacteristic(),
        [CHAR_IMU_UUID]: fakeCharacteristic(),
      };
      const batteryChar = fakeCharacteristic();
      const device = fakeDevice({
        [SWEATSALT_SERVICE_UUID]: fakeService(sensorChars),
        [BATTERY_SERVICE_UUID]: fakeService({ [BATTERY_LEVEL_UUID]: batteryChar }),
      });
      vi.stubGlobal("navigator", {
        bluetooth: { requestDevice: vi.fn().mockResolvedValue(device) },
      });
      return { device, gsrChar, batteryChar, sensorChars };
    }

    it("onReading returns an unsubscribe that stops delivery to that listener", async () => {
      const { gsrChar } = connectedSetup();
      const source = new BleDataSource();
      const kept: Reading[] = [];
      const dropped: Reading[] = [];
      source.onReading((r) => kept.push(r));
      const unsubscribe = source.onReading((r) => dropped.push(r));
      await source.start();

      gsrChar.fireValueChanged(floatValue(1));
      unsubscribe();
      gsrChar.fireValueChanged(floatValue(2));

      expect(kept).toHaveLength(2);
      expect(dropped).toHaveLength(1);
    });

    it("onStatusChange, onDeviceInfo and onBattery also return working unsubscribes", async () => {
      const { device, batteryChar } = connectedSetup();
      const source = new BleDataSource();
      const statuses: string[] = [];
      const levels: number[] = [];
      source.onStatusChange((s) => statuses.push(s))();
      source.onBattery((p) => levels.push(p))();
      source.onDeviceInfo(() => {})();
      await source.start();

      device.fireDisconnect();
      const dv = new DataView(new ArrayBuffer(1));
      dv.setUint8(0, 50);
      batteryChar.fireValueChanged(dv);

      expect(statuses).toEqual([]);
      expect(levels).toEqual([]);
    });

    it("stop() removes characteristic listeners and stops notifications", async () => {
      const { gsrChar, batteryChar, sensorChars } = connectedSetup();
      const source = new BleDataSource();
      const readings: Reading[] = [];
      source.onReading((r) => readings.push(r));
      await source.start();
      expect(gsrChar.listenerCount()).toBe(1);

      source.stop();

      expect(gsrChar.listenerCount()).toBe(0);
      expect(batteryChar.listenerCount()).toBe(0);
      for (const c of Object.values(sensorChars)) expect(c.stopNotifications).toHaveBeenCalledTimes(1);
      expect(batteryChar.stopNotifications).toHaveBeenCalledTimes(1);
      gsrChar.fireValueChanged(floatValue(9));
      expect(readings).toEqual([]);
    });

    it("stop() removes the disconnect listener so no status fires after teardown", async () => {
      const { device } = connectedSetup();
      const source = new BleDataSource();
      const statuses: string[] = [];
      source.onStatusChange((s) => statuses.push(s));
      await source.start();
      statuses.length = 0;

      source.stop();
      device.fireDisconnect();

      expect(device.listenerCount("gattserverdisconnected")).toBe(0);
      expect(statuses).toEqual([]);
    });

    it("a retry on the same device does not stack a second set of listeners", async () => {
      const { device, gsrChar } = connectedSetup();
      const source = new BleDataSource();
      const readings: Reading[] = [];
      source.onReading((r) => readings.push(r));
      await source.start();

      device.fireDisconnect();
      await source.start();
      gsrChar.fireValueChanged(floatValue(3));

      expect(gsrChar.listenerCount()).toBe(1);
      expect(readings).toHaveLength(1);
      expect(device.listenerCount("gattserverdisconnected")).toBe(1);
    });

    it("start() called while still connected does not duplicate readings", async () => {
      const { gsrChar } = connectedSetup();
      const source = new BleDataSource();
      const readings: Reading[] = [];
      source.onReading((r) => readings.push(r));
      await source.start();
      await source.start();

      gsrChar.fireValueChanged(floatValue(3));

      expect(readings).toHaveLength(1);
    });

    it("stop() before a late characteristic fails to stop does not throw", async () => {
      const { gsrChar } = connectedSetup();
      gsrChar.stopNotifications.mockRejectedValue(new Error("device gone"));
      const source = new BleDataSource();
      await source.start();

      expect(() => source.stop()).not.toThrow();
      await Promise.resolve();
    });
  });
});
