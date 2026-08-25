export interface Tilt {
  rotateX: number;
  rotateY: number;
}

const MAX_DEGREES = 45;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// Gravity's *magnitude* barely changes as a phone tilts (it's ~9.8 m/s^2
// no matter the orientation) — only its *direction* relative to the
// device does. So orientation has to come from the angle of the gravity
// vector (atan2 of the components), not from the vector's length.
export function tiltFromGravity(x: number, y: number, z: number): Tilt {
  const rotateX = clamp((Math.atan2(-y, z) * 180) / Math.PI, -MAX_DEGREES, MAX_DEGREES);
  const rotateY = clamp((Math.atan2(x, z) * 180) / Math.PI, -MAX_DEGREES, MAX_DEGREES);
  return { rotateX, rotateY };
}
