import { useEffect, useRef, useState } from "react";
import { magnitudeToG } from "./deviceMotionMagnitude";
import { tiltFromGravity, type Tilt } from "./deviceOrientationTilt";

interface DeviceMotionState {
  value: number | undefined;
  tilt: Tilt | undefined;
  error: string | null;
  retry: () => void;
}

// Raw devicemotion events fire ~60/s and are jittery even holding a phone
// still. A trailing low-pass filter (each sample nudged toward the raw
// reading rather than snapping to it) turns that into the smooth "tilt
// following your hand" motion the tile is meant to show. Lower = smoother
// but laggier; 0.15 reads as smoothed without feeling unresponsive.
const SMOOTHING = 0.15;

type PermissionRequestable = {
  requestPermission?: () => Promise<"granted" | "denied">;
};

// Lets the phone's (or a DevTools-simulated) real accelerometer drive the
// imu channel — a stand-in for the real IMU while the hardware isn't
// wired up yet (session 15). iOS gates this behind a permission prompt
// that must fire from a user gesture — this hook is only ever enabled
// from a tap, never on mount. `retry` re-runs the request without
// requiring `enabled` to toggle off first — needed because WebKit caches
// a real denial and won't re-prompt just because `enabled` stays true.
export function useDeviceMotion(enabled: boolean): DeviceMotionState {
  const [value, setValue] = useState<number | undefined>(undefined);
  const [tilt, setTilt] = useState<Tilt | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const smoothed = useRef<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setValue(undefined);
      setTilt(undefined);
      setError(null);
      return;
    }

    setError(null);
    smoothed.current = null;
    let cancelled = false;

    function handleMotion(event: DeviceMotionEvent) {
      const acc = event.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

      const prev = smoothed.current;
      const next = prev
        ? {
            x: prev.x + SMOOTHING * (acc.x - prev.x),
            y: prev.y + SMOOTHING * (acc.y - prev.y),
            z: prev.z + SMOOTHING * (acc.z - prev.z),
          }
        : { x: acc.x, y: acc.y, z: acc.z };
      smoothed.current = next;

      setValue(magnitudeToG(next.x, next.y, next.z));
      setTilt(tiltFromGravity(next.x, next.y, next.z));
    }

    async function start() {
      const ctor =
        typeof DeviceMotionEvent !== "undefined" ? (DeviceMotionEvent as unknown as PermissionRequestable) : undefined;

      if (ctor?.requestPermission) {
        try {
          const result = await ctor.requestPermission();
          if (cancelled) return;
          if (result !== "granted") {
            setError("Motion permission denied");
            return;
          }
        } catch {
          if (!cancelled) setError("Motion permission request failed");
          return;
        }
      }

      window.addEventListener("devicemotion", handleMotion);
    }

    void start();
    return () => {
      cancelled = true;
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [enabled, attempt]);

  function retry() {
    setAttempt((n) => n + 1);
  }

  return { value, tilt, error, retry };
}
