"use client";

import Link from "next/link";
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Group,
  List,
  ListItem,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconShieldCheck,
} from "@tabler/icons-react";
import type { LogPullEvaluation, PullStatus } from "./lib/evaluate-log-pull";
import { summarizeSpec, type VehicleSpec } from "./lib/vehicle-spec";

// Presentational summary of an automated log-pull evaluation: the VERIFIED /
// PARTIAL / INVALID status badge, missing-parameter hints, and safety alerts.
// All judgement lives in the pure engine (evaluate-log-pull.ts); this component
// only renders its result.

const STATUS_META: Record<PullStatus, { label: string; color: string }> = {
  verified: { label: "VERIFIED PULL", color: "teal" },
  partial: { label: "PARTIAL PULL", color: "yellow" },
  invalid: { label: "INVALID / INCOMPLETE", color: "red" },
};

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export function EvaluationCard({
  evaluation,
  spec,
}: {
  evaluation: LogPullEvaluation;
  spec: VehicleSpec;
}) {
  const { validity, missing, alerts, limits } = evaluation;
  const status = STATUS_META[validity.status];

  // A valid pull starts in gear ≥ 3 and spans one or two consecutive gears; the
  // detector already truncates at a 3rd gear, so the start gear drives the check.
  const gearOk: boolean | null = validity.gearInRange;
  const gearValueLabel =
    validity.gears.length > 0
      ? `Gang ${validity.gears.join("→")}`
      : validity.gearValue !== null
        ? `Gang ${validity.gearValue}`
        : "—";

  const checks: { label: string; ok: boolean | null; value: string }[] = [
    {
      label: "WOT-Pull ab Gang 3 (1–2 Gänge)",
      ok: gearOk,
      value: gearValueLabel,
    },
    {
      label: `Volllast (WOT ≥ ${limits.wotThreshold}% Pedal)`,
      ok: validity.wot,
      value: fmtPct(validity.wotCoverage),
    },
    {
      label: `Drehzahlfenster (≤ ${limits.rpmStartMax} → ≥ ${limits.rpmEndMin} RPM)`,
      ok: validity.rpmSpanOk,
      value:
        validity.rpmStart !== null && validity.rpmEnd !== null
          ? `${Math.round(validity.rpmStart)} → ${Math.round(validity.rpmEnd)}`
          : "—",
    },
  ];

  return (
    <Card withBorder radius="md" p="lg" data-testid="evaluation-card">
      <Group justify="space-between" mb="md" wrap="wrap">
        <Group gap="xs">
          <ThemeIcon variant="light" color={status.color} radius="md" size={30}>
            <IconShieldCheck size={17} stroke={1.6} />
          </ThemeIcon>
          <Title order={5}>Log-Pull Bewertung</Title>
        </Group>
        <Badge size="lg" color={status.color} variant="filled" data-testid="pull-status">
          {status.label}
        </Badge>
      </Group>

      <List spacing={8} size="sm" center>
        {checks.map((c) => (
          <ListItem
            key={c.label}
            icon={
              <ThemeIcon
                size={20}
                radius="xl"
                variant="light"
                color={c.ok === true ? "teal" : c.ok === false ? "red" : "gray"}
              >
                {c.ok === true ? (
                  <IconCircleCheck size={14} />
                ) : c.ok === false ? (
                  <IconAlertTriangle size={14} />
                ) : (
                  <IconInfoCircle size={14} />
                )}
              </ThemeIcon>
            }
          >
            <Group gap={6} justify="space-between" wrap="nowrap">
              <Text size="sm">{c.label}</Text>
              <Text size="xs" c="dimmed">
                {c.value}
              </Text>
            </Group>
          </ListItem>
        ))}
      </List>

      {validity.reasons.length > 0 && (
        <Stack gap={4} mt="sm">
          {validity.reasons.map((r) => (
            <Text key={r} size="xs" c="dimmed">
              • {r}
            </Text>
          ))}
        </Stack>
      )}

      {alerts.length > 0 && (
        <Stack gap="xs" mt="lg" data-testid="safety-alerts">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            Safety &amp; Health
          </Text>
          {alerts.map((a) => (
            <Alert
              key={a.id}
              variant="light"
              color={a.severity === "critical" ? "red" : "orange"}
              icon={<IconAlertTriangle size={16} />}
              title={a.title}
            >
              {a.detail}
            </Alert>
          ))}
        </Stack>
      )}

      {missing.length > 0 && (
        <Stack gap={6} mt="lg" data-testid="missing-params">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            Logging-Profil Hinweise
          </Text>
          {missing.map((m) => (
            <Alert key={m.key} variant="light" color="blue" icon={<IconInfoCircle size={16} />}>
              {m.message}
            </Alert>
          ))}
        </Stack>
      )}

      <Text size="xs" c="dimmed" mt="lg">
        Bewertet gegen Profil: {summarizeSpec(spec)}.{" "}
        <Anchor component={Link} href="/apps/log-analyzer/specs" size="xs" c="orange">
          Anpassen
        </Anchor>
      </Text>
    </Card>
  );
}
