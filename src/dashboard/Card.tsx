import { motion, useReducedMotion } from "framer-motion";
import type { CardConfig } from "../theme/ThemeContext";
import { useThemeConfig } from "../theme/ThemeContext";
import { useAnimatedNumber } from "./useAnimatedNumber";
import { WristTilt } from "./WristTilt";
import { Sparkline } from "./Sparkline";
import { FillBar } from "./FillBar";
import { Thermometer } from "./Thermometer";
import { normalize, RANGES } from "./IndexCalc";

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
  imu: "g",
};

const RISK_TICKS = [
  { percent: 6, label: "Safe" },
  { percent: 50, label: "Elevated" },
  { percent: 94, label: "High" },
];

// One squared-off corner among otherwise-rounded ones reads as a cut
// crystal facet — a plain 90° corner, so it never fights box-shadow or
// clips content the way a clip-path polygon would at small card sizes.
const FACET_CORNER = "rounded-tl-none";

interface CardProps {
  config: CardConfig;
  value: number | undefined;
}

function HeroReadout({ label, value, testId }: { label: string; value: number | undefined; testId: string }) {
  const theme = useThemeConfig();
  const animated = useAnimatedNumber(value);

  return (
    <div
      className={`bg-surface border-hairline flex flex-col gap-4 rounded-3xl border px-6 py-6 ${FACET_CORNER}`}
      data-testid={testId}
    >
      <div className="font-sans text-xs font-semibold tracking-[0.18em] text-white/60 uppercase">{label}</div>
      <div className="flex items-center gap-6">
        <FillBar percent={animated ?? 0} accent={theme.colors.accent} size="lg" ticks={RISK_TICKS} />
        <div className="font-mono text-[clamp(3rem,15vw,4.5rem)] leading-none font-bold [font-variant-numeric:tabular-nums]">
          {animated !== undefined ? Math.round(animated) : "--"}
        </div>
      </div>
      <Sparkline source="heatIndex" accent={theme.colors.accent} />
    </div>
  );
}

export function Card({ config, value }: CardProps) {
  const theme = useThemeConfig();
  const label = LABELS[config.source];
  const prefersReducedMotion = useReducedMotion();

  if (!label) {
    return (
      <div
        className="bg-surface border-hairline rounded-2xl border px-4 py-3.5"
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
        className={`bg-surface border-hairline flex flex-col justify-between rounded-2xl border px-4 py-3.5 ${FACET_CORNER}`}
        data-testid={`card-${config.source}`}
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <div className="font-sans text-[0.7rem] font-semibold tracking-[0.1em] text-white/60 uppercase">
            {label}
          </div>
          <div className="font-mono mt-1 text-2xl font-medium [font-variant-numeric:tabular-nums]">
            {value !== undefined ? value.toFixed(1) : "--"}
            {value !== undefined && <span className="font-sans ml-1 text-[0.7rem] text-white/50">{UNITS.imu}</span>}
          </div>
        </div>
        <WristTilt value={value} />
      </motion.div>
    );
  }

  const range = RANGES[config.source as keyof typeof RANGES];

  return (
    <motion.div
      className={`bg-surface border-hairline flex flex-col justify-between rounded-2xl border px-4 py-3.5 ${FACET_CORNER}`}
      data-testid={`card-${config.source}`}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div>
        <div className="font-sans text-[0.7rem] font-semibold tracking-[0.1em] text-white/60 uppercase">{label}</div>
        <div className="font-mono mt-1 text-2xl font-medium [font-variant-numeric:tabular-nums]">
          {value !== undefined ? value.toFixed(1) : "--"}
          {value !== undefined && UNITS[config.source] && (
            <span className="font-sans ml-1 text-[0.7rem] text-white/50">{UNITS[config.source]}</span>
          )}
        </div>
      </div>
      {config.source === "temp" ? (
        <Thermometer
          percent={value !== undefined && range ? normalize(value, range.min, range.max) * 100 : 0}
          accent={theme.colors.accent}
        />
      ) : (
        <Sparkline source={config.source} accent={theme.colors.accent} />
      )}
    </motion.div>
  );
}
