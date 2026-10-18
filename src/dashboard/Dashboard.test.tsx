import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { Dashboard } from "./Dashboard";
import { ThemeProvider } from "../theme/ThemeContext";
import type { DataSource, Reading, ConnectionStatus, DeviceInfo } from "../datasource/types";

class FakeDataSource implements DataSource {
  private readingCb: ((r: Reading) => void) | null = null;
  private statusCb: ((s: ConnectionStatus) => void) | null = null;
  private deviceInfoCb: ((info: DeviceInfo) => void) | null = null;
  private batteryCb: ((percent: number) => void) | null = null;
  stopCalls = 0;

  start(): void {
    this.statusCb?.("connected");
  }
  stop(): void {
    this.stopCalls += 1;
  }
  onReading(cb: (r: Reading) => void): () => void {
    this.readingCb = cb;
    return () => {
      this.readingCb = null;
    };
  }
  onStatusChange(cb: (s: ConnectionStatus) => void): () => void {
    this.statusCb = cb;
    return () => {
      this.statusCb = null;
    };
  }
  onDeviceInfo(cb: (info: DeviceInfo) => void): () => void {
    this.deviceInfoCb = cb;
    return () => {
      this.deviceInfoCb = null;
    };
  }
  onBattery(cb: (percent: number) => void): () => void {
    this.batteryCb = cb;
    return () => {
      this.batteryCb = null;
    };
  }
  get hasListeners(): boolean {
    return !!(this.readingCb || this.statusCb || this.deviceInfoCb || this.batteryCb);
  }
  emit(reading: Reading): void {
    this.readingCb?.(reading);
  }
  disconnect(): void {
    this.statusCb?.("disconnected");
  }
  reportDeviceInfo(info: DeviceInfo): void {
    this.deviceInfoCb?.(info);
  }
}

describe("Dashboard", () => {
  it("unregisters every data-source listener and stops the source on unmount", () => {
    const source = new FakeDataSource();
    const { unmount } = render(
      <ThemeProvider>
        <Dashboard dataSource={source} />
      </ThemeProvider>
    );
    expect(source.hasListeners).toBe(true);

    unmount();

    expect(source.hasListeners).toBe(false);
    expect(source.stopCalls).toBe(1);
  });

  it("moves its listeners to the new source when the data source prop changes", () => {
    const first = new FakeDataSource();
    const second = new FakeDataSource();
    const { rerender } = render(
      <ThemeProvider>
        <Dashboard dataSource={first} />
      </ThemeProvider>
    );

    rerender(
      <ThemeProvider>
        <Dashboard dataSource={second} />
      </ThemeProvider>
    );

    expect(first.hasListeners).toBe(false);
    expect(first.stopCalls).toBe(1);
    expect(second.hasListeners).toBe(true);
  });

  it("renders visible cards from theme.json and updates on readings", () => {
    const source = new FakeDataSource();
    render(
      <ThemeProvider>
        <Dashboard dataSource={source} />
      </ThemeProvider>
    );

    expect(screen.getByTestId("card-gsr")).toBeInTheDocument();
    expect(screen.getByTestId("card-imu")).toBeInTheDocument();

    act(() => {
      source.emit({ source: "gsr", value: 6.5, ts: Date.now() });
    });
    expect(screen.getByTestId("card-gsr")).toHaveTextContent("6.5");
  });

  it("computes and displays the heat index once gsr, hr, and temp have all reported", () => {
    const source = new FakeDataSource();
    render(
      <ThemeProvider>
        <Dashboard dataSource={source} />
      </ThemeProvider>
    );

    act(() => {
      source.emit({ source: "gsr", value: 10.1, ts: Date.now() });
      source.emit({ source: "hr", value: 115, ts: Date.now() });
      source.emit({ source: "temp", value: 34.5, ts: Date.now() });
    });

    const heatIndexCard = screen.getByTestId("card-heatIndex");
    expect(heatIndexCard.textContent).not.toContain("--");
  });

  it("shows a disconnected banner when the data source reports disconnected", () => {
    const source = new FakeDataSource();
    render(
      <ThemeProvider>
        <Dashboard dataSource={source} />
      </ThemeProvider>
    );

    act(() => {
      source.disconnect();
    });
    expect(screen.getByTestId("disconnected-banner")).toBeInTheDocument();
  });

  it("shows a connect-device button when onConnectDevice is provided and no device is paired yet", () => {
    const source = new FakeDataSource();
    const onConnectDevice = vi.fn();
    render(
      <ThemeProvider>
        <Dashboard dataSource={source} onConnectDevice={onConnectDevice} />
      </ThemeProvider>
    );

    const button = screen.getByTestId("connect-device-button");
    fireEvent.click(button);
    expect(onConnectDevice).toHaveBeenCalledTimes(1);
  });

  it("omits the connect-device button once a real device has reported its info", () => {
    const source = new FakeDataSource();
    render(
      <ThemeProvider>
        <Dashboard dataSource={source} onConnectDevice={() => {}} />
      </ThemeProvider>
    );

    act(() => {
      source.reportDeviceInfo({ id: "SWST-1", name: "SweatSalt" });
    });
    expect(screen.queryByTestId("connect-device-button")).not.toBeInTheDocument();
  });
});
