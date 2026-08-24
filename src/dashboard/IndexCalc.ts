export interface SensorSnapshot {
  gsr: number;
  hr: number;
  temp: number;
}

// Placeholder weighted formula — NOT the real fusion algorithm.
// The real algorithm is fusion.py (session 13); this stand-in exists
// only so the dashboard has something to display before firmware/BLE
// integration lands at session 15. See the design spec's
// "Heat-stress index (placeholder)" section.
const WEIGHTS = { gsr: 0.4, hr: 0.3, temp: 0.3 };

const RANGES = {
  gsr: { min: 0.2, max: 20 },
  hr: { min: 50, max: 180 },
  temp: { min: 30, max: 39 },
};

function normalize(value: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return (clamped - min) / (max - min);
}

export function computeHeatIndex(snapshot: SensorSnapshot): number {
  const gsrScore = normalize(snapshot.gsr, RANGES.gsr.min, RANGES.gsr.max);
  const hrScore = normalize(snapshot.hr, RANGES.hr.min, RANGES.hr.max);
  const tempScore = normalize(snapshot.temp, RANGES.temp.min, RANGES.temp.max);
  const combined = gsrScore * WEIGHTS.gsr + hrScore * WEIGHTS.hr + tempScore * WEIGHTS.temp;
  return Math.round(combined * 100);
}
