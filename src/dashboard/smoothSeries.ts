// Trailing moving average — the mock data source adds full-range random
// noise every tick, so a raw connect-the-dots line reads as a scribble
// rather than a trend. This smooths without inventing data (no lookahead).
export function smoothSeries(series: number[], window: number): number[] {
  if (window <= 1) return series;
  return series.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = series.slice(start, i + 1);
    return slice.reduce((sum, v) => sum + v, 0) / slice.length;
  });
}
