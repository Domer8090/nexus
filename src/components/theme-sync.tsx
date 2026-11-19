"use client";

import { useEffect } from "react";
import { usePref } from "@/lib/client";

export type ThemePref = "dark" | "light" | "system";

export function useTheme() {
  return usePref<ThemePref>("theme", "dark");
}

/** Keeps <html data-theme> in sync with the saved preference. Dark is the default. */
export function ThemeSync() {
  const [theme] = useTheme();
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return null;
}

export const THEME_BOOT_SCRIPT = `(function(){try{var t=JSON.parse(localStorage.getItem("nexus.ui.theme")||'"dark"');if(t==="system"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}})();`;
