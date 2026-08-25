import type { LogEntry } from "../log/logStore";

export function recentSeries(
  entries: LogEntry[],
  source: string,
  now: number,
  windowMs: number,
  maxPoints: number
): number[] {
  const cutoff = now - windowMs;
  const inWindow = entries
    .filter((e) => e.source === source && e.ts >= cutoff && e.ts <= now)
    .sort((a, b) => a.ts - b.ts);

  if (inWindow.length <= maxPoints) return inWindow.map((e) => e.value);

  const step = inWindow.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, i) => inWindow[Math.floor(i * step)].value);
}
