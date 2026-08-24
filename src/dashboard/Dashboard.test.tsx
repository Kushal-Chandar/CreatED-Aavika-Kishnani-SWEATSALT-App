import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Dashboard } from "./Dashboard";
import { ThemeProvider } from "../theme/ThemeContext";
import type { DataSource, Reading, ConnectionStatus } from "../datasource/types";

class FakeDataSource implements DataSource {
  private readingCb: ((r: Reading) => void) | null = null;
  private statusCb: ((s: ConnectionStatus) => void) | null = null;

  start(): void {
    this.statusCb?.("connected");
  }
  stop(): void {}
  onReading(cb: (r: Reading) => void): void {
    this.readingCb = cb;
  }
  onStatusChange(cb: (s: ConnectionStatus) => void): void {
    this.statusCb = cb;
  }
  emit(reading: Reading): void {
    this.readingCb?.(reading);
  }
  disconnect(): void {
    this.statusCb?.("disconnected");
  }
}

describe("Dashboard", () => {
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
});
