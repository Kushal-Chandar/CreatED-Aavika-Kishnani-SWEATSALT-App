import type { DataSource, Reading, ConnectionStatus } from "./types";

// GATT service/characteristic UUIDs are not yet defined — firmware
// (session 14, 2026-09-12) doesn't exist yet. This class implements the
// DataSource contract with a working device-pick/connect/disconnect
// flow so it's structurally ready to drop into App.tsx; characteristic
// subscription is wired in at session 15 once the firmware's UUIDs are
// known. See the design spec's "Out of scope" section.
export class BleDataSource implements DataSource {
  private device: BluetoothDevice | null = null;
  private readingListeners: Array<(r: Reading) => void> = [];
  private statusListeners: Array<(s: ConnectionStatus) => void> = [];

  private emitStatus(status: ConnectionStatus): void {
    this.statusListeners.forEach((cb) => cb(status));
  }

  async start(): Promise<void> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
      });
      this.device.addEventListener("gattserverdisconnected", () => {
        this.emitStatus("disconnected");
      });
      await this.device.gatt?.connect();
      this.emitStatus("connected");
      // Characteristic subscription (session 15): once firmware's GATT
      // layout is known, subscribe to its notify characteristics here
      // and forward each notification to this.readingListeners.
    } catch {
      this.emitStatus("disconnected");
    }
  }

  stop(): void {
    this.device?.gatt?.disconnect();
    this.device = null;
  }

  onReading(cb: (r: Reading) => void): void {
    this.readingListeners.push(cb);
  }

  onStatusChange(cb: (s: ConnectionStatus) => void): void {
    this.statusListeners.push(cb);
  }
}
