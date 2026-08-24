import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { DataSource, Reading, SensorSource, ConnectionStatus } from "../datasource/types";
import { useThemeConfig } from "../theme/ThemeContext";
import { Card } from "./Card";
import { SaltDivider } from "./SaltDivider";
import { computeHeatIndex } from "./IndexCalc";
import { appendEntry, pruneOldEntries } from "../log/logStore";
import "./dashboard.css";

interface DashboardProps {
  dataSource: DataSource;
}

type ValueMap = Partial<Record<SensorSource, number>>;

export function Dashboard({ dataSource }: DashboardProps) {
  const theme = useThemeConfig();
  const [values, setValues] = useState<ValueMap>({});
  const [status, setStatus] = useState<ConnectionStatus>("connected");

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

    dataSource.onReading(handleReading);
    dataSource.onStatusChange(setStatus);
    dataSource.start();
    return () => dataSource.stop();
  }, [dataSource]);

  const sortedCards = [...theme.cards].filter((c) => c.visible).sort((a, b) => a.order - b.order);
  const heroCards = sortedCards.filter((c) => c.size === "large");
  const tileCards = sortedCards.filter((c) => c.size !== "large");

  return (
    <div
      className="dashboard"
      style={{
        background: theme.colors.background,
        color: theme.colors.text,
        fontFamily: theme.font.family,
        fontSize: theme.font.baseSize,
      }}
    >
      <AnimatePresence>
        {status === "disconnected" && (
          <motion.div
            className="dashboard__banner"
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
      {heroCards.map((card) => (
        <Card key={card.source} config={card} value={values[card.source as SensorSource]} />
      ))}
      {heroCards.length > 0 && tileCards.length > 0 && <SaltDivider />}
      <div className="tiles">
        {tileCards.map((card) => (
          <Card key={card.source} config={card} value={values[card.source as SensorSource]} />
        ))}
      </div>
    </div>
  );
}
