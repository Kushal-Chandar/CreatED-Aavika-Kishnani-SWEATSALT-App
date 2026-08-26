import { Suspense, lazy, useMemo, useState } from "react";
import { ThemeProvider } from "./theme/ThemeContext";
import { Dashboard } from "./dashboard/Dashboard";
import { InstallPrompt } from "./dashboard/InstallPrompt";
import { MockDataSource } from "./datasource/mockDataSource";
import { BleDataSource } from "./datasource/bleDataSource";
import { isWebBluetoothSupported } from "./datasource/webBluetoothSupport";

// Dev-only: excluded from the production bundle because this dynamic
// import only runs behind `import.meta.env.DEV`, a build-time constant
// that's `false` in `vite build` — Rollup drops the whole branch (and
// the ThemeEditorPanel chunk) from what ships.
const ThemeEditorPanel = import.meta.env.DEV
  ? lazy(() => import("./theme/ThemeEditorPanel").then((m) => ({ default: m.ThemeEditorPanel })))
  : null;

export function App() {
  const [useBle, setUseBle] = useState(false);
  // requestDevice() needs to fire from this tap's own call stack, so the
  // Dashboard button flips this flag directly rather than going through
  // an async wrapper — the resulting effect-driven `dataSource.start()`
  // is still inside the same user gesture (same pattern useDeviceMotion
  // already relies on for iOS's motion-permission prompt).
  const dataSource = useMemo(() => (useBle ? new BleDataSource() : new MockDataSource()), [useBle]);

  return (
    <ThemeProvider>
      <Dashboard
        dataSource={dataSource}
        onConnectDevice={!useBle && isWebBluetoothSupported() ? () => setUseBle(true) : undefined}
      />
      <InstallPrompt />
      {ThemeEditorPanel && (
        <Suspense fallback={null}>
          <ThemeEditorPanel />
        </Suspense>
      )}
    </ThemeProvider>
  );
}

export default App;
