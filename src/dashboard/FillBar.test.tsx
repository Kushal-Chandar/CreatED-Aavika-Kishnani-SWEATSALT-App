import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FillBar } from "./FillBar";

describe("FillBar", () => {
  it("renders a fill sized to the given percent", () => {
    render(<FillBar percent={70} accent="#ff5a36" />);
    const fill = screen.getByTestId("fill-bar-fill");
    expect(fill).toHaveStyle({ height: "70%" });
  });

  it("clamps out-of-range percents into 0-100", () => {
    render(<FillBar percent={140} accent="#ff5a36" />);
    expect(screen.getByTestId("fill-bar-fill")).toHaveStyle({ height: "100%" });
  });

  it("renders graduation tick labels when given", () => {
    render(
      <FillBar
        percent={40}
        accent="#ff5a36"
        size="lg"
        ticks={[
          { percent: 0, label: "Safe" },
          { percent: 100, label: "High" },
        ]}
      />
    );
    expect(screen.getByText("Safe")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("renders no tick labels when none are given", () => {
    render(<FillBar percent={40} accent="#ff5a36" />);
    expect(screen.queryByText("Safe")).not.toBeInTheDocument();
  });
});
