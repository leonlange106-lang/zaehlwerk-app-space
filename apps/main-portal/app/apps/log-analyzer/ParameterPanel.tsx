"use client";

import { useMemo } from "react";
import { Anchor, Card, Checkbox, Group, Stack, Text, Title } from "@mantine/core";
import type { LogSeries } from "./lib/types";
import classes from "./LogAnalyzer.module.css";

// The channel toggle panel: parameters grouped logically (Boost Control,
// Ignition & Knock, Fueling, …) with a per-channel checkbox and a group-level
// "alle/keine" quick-toggle.

interface Props {
  series: LogSeries[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleGroup: (keys: string[], on: boolean) => void;
}

export function ParameterPanel({ series, selected, onToggle, onToggleGroup }: Props) {
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
      <Title order={5} mb="sm">
        Parameter
      </Title>
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
                {groupSeries.map((s) => (
                  <Checkbox
                    key={s.key}
                    size="sm"
                    color="orange"
                    checked={selected.has(s.key)}
                    onChange={() => onToggle(s.key)}
                    label={
                      <Group gap={7} wrap="nowrap">
                        <span className={classes.legendDot} style={{ backgroundColor: s.color }} />
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
                ))}
              </Stack>
            </div>
          );
        })}
      </Stack>
    </Card>
  );
}
