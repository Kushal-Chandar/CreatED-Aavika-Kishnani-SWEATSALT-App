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
    <div className="mt-1.5 flex min-h-14 flex-1 items-center justify-center [perspective:400px]">
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
