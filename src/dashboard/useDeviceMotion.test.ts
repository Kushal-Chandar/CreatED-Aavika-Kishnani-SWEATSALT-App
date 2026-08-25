import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDeviceMotion } from "./useDeviceMotion";

function dispatchMotion(x: number, y: number, z: number) {
  const event = new Event("devicemotion") as DeviceMotionEvent;
  Object.defineProperty(event, "accelerationIncludingGravity", {
    value: { x, y, z },
    configurable: true,
  });
  window.dispatchEvent(event);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDeviceMotion", () => {
  it("stays undefined and ignores events while disabled", () => {
    const { result } = renderHook(() => useDeviceMotion(false));
    dispatchMotion(0, 0, 9.80665);
    expect(result.current.value).toBeUndefined();
  });

  it("updates from live devicemotion events once enabled (no permission API)", async () => {
    vi.stubGlobal("DeviceMotionEvent", class {});
    const { result } = renderHook(() => useDeviceMotion(true));

    dispatchMotion(0, 0, 9.80665);

    await waitFor(() => {
      expect(result.current.value).toBeCloseTo(1, 2);
    });
  });

  it("derives a tilt (not just magnitude) from live events", async () => {
    vi.stubGlobal("DeviceMotionEvent", class {});
    const { result } = renderHook(() => useDeviceMotion(true));

    dispatchMotion(9.80665, 0, 0);

    await waitFor(() => {
      expect(result.current.tilt?.rotateY).toBeCloseTo(45, 2);
    });
  });

  it("attaches the listener only after permission is granted", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("DeviceMotionEvent", class {
      static requestPermission = requestPermission;
    });

    const { result } = renderHook(() => useDeviceMotion(true));

    await waitFor(() => expect(requestPermission).toHaveBeenCalled());
    dispatchMotion(3, 4, 0);

    await waitFor(() => {
      expect(result.current.value).toBeCloseTo(5 / 9.80665, 4);
    });
  });

  it("surfaces an error and never sets a value when permission is denied", async () => {
    vi.stubGlobal("DeviceMotionEvent", class {
      static requestPermission = vi.fn().mockResolvedValue("denied");
    });

    const { result } = renderHook(() => useDeviceMotion(true));

    await waitFor(() => {
      expect(result.current.error).toBe("Motion permission denied");
    });
    expect(result.current.value).toBeUndefined();
  });

  it("re-requests permission when retry is called, without needing to toggle enabled off", async () => {
    const requestPermission = vi.fn().mockResolvedValueOnce("denied").mockResolvedValueOnce("granted");
    vi.stubGlobal("DeviceMotionEvent", class {
      static requestPermission = requestPermission;
    });

    const { result } = renderHook(() => useDeviceMotion(true));

    await waitFor(() => expect(result.current.error).toBe("Motion permission denied"));

    result.current.retry();

    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(2));
    dispatchMotion(0, 0, 9.80665);

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.value).toBeCloseTo(1, 2);
    });
  });
});
