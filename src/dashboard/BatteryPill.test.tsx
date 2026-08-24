import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BatteryPill } from "./BatteryPill";

describe("BatteryPill", () => {
  it("shows the percentage when known", () => {
    render(<BatteryPill percent={72} />);
    expect(screen.getByTestId("battery-pill")).toHaveTextContent("72%");
  });

  it("shows a placeholder when unknown", () => {
    render(<BatteryPill percent={undefined} />);
    expect(screen.getByTestId("battery-pill")).toHaveTextContent("--");
  });
});
