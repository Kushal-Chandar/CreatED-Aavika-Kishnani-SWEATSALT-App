const STANDARD_GRAVITY = 9.80665;
const MAX_G = 4; // matches mockDataSource's imu RANGES.imu.max

export function magnitudeToG(x: number, y: number, z: number): number {
  const magnitude = Math.sqrt(x * x + y * y + z * z) / STANDARD_GRAVITY;
  return Math.min(MAX_G, Math.max(0, magnitude));
}
