import type { DataSource, Reading, ConnectionStatus, DeviceInfo, DeviceAlert, Unsubscribe } from "./types";
import { addListener } from "./listeners";

// Must stay byte-for-byte identical to the UUID defines at the top of firmware/firmware.ino.
export const SWEATSALT_SERVICE_UUID = "5a7b0000-0001-4a6e-9c1a-000000000000";
export const CHAR_GSR_UUID = "5a7b0000-0001-4a6e-9c1a-000000000001";
export const CHAR_HR_UUID = "5a7b0000-0001-4a6e-9c1a-000000000002";
export const CHAR_TEMP_UUID = "5a7b0000-0001-4a6e-9c1a-000000000003";
export const CHAR_IMU_UUID = "5a7b0000-0001-4a6e-9c1a-000000000004";
export const CHAR_VIBRATION_UUID = "5a7b0000-0001-4a6e-9c1a-000000000005";
export const CHAR_ALERT_UUID = "5a7b0000-0001-4a6e-9c1a-000000000007";
// Standard 16-bit services as full 128-bit strings. The spec also accepts bare
// numbers (0x180a), but wrappers like Bluefy only reliably take strings.
export const DEVICE_INFO_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";
export const MODEL_NUMBER_UUID = "00002a24-0000-1000-8000-00805f9b34fb";
export const SERIAL_NUMBER_UUID = "00002a25-0000-1000-8000-00805f9b34fb";
export const BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
export const BATTERY_LEVEL_UUID = "00002a19-0000-1000-8000-00805f9b34fb";

// Bluefy and friends sometimes reject with a bare code or object rather than
// an Error, so show whatever it is instead of "[object Object]" or nothing.
function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "object" && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return `non-Error rejection: ${String(err)}`;
}

const SENSOR_CHARACTERISTICS: Array<[BluetoothCharacteristicUUID, Reading["source"]]> = [
  [CHAR_GSR_UUID, "gsr"],
  [CHAR_HR_UUID, "hr"],
  [CHAR_TEMP_UUID, "temp"],
  [CHAR_IMU_UUID, "imu"],
];

// Firmware AlertType enum order (0 = none).
const ALERT_BY_CODE: Array<DeviceAlert | null> = [null, "fever", "highHr", "lowHr", "battery"];

export class BleDataSource implements DataSource {
  private device: BluetoothDevice | null = null;
  private readingListeners: Array<(r: Reading) => void> = [];
  private statusListeners: Array<(s: ConnectionStatus) => void> = [];
  private deviceInfoListeners: Array<(d: DeviceInfo) => void> = [];
  private batteryListeners: Array<(percent: number) => void> = [];
  private alertListeners: Array<(a: DeviceAlert | null) => void> = [];
  private vibrationCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  // Notification handlers attached for the current connection. Tracked so a
  // retry or stop() can detach them instead of leaving them on the old
  // characteristic objects (which would stack duplicates up).
  private notifyHandlers: Array<{ characteristic: BluetoothRemoteGATTCharacteristic; handler: () => void }> = [];

  private emitStatus(status: ConnectionStatus): void {
    this.statusListeners.forEach((cb) => cb(status));
  }

  // Stable reference so removeEventListener can find it again in stop().
  private handleGattDisconnected = (): void => {
    // The link is gone, so the characteristics are dead too — drop their
    // handlers (no stopNotifications: there's nothing to talk to).
    this.releaseNotifyHandlers(false);
    this.vibrationCharacteristic = null;
    this.alertListeners.forEach((cb) => cb(null));
    this.emitStatus("disconnected");
  };

  private onNotify(characteristic: BluetoothRemoteGATTCharacteristic, handler: () => void): void {
    characteristic.addEventListener("characteristicvaluechanged", handler);
    this.notifyHandlers.push({ characteristic, handler });
  }

  private releaseNotifyHandlers(stopNotifications: boolean): void {
    for (const { characteristic, handler } of this.notifyHandlers.splice(0)) {
      characteristic.removeEventListener("characteristicvaluechanged", handler);
      if (stopNotifications) {
        // Best effort: the device may already be gone.
        void characteristic.stopNotifications().catch(() => {});
      }
    }
  }

  // Why the last start() failed, for the UI ("NotAllowedError: ..."). The
  // browser picker's own errors are otherwise invisible on a phone.
  lastError: string | undefined;
  // In-flight start(), so a second caller (e.g. the Dashboard effect running
  // right after the tap handler already started us) shares it instead of
  // opening a second picker.
  private starting: Promise<void> | null = null;
  // After a filtered picker fails for a reason other than "cancelled", the
  // next tap lists every nearby device instead.
  private showAllDevices = false;

