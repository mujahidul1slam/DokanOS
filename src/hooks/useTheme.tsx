import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Theme = "light" | "dark";

export const THEMES: Theme[] = ["light", "dark"];

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem("dokanos-liquid-theme") as Theme) || "dark";
  });
  const [userId, setUserId] = useState<string | null>(null);

  // Apply CSS theme class to root element
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (theme === "dark") {
      root.classList.add("dark");
    }
    localStorage.setItem("dokanos-liquid-theme", theme);
    if (userId) {
      localStorage.setItem(`dokanos-theme-${userId}`, theme);
    }
  }, [theme, userId]);

  // Sync theme with authenticated user account & per-user cache
  useEffect(() => {
    const syncUserTheme = (user: any) => {
      if (!user) {
        setUserId(null);
        return;
      }
      setUserId(user.id);
      const userMetaTheme = user.user_metadata?.theme as Theme | undefined;
      const cachedUserTheme = localStorage.getItem(`dokanos-theme-${user.id}`) as Theme | null;
      const chosenTheme = userMetaTheme || cachedUserTheme;

      if (chosenTheme === "light" || chosenTheme === "dark") {
        setThemeState(chosenTheme);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      syncUserTheme(session?.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      syncUserTheme(session?.user);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    if (userId) {
      localStorage.setItem(`dokanos-theme-${userId}`, newTheme);
      supabase.auth.updateUser({ data: { theme: newTheme } }).catch((err) => {
        console.warn("Failed to persist theme to user metadata:", err);
      });
    }
  };

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
