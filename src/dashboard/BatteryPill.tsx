interface BatteryPillProps {
  percent: number | undefined;
}

function levelColor(percent: number): string {
  if (percent <= 20) return "var(--color-danger)";
  if (percent <= 40) return "var(--color-warn)";
  return "var(--color-safe)";
}

export function BatteryPill({ percent }: BatteryPillProps) {
  const known = percent !== undefined;
  const fillColor = known ? levelColor(percent) : "var(--color-hairline)";

  return (
    <div
      className="border-hairline flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs"
      data-testid="battery-pill"
    >
      <span className="border-hairline relative h-[11px] w-[22px] rounded-[2px] border p-px">
        <span
          className="block h-full rounded-[1px] transition-[width] duration-500"
          style={{ width: known ? `${percent}%` : "0%", background: fillColor }}
        />
        <span className="bg-hairline absolute top-[3px] -right-[3px] h-[5px] w-[2px] rounded-r-[1px]" />
      </span>
      <span>{known ? `${percent}%` : "--"}</span>
    </div>
  );
}
