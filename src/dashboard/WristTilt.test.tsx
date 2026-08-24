import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WristTilt } from "./WristTilt";

describe("WristTilt", () => {
  it("renders for a real motion value", () => {
    render(<WristTilt value={2.5} />);
    expect(screen.getByTestId("wrist-tilt-band")).toBeInTheDocument();
  });

  it("renders a resting tilt when no value is available yet", () => {
    render(<WristTilt value={undefined} />);
    expect(screen.getByTestId("wrist-tilt-band")).toBeInTheDocument();
  });
});
