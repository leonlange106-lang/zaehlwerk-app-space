"use client";

import { useMemo } from "react";
import {
  Anchor,
  Card,
  Checkbox,
  ColorSwatch,
  Group,
  Popover,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import type { AxisSide, LogSeries } from "./lib/types";
import classes from "./LogAnalyzer.module.css";

// The channel toggle panel: EVERY parsed parameter is listed and selectable —
// grouped logically (Boost Control, Ignition & Knock, Fueling, …) with unknown
// columns under "Sonstige / Custom" so nothing is hidden. Each selected channel
// also exposes a per-channel Y-axis side (L/R) picker and a line-colour swatch.

// A compact palette users can recolour a channel with. Every entry is picked to
// stay legible as a 1.6px stroke on the #080c14 canvas — nothing darker than
// roughly 45% luminance, and no two neighbours that collapse into one another
// for the common red-green deficiencies.
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
 * The panel in its own card — the desktop sidebar presentation.
 *
 * On phones the same controls are rendered *bare* inside a bottom sheet (which
 * brings its own surface and title), so the card chrome would be a second frame
 * around a frame. `ParameterPanelBody` is that shared inner content.
 */
export function ParameterPanel(props: Props) {
  return (
    <Card p="md">
      <Title order={5} mb={4}>
        Parameter
      </Title>
      <ParameterPanelBody {...props} />
    </Card>
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
      <Text size="xs" c="dimmed" mb="sm">
        Alle {series.length} erkannten Kanäle. Ausgewählte lassen sich links/rechts der
        Y-Achse zuordnen und einfärben.
      </Text>
      <Stack gap="lg">
        {groups.map(([groupName, groupSeries]) => {
          const keys = groupSeries.map((s) => s.key);
          const allOn = keys.every((k) => selected.has(k));
          return (
            <div key={groupName}>
              <Group justify="space-between" mb={6}>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                  {groupName}
                </Text>
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  c="orange"
                  onClick={() => onToggleGroup(keys, !allOn)}
                >
                  {allOn ? "keine" : "alle"}
                </Anchor>
              </Group>
              <Stack gap={8}>
                {groupSeries.map((s) => {
                  const isOn = selected.has(s.key);
                  const color = colorById[s.key] ?? s.color;
                  const side = axisById[s.key] ?? "left";
                  return (
                    <div key={s.key}>
                      <Group gap={6} wrap="nowrap" justify="space-between">
                        <Checkbox
                          size="sm"
                          color="orange"
                          checked={isOn}
                          onChange={() => onToggle(s.key)}
                          label={
                            <Group gap={7} wrap="nowrap">
                              <span
                                className={classes.legendDot}
                                style={{ backgroundColor: color }}
                              />
                              <Text size="sm">
                                {s.label}
                                {s.unit ? (
                                  <Text span c="dimmed" size="xs">
                                    {" "}
                                    ({s.unit})
                                  </Text>
                                ) : null}
                              </Text>
                            </Group>
                          }
                        />
                      </Group>

                      {isOn && (
                        <Group gap="xs" wrap="nowrap" pl={30} mt={4}>
                          <SegmentedControl
                            size="xs"
                            value={side}
                            onChange={(v) => onAxis(s.key, v as AxisSide)}
                            data={[
                              { value: "left", label: "Y-L" },
                              { value: "right", label: "Y-R" },
                            ]}
                            aria-label={`Y-Achse für ${s.label}`}
                          />
                          <Popover position="bottom-start" withArrow shadow="md">
                            <Popover.Target>
                              <Tooltip label="Linienfarbe wählen" withArrow>
                                <ColorSwatch
                                  color={color}
                                  size={20}
                                  radius="xs"
                                  style={{ cursor: "pointer" }}
                                  role="button"
                                  aria-label={`Farbe für ${s.label}`}
                                />
                              </Tooltip>
                            </Popover.Target>
                            <Popover.Dropdown p="xs">
                              <Group gap={6} maw={148}>
                                {SWATCHES.map((c) => (
                                  <ColorSwatch
                                    key={c}
                                    color={c}
                                    size={20}
                                    radius="xs"
                                    style={{ cursor: "pointer" }}
                                    role="button"
                                    aria-label={c}
                                    onClick={() => onColor(s.key, c)}
                                  />
                                ))}
                              </Group>
                            </Popover.Dropdown>
                          </Popover>
                        </Group>
                      )}
                    </div>
                  );
                })}
              </Stack>
            </div>
          );
        })}
      </Stack>
    </>
  );
}
