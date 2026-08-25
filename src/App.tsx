import { Suspense, lazy } from "react";
import { ThemeProvider } from "./theme/ThemeContext";
import { Dashboard } from "./dashboard/Dashboard";
import { InstallPrompt } from "./dashboard/InstallPrompt";
import { MockDataSource } from "./datasource/mockDataSource";

// Dev-only: excluded from the production bundle because this dynamic
// import only runs behind `import.meta.env.DEV`, a build-time constant
// that's `false` in `vite build` — Rollup drops the whole branch (and
// the ThemeEditorPanel chunk) from what ships.
const ThemeEditorPanel = import.meta.env.DEV
  ? lazy(() => import("./theme/ThemeEditorPanel").then((m) => ({ default: m.ThemeEditorPanel })))
  : null;

// Session 15 (2026-09-13) swaps this for `new BleDataSource()` — the
// Dashboard doesn't change either way.
const dataSource = new MockDataSource();

export function App() {
  return (
    <ThemeProvider>
      <Dashboard dataSource={dataSource} />
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
