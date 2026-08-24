import { motion, useReducedMotion } from "framer-motion";
import type { CardConfig } from "../theme/ThemeContext";
import { useThemeConfig } from "../theme/ThemeContext";
import { useAnimatedNumber } from "./useAnimatedNumber";
import { WristTilt } from "./WristTilt";

const LABELS: Record<string, string> = {
  heatIndex: "Risk Index",
  gsr: "GSR",
  hr: "Heart Rate",
  temp: "Skin Temp",
  imu: "Motion",
};

const UNITS: Record<string, string> = {
  gsr: "µS",
  hr: "bpm",
  temp: "°C",
};

const SCALE_LABELS = ["Safe", "Elevated", "High"];

interface CardProps {
  config: CardConfig;
  value: number | undefined;
}

function HeroReadout({ label, value, testId }: { label: string; value: number | undefined; testId: string }) {
  const theme = useThemeConfig();
  const animated = useAnimatedNumber(value);
  const prefersReducedMotion = useReducedMotion();
  const clamped = animated !== undefined ? Math.min(100, Math.max(0, animated)) : 0;

  return (
    <div className="hero" data-testid={testId}>
      <div className="hero__eyebrow">{label}</div>
      <div className="hero__value">{animated !== undefined ? Math.round(animated) : "--"}</div>
      <div className="hero__scale">
        <motion.div
          className="hero__marker"
          animate={{ left: `${clamped}%` }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.6, ease: "easeOut" }}
          style={{ backgroundColor: theme.colors.accent }}
        />
      </div>
      <div className="hero__scale-labels">
        {SCALE_LABELS.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </div>
  );
}

export function Card({ config, value }: CardProps) {
  const label = LABELS[config.source];
  const prefersReducedMotion = useReducedMotion();

  if (!label) {
    return (
      <div className="tile" data-testid={`card-${config.source}`}>
        <div className="card__unknown">Unknown source: {config.source}</div>
      </div>
    );
  }

  if (config.source === "heatIndex") {
    return <HeroReadout label={label} value={value} testId={`card-${config.source}`} />;
  }

  if (config.source === "imu") {
    return (
      <motion.div
        className="tile tile--imu"
        data-testid={`card-${config.source}`}
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="tile__label">{label}</div>
        <WristTilt value={value} />
      </motion.div>
    );
  }

  return (
    <motion.div
      className="tile"
      data-testid={`card-${config.source}`}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="tile__label">{label}</div>
      <div className="tile__value">
        {value !== undefined ? value.toFixed(1) : "--"}
        {value !== undefined && UNITS[config.source] && (
          <span className="tile__unit">{UNITS[config.source]}</span>
        )}
      </div>
    </motion.div>
  );
}
