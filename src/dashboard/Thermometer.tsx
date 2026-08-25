interface ThermometerProps {
  percent: number;
  accent: string;
}

// Horizontal bulb thermometer — same full-width track + circular marker
// footprint as the sparklines and the tilt bar, so all four tiles read as
// one row. Bulb (the reservoir) sits at the start; the stem fills toward
// it as temperature rises.
export function Thermometer({ percent, accent }: ThermometerProps) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div className="flex h-6 w-full items-center gap-1.5" data-testid="thermometer">
      <div
        className="h-3.5 w-3.5 shrink-0 rounded-full border"
        style={{ background: accent, borderColor: "var(--color-hairline)" }}
        aria-hidden="true"
      />
      <div className="border-hairline relative h-1.5 flex-1 overflow-hidden rounded-full border">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          data-testid="thermometer-fill"
          style={{ width: `${clamped}%`, background: accent }}
        />
      </div>
    </div>
  );
}
