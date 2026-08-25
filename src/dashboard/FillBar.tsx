interface Tick {
  percent: number;
  label: string;
}

interface FillBarProps {
  percent: number;
  accent: string;
  size?: "sm" | "lg";
  ticks?: Tick[];
}

// A rising fill in a rounded-bottom vessel — a salinity-test vial, not a
// generic progress ring. Doubles as the small temp-tile bar (sm, no ticks)
// and the hero risk gauge (lg, with graduation labels).
export function FillBar({ percent, accent, size = "sm", ticks }: FillBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const dims = size === "lg" ? "h-40 w-9" : "h-16 w-2.5";
  const shape = size === "lg" ? "rounded-t-md rounded-b-[26px]" : "rounded-full";

  return (
    <div className="flex items-stretch gap-3">
      <div className={`border-hairline relative ${dims} ${shape} overflow-hidden border`} data-testid="fill-bar">
        <div
          className="absolute inset-x-0 bottom-0 transition-[height] duration-500"
          data-testid="fill-bar-fill"
          style={{ height: `${clamped}%`, background: accent }}
        />
      </div>
      {ticks && ticks.length > 0 && (
        <div className="flex flex-col justify-between py-1">
          {[...ticks]
            .sort((a, b) => b.percent - a.percent)
            .map((tick) => (
              <div
                key={tick.label}
                className="flex items-center gap-1.5 font-sans text-[0.65rem] whitespace-nowrap text-white/55 tracking-wider uppercase"
              >
                <span className="bg-hairline h-px w-2.5" aria-hidden="true" />
                {tick.label}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
