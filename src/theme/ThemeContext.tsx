import { createContext, useContext, type ReactNode } from "react";
import themeData from "./theme.json";

export interface CardConfig {
  source: string;
  visible: boolean;
  size: "small" | "large";
  order: number;
}

export interface ThemeConfig {
  colors: { background: string; text: string; accent: string };
  font: { family: string; baseSize: number };
  cards: CardConfig[];
}

const theme = themeData as ThemeConfig;

const ThemeConfigContext = createContext<ThemeConfig>(theme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeConfigContext.Provider value={theme}>{children}</ThemeConfigContext.Provider>;
}

export function useThemeConfig(): ThemeConfig {
  return useContext(ThemeConfigContext);
}
