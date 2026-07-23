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

// A compact palette users can recolour a channel with.
const SWATCHES = [
  "#fd7e14", "#fa5252", "#4dabf7", "#20c997", "#f783ac", "#845ef7",
  "#e8590c", "#e03131", "#1971c2", "#0ca678", "#d6336c", "#5f3dc4",
  "#f59f00", "#adb5bd", "#495057", "#12b886",
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

export function ParameterPanel({
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
    <Card withBorder radius="md" p="md">
      <Title order={5} mb={4}>
        Parameter
      </Title>
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
    </Card>
  );
}
