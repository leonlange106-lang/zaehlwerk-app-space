"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { Field, Select, SelectShell } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { Divider, IconChip, PageHeader } from "@/app/components/ui/primitives";
import { IconCar, IconDeviceFloppy, IconEngine, IconGauge } from "@tabler/icons-react";
import { loadVehicleSpec, saveVehicleSpec } from "./lib/spec-store";
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

// The vehicle & hardware setup profile form. Everything persists to
// localStorage (spec-store) — no server round trip. The exact engine
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
  const [spec, setSpec] = useState<VehicleSpec | null>(null);
  const [saved, setSaved] = useState(false);

  // localStorage is client-only; read once on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpec(loadVehicleSpec());
  }, []);

  if (!spec) return null;

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

  function save() {
    if (!spec) return;
    saveVehicleSpec(spec);
    setSaved(true);
  }

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

      <Panel title="Fahrzeug & Antrieb" icon={<IconCar size={17} stroke={1.7} />}>
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

        <div className="mt-6 flex items-center justify-end gap-3">
          {saved && <Badge tone="accent" data-testid="spec-saved">Gespeichert</Badge>}
          <Button variant="primary" onClick={save} data-testid="spec-save">
            <IconDeviceFloppy size={16} />
            Profil speichern
          </Button>
        </div>
      </Panel>

      <Panel title="Abgeleitete Grenzwerte" icon={<IconGauge size={17} stroke={1.7} />}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          <Limit label="EGT-Limit" value={`${limits.maxEgt} °C`} />
          <Limit label="Max. Boost (plausibel)" value={`${limits.maxBoost.toFixed(2)} bar`} />
          <Limit label="Min. HPFP-Druck" value={`${limits.minHpfpPressure} bar`} />
          <Limit label="Boost-Abweichung" value={`± ${limits.boostDeviation.toFixed(2)} bar`} />
          <Limit label="Fuel-Trim-Limit" value={`± ${limits.fuelTrimLimit} %`} />
          <Limit label="HPFP-Einbruch" value={`${limits.hpfpDrop} bar`} />
          <Limit label="Knock-Korrektur" value={`${limits.knockCorrection}°`} />
          <Limit label="Pull-Fenster" value={`≤ ${limits.rpmStartMax} → ≥ ${limits.rpmEndMin}`} />
        </div>
        <Divider className="my-4" />
        <p className="text-xs text-dim">
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
