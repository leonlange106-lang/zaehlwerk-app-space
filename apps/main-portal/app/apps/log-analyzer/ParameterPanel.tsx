"use client";

import { useMemo } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Panel } from "@/app/components/ui/Panel";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { cn } from "@/app/lib/cn";
import type { AxisSide, LogSeries } from "./lib/types";

// The channel toggle panel: EVERY parsed parameter is listed and selectable —
// grouped logically (Boost Control, Ignition & Knock, Fueling, …) with unknown
// columns under "Sonstige / Custom" so nothing is hidden. Each selected channel
// also exposes a per-channel Y-axis side (L/R) picker and a line-colour swatch.

// A compact palette users can recolour a channel with. Every entry is picked to
// stay legible as a 1.6px stroke on the dark deck — nothing darker than roughly
// 45% luminance, and no two neighbours that collapse into one another for the
// common red-green deficiencies.
const SWATCHES = [
  "#f97316", "#ef4444", "#06b6d4", "#10b981", "#f472b6", "#a78bfa",
  "#fb923c", "#f87171", "#38bdf8", "#34d399", "#e879f9", "#818cf8",
  "#f59e0b", "#94a3b8", "#e5e9f0", "#2dd4bf",
];

interface Props {
  series: LogSeries[];
  selected: Set<string>;
  axisById: Record<string, AxisSide>;
  colorById: Record<string, string>;
  onToggle: (key: string) => void;
  onToggleGroup: (keys: string[], on: boolean) => void;
  onAxis: (key: string, side: AxisSide) => void;
  onColor: (key: string, color: string) => void;
}

/**
 * The panel in its own plate — the desktop sidebar presentation.
 *
 * On phones the same controls are rendered *bare* inside a bottom sheet (which
 * brings its own surface and title), so the plate chrome would be a second frame
 * around a frame. `ParameterPanelBody` is that shared inner content.
 */
export function ParameterPanel(props: Props) {
  return (
    <Panel title="Parameter" className="[&]:p-4">
      <ParameterPanelBody {...props} />
    </Panel>
  );
}

/** Two-state axis picker. Small enough that a segmented pill would dwarf it. */
function AxisToggle({
  value,
  onChange,
  label,
}: {
  value: AxisSide;
  onChange: (side: AxisSide) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="well flex overflow-hidden rounded-full p-0.5"
    >
      {(["left", "right"] as const).map((side) => (
        <label
          key={side}
          className={cn(
            "cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors",
            value === side ? "accent-gradient text-white" : "text-dim hover:text-ink",
          )}
        >
          <input
            type="radio"
            className="sr-only"
            checked={value === side}
            onChange={() => onChange(side)}
          />
          {side === "left" ? "Y-L" : "Y-R"}
        </label>
      ))}
    </div>
  );
}

export function ParameterPanelBody({
  series,
  selected,
  axisById,
  colorById,
  onToggle,
  onToggleGroup,
  onAxis,
  onColor,
}: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, LogSeries[]>();
    for (const s of series) {
      const list = map.get(s.group) ?? [];
      list.push(s);
      map.set(s.group, list);
    }
    return [...map.entries()];
  }, [series]);

  return (
    <>
      <p className="mb-4 text-xs text-dim">
        Alle {series.length} erkannten Kanäle. Ausgewählte lassen sich links/rechts der Y-Achse
        zuordnen und einfärben.
      </p>
      <div className="flex flex-col gap-5">
        {groups.map(([groupName, groupSeries]) => {
          const keys = groupSeries.map((s) => s.key);
          const allOn = keys.every((k) => selected.has(k));
          return (
            <div key={groupName}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="legend-label">{groupName}</p>
                <button
                  type="button"
                  onClick={() => onToggleGroup(keys, !allOn)}
                  className="text-xs text-accent underline-offset-2 hover:underline"
                >
                  {allOn ? "keine" : "alle"}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {groupSeries.map((s) => {
                  const isOn = selected.has(s.key);
                  const color = colorById[s.key] ?? s.color;
                  const side = axisById[s.key] ?? "left";
                  return (
                    <div key={s.key}>
                      <label className="flex min-h-8 cursor-pointer items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={isOn}
                          onChange={() => onToggle(s.key)}
                          className="size-4 flex-none accent-[var(--zw-accent)]"
                        />
                        <span
                          aria-hidden
                          className="size-2.5 flex-none rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="min-w-0 text-sm">
                          {s.label}
                          {s.unit ? <span className="text-xs text-dim"> ({s.unit})</span> : null}
                        </span>
                      </label>

                      {isOn && (
                        <div className="mt-1.5 flex items-center gap-2 pl-7">
                          <AxisToggle
                            value={side}
                            onChange={(next) => onAxis(s.key, next)}
                            label={`Y-Achse für ${s.label}`}
                          />
                          <Popover.Root>
                            <Popover.Trigger asChild>
                              <Tooltip label="Linienfarbe wählen">
                                <button
                                  type="button"
                                  aria-label={`Farbe für ${s.label}`}
                                  className="size-5 flex-none rounded-[5px] border border-line-strong"
                                  style={{ backgroundColor: color }}
                                />
                              </Tooltip>
                            </Popover.Trigger>
                            <Popover.Portal>
                              <Popover.Content
                                align="start"
                                sideOffset={6}
                                className="z-50 rounded-panel border border-line bg-elevated p-2 shadow-panel-lg"
                              >
                                <div className="grid w-40 grid-cols-6 gap-1.5">
                                  {SWATCHES.map((c) => (
                                    <button
                                      key={c}
                                      type="button"
                                      aria-label={c}
                                      onClick={() => onColor(s.key, c)}
                                      className="size-5 rounded-[5px] border border-line-strong transition-transform hover:scale-110"
                                      style={{ backgroundColor: c }}
                                    />
                                  ))}
                                </div>
                              </Popover.Content>
                            </Popover.Portal>
                          </Popover.Root>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
