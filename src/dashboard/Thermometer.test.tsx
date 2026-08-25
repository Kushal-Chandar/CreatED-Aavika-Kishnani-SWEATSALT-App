import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Thermometer } from "./Thermometer";

describe("Thermometer", () => {
  it("fills the full track at 100 percent", () => {
    render(<Thermometer percent={100} accent="#ff5a36" />);
    expect(screen.getByTestId("thermometer-fill")).toHaveStyle({ width: "100%" });
  });

  it("renders no fill at 0 percent", () => {
    render(<Thermometer percent={0} accent="#ff5a36" />);
    expect(screen.getByTestId("thermometer-fill")).toHaveStyle({ width: "0%" });
  });

  it("clamps percents above 100", () => {
    render(<Thermometer percent={140} accent="#ff5a36" />);
    expect(screen.getByTestId("thermometer-fill")).toHaveStyle({ width: "100%" });
  });

  it("clamps percents below 0", () => {
    render(<Thermometer percent={-20} accent="#ff5a36" />);
    expect(screen.getByTestId("thermometer-fill")).toHaveStyle({ width: "0%" });
  });
});
