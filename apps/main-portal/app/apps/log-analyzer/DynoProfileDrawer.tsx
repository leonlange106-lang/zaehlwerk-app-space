"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Divider,
  Drawer,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconDeviceFloppy, IconRotate } from "@tabler/icons-react";
import {
  applyVehicleEngine,
  DYNO_PRESETS,
  findDynoPreset,
  tireCircumferenceM,
  type DynoProfile,
} from "./lib/dyno-spec";
import { engineProfile, type EngineCode } from "./lib/engines";
import { saveDynoProfile } from "./lib/dyno-store";

// The vehicle-dynamics config drawer. A platform preset fills in every number at
// once; each field stays editable afterwards (which clears the preset badge,
// because the profile is then the user's own). Saving persists to localStorage
// and hands the profile back so the dyno recomputes immediately.

/** Gear ratios are edited as a comma-separated list — compact and paste-able. */
function ratiosToText(ratios: number[]): string {
  return ratios.join(", ");
}

function parseRatios(text: string): number[] | null {
  const parts = text
    .split(/[,;\s]+/)
    .map((p) => p.trim().replace(",", "."))
    .filter(Boolean);
  const ratios = parts.map(Number);
  if (ratios.length === 0 || ratios.some((r) => !Number.isFinite(r) || r <= 0)) return null;
  return ratios;
}

export function DynoProfileDrawer({
  opened,
  profile,
  engineCode,
  onClose,
  onSave,
}: {
  opened: boolean;
  profile: DynoProfile;
  /** Engine from the vehicle profile — the source of the displacement. */
  engineCode: EngineCode;
  onClose: () => void;
  onSave: (profile: DynoProfile) => void;
}) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      title="Fahrzeug-Parameter (Virtueller Prüfstand)"
    >
      {/* Mounted only while open, so every open re-seeds from the saved profile
          and a cancelled edit can never leak into the next session. */}
      {opened && (
        <ProfileForm
          profile={profile}
          engineCode={engineCode}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Drawer>
  );
}

