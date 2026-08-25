import { useEffect, useState } from "react";
import { queryEntries } from "../log/logStore";
import { recentSeries } from "./sparklineData";
import { smoothSeries } from "./smoothSeries";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_POINTS = 24;
const POLL_MS = 5000;
const SMOOTHING_WINDOW = 3;
// Vertical padding (in viewBox units) so the line doesn't touch the top/
// bottom edge when it hits the series min/max.
const Y_PAD = 12;

interface SparklineProps {
  source: string;
  accent?: string;
}

export function Sparkline({ source, accent = "currentColor" }: SparklineProps) {
  const [series, setSeries] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const entries = await queryEntries();
      if (cancelled) return;
      setSeries(recentSeries(entries, source, Date.now(), WINDOW_MS, MAX_POINTS));
    }

    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [source]);

  const smoothed = smoothSeries(series, SMOOTHING_WINDOW);
  const min = smoothed.length ? Math.min(...smoothed) : 0;
  const max = smoothed.length ? Math.max(...smoothed) : 1;
  const span = max - min || 1;
  const points = smoothed
    .map((v, i) => {
      const x = smoothed.length > 1 ? (i / (smoothed.length - 1)) * 100 : 0;
      const y = Y_PAD + (100 - Y_PAD * 2) * (1 - (v - min) / span);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-6 w-full"
      data-testid={`sparkline-${source}`}
      data-points={series.length}
    >
      {smoothed.length > 1 && (
        <polyline
          points={points}
          fill="none"
          stroke={accent}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
