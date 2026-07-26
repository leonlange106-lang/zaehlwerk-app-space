"use client";

import { cn } from "@/app/lib/cn";
import classes from "./RangeSlider.module.css";

// A window picker: two values on one scale, "from" and "to".
//
// The thumbs cannot cross. Dragging one past the other clamps it to `minRange`
// steps away instead of swapping them, so the value pair keeps its meaning and
// the label the caller prints beside it never reads backwards.

export interface RangeSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  /** Smallest allowed distance between the thumbs. */
  minRange?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  /**
   * Names the pair. Each thumb gets it with "Anfang"/"Ende" appended — a slider
   * whose accessible name is just "Zeitfenster" twice tells a screen-reader user
   * nothing about which end they are holding.
   */
  label: string;
  /** Turns a raw value into what a screen reader should read out. */
  formatValue?: (value: number) => string;
}

export function RangeSlider({
  min,
  max,
  value,
  onChange,
  minRange = 1,
  step = 1,
  disabled,
  className,
  label,
  formatValue,
}: RangeSliderProps) {
  const [start, end] = value;
  const span = Math.max(1, max - min);
  // Unitless fractions, not percentages: the stylesheet has to combine them with
  // the thumb's own width to line the fill up with the thumb centres.
  const startFraction = (start - min) / span;
  const endFraction = (end - min) / span;
  // Past the halfway mark the start thumb risks being pinned under the end one
  // against the right edge, where it could no longer be grabbed.
  const startOnTop = startFraction > 0.5;

  return (
    <div
      className={cn(classes.root, disabled && "opacity-50", className)}
      style={
        {
          "--range-start": startFraction,
          "--range-end": endFraction,
        } as React.CSSProperties
      }
    >
      <span aria-hidden className={classes.track} />
      <span aria-hidden className={classes.fill} />
      <input
        type="range"
        className={cn(classes.input, startOnTop && classes.inputStartOnTop)}
        min={min}
        max={max}
        step={step}
        value={start}
        disabled={disabled}
        aria-label={`${label} – Anfang`}
        aria-valuetext={formatValue?.(start)}
        onChange={(event) => {
          const next = Math.min(Number(event.currentTarget.value), end - minRange);
          onChange([Math.max(min, next), end]);
        }}
      />
      <input
        type="range"
        className={classes.input}
        min={min}
        max={max}
        step={step}
        value={end}
        disabled={disabled}
        aria-label={`${label} – Ende`}
        aria-valuetext={formatValue?.(end)}
        onChange={(event) => {
          const next = Math.max(Number(event.currentTarget.value), start + minRange);
          onChange([start, Math.min(max, next)]);
        }}
      />
    </div>
  );
}
