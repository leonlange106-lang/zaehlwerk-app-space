"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Select,
} from "@mantine/core";
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
    <Stack gap="lg" maw={820} mx="auto">
      <Group gap="md">
        <ThemeIcon variant="light" color="orange" radius="md" size={44}>
          <IconEngine size={24} stroke={1.5} />
        </ThemeIcon>
        <div>
          <Title order={2}>Fahrzeug- &amp; Motor-Profil</Title>
          <Text c="dimmed" size="sm">
            Exakte Motorbezeichnung + Hardware bestimmen die kontextuellen Grenzwerte der
            automatischen Log-Bewertung.
          </Text>
        </div>
      </Group>

      <Card withBorder radius="md" p="lg">
        <Group gap="xs" mb="md">
          <ThemeIcon variant="light" color="orange" radius="md" size={28}>
            <IconCar size={16} stroke={1.6} />
          </ThemeIcon>
          <Title order={5}>Fahrzeug &amp; Antrieb</Title>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
          <Select
            label="Marke"
            data={VEHICLE_CATALOG.map((b) => ({ value: b.id, label: b.label }))}
            value={spec.brand}
            onChange={onBrand}
            placeholder="Marke wählen"
            clearable
            data-testid="spec-brand"
          />
          <Select
            label="Baureihe"
            data={(brand?.series ?? []).map((s) => ({ value: s.id, label: s.label }))}
            value={spec.series}
            onChange={onSeries}
            placeholder={brand ? "Baureihe wählen" : "erst Marke wählen"}
            disabled={!brand}
            clearable
            data-testid="spec-series"
          />
          <Select
            label="Modell"
            data={(series?.models ?? []).map((m) => ({ value: m.id, label: m.label }))}
            value={spec.model}
            onChange={onModel}
            placeholder={series ? "Modell wählen" : "erst Baureihe wählen"}
            disabled={!series}
            clearable
            data-testid="spec-model"
          />
          <Select
            label="Motor (exakte Bezeichnung)"
            data={engineChoices}
            value={spec.engineCode}
            onChange={(v) => v && update("engineCode", v as EngineCode)}
            allowDeselect={false}
            searchable
            data-testid="spec-engine"
          />
          <Select
            label="Getriebe"
            data={transmissionChoices}
            value={spec.transmission}
            onChange={(v) => v && update("transmission", v as TransmissionCode)}
            allowDeselect={false}
            searchable
            data-testid="spec-transmission"
          />
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="sm">
          {ENGINES[spec.engineCode].displacement} · Redline-Bezug{" "}
          {ENGINES[spec.engineCode].thresholds.redlineRpm} RPM
        </Text>
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={5} mb="md">
          Hardware-Setup
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Select
            label="Katalysator"
            data={options<CatType>(CAT_TYPE_LABELS)}
            value={spec.catType}
            onChange={(v) => v && update("catType", v as CatType)}
            allowDeselect={false}
            data-testid="spec-cat"
          />
          <Select
            label="Kraftstoff / Oktan"
            data={options<FuelType>(FUEL_LABELS)}
            value={spec.fuel}
            onChange={(v) => v && update("fuel", v as FuelType)}
            allowDeselect={false}
            data-testid="spec-fuel"
          />
          <Select
            label="Turbolader"
            data={options<TurboType>(TURBO_LABELS)}
            value={spec.turbo}
            onChange={(v) => v && update("turbo", v as TurboType)}
            allowDeselect={false}
            data-testid="spec-turbo"
          />
          <Select
            label="Hochdruckpumpe (HPFP)"
            data={options<HpfpType>(HPFP_LABELS)}
            value={spec.hpfp}
            onChange={(v) => v && update("hpfp", v as HpfpType)}
            allowDeselect={false}
            data-testid="spec-hpfp"
          />
          <Select
            label="Tuning-Stufe (Map)"
            data={options<TuneStage>(STAGE_LABELS)}
            value={spec.stage}
            onChange={(v) => v && update("stage", v as TuneStage)}
            allowDeselect={false}
            data-testid="spec-stage"
          />
        </SimpleGrid>

        <Group justify="flex-end" mt="lg">
          {saved && (
            <Badge color="teal" variant="light" data-testid="spec-saved">
              Gespeichert
            </Badge>
          )}
          <Button
            color="orange"
            leftSection={<IconDeviceFloppy size={16} />}
            onClick={save}
            data-testid="spec-save"
          >
            Profil speichern
          </Button>
        </Group>
      </Card>

      <Card withBorder radius="md" p="lg">
        <Group gap="xs" mb="md">
          <ThemeIcon variant="light" color="slate" radius="md" size={30}>
            <IconGauge size={17} stroke={1.6} />
          </ThemeIcon>
          <Title order={5}>Abgeleitete Grenzwerte</Title>
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="md">
          <Limit label="EGT-Limit" value={`${limits.maxEgt} °C`} />
          <Limit label="Max. Boost (plausibel)" value={`${limits.maxBoost.toFixed(2)} bar`} />
          <Limit label="Min. HPFP-Druck" value={`${limits.minHpfpPressure} bar`} />
          <Limit label="Boost-Abweichung" value={`± ${limits.boostDeviation.toFixed(2)} bar`} />
          <Limit label="Fuel-Trim-Limit" value={`± ${limits.fuelTrimLimit} %`} />
          <Limit label="HPFP-Einbruch" value={`${limits.hpfpDrop} bar`} />
          <Limit label="Knock-Korrektur" value={`${limits.knockCorrection}°`} />
          <Limit label="Pull-Fenster" value={`≤ ${limits.rpmStartMax} → ≥ ${limits.rpmEndMin}`} />
        </SimpleGrid>
        <Divider my="md" />
        <Text size="xs" c="dimmed">
          Basis: {limits.engineLabel}. {limits.egtRationale}
        </Text>
      </Card>
    </Stack>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} lh={1.3}>
        {label}
      </Text>
      <Text size="sm" fw={600}>
        {value}
      </Text>
    </div>
  );
}
