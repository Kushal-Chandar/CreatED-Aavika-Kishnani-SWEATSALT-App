import { motion, useReducedMotion } from "framer-motion";
import type { Tilt } from "./deviceOrientationTilt";

interface WristTiltProps {
  value: number | undefined;
  tilt?: Tilt;
}

// IMU mock range is 0-4g (see mockDataSource.ts RANGES.imu). Mapped to a
// gentle two-axis tilt on a small 3D wrist/band silhouette — cheaper than
// a real 3D model (no WebGL, no new dependency) while still reading as
// "this thing is moving on someone's wrist." When a real `tilt` (from a
// phone's own accelerometer, already smoothed) is available, that drives
// the rotation directly instead — it's actual orientation, not a g-force
// guess.
export function WristTilt({ value, tilt }: WristTiltProps) {
  const g = value ?? 1;
  const rotateX = tilt ? tilt.rotateX : Math.min(28, g * 6);
  const rotateY = tilt ? tilt.rotateY : Math.min(24, Math.max(-24, (g - 1) * 12));
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="flex min-h-14 flex-1 items-center justify-center [perspective:400px]">
      <motion.div
        className="border-hairline relative h-[26px] w-[60px] rounded-lg border bg-[linear-gradient(135deg,rgba(237,230,214,0.14),rgba(237,230,214,0.04))] [transform-style:preserve-3d]"
        data-testid="wrist-tilt-band"
        animate={{ rotateX, rotateY }}
        transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
      >
        <div className="absolute [inset:4px_10px] rounded-[3px] bg-[rgba(237,230,214,0.18)]" />
      </motion.div>
    </div>
  );
}
