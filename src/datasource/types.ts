export type SensorSource = "heatIndex" | "gsr" | "hr" | "temp" | "imu";

export interface Reading {
  source: Exclude<SensorSource, "heatIndex">;
  value: number;
  ts: number;
}

export type ConnectionStatus = "connected" | "disconnected";

export interface DataSource {
  start(): void;
  stop(): void;
  onReading(cb: (reading: Reading) => void): void;
  onStatusChange(cb: (status: ConnectionStatus) => void): void;
}
