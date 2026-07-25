"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Colour-scheme control, replacing MantineProvider's.
//
// Three modes, not two. "auto" is the default and it FOLLOWS THE SYSTEM LIVE —
// flipping the OS to light at dusk flips the app, without a reload — while an
// explicit light/dark choice pins it and outranks the OS from then on. A plain
// two-state toggle cannot express "follow the system", only "match it right now".
//
// The resolved scheme lives as `data-theme` on <html>, which is what every token
// block in globals.css keys off. Two things have to be true and neither is free:
//
//  1. NO FLASH. The correct scheme must be on <html> before the first paint, so
//     `themeScript` below runs synchronously in <head> — before React exists.
//     Resolving in an effect would paint dark, then repaint light.
//  2. THE CHOICE OUTRANKS THE OS. Once a mode is stored it wins, which is why
//     the media query is only consulted in "auto".

export type ThemeMode = "auto" | "light" | "dark";
export type ColorScheme = "dark" | "light";

const STORAGE_KEY = "zw:theme-mode";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

/**
 * Injected verbatim into <head>. Kept as a string on purpose: it must run before
 * hydration, and this is the one place in the app where that is true.
 */
export const themeScript = `(function(){try{
var m=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
if(m!=='light'&&m!=='dark'){m='auto';}
var s=m==='auto'?(window.matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches?'light':'dark'):m;
var d=document.documentElement.dataset;d.theme=s;d.themeMode=m;d.mantineColorScheme=s;
}catch(e){var d2=document.documentElement.dataset;d2.theme='dark';d2.themeMode='auto';d2.mantineColorScheme='dark';}})();`;

interface ThemeContextValue {
  /** What the user picked: may be "auto". */
  mode: ThemeMode;
  /** What is actually on screen right now. */
  colorScheme: ColorScheme;
  setMode: (mode: ThemeMode) => void;
  /** Cycles auto → light → dark → auto, for the header control. */
  cycleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemScheme(): ColorScheme {
  return typeof window !== "undefined" && window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

function apply(mode: ThemeMode): ColorScheme {
  const scheme = mode === "auto" ? systemScheme() : mode;
  const root = document.documentElement;
  root.dataset.theme = scheme;
  root.dataset.themeMode = mode;
  // Mirror onto Mantine's attribute for as long as unmigrated screens render its
  // components: this provider is the single source of truth, and without the
  // mirror those screens would keep whichever scheme they started in. Drop this
  // line together with the Mantine dependency.
  root.dataset.mantineColorScheme = scheme;
  return scheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server-renders as the script's fallback; the effect below reconciles with
  // what the script actually applied, so nothing repaints.
  const [mode, setModeState] = useState<ThemeMode>("auto");
  const [colorScheme, setColorScheme] = useState<ColorScheme>("dark");

  useEffect(() => {
    const root = document.documentElement;
    const applied = root.dataset.theme === "light" ? "light" : "dark";
    const stored = root.dataset.themeMode;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setColorScheme(applied);
    setModeState(stored === "light" || stored === "dark" ? stored : "auto");
  }, []);

  // Only "auto" listens. A pinned choice must not move when the OS does.
  useEffect(() => {
    if (mode !== "auto") return;
    const media = window.matchMedia(LIGHT_QUERY);
    const onChange = () => setColorScheme(apply("auto"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    setColorScheme(apply(next));
    try {
      if (next === "auto") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled: the choice simply doesn't persist.
    }
  }, []);

  const cycleMode = useCallback(() => {
    setMode(mode === "auto" ? "light" : mode === "light" ? "dark" : "auto");
  }, [mode, setMode]);

  const value = useMemo(
    () => ({ mode, colorScheme, setMode, cycleMode }),
    [mode, colorScheme, setMode, cycleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useColorScheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useColorScheme must be used inside <ThemeProvider>.");
  return context;
}
