"use client";

import Link from "next/link";
import {
  Alert,
  Anchor,
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
  IconCheck,
  IconInfoCircle,
  IconShieldCheck,
  IconShieldX,
} from "@tabler/icons-react";
import { StatusBadge, toneForCheck, type StatusTone } from "@/app/components/ui/StatusBadge";
import { healthFromAlerts, type LogPullEvaluation, type PullStatus } from "./lib/evaluate-log-pull";
import { summarizeSpec, type VehicleSpec } from "./lib/vehicle-spec";

// Presentational summary of an automated log-pull evaluation: the VERIFIED /
// PARTIAL / INVALID status badge, missing-parameter hints, and safety alerts.
// All judgement lives in the pure engine (evaluate-log-pull.ts); this component
// only renders its result.
//
// Every verdict here goes through StatusBadge, which pairs the colour with an
// icon — these are exactly the states someone screenshots into a forum thread
// or prints in greyscale, where "the green one" carries no information at all.

const STATUS_META: Record<PullStatus, { label: string; tone: StatusTone }> = {
  verified: { label: "VERIFIED PULL", tone: "ok" },
  partial: { label: "PARTIAL PULL", tone: "watch" },
  invalid: { label: "INVALID / INCOMPLETE", tone: "risk" },
};

const HEALTH_META = {
  safe: { label: "Hardware-sicher", tone: "ok" },
  caution: { label: "Beobachten", tone: "watch" },
  danger: { label: "Hardware-Risiko", tone: "risk" },
} as const satisfies Record<string, { label: string; tone: StatusTone }>;

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
  const health = HEALTH_META[healthFromAlerts(alerts)];

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
    <Card p="md" data-testid="evaluation-card">
      <Group justify="space-between" mb="md" wrap="wrap" gap="xs">
        <Group gap="xs">
          <ThemeIcon
            variant="light"
            color={status.tone === "ok" ? "emerald" : status.tone === "watch" ? "amber" : "red"}
            radius="sm"
            size={28}
          >
            {status.tone === "risk" ? (
              <IconShieldX size={16} stroke={1.75} />
            ) : (
              <IconShieldCheck size={16} stroke={1.75} />
            )}
          </ThemeIcon>
          <Title order={5}>Log-Pull Bewertung</Title>
        </Group>
        <Group gap={6}>
          <StatusBadge
            size="lg"
            variant="filled"
            tone={health.tone}
            label={health.label}
            data-testid="pull-health"
          />
          <StatusBadge
            size="lg"
            tone={status.tone}
            label={status.label}
            data-testid="pull-status"
          />
        </Group>
      </Group>

      <List spacing={8} size="sm" center>
        {checks.map((c) => (
          <ListItem
            key={c.label}
            icon={
              <ThemeIcon
                size={20}
                radius="sm"
                variant="light"
                color={
                  toneForCheck(c.ok) === "ok"
                    ? "emerald"
                    : toneForCheck(c.ok) === "risk"
                      ? "red"
                      : "slate"
                }
              >
                {c.ok === true ? (
                  <IconCheck size={13} stroke={2.2} />
                ) : c.ok === false ? (
                  <IconAlertTriangle size={13} stroke={1.75} />
                ) : (
                  <IconInfoCircle size={13} stroke={1.75} />
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
              // Amber, not the app's orange accent: a warning must read as a
              // status, not as "this is the Log Analyzer".
              color={a.severity === "critical" ? "red" : "amber"}
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
            <Alert key={m.key} variant="light" color="cyan" icon={<IconInfoCircle size={16} />}>
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
