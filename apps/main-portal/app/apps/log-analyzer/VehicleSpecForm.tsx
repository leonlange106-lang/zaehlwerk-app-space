"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Select,
} from "@mantine/core";
import { IconDeviceFloppy, IconEngine, IconGauge } from "@tabler/icons-react";
import { loadVehicleSpec, saveVehicleSpec } from "./lib/spec-store";
import {
  CAT_TYPE_LABELS,
  FUEL_LABELS,
  HPFP_LABELS,
  TURBO_LABELS,
  limitsForSpec,
  type CatType,
  type FuelType,
  type HpfpType,
  type TurboType,
  type VehicleSpec,
} from "./lib/vehicle-spec";

// The vehicle & hardware setup profile form. Everything persists to
// localStorage (spec-store) — no server round trip. The derived, hardware-
// contextual limits are shown live so the user sees how each choice changes the
// plausibility/safety thresholds the evaluation engine will apply.

function options<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
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

  const limits = limitsForSpec(spec);

  function save() {
    if (!spec) return;
    saveVehicleSpec(spec);
    setSaved(true);
  }

  return (
    <Stack gap="lg" maw={760} mx="auto">
      <Group gap="md">
        <ThemeIcon variant="light" color="orange" radius="md" size={44}>
          <IconEngine size={24} stroke={1.5} />
        </ThemeIcon>
        <div>
          <Title order={2}>Fahrzeug &amp; Hardware-Profil</Title>
          <Text c="dimmed" size="sm">
            Definiert die kontextuellen Grenzwerte für die automatische Log-Bewertung.
          </Text>
        </div>
      </Group>

      <Card withBorder radius="md" p="lg">
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
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
          <Limit label="EGT-Limit" value={`${limits.maxEgt} °C`} />
          <Limit label="Max. Boost (plausibel)" value={`${limits.maxBoost} psi`} />
          <Limit label="Min. HPFP-Druck" value={`${limits.minHpfpPressure} bar`} />
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="md">
          {limits.egtRationale}
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
