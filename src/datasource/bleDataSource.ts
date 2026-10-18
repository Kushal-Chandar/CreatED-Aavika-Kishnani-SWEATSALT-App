import type { DataSource, Reading, ConnectionStatus, DeviceInfo, Unsubscribe } from "./types";
import { addListener } from "./listeners";

// Must stay byte-for-byte identical to the UUID defines at the top of firmware/firmware.ino.
export const SWEATSALT_SERVICE_UUID = "5a7b0000-0001-4a6e-9c1a-000000000000";
export const CHAR_GSR_UUID = "5a7b0000-0001-4a6e-9c1a-000000000001";
export const CHAR_HR_UUID = "5a7b0000-0001-4a6e-9c1a-000000000002";
export const CHAR_TEMP_UUID = "5a7b0000-0001-4a6e-9c1a-000000000003";
export const CHAR_IMU_UUID = "5a7b0000-0001-4a6e-9c1a-000000000004";
export const DEVICE_INFO_SERVICE_UUID = 0x180a;
export const MODEL_NUMBER_UUID = 0x2a24;
export const SERIAL_NUMBER_UUID = 0x2a25;
export const BATTERY_SERVICE_UUID = 0x180f;
export const BATTERY_LEVEL_UUID = 0x2a19;

const SENSOR_CHARACTERISTICS: Array<[BluetoothCharacteristicUUID, Reading["source"]]> = [
  [CHAR_GSR_UUID, "gsr"],
  [CHAR_HR_UUID, "hr"],
  [CHAR_TEMP_UUID, "temp"],
  [CHAR_IMU_UUID, "imu"],
];

export class BleDataSource implements DataSource {
  private device: BluetoothDevice | null = null;
  private readingListeners: Array<(r: Reading) => void> = [];
  private statusListeners: Array<(s: ConnectionStatus) => void> = [];
  private deviceInfoListeners: Array<(d: DeviceInfo) => void> = [];
  private batteryListeners: Array<(percent: number) => void> = [];
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

  async start(): Promise<void> {
    try {
      if (!this.device) {
        this.device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [SWEATSALT_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID, BATTERY_SERVICE_UUID],
        });
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
        ]) {
          try {
            await step();
          } catch {
            // that service's data just won't arrive until the device exposes it
          }
        }
      }
    } catch {
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
  }

  stop(): void {
    this.releaseNotifyHandlers(true);
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
}
