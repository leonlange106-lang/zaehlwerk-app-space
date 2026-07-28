"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { Field, NumberInput, Select, SelectShell, TextInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { Alert, Divider, IconChip, PageHeader, Spinner } from "@/app/components/ui/primitives";
import {
  IconAlertTriangle,
  IconCar,
  IconDeviceFloppy,
  IconEngine,
  IconGauge,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { loadVehicleSpec } from "./lib/spec-store";
import {
  createVehicleAction,
  deleteVehicleAction,
  listVehiclesAction,
  setActiveVehicleAction,
  updateVehicleAction,
} from "@/app/lib/vehicle-actions";
import type { StoredVehicle } from "@/app/lib/vehicle-repository";
import {
  describeLimits,
  LIMIT_BOUNDS,
  type LimitOverrides,
  type OverridableLimit,
} from "./lib/limit-overrides";
import {
  ENGINES,
  ENGINE_CODES,
  TRANSMISSIONS,
  TRANSMISSION_CODES,
  type EngineCode,
  type TransmissionCode,
} from "./lib/engines";
import { VEHICLE_CATALOG, findModel } from "./lib/catalog";
import {
  CAT_TYPE_LABELS,
  FUEL_LABELS,
  HPFP_LABELS,
  STAGE_LABELS,
  TURBO_LABELS,
  limitsForSpec,
  type CatType,
  type FuelType,
  type HpfpType,
  type TurboType,
  type TuneStage,
  type VehicleSpec,
} from "./lib/vehicle-spec";

// The vehicle & hardware setup profile form. Everything persists to the
// DATABASE through the vehicle actions; localStorage is read exactly once, to
// seed a first vehicle from the old single profile. The exact engine
// designation drives the baseline thresholds; the hardware modifiers shift them.
// The derived, contextual limits are shown live so the user sees how each choice
// changes the plausibility/safety thresholds the evaluation engine will apply.

function options<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

function engineOptions(codes: readonly EngineCode[]) {
  return codes.map((code) => ({ value: code, label: ENGINES[code].label }));
}

function transmissionOptions(codes: readonly TransmissionCode[]) {
  return codes.map((code) => ({ value: code, label: TRANSMISSIONS[code] }));
}

/**
 * One labelled native select. Keeps the data-testid the E2E suite locates.
 *
 * Module scope on purpose: declared inside the form it would be a NEW component
 * type on every render, so React would unmount and remount each select — losing
 * focus mid-interaction and closing an open dropdown on the next keystroke.
 */
function Choice({
  label,
  testId,
  value,
  onChange,
  disabled,
  placeholder,
  options: opts,
}: {
  label: string;
  testId: string;
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Field label={label}>
      {({ id }) => (
        <SelectShell>
          <Select
            id={id}
            data-testid={testId}
            value={value ?? ""}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}
          >
            {placeholder && <option value="">{placeholder}</option>}
            {opts.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </SelectShell>
      )}
    </Field>
  );
}

export function VehicleSpecForm() {
  const [vehicles, setVehicles] = useState<StoredVehicle[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState<VehicleSpec | null>(null);
  const [overrides, setOverrides] = useState<LimitOverrides>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((vehicle: StoredVehicle) => {
    setActiveId(vehicle.id);
    setName(vehicle.name);
    setSpec(vehicle.spec);
    setOverrides(vehicle.limitOverrides);
    setSaved(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await listVehiclesAction();
        if (!alive) return;
        setVehicles(list);
        const active = list.find((v) => v.active) ?? list[0] ?? null;
        if (active) {
          adopt(active);
        } else {
          // No vehicle yet. Seed the form from whatever the old single
          // localStorage profile held, so the person who has been using this app
          // does not find their setup gone after an update — they press save
          // once and it becomes their first vehicle.
          setSpec(loadVehicleSpec());
          setName("Mein Fahrzeug");
        }
      } catch {
        if (alive) setError("Fahrzeuge konnten nicht geladen werden.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [adopt]);

  if (!spec || vehicles === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-dim">
        <Spinner size={16} label="Fahrzeuge werden geladen" />
        Fahrzeuge werden geladen…
      </div>
    );
  }

  const update = <K extends keyof VehicleSpec>(key: K, value: VehicleSpec[K]) => {
    setSpec((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  };

  const brand = VEHICLE_CATALOG.find((b) => b.id === spec.brand) ?? null;
  const series = brand?.series.find((s) => s.id === spec.series) ?? null;
  const model = series?.models.find((m) => m.id === spec.model) ?? null;

  // Selecting a brand/series/model cascades: narrower fields reset, and picking a
  // model auto-selects a plausible engine + gearbox (still overridable below).
  const onBrand = (brandId: string | null) => {
    setSpec((prev) => (prev ? { ...prev, brand: brandId, series: null, model: null } : prev));
    setSaved(false);
  };
  const onSeries = (seriesId: string | null) => {
    setSpec((prev) => (prev ? { ...prev, series: seriesId, model: null } : prev));
    setSaved(false);
  };
  const onModel = (modelId: string | null) => {
    const loc = findModel(modelId);
    setSpec((prev) => {
      if (!prev) return prev;
      if (!loc) return { ...prev, model: modelId };
      return {
        ...prev,
        brand: loc.brand.id,
        series: loc.series.id,
        model: loc.model.id,
        engineCode: loc.model.engines[0] ?? prev.engineCode,
        transmission: loc.model.transmissions[0] ?? prev.transmission,
      };
    });
    setSaved(false);
  };

  const engineChoices = model ? engineOptions(model.engines) : engineOptions(ENGINE_CODES);
  const transmissionChoices = model
    ? transmissionOptions(model.transmissions)
    : transmissionOptions(TRANSMISSION_CODES);

  const limits = limitsForSpec(spec);

  async function save() {
    if (!spec) return;
    setBusy(true);
    setError(null);
    const payload = { name, spec, limitOverrides: overrides };
    try {
      const result = activeId
        ? await updateVehicleAction(activeId, payload)
        : await createVehicleAction(payload);
      if (!result.success) {
        setError(result.error ?? "Speichern fehlgeschlagen.");
        return;
      }
      setVehicles(await listVehiclesAction());
      if (result.vehicle) setActiveId(result.vehicle.id);
      setSaved(true);
    } catch {
      setError("Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function switchTo(id: string) {
    const target = vehicles?.find((v) => v.id === id);
    if (!target) return;
    setBusy(true);
    try {
      await setActiveVehicleAction(id);
      adopt(target);
      setVehicles(await listVehiclesAction());
    } finally {
      setBusy(false);
    }
  }

  /** Start a NEW vehicle from the current one — the usual case is a second car
   *  of the same family, not a blank form. */
  function startNew() {
    setActiveId(null);
    setName("");
    setOverrides({});
    setSaved(false);
  }

  async function remove() {
    if (!activeId) return;
    setBusy(true);
    try {
      await deleteVehicleAction(activeId);
      const list = await listVehiclesAction();
      setVehicles(list);
      const next = list.find((v) => v.active) ?? list[0] ?? null;
      if (next) adopt(next);
      else startNew();
    } finally {
      setBusy(false);
    }
  }

  const setOverride = (key: OverridableLimit, value: number | null) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
    setSaved(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <IconChip size={44}>
          <IconEngine size={22} stroke={1.6} />
        </IconChip>
        <PageHeader
          title="Fahrzeug- & Motor-Profil"
          description="Exakte Motorbezeichnung + Hardware bestimmen die kontextuellen Grenzwerte der automatischen Log-Bewertung."
        />
      </div>

      {vehicles.length > 0 && (
        <Panel title="Fahrzeuge" icon={<IconCar size={17} stroke={1.7} />}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Aktives Fahrzeug" className="flex-1">
              {({ id }) => (
                <SelectShell>
                  <Select
                    id={id}
                    value={activeId ?? ""}
                    data-testid="vehicle-picker"
                    disabled={busy}
                    onChange={(event) => void switchTo(event.currentTarget.value)}
                  >
                    {!activeId && <option value="">Neues Fahrzeug…</option>}
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.name}
                      </option>
                    ))}
                  </Select>
                </SelectShell>
              )}
            </Field>
            <div className="flex gap-2">
              <Button variant="subtle" onClick={startNew} disabled={busy} data-testid="vehicle-new">
                <IconPlus size={16} />
                Neu
              </Button>
              {activeId && vehicles.length > 1 && (
                <Button
                  variant="danger"
                  onClick={() => void remove()}
                  disabled={busy}
                  data-testid="vehicle-delete"
                >
                  <IconTrash size={16} />
                  Löschen
                </Button>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-dim">
            Das aktive Fahrzeug bestimmt, gegen welche Grenzwerte neue Logs bewertet werden.
            Gespeicherte Logs behalten das Fahrzeug, mit dem sie bewertet wurden.
          </p>
        </Panel>
      )}

      <Panel title="Fahrzeug & Antrieb" icon={<IconCar size={17} stroke={1.7} />}>
        <Field label="Bezeichnung" required className="mb-4">
          {({ id }) => (
            <TextInput
              id={id}
              value={name}
              data-testid="vehicle-name"
              placeholder="E92 335i, Sommerreifen"
              onChange={(event) => {
                setName(event.currentTarget.value);
                setSaved(false);
              }}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          <Choice
            label="Marke"
            testId="spec-brand"
            value={spec.brand}
            onChange={(v) => onBrand(v || null)}
            placeholder="Marke wählen"
            options={VEHICLE_CATALOG.map((b) => ({ value: b.id, label: b.label }))}
          />
          <Choice
            label="Baureihe"
            testId="spec-series"
            value={spec.series}
            onChange={(v) => onSeries(v || null)}
            disabled={!brand}
            placeholder={brand ? "Baureihe wählen" : "erst Marke wählen"}
            options={(brand?.series ?? []).map((x) => ({ value: x.id, label: x.label }))}
          />
          <Choice
            label="Modell"
            testId="spec-model"
            value={spec.model}
            onChange={(v) => onModel(v || null)}
            disabled={!series}
            placeholder={series ? "Modell wählen" : "erst Baureihe wählen"}
            options={(series?.models ?? []).map((m) => ({ value: m.id, label: m.label }))}
          />
          <Choice
            label="Motor (exakte Bezeichnung)"
            testId="spec-engine"
            value={spec.engineCode}
            onChange={(v) => update("engineCode", v as EngineCode)}
            options={engineChoices}
          />
          <Choice
            label="Getriebe"
            testId="spec-transmission"
            value={spec.transmission}
            onChange={(v) => update("transmission", v as TransmissionCode)}
            options={transmissionChoices}
          />
        </div>
        <p className="mt-4 text-xs text-dim">
          {ENGINES[spec.engineCode].displacement} · Redline-Bezug{" "}
          {ENGINES[spec.engineCode].thresholds.redlineRpm} RPM
        </p>
      </Panel>

      <Panel title="Hardware-Setup">
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice
            label="Katalysator"
            testId="spec-cat"
            value={spec.catType}
            onChange={(v) => update("catType", v as CatType)}
            options={options<CatType>(CAT_TYPE_LABELS)}
          />
          <Choice
            label="Kraftstoff / Oktan"
            testId="spec-fuel"
            value={spec.fuel}
            onChange={(v) => update("fuel", v as FuelType)}
            options={options<FuelType>(FUEL_LABELS)}
          />
          <Choice
            label="Turbolader"
            testId="spec-turbo"
            value={spec.turbo}
            onChange={(v) => update("turbo", v as TurboType)}
            options={options<TurboType>(TURBO_LABELS)}
          />
          <Choice
            label="Hochdruckpumpe (HPFP)"
            testId="spec-hpfp"
            value={spec.hpfp}
            onChange={(v) => update("hpfp", v as HpfpType)}
            options={options<HpfpType>(HPFP_LABELS)}
          />
          <Choice
            label="Tuning-Stufe (Map)"
            testId="spec-stage"
            value={spec.stage}
            onChange={(v) => update("stage", v as TuneStage)}
            options={options<TuneStage>(STAGE_LABELS)}
          />
        </div>

        {error && (
          <Alert tone="risk" role="alert" icon={<IconAlertTriangle size={16} />} className="mt-4">
            {error}
          </Alert>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          {saved && <Badge tone="accent" data-testid="spec-saved">Gespeichert</Badge>}
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={busy || name.trim() === ""}
            data-testid="spec-save"
          >
            <IconDeviceFloppy size={16} />
            {activeId ? "Profil speichern" : "Fahrzeug anlegen"}
          </Button>
        </div>
      </Panel>

      <Panel title="Grenzwerte" icon={<IconGauge size={17} stroke={1.7} />}>
        <p className="mb-4 text-xs text-dim">
          Abgeleitet aus Motor, Hardware und Map. Ein Wert lässt sich überschreiben, wenn du es
          besser weißt — leer lassen heißt &bdquo;abgeleitet&ldquo;, und dann wirkt sich jede spätere
          Korrektur der Tabellen weiter aus.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {describeLimits(spec, overrides).map((row) => (
            <LimitRow
              key={row.key}
              row={row}
              disabled={busy}
              onChange={(value) => setOverride(row.key, value)}
            />
          ))}
        </div>

        <Divider className="my-4" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Limit label="Pull-Fenster" value={`≤ ${limits.rpmStartMax} → ≥ ${limits.rpmEndMin}`} />
          <Limit label="Knock-Summenanteil" value={`${Math.round(limits.knockTotalShare * 100)} %`} />
          <Limit label="Entprellung" value={`${limits.debounceSamples} Samples`} />
          <Limit label="WOT ab" value={`${limits.wotThreshold} %`} />
        </div>
        <p className="mt-4 text-xs text-dim">
          Basis: {limits.engineLabel}. {limits.egtRationale}
        </p>
      </Panel>
    </div>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="legend-label">{label}</p>
      <p className="readout mt-0.5 text-sm">{value}</p>
    </div>
  );
}

/**
 * One overridable limit.
 *
 * § 6.3 asks for the derived value struck through beside the manual one, and the
 * manual one in red. Red ALONE would break the rule that colour never carries
 * meaning by itself — greyscale report prints and red-green deficiency both lose
 * it — so the manual state also gets a "manuell" badge and the derived value
 * stays on screen next to it. Two channels, one meaning.
 */
function LimitRow({
  row,
  disabled,
  onChange,
}: {
  row: ReturnType<typeof describeLimits>[number];
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  const bounds = LIMIT_BOUNDS[row.key];
  return (
    <Field
      label={row.label}
      description={
        row.manual
          ? undefined
          : `Abgeleitet: ${formatLimit(row.derived)} ${bounds.unit}`
      }
    >
      {({ id, describedBy }) => (
        <div className="flex flex-col gap-1">
          <NumberInput
            id={id}
            aria-describedby={describedBy}
            data-testid={`limit-${row.key}`}
            value={row.manual ? row.value : ""}
            placeholder={formatLimit(row.derived)}
            step="any"
            min={bounds.min}
            max={bounds.max}
            disabled={disabled}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              onChange(raw === "" ? null : Number(raw));
            }}
          />
          {row.manual && (
            <span className="flex items-center gap-1.5 text-[11px] text-dim">
              <Badge tone="accent" data-testid={`limit-manual-${row.key}`}>
                manuell
              </Badge>
              <s>
                {formatLimit(row.derived)} {bounds.unit}
              </s>
            </span>
          )}
        </div>
      )}
    </Field>
  );
}

/** Two decimals only where they carry information (boost, lambda). */
function formatLimit(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
