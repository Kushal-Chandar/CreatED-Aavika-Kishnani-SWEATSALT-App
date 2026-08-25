import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import { Sparkline } from "./Sparkline";
import { appendEntry } from "../log/logStore";

describe("Sparkline", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("sweatsalt-log");
  });

  it("renders with no points before any data exists", () => {
    render(<Sparkline source="hr" />);
    expect(screen.getByTestId("sparkline-hr")).toHaveAttribute("data-points", "0");
  });

  it("renders a trend line once matching entries load", async () => {
    const now = Date.now();
    await appendEntry({ source: "hr", value: 70, ts: now - 1000 });
    await appendEntry({ source: "hr", value: 90, ts: now });

    render(<Sparkline source="hr" />);

    await waitFor(() => {
      expect(screen.getByTestId("sparkline-hr")).toHaveAttribute("data-points", "2");
    });
  });

  it("ignores entries from other sensor sources", async () => {
    const now = Date.now();
    await appendEntry({ source: "gsr", value: 5, ts: now });

    render(<Sparkline source="hr" />);

    await waitFor(() => {
      expect(screen.getByTestId("sparkline-hr")).toHaveAttribute("data-points", "0");
    });
  });
});
