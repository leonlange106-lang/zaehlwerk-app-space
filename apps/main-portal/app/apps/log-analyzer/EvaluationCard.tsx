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
import { remediationFor, REMEDIATION_DISCLAIMER } from "./lib/remediation";
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
                <Suggestions alertId={a.id} />
              </Alert>
            ))}
            <p className="text-[11px] leading-relaxed text-dim">{REMEDIATION_DISCLAIMER}</p>
          </div>
        )}

        {/* Always on screen, breached or not — § 6.1. A limit that only appears
            when it is exceeded means the one question people actually ask
            ("how close was I?") has no answer on a clean log. */}
        <div className="mt-6" data-testid="limit-overview">
          <p className="legend-label">Grenzwerte dieses Profils</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {[
              { label: "EGT", value: `${limits.maxEgt} °C` },
              { label: "Ladedruck", value: `${limits.maxBoost.toFixed(2)} bar` },
              { label: "HPFP min.", value: `${limits.minHpfpPressure} bar` },
              { label: "Ladedruck-Abw.", value: `± ${limits.boostDeviation.toFixed(2)} bar` },
              { label: "Fuel-Trim", value: `± ${limits.fuelTrimLimit} %` },
              { label: "HPFP-Einbruch", value: `${limits.hpfpDrop} bar` },
              { label: "Klopfen", value: `${limits.knockCorrection}°` },
              { label: "Lambda (WOT)", value: `≤ ${limits.maxLambdaWot.toFixed(2)}` },
            ].map((row) => (
              /* Deliberately NOT StatusBadge and not the ok/watch/risk tokens: an
                 unreached limit is not a verdict, and colouring it would make a
                 completely unremarkable log look alarming. */
              <div key={row.label} className="min-w-0">
                <p className="legend-label">{row.label}</p>
                <p className="readout mt-0.5 text-sm text-dim">{row.value}</p>
              </div>
            ))}
          </div>
        </div>

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

/**
 * Where to start looking, for one alert.
 *
 * Collapsed by default: the verdict and its measurement come first, and a wall
 * of suggestions under every warning would bury them. Opening it is a
 * deliberate "what do I do about this" — which is also why the summary says so
 * rather than just "Details".
 *
 * These EXPLAIN the verdict; they never change it. Nothing here feeds back into
 * `evaluate-log-pull.ts`, and there is deliberately no EVALUATION_RULES_VERSION
 * bump — that counter belongs to changes in how a log is judged.
 */
function Suggestions({ alertId }: { alertId: string }) {
  const remediation = remediationFor(alertId);
  if (!remediation) return null;
  return (
    <details className="mt-2" data-testid={`remediation-${alertId}`}>
      <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold sm:min-h-8">
        Was jetzt prüfen?
      </summary>
      <p className="mt-1.5 text-[11px] leading-relaxed text-dim">{remediation.rationale}</p>
      <ol className="mt-2 flex list-decimal flex-col gap-1 pl-4 text-[11px] leading-relaxed">
        {remediation.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </details>
  );
}
