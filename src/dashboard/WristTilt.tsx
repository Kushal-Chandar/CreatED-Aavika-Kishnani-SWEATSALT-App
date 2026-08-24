import { motion, useReducedMotion } from "framer-motion";

interface WristTiltProps {
  value: number | undefined;
}

// IMU mock range is 0-4g (see mockDataSource.ts RANGES.imu). Mapped to a
// gentle two-axis tilt on a small 3D wrist/band silhouette — cheaper than
// a real 3D model (no WebGL, no new dependency) while still reading as
// "this thing is moving on someone's wrist."
export function WristTilt({ value }: WristTiltProps) {
  const g = value ?? 1;
  const rotateX = Math.min(28, g * 6);
  const rotateY = Math.min(24, Math.max(-24, (g - 1) * 12));
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="wrist-tilt">
      <div className="wrist-tilt__stage">
        <motion.div
          className="wrist-tilt__band"
          data-testid="wrist-tilt-band"
          animate={{ rotateX, rotateY }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
        >
          <div className="wrist-tilt__face" />
        </motion.div>
      </div>
    </div>
  );
}