  // Web Bluetooth only allows the picker straight from a tap, and some
  // browsers (Bluefy/iOS) are strict about it. So requestDevice() is the
  // first thing that runs, synchronously, and there is exactly one picker
  // call per start() — no await before it, no second call after it.
  start(): Promise<void> {
    this.starting ??= this.connect().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async connect(): Promise<void> {
    this.lastError = undefined;
    try {
      if (!this.device) {
        const optionalServices = [SWEATSALT_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID, BATTERY_SERVICE_UUID];
        const picker = navigator.bluetooth.requestDevice(
          this.showAllDevices
            ? { acceptAllDevices: true, optionalServices }
            : {
                filters: [
                  { name: "SweatSalt" },
                  { namePrefix: "SweatSalt" },
                  { services: [SWEATSALT_SERVICE_UUID] },
                ],
                optionalServices,
              },
        );
        try {
          this.device = await picker;
        } catch (err: unknown) {
          const cancelled =
            err instanceof Error && (err.name === "NotFoundError" || err.message?.includes("User cancelled"));
          if (!cancelled) this.showAllDevices = true;
          throw err;
        }
        this.device.addEventListener("gattserverdisconnected", this.handleGattDisconnected);
      }
      // Reuses the already-paired device on retry — the disconnected
      // banner's "tap to retry" should reconnect quietly, not throw a
      // new browser device-picker dialog at someone whose watch just
      // walked out of range for a second.
      const server = await this.device.gatt?.connect();
      // A start() on top of an earlier connection (retry) must not leave the
      // previous attempt's handlers attached alongside the new ones.
      this.releaseNotifyHandlers(false);
      this.emitStatus("connected");

      if (server) {
        // Non-fatal and independent: the BLE link itself is up even if a
        // particular service isn't there yet (e.g. older firmware), so one
        // missing service shouldn't flip the connection back to
        // "disconnected" or hide the others.
        for (const step of [
          () => this.subscribeSensorReadings(server),
          () => this.readDeviceInfo(server),
          () => this.subscribeBattery(server),
          () => this.setupVibration(server),
          () => this.subscribeAlerts(server),
        ]) {
          try {
            await step();
          } catch {
            // that service's data just won't arrive until the device exposes it
          }
        }
      }
    } catch (err: unknown) {
      this.lastError = describeError(err);
      this.emitStatus("disconnected");
    }
  }

  private async subscribeSensorReadings(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(SWEATSALT_SERVICE_UUID);
    for (const [uuid, source] of SENSOR_CHARACTERISTICS) {
      const characteristic = await service.getCharacteristic(uuid);
      await characteristic.startNotifications();
      this.onNotify(characteristic, () => {
        const dv = characteristic.value;
        if (!dv) return;
        const value = dv.getFloat32(0, true);
        this.readingListeners.forEach((cb) => cb({ source, value, ts: Date.now() }));
      });
      try {
        const initial = await characteristic.readValue();
        if (initial && initial.byteLength >= 4) {
          const value = initial.getFloat32(0, true);
          if (!Number.isNaN(value)) {
            this.readingListeners.forEach((cb) => cb({ source, value, ts: Date.now() }));
          }
        }
      } catch {
        // Initial read is best-effort; notification stream will supply values
      }
    }
  }

  private async readDeviceInfo(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(DEVICE_INFO_SERVICE_UUID);
    const modelChar = await service.getCharacteristic(MODEL_NUMBER_UUID);
    const serialChar = await service.getCharacteristic(SERIAL_NUMBER_UUID);
    const [modelValue, serialValue] = await Promise.all([
      modelChar.readValue(),
      serialChar.readValue(),
    ]);
    const decoder = new TextDecoder();
    const info: DeviceInfo = {
      name: decoder.decode(modelValue),
      id: decoder.decode(serialValue),
    };
    this.deviceInfoListeners.forEach((cb) => cb(info));
  }

  private async subscribeBattery(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(BATTERY_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(BATTERY_LEVEL_UUID);
    await characteristic.startNotifications();
    this.onNotify(characteristic, () => {
      const dv = characteristic.value;
      if (!dv) return;
      this.batteryListeners.forEach((cb) => cb(dv.getUint8(0)));
    });
    try {
      const initial = await characteristic.readValue();
      if (initial && initial.byteLength >= 1) {
        this.batteryListeners.forEach((cb) => cb(initial.getUint8(0)));
      }
    } catch {
      // Best-effort initial read
    }
  }

  private async setupVibration(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(SWEATSALT_SERVICE_UUID);
    this.vibrationCharacteristic = await service.getCharacteristic(CHAR_VIBRATION_UUID);
  }

  private async subscribeAlerts(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(SWEATSALT_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHAR_ALERT_UUID);
    const emit = (dv: DataView | undefined) => {
      if (!dv || dv.byteLength < 1) return;
      const alert = ALERT_BY_CODE[dv.getUint8(0)] ?? null;
      this.alertListeners.forEach((cb) => cb(alert));
    };
    await characteristic.startNotifications();
    this.onNotify(characteristic, () => emit(characteristic.value));
    try {
      emit(await characteristic.readValue());
    } catch {
      // Best-effort initial read
    }
  }

  async setVibration(intensity: number): Promise<void> {
    if (!this.vibrationCharacteristic) return;
    const clamped = Math.max(0, Math.min(255, Math.round(intensity)));
    const buf = new Uint8Array([clamped]);
    try {
      const c = this.vibrationCharacteristic as BluetoothRemoteGATTCharacteristic & {
        writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
      };
      if (typeof c.writeValueWithoutResponse === "function") {
        await c.writeValueWithoutResponse(buf);
      } else {
        await c.writeValue(buf);
      }
    } catch {
      // Best-effort write
    }
  }

  async buzz(durationMs = 200, intensity = 200): Promise<void> {
    await this.setVibration(intensity);
    setTimeout(() => {
      void this.setVibration(0);
    }, durationMs);
  }

  stop(): void {
    this.releaseNotifyHandlers(true);
    this.vibrationCharacteristic = null;
    this.device?.removeEventListener("gattserverdisconnected", this.handleGattDisconnected);
    this.device?.gatt?.disconnect();
    this.device = null;
  }

  onReading(cb: (r: Reading) => void): Unsubscribe {
    return addListener(this.readingListeners, cb);
  }

  onStatusChange(cb: (s: ConnectionStatus) => void): Unsubscribe {
    return addListener(this.statusListeners, cb);
  }

  onDeviceInfo(cb: (d: DeviceInfo) => void): Unsubscribe {
    return addListener(this.deviceInfoListeners, cb);
  }

  onBattery(cb: (percent: number) => void): Unsubscribe {
    return addListener(this.batteryListeners, cb);
  }

  onAlert(cb: (alert: DeviceAlert | null) => void): Unsubscribe {
    return addListener(this.alertListeners, cb);
  }
}
