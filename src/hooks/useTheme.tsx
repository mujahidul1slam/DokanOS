import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Theme = "theme-ocean" | "theme-obsidian" | "theme-amethyst" | "theme-emerald" | "theme-crimson";

export const THEMES: Theme[] = [
  "theme-ocean",
  "theme-obsidian",
  "theme-amethyst",
  "theme-emerald",
  "theme-crimson"
];

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>("theme-ocean");

  useEffect(() => {
    const root = document.documentElement;
    // Remove all themes
    THEMES.forEach(t => root.classList.remove(t));
    // Remove old light/dark if present
    root.classList.remove("light", "dark");
    // Add new theme
    root.classList.add(theme);
    localStorage.setItem("dokanos-liquid-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    // Cycle through themes for legacy toggle button support
    setThemeState((current) => {
      const idx = THEMES.indexOf(current);
      return THEMES[(idx + 1) % THEMES.length];
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
