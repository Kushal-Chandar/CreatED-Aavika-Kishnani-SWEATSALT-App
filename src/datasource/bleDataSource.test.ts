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

function fakeDevice(services: Record<string, ReturnType<typeof fakeService>> = {}) {
  const listeners: Record<string, () => void> = {};
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
    addEventListener: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
    }),
    gatt,
    fireDisconnect: () => listeners["gattserverdisconnected"]?.(),
  };
}

function fakeCharacteristic() {
  const listeners: Record<string, () => void> = {};
  return {
    value: undefined as DataView | undefined,
    startNotifications: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
    }),
    readValue: vi.fn().mockResolvedValue(new DataView(new ArrayBuffer(0))),
    fireValueChanged(dv: DataView) {
      this.value = dv;
      listeners["characteristicvaluechanged"]?.();
    },
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
});
