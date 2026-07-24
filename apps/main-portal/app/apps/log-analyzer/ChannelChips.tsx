"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import type { LogSeries } from "./lib/types";
import classes from "./LogAnalyzer.module.css";

// The mobile channel selector.
//
// A 390px plot with six overlapping traces is a scribble, and the desktop
// parameter sidebar has nowhere to live at that width. This bar puts the
// channels that matter one tap away, directly above the charts: every chip is a
// toggle, coloured with the very same stroke colour its trace is drawn in, so
// there is never any doubt which line a chip controls. The full grouped panel
// (all 30+ parsed channels, axis assignment, recolouring) stays one tap further
// away, in a bottom sheet.

/**
 * How many channels the bar offers. The list is the currently plotted channels
 * first — those must always be droppable — topped up with the next few from the
 * log so there is something to add without opening the sheet.
 */
const CHIP_BUDGET = 10;

interface Props {
  series: LogSeries[];
  selected: Set<string>;
  colorById: Record<string, string>;
  onToggle: (key: string) => void;
  /** Opens the full parameter panel (bottom sheet on phones). */
  onOpenAll: () => void;
}

export function ChannelChips({ series, selected, colorById, onToggle, onOpenAll }: Props) {
  // Selected channels lead and keep their order stable as you toggle, so a chip
  // never jumps under your thumb between two taps.
  const chips = useMemo(() => {
    const active = series.filter((s) => selected.has(s.key));
    const inactive = series.filter((s) => !selected.has(s.key));
    return [...active, ...inactive].slice(0, Math.max(CHIP_BUDGET, active.length));
  }, [series, selected]);

  return (
    <div className={classes.chipBar} role="group" aria-label="Telemetrie-Kanäle">
      {chips.map((s) => {
        const isOn = selected.has(s.key);
        return (
          <button
            key={s.key}
            type="button"
            className={classes.chip}
            data-active={isOn ? "true" : "false"}
            aria-pressed={isOn}
            onClick={() => onToggle(s.key)}
            style={{ "--chip-color": colorById[s.key] ?? s.color } as CSSProperties}
          >
            <span className={classes.chipSwatch} aria-hidden />
            {s.label}
          </button>
        );
      })}

      <button
        type="button"
        className={`${classes.chip} ${classes.chipMore}`}
        data-active="false"
        onClick={onOpenAll}
        data-testid="open-channel-sheet"
      >
        <IconAdjustmentsHorizontal size={14} stroke={1.75} />
        Alle Kanäle ({series.length})
      </button>
    </div>
  );
}
