import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider, useThemeConfig } from "./ThemeContext";
import { ThemeEditorPanel } from "./ThemeEditorPanel";

function CurrentAccent() {
  const theme = useThemeConfig();
  return <div data-testid="accent">{theme.colors.accent}</div>;
}

describe("ThemeEditorPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("updates the live theme immediately when a color changes", () => {
    render(
      <ThemeProvider>
        <CurrentAccent />
        <ThemeEditorPanel />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText("Edit theme"));
    const accentInput = screen.getByLabelText("Accent");
    fireEvent.change(accentInput, { target: { value: "#00ff00" } });

    expect(screen.getByTestId("accent")).toHaveTextContent("#00ff00");
  });

  it("posts the current theme to /__theme/save when Save is clicked", async () => {
    render(
      <ThemeProvider>
        <ThemeEditorPanel />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText("Edit theme"));
    await act(async () => {
      fireEvent.click(screen.getByText("Save to theme.json"));
    });

    expect(fetch).toHaveBeenCalledWith("/__theme/save", expect.objectContaining({ method: "POST" }));
  });
});
