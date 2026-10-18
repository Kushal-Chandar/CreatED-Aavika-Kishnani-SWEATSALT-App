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

// Each `onX` registers a listener and returns a function that unregisters
// it, so a consumer (e.g. a React effect) can clean up without leaking
// callbacks into a source that outlives it.
export type Unsubscribe = () => void;

export interface DataSource {
  start(): void;
  stop(): void;
  onReading(cb: (reading: Reading) => void): Unsubscribe;
  onStatusChange(cb: (status: ConnectionStatus) => void): Unsubscribe;
  onDeviceInfo(cb: (info: DeviceInfo) => void): Unsubscribe;
  // 0-100. Real hardware reports this via the standard BLE Battery
  // Service (0x180F) — see the design spec's battery ADC voltage-divider
  // note for how firmware derives the percentage.
  onBattery(cb: (percent: number) => void): Unsubscribe;
}
