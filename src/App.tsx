import { Suspense, lazy, useState } from "react";
import { ThemeProvider } from "./theme/ThemeContext";
import { Dashboard } from "./dashboard/Dashboard";
import { InstallPrompt } from "./dashboard/InstallPrompt";
import { MockDataSource } from "./datasource/mockDataSource";
import { BleDataSource } from "./datasource/bleDataSource";
import type { DataSource } from "./datasource/types";
import { isWebBluetoothSupported } from "./datasource/webBluetoothSupport";

// Dev-only: excluded from the production bundle because this dynamic
// import only runs behind `import.meta.env.DEV`, a build-time constant
// that's `false` in `vite build` — Rollup drops the whole branch (and
// the ThemeEditorPanel chunk) from what ships.
const ThemeEditorPanel = import.meta.env.DEV
  ? lazy(() => import("./theme/ThemeEditorPanel").then((m) => ({ default: m.ThemeEditorPanel })))
  : null;

export function App() {
  const [dataSource, setDataSource] = useState<DataSource>(() => new MockDataSource());
  const useBle = dataSource instanceof BleDataSource;

  // requestDevice() must be called from the tap's own call stack — browsers
  // (iOS Bluefy especially) refuse the picker otherwise, even a tick later
  // from a React effect. So start() runs right here; the Dashboard's effect
  // calling start() again just shares the in-flight attempt.
  const connectDevice = () => {
    const ble = new BleDataSource();
    void ble.start();
    setDataSource(ble);
  };

  return (
    <ThemeProvider>
      <Dashboard
        dataSource={dataSource}
        onConnectDevice={!useBle && isWebBluetoothSupported() ? connectDevice : undefined}
        onDisconnectDevice={useBle ? () => setDataSource(new MockDataSource()) : undefined}
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
