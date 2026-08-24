import { createContext, useContext, useState, type ReactNode } from "react";
import defaultTheme from "./theme.json";

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

interface ThemeContextValue {
  theme: ThemeConfig;
  setTheme: (theme: ThemeConfig) => void;
}

const initialTheme = defaultTheme as ThemeConfig;

const ThemeConfigContext = createContext<ThemeContextValue>({
  theme: initialTheme,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeConfig>(initialTheme);
  return <ThemeConfigContext.Provider value={{ theme, setTheme }}>{children}</ThemeConfigContext.Provider>;
}

export function useThemeConfig(): ThemeConfig {
  return useContext(ThemeConfigContext).theme;
}

export function useThemeEditor(): [ThemeConfig, (theme: ThemeConfig) => void] {
  const ctx = useContext(ThemeConfigContext);
  return [ctx.theme, ctx.setTheme];
}
