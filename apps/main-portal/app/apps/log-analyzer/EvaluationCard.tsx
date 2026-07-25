"use client";

import Link from "next/link";
import { Panel } from "@/app/components/ui/Panel";
import { Alert, IconChip } from "@/app/components/ui/primitives";
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
    <Panel
      className="[&]:p-4"
      title="Log-Pull Bewertung"
      icon={
        status.tone === "risk" ? (
          <IconShieldX size={17} stroke={1.8} />
        ) : (
          <IconShieldCheck size={17} stroke={1.8} />
        )
      }
      accent={
        status.tone === "ok"
          ? "var(--zw-ok)"
          : status.tone === "watch"
            ? "var(--zw-watch)"
            : "var(--zw-risk)"
      }
      action={
        <>
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
        </>
      }
    >
      <div data-testid="evaluation-card">
        <ul className="flex flex-col gap-2.5">
          {checks.map((c) => {
            const tone = toneForCheck(c.ok);
            return (
              <li key={c.label} className="flex items-center gap-2.5">
                <IconChip
                  size={22}
                  accent={
                    tone === "ok"
                      ? "var(--zw-ok)"
                      : tone === "risk"
                        ? "var(--zw-risk)"
                        : "var(--zw-neutral)"
                  }
                >
                  {c.ok === true ? (
                    <IconCheck size={13} stroke={2.4} />
                  ) : c.ok === false ? (
                    <IconAlertTriangle size={13} stroke={2} />
                  ) : (
                    <IconInfoCircle size={13} stroke={2} />
                  )}
                </IconChip>
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="text-sm">{c.label}</span>
                  <span className="readout flex-none text-xs text-dim">{c.value}</span>
                </span>
              </li>
            );
          })}
        </ul>

        {validity.reasons.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            {validity.reasons.map((r) => (
              <p key={r} className="text-xs text-dim">
                • {r}
              </p>
            ))}
          </div>
        )}

        {alerts.length > 0 && (
          <div className="mt-6 flex flex-col gap-2" data-testid="safety-alerts">
            <p className="legend-label">Safety &amp; Health</p>
            {alerts.map((a) => (
              <Alert
                key={a.id}
                role="alert"
                // Watch, not the app's own orange: a warning has to read as a
                // status, not as "this is the Log Analyzer".
                tone={a.severity === "critical" ? "risk" : "watch"}
                icon={<IconAlertTriangle size={16} />}
                title={a.title}
              >
                {a.detail}
              </Alert>
            ))}
          </div>
        )}

        {missing.length > 0 && (
          <div className="mt-6 flex flex-col gap-2" data-testid="missing-params">
            <p className="legend-label">Logging-Profil Hinweise</p>
            {missing.map((m) => (
              <Alert key={m.key} icon={<IconInfoCircle size={16} />}>
                {m.message}
              </Alert>
            ))}
          </div>
        )}

        <p className="mt-6 text-xs text-dim">
          Bewertet gegen Profil: {summarizeSpec(spec)}.{" "}
          <Link
            href="/apps/log-analyzer/specs"
            className="text-accent underline-offset-2 hover:underline"
          >
            Anpassen
          </Link>
        </p>
      </div>
    </Panel>
  );
}
