import type { DataSource, Reading, ConnectionStatus } from "./types";

type MockSource = Reading["source"];

const RANGES: Record<MockSource, { min: number; max: number; start: number }> = {
  gsr: { min: 0.2, max: 20, start: 5 },
  hr: { min: 50, max: 180, start: 72 },
  temp: { min: 30, max: 39, start: 33.5 },
  imu: { min: 0, max: 4, start: 1 },
};

export class MockDataSource implements DataSource {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readingListeners: Array<(r: Reading) => void> = [];
  private statusListeners: Array<(s: ConnectionStatus) => void> = [];
  private current: Record<MockSource, number> = {
    gsr: RANGES.gsr.start,
    hr: RANGES.hr.start,
    temp: RANGES.temp.start,
    imu: RANGES.imu.start,
  };

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      (Object.keys(RANGES) as MockSource[]).forEach((source) => {
        const { min, max } = RANGES[source];
        const step = (max - min) * 0.03;
        const delta = (Math.random() - 0.5) * step * 2;
        this.current[source] = Math.min(max, Math.max(min, this.current[source] + delta));
        const reading: Reading = { source, value: this.current[source], ts: Date.now() };
        this.readingListeners.forEach((cb) => cb(reading));
      });
    }, 1000);
    this.statusListeners.forEach((cb) => cb("connected"));
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  onReading(cb: (r: Reading) => void): void {
    this.readingListeners.push(cb);
  }

  onStatusChange(cb: (s: ConnectionStatus) => void): void {
    this.statusListeners.push(cb);
  }
}
