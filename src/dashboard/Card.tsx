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
    <div
      className="bg-surface px-6 pt-8 pb-7 [clip-path:polygon(1.25rem_0,100%_0,100%_calc(100%-1.25rem),calc(100%-1.25rem)_100%,0_100%,0_1.25rem)]"
      data-testid={testId}
    >
      <div className="font-sans text-xs font-semibold tracking-[0.18em] text-white/60 uppercase">{label}</div>
      <div className="font-mono my-2 mb-5 text-[clamp(3.5rem,16vw,5.5rem)] leading-none font-bold [font-variant-numeric:tabular-nums]">
        {animated !== undefined ? Math.round(animated) : "--"}
      </div>
      <div className="relative h-2 rounded-full bg-[linear-gradient(90deg,var(--color-safe),var(--color-warn)_55%,var(--color-danger))]">
        <motion.div
          className="absolute -top-[0.35rem] h-5 w-0.5 -translate-x-px"
          animate={{ left: `${clamped}%` }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.6, ease: "easeOut" }}
          style={{ backgroundColor: theme.colors.accent }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-sans text-[0.7rem] tracking-wider text-white/55 uppercase">
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
      <div
        className="bg-surface border-hairline px-4 py-3.5 [clip-path:polygon(0.6rem_0,100%_0,100%_100%,0_100%,0_0.6rem)]"
        data-testid={`card-${config.source}`}
      >
        <div className="font-sans text-white/60 italic">Unknown source: {config.source}</div>
      </div>
    );
  }

  if (config.source === "heatIndex") {
    return <HeroReadout label={label} value={value} testId={`card-${config.source}`} />;
  }

  if (config.source === "imu") {
    return (
      <motion.div
        className="bg-surface border-hairline flex flex-col border-t-2 px-4 py-3.5 [clip-path:polygon(0.6rem_0,100%_0,100%_100%,0_100%,0_0.6rem)]"
        data-testid={`card-${config.source}`}
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="font-sans text-[0.7rem] font-semibold tracking-[0.1em] text-white/60 uppercase">{label}</div>
        <WristTilt value={value} />
      </motion.div>
    );
  }

  return (
    <motion.div
      className="bg-surface border-hairline border-t-2 px-4 py-3.5 [clip-path:polygon(0.6rem_0,100%_0,100%_100%,0_100%,0_0.6rem)]"
      data-testid={`card-${config.source}`}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="font-sans text-[0.7rem] font-semibold tracking-[0.1em] text-white/60 uppercase">{label}</div>
      <div className="font-mono mt-1 text-2xl font-medium [font-variant-numeric:tabular-nums]">
        {value !== undefined ? value.toFixed(1) : "--"}
        {value !== undefined && UNITS[config.source] && (
          <span className="font-sans ml-1 text-[0.7rem] text-white/50">{UNITS[config.source]}</span>
        )}
      </div>
    </motion.div>
  );
}
