export type SensorSource = "heatIndex" | "gsr" | "hr" | "temp" | "imu";

export interface Reading {
  source: Exclude<SensorSource, "heatIndex">;
  value: number;
  ts: number;
}

export type ConnectionStatus = "connected" | "disconnected";

// Firmware-assigned unique ID + a human-friendly paired name — read from
// the device's standard BLE Device Information Service (0x180A) once
// real hardware is wired in at session 15.
export interface DeviceInfo {
  id: string;
  name: string;
}

export interface DataSource {
  start(): void;
  stop(): void;
  onReading(cb: (reading: Reading) => void): void;
  onStatusChange(cb: (status: ConnectionStatus) => void): void;
  onDeviceInfo(cb: (info: DeviceInfo) => void): void;
  // 0-100. Real hardware reports this via the standard BLE Battery
  // Service (0x180F) — see the design spec's battery ADC voltage-divider
  // note for how firmware derives the percentage.
  onBattery(cb: (percent: number) => void): void;
}
