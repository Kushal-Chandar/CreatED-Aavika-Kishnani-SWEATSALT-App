// iOS Safari has no Web Bluetooth API at all (Bluefy and similar
// extension-browsers add it) — gate any "Connect device" UI on this so
// the button simply doesn't render where it could never work.
export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}