function ProfileForm({
  profile,
  engineCode,
  onClose,
  onSave,
}: {
  profile: DynoProfile;
  engineCode: EngineCode;
  onClose: () => void;
  onSave: (profile: DynoProfile) => void;
}) {
  const [draft, setDraft] = useState<DynoProfile>(profile);
  const [ratioText, setRatioText] = useState(ratiosToText(profile.gearRatios));

  // Any manual edit detaches the profile from its preset.
  const update = <K extends keyof DynoProfile>(key: K, value: DynoProfile[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value, presetId: null }));
  };

  const updateTire = (key: keyof DynoProfile["tire"], value: number) => {
    setDraft((prev) => ({ ...prev, tire: { ...prev.tire, [key]: value }, presetId: null }));
  };

  const applyPreset = (id: string | null) => {
    const preset = findDynoPreset(id);
    if (!preset) return;
    // A preset carries its own displacement, but the vehicle profile's engine
    // still wins — otherwise the read-only field would contradict the car.
    setDraft(applyVehicleEngine({ presetId: preset.id, ...preset.profile }, engineCode));
    setRatioText(ratiosToText(preset.profile.gearRatios));
  };

  const onRatios = (text: string) => {
    setRatioText(text);
    const parsed = parseRatios(text);
    if (parsed) update("gearRatios", parsed);
  };

  const ratiosValid = parseRatios(ratioText) !== null;

  const save = () => {
    saveDynoProfile(draft);
    onSave(draft);
    onClose();
  };

  /** NumberInput hands back "" while a field is being cleared — keep the last value. */
  const num = (value: number | string, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return (
    <Stack gap="md" data-testid="dyno-drawer">
      <Select
        label="Plattform-Preset"
        description="Füllt alle Werte mit Referenzdaten der Plattform – danach frei anpassbar."
        data={DYNO_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        value={draft.presetId}
        onChange={applyPreset}
        placeholder="Preset wählen…"
        searchable
        data-testid="dyno-preset"
      />

      <Divider label="Fahrzeug" labelPosition="left" />
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <NumberInput
          label="Masse inkl. Fahrer"
          suffix=" kg"
          min={300}
          max={5000}
          step={10}
          value={draft.massKg}
          onChange={(v) => update("massKg", num(v, draft.massKg))}
          data-testid="dyno-mass"
        />
        <NumberInput
          label="Antriebsstrang-Verlust"
          suffix=" %"
          min={0}
          max={45}
          step={1}
          value={draft.drivetrainLossPct}
          onChange={(v) => update("drivetrainLossPct", num(v, draft.drivetrainLossPct))}
          data-testid="dyno-loss"
        />
        {/* The engine belongs to the car, not to the dyno run — it is configured
            once in the vehicle profile and only mirrored here. */}
        <TextInput
          label="Hubraum"
          description="Aus dem Fahrzeugprofil (Motor)"
          value={`${draft.displacementL.toFixed(1)} L · ${engineProfile(engineCode).label}`}
          readOnly
          data-testid="dyno-displacement"
        />
        <NumberInput
          label="Volumetrischer Wirkungsgrad (VE)"
          description="Nur relevant ohne MAF-Kanal"
          min={0.3}
          max={1.5}
          step={0.01}
          decimalScale={2}
          value={draft.volumetricEfficiency}
          onChange={(v) => update("volumetricEfficiency", num(v, draft.volumetricEfficiency))}
        />
        <NumberInput
          label="Luftmasse je PS-Einheit"
          description="g/s Luft pro hp – Effizienz-Offset (Standard 0,80)"
          min={0.4}
          max={1.5}
          step={0.01}
          decimalScale={2}
          value={draft.gramsPerHp}
          onChange={(v) => update("gramsPerHp", num(v, draft.gramsPerHp))}
          data-testid="dyno-grams-per-hp"
        />
      </SimpleGrid>

      <Divider label="Reifen & Übersetzung" labelPosition="left" />
      <SimpleGrid cols={{ base: 3 }} spacing="sm">
        <NumberInput
          label="Breite"
          suffix=" mm"
          min={100}
          max={400}
          step={5}
          value={draft.tire.widthMm}
          onChange={(v) => updateTire("widthMm", num(v, draft.tire.widthMm))}
        />
        <NumberInput
          label="Querschnitt"
          suffix=" %"
          min={15}
          max={90}
          step={5}
          value={draft.tire.aspectPct}
          onChange={(v) => updateTire("aspectPct", num(v, draft.tire.aspectPct))}
        />
        <NumberInput
          label="Felge"
          suffix=" Zoll"
          min={10}
          max={26}
          step={1}
          value={draft.tire.rimIn}
          onChange={(v) => updateTire("rimIn", num(v, draft.tire.rimIn))}
        />
      </SimpleGrid>
      <Text size="xs" c="dimmed">
        Abrollumfang: {tireCircumferenceM(draft.tire).toFixed(3)} m
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <TextInput
          label="Getriebeübersetzungen"
          description="Gang 1 … n, kommagetrennt"
          value={ratioText}
          onChange={(e) => onRatios(e.currentTarget.value)}
          error={ratiosValid ? null : "Nur positive Zahlen, kommagetrennt"}
          data-testid="dyno-ratios"
        />
        <NumberInput
          label="Achsübersetzung"
          min={1}
          max={8}
          step={0.01}
          decimalScale={2}
          value={draft.finalDrive}
          onChange={(v) => update("finalDrive", num(v, draft.finalDrive))}
        />
        <Select
          label="Gang des Pulls"
          description="Nur nötig, wenn kein Geschwindigkeits-Kanal geloggt ist"
          data={draft.gearRatios.map((_, i) => ({ value: String(i + 1), label: `${i + 1}. Gang` }))}
          value={draft.gear === null ? null : String(draft.gear)}
          onChange={(v) => update("gear", v === null ? null : Number(v))}
          placeholder="Automatisch aus dem Log"
          clearable
          data-testid="dyno-gear"
        />
      </SimpleGrid>

      <Divider label="Fahrwiderstände" labelPosition="left" />
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <NumberInput
          label="cW-Wert"
          min={0.1}
          max={1}
          step={0.01}
          decimalScale={2}
          value={draft.dragCoefficient}
          onChange={(v) => update("dragCoefficient", num(v, draft.dragCoefficient))}
        />
        <NumberInput
          label="Stirnfläche"
          suffix=" m²"
          min={1}
          max={5}
          step={0.01}
          decimalScale={2}
          value={draft.frontalAreaM2}
          onChange={(v) => update("frontalAreaM2", num(v, draft.frontalAreaM2))}
        />
        <NumberInput
          label="Rollwiderstandsbeiwert"
          min={0.005}
          max={0.05}
          step={0.001}
          decimalScale={3}
          value={draft.rollingResistance}
          onChange={(v) => update("rollingResistance", num(v, draft.rollingResistance))}
        />
        <NumberInput
          label="Rotationsmassen-Faktor"
          min={1}
          max={1.3}
          step={0.01}
          decimalScale={2}
          value={draft.rotatingMassFactor}
          onChange={(v) => update("rotatingMassFactor", num(v, draft.rotatingMassFactor))}
        />
      </SimpleGrid>

      <Group justify="space-between" mt="md">
        {draft.presetId ? (
          <Badge variant="light" color="orange">
            {findDynoPreset(draft.presetId)?.label}
          </Badge>
        ) : (
          <Badge variant="light" color="slate" leftSection={<IconRotate size={12} />}>
            Eigenes Profil
          </Badge>
        )}
        <Button
          color="orange"
          leftSection={<IconDeviceFloppy size={16} />}
          onClick={save}
          disabled={!ratiosValid}
          data-testid="dyno-save"
        >
          Speichern
        </Button>
      </Group>
    </Stack>
  );
}
