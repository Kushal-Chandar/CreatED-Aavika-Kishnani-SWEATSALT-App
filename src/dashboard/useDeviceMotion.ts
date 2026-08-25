import { useEffect, useState } from "react";
import { magnitudeToG } from "./deviceMotionMagnitude";

interface DeviceMotionState {
  value: number | undefined;
  error: string | null;
  retry: () => void;
}

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
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setValue(undefined);
      setError(null);
      return;
    }

    setError(null);
    let cancelled = false;

    function handleMotion(event: DeviceMotionEvent) {
      const acc = event.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
      setValue(magnitudeToG(acc.x, acc.y, acc.z));
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

  return { value, error, retry };
}
