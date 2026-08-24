import type { DataSource, Reading, ConnectionStatus } from "./types";

type MockSource = Reading["source"];

const RANGES: Record<MockSource, { min: number; max: number; start: number }> = {
  gsr: { min: 0.2, max: 20, start: 5 },
  hr: { min: 50, max: 180, start: 72 },
  temp: { min: 30, max: 39, start: 33.5 },
  imu: { min: 0, max: 4, start: 1 },
};

// One 30-tick (30s) cycle: normal drift, a 5-tick spike toward the high
// end of each range (exercises the "elevated"/"high" hero states), then
// a 4-tick simulated disconnect (exercises the disconnected banner) —
// all automatic, so a live demo shows every alert state without anyone
// touching devtools. `tick` is 1-based (incremented before use), so
// `cycle` runs 1..29 then wraps to 0 on the 30th tick of each cycle.
const CYCLE_TICKS = 30;
const SPIKE_START = 10;
const SPIKE_END = 15;
const DISCONNECT_START = 26;

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
  private tick = 0;
  private connected = true;

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.tickOnce(), 1000);
    this.statusListeners.forEach((cb) => cb("connected"));
  }

  private tickOnce(): void {
    this.tick += 1;
    const cycle = this.tick % CYCLE_TICKS;

    if (cycle === DISCONNECT_START) {
      this.connected = false;
      this.statusListeners.forEach((cb) => cb("disconnected"));
      return;
    }

    if (!this.connected) {
      if (cycle !== 0) {
        return;
      }
      this.connected = true;
      this.statusListeners.forEach((cb) => cb("connected"));
      // fall through — this tick also emits a normal reading
    }

    const spiking = cycle >= SPIKE_START && cycle < SPIKE_END;

    (Object.keys(RANGES) as MockSource[]).forEach((source) => {
      const { min, max } = RANGES[source];
      const step = (max - min) * (spiking ? 0.08 : 0.03);
      const bias = spiking ? (max - this.current[source]) * 0.15 : 0;
      const delta = (Math.random() - 0.5) * step * 2 + bias;
      this.current[source] = Math.min(max, Math.max(min, this.current[source] + delta));
      const reading: Reading = { source, value: this.current[source], ts: Date.now() };
      this.readingListeners.forEach((cb) => cb(reading));
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.tick = 0;
    this.connected = true;
  }

  onReading(cb: (r: Reading) => void): void {
    this.readingListeners.push(cb);
  }

  onStatusChange(cb: (s: ConnectionStatus) => void): void {
    this.statusListeners.push(cb);
  }
}
