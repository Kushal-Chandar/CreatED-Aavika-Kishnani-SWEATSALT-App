import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders label and value for a known source", () => {
    render(<Card config={{ source: "gsr", visible: true, size: "small", order: 0 }} value={5.234} />);
    expect(screen.getByText("GSR")).toBeInTheDocument();
    expect(screen.getByText("5.2")).toBeInTheDocument();
  });

  it("renders a placeholder for an unrecognized source", () => {
    render(<Card config={{ source: "bogus", visible: true, size: "small", order: 0 }} value={1} />);
    expect(screen.getByText("Unknown source: bogus")).toBeInTheDocument();
  });

  it("renders a dash when no value is available yet", () => {
    render(<Card config={{ source: "hr", visible: true, size: "small", order: 0 }} value={undefined} />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders a numeric g-force readout for motion alongside the tilt level", () => {
    render(<Card config={{ source: "imu", visible: true, size: "small", order: 0 }} value={1.8} />);
    expect(screen.getByText("Motion")).toBeInTheDocument();
    expect(screen.getByText("1.8")).toBeInTheDocument();
    expect(screen.getByText("g")).toBeInTheDocument();
    expect(screen.getByTestId("wrist-tilt-band")).toBeInTheDocument();
  });
});
