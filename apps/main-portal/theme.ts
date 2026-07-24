import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Refined Industrial Neobrutalism — the App Space design language.
//
// The look is utility-first and dark-mode native: a deep OLED canvas, flat
// surfaces separated by thin high-contrast outlines instead of soft shadows,
// micro-radii, and dense typography. Colour is never the sole carrier of
// meaning — every status token has an icon partner (see `components/ui/StatusBadge`).
//
// Only the *scales* live here. The surface/canvas/border variables that give
// the palette its industrial feel are resolved in `app/globals.css`, because
// they override Mantine's own `--mantine-color-*` variables and must apply to
// both colour schemes without a client-side resolver (this theme is handed to
// MantineProvider from a Server Component, so it has to stay serializable).

/** Neutral chrome. 0–3 are text tints on dark; 6–9 carry the industrial greys. */
const slate: MantineColorsTuple = [
  "#f1f5f9",
  "#e2e8f0",
  "#cbd5e1",
  "#94a3b8",
  "#64748b",
  "#475569",
  "#374151",
  "#1f293d",
  "#111827",
  "#080c14",
];

/** Zählwerk (energy accent) — vivid electric cyan. */
const cyan: MantineColorsTuple = [
  "#ecfeff",
  "#cffafe",
  "#a5f3fc",
  "#67e8f9",
  "#22d3ee",
  "#0ed7ef",
  "#06b6d4",
  "#0891b2",
  "#0e7490",
  "#155e75",
];

/** Log Analyzer (automotive accent) — high-octane orange. */
const orange: MantineColorsTuple = [
  "#fff7ed",
  "#ffedd5",
  "#fed7aa",
  "#fdba74",
  "#fb923c",
  "#fb8b3c",
  "#f97316",
  "#ea580c",
  "#c2410c",
  "#9a3412",
];

/** OK / verified. */
const emerald: MantineColorsTuple = [
  "#ecfdf5",
  "#d1fae5",
  "#a7f3d0",
  "#6ee7b7",
  "#34d399",
  "#1ec98d",
  "#10b981",
  "#059669",
  "#047857",
  "#065f46",
];

/** Watch / warning. */
const amber: MantineColorsTuple = [
  "#fffbeb",
  "#fef3c7",
  "#fde68a",
  "#fcd34d",
  "#fbbf24",
  "#f8b013",
  "#f59e0b",
  "#d97706",
  "#b45309",
  "#92400e",
];

/** Risk / critical. */
const red: MantineColorsTuple = [
  "#fef2f2",
  "#fee2e2",
  "#fecaca",
  "#fca5a5",
  "#f87171",
  "#f45b5b",
  "#ef4444",
  "#dc2626",
  "#b91c1c",
  "#991b1b",
];

/**
 * Mantine derives its dark-scheme surfaces from this tuple: dark[7] is the body
 * canvas, dark[6] the default surface, dark[5] the hover/elevated step and
 * dark[4] the border. Mapping our industrial slates onto those slots is what
 * makes every unstyled Mantine component land on-palette for free.
 */
const dark: MantineColorsTuple = [
  "#e5e9f0", // text
  "#c3cbd9",
  "#94a3b8", // dimmed
  "#64748b",
  "#374151", // borders
  "#1f293d", // elevated inputs / drawers
  "#111827", // primary surfaces / cards
  "#080c14", // canvas
  "#05080e",
  "#02040a",
];

export const theme = createTheme({
  primaryColor: "cyan",
  primaryShade: { light: 7, dark: 6 },
  colors: { slate, cyan, orange, emerald, amber, red, dark },

  // Native system stack only — the CSP forbids any external font host.
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",

  // Sharp / micro-radii throughout: nothing rounder than 8px, and the default
  // "md" that most existing call sites pass now resolves to a 4px corner.
  defaultRadius: "sm",
  radius: { xs: "2px", sm: "4px", md: "4px", lg: "6px", xl: "8px" },

  // Flat by design — the border carries the separation, not a drop shadow.
  shadows: {
    xs: "none",
    sm: "none",
    md: "0 8px 24px rgba(0, 0, 0, 0.45)",
    lg: "0 12px 32px rgba(0, 0, 0, 0.55)",
    xl: "0 20px 48px rgba(0, 0, 0, 0.6)",
  },

  headings: {
    fontWeight: "700",
    sizes: {
      h1: { fontSize: "1.75rem", lineHeight: "1.2" },
      h2: { fontSize: "1.375rem", lineHeight: "1.25" },
      h3: { fontSize: "1.125rem", lineHeight: "1.3" },
      h4: { fontSize: "1rem", lineHeight: "1.35" },
      h5: { fontSize: "0.875rem", lineHeight: "1.4" },
    },
  },

  components: {
    // Cards and Papers are the "industrial slate" plates: explicit outline,
    // no shadow, micro-radius. Their background comes from globals.css so the
    // elevation step (surface vs. canvas) holds in both colour schemes.
    Card: { defaultProps: { withBorder: true, radius: "md", shadow: "none" } },
    Paper: { defaultProps: { withBorder: true, radius: "md", shadow: "none" } },
    Modal: { defaultProps: { radius: "md", overlayProps: { blur: 2 } } },
    Drawer: { defaultProps: { radius: 0, overlayProps: { blur: 2 } } },
    Badge: { defaultProps: { radius: "xs" } },
    Button: { defaultProps: { radius: "sm" } },
    ActionIcon: { defaultProps: { radius: "sm" } },
    SegmentedControl: { defaultProps: { radius: "sm" } },
    Tooltip: { defaultProps: { radius: "sm", withArrow: true } },
    Menu: { defaultProps: { radius: "sm", shadow: "md" } },
    Popover: { defaultProps: { radius: "sm", shadow: "md" } },
  },
});
