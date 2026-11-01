import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { DataSource, Reading, SensorSource, ConnectionStatus, DeviceInfo, DeviceAlert } from "../datasource/types";
import { useThemeConfig } from "../theme/ThemeContext";
import { Card } from "./Card";
import { SaltDivider } from "./SaltDivider";
import { BatteryPill } from "./BatteryPill";
import { computeHeatIndex } from "./IndexCalc";
import { appendEntry, pruneOldEntries } from "../log/logStore";

interface DashboardProps {
  dataSource: DataSource;
  onConnectDevice?: () => void;
  onDisconnectDevice?: () => void;
}

type ValueMap = Partial<Record<SensorSource, number>>;

const SPLASH_MS = 900;

const ALERT_TEXT: Record<DeviceAlert, string> = {
  fever: "Fever — body temperature is high",
  highHr: "Heart rate is too high",
  lowHr: "Heart rate is too low",
  battery: "Band battery is low — charge soon",
};

export function Dashboard({ dataSource, onConnectDevice, onDisconnectDevice }: DashboardProps) {
  const theme = useThemeConfig();
  const [values, setValues] = useState<ValueMap>({});
  const [status, setStatus] = useState<ConnectionStatus>("connected");
  const [battery, setBattery] = useState<number | undefined>(undefined);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | undefined>(undefined);
  const [alert, setAlert] = useState<DeviceAlert | null>(null);
  const [booted, setBooted] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    void pruneOldEntries();

    const handleReading = (reading: Reading) => {
      setValues((prev) => {
        const next: ValueMap = { ...prev, [reading.source]: reading.value };
        if (next.gsr !== undefined && next.hr !== undefined && next.temp !== undefined) {
          next.heatIndex = computeHeatIndex({ gsr: next.gsr, hr: next.hr, temp: next.temp });
          void appendEntry({ source: "heatIndex", value: next.heatIndex, ts: reading.ts });
        }
        return next;
      });
      void appendEntry({ source: reading.source, value: reading.value, ts: reading.ts });
    };

    const unsubscribers = [
      dataSource.onReading(handleReading),
      dataSource.onStatusChange(setStatus),
      dataSource.onDeviceInfo(setDeviceInfo),
      dataSource.onBattery(setBattery),
      ...(dataSource.onAlert ? [dataSource.onAlert(setAlert)] : []),
    ];
    dataSource.start();
    return () => {
      setAlert(null);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      dataSource.stop();
    };
  }, [dataSource]);

  useEffect(() => {
    document.body.style.background = theme.colors.background;
  }, [theme.colors.background]);

  // Purely a visual entrance moment — echoes the real device's boot-time
  // auto-calibration. Overlays the dashboard rather than gating its
  // content, so the underlying cards are already in the DOM immediately
  // (matters for tests, and means nothing is actually delayed).
  useEffect(() => {
    if (prefersReducedMotion) {
      setBooted(true);
      return;
    }
    const timer = setTimeout(() => setBooted(true), SPLASH_MS);
    return () => clearTimeout(timer);
  }, [prefersReducedMotion]);

  const sortedCards = [...theme.cards].filter((c) => c.visible).sort((a, b) => a.order - b.order);
  const heroCards = sortedCards.filter((c) => c.size === "large");
  const tileCards = sortedCards.filter((c) => c.size !== "large");

  return (
    <div
      className="relative flex min-h-dvh items-center justify-center overflow-x-hidden font-sans"
      style={{
        background: theme.colors.background,
        color: theme.colors.text,
        fontFamily: theme.font.family,
        fontSize: theme.font.baseSize,
      }}
    >
      <AnimatePresence>
        {!booted && (
          <motion.div
            className="absolute inset-0 z-40 flex items-center justify-center"
            style={{ background: theme.colors.background }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <span className="font-mono text-2xl font-bold tracking-wider md:text-3xl">
              SWEAT<span style={{ color: theme.colors.accent }}>SALT</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative w-full max-w-[640px] px-5 py-6 max-[420px]:px-3.5">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-lg font-bold tracking-wider">
              SWEAT<span style={{ color: theme.colors.accent }}>SALT</span>
            </div>
            <div className="font-sans text-[0.7rem] tracking-widest text-white/50 uppercase">
              Heat-stress companion
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <BatteryPill percent={battery} />
            <div className="flex items-center gap-2 font-sans text-[0.65rem] text-white/40">
              {deviceInfo && (
                <span>
                  {deviceInfo.name} <span className="font-mono">· {deviceInfo.id}</span>
                </span>
              )}
              {onConnectDevice && (
                <button
                  type="button"
                  onClick={onConnectDevice}
                  data-testid="connect-device-button"
                  className="text-white/60 underline decoration-white/30 underline-offset-2 hover:text-white/90"
                >
                  Connect device
                </button>
              )}
              {onDisconnectDevice && (
                <button
                  type="button"
                  onClick={onDisconnectDevice}
                  data-testid="disconnect-device-button"
                  className="text-white/45 underline decoration-white/20 underline-offset-2 hover:text-white/70"
                >
                  {deviceInfo ? "Disconnect" : "Switch to Demo"}
                </button>
              )}
            </div>
          </div>
        </header>

        <AnimatePresence>
          {status === "disconnected" && (
            <motion.div
              className="bg-danger mb-5 cursor-pointer rounded-full px-4 py-2.5 text-center font-sans font-semibold text-[#15110c]"
              data-testid="disconnected-banner"
              onClick={() => dataSource.start()}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              whileTap={{ scale: 0.98 }}
            >
              Disconnected — tap to retry
            </motion.div>
          )}
        </AnimatePresence>
        {alert && (
          <div
            role="alert"
            data-testid="device-alert-banner"
            className="mb-5 rounded-2xl border border-[#ff6b4a]/60 bg-[#ff6b4a]/15 px-4 py-3 text-center font-sans text-sm font-semibold text-[#ff9b85]"
          >
            ⚠ {ALERT_TEXT[alert]}
            <div className="mt-0.5 text-[0.7rem] font-normal text-white/50">Press the band button to dismiss</div>
          </div>
        )}
        {heroCards.map((card) => (
          <Card key={card.source} config={card} value={values[card.source as SensorSource]} />
        ))}
        {heroCards.length > 0 && tileCards.length > 0 && <SaltDivider />}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
          {tileCards.map((card) => (
            <Card key={card.source} config={card} value={values[card.source as SensorSource]} />
          ))}
        </div>
        {dataSource.onAlert && dataSource.buzz && status === "connected" && deviceInfo && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => void dataSource.buzz?.(400, 200)}
              data-testid="buzz-band-button"
              className="rounded-full border border-white/15 px-4 py-2 font-sans text-xs text-white/60 hover:text-white/90"
            >
              Buzz my band
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
