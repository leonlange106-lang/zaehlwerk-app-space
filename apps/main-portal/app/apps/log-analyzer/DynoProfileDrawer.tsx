"use client";

import { useState } from "react";
import { Badge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { Field, NumberInput, Select, SelectShell, TextInput } from "@/app/components/ui/Field";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import { Divider } from "@/app/components/ui/primitives";
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
  // A right-hand drawer is a desktop idiom — at 390px it covers the screen and
  // its Save button lands in the top-right corner, the least reachable spot on a
  // phone. ResponsiveDialog already resolves that with a media query (a bottom
  // sheet below `sm`, a centred panel above), so the useMediaQuery this used to
  // read — which settles only after mount, and swapped the shape in front of the
  // user — is gone.
  return (
    <ResponsiveDialog
      opened={opened}
      onClose={onClose}
      title="Fahrzeug-Parameter (Virtueller Prüfstand)"
      size="lg"
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
    </ResponsiveDialog>
  );
}

/** A labelled numeric field. The unit rides in the label — a native number input
 *  has no suffix slot, and putting it in the value would break `fill()`. */
function NumField({
  label,
  unit,
  description,
  testId,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  unit?: string;
  description?: string;
  testId?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <Field label={unit ? `${label} (${unit})` : label} description={description}>
      {({ id, describedBy }) => (
        <NumberInput
          id={id}
          aria-describedby={describedBy}
          data-testid={testId}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
      )}
    </Field>
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

  return (
    <div className="flex flex-col gap-4" data-testid="dyno-drawer">
      <Field
        label="Plattform-Preset"
        description="Füllt alle Werte mit Referenzdaten der Plattform – danach frei anpassbar."
      >
        {({ id, describedBy }) => (
          <SelectShell>
            <Select
              id={id}
              aria-describedby={describedBy}
              value={draft.presetId ?? ""}
              onChange={(event) => applyPreset(event.currentTarget.value || null)}
              data-testid="dyno-preset"
            >
              <option value="">Preset wählen…</option>
              {DYNO_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </Select>
          </SelectShell>
        )}
      </Field>

      <Divider />
      <p className="legend-label">Fahrzeug</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumField
          label="Masse inkl. Fahrer"
          unit="kg"
          testId="dyno-mass"
          min={300}
          max={5000}
          step={10}
          value={draft.massKg}
          onChange={(v) => update("massKg", v)}
        />
        <NumField
          label="Antriebsstrang-Verlust"
          unit="%"
          testId="dyno-loss"
          min={0}
          max={45}
          step={1}
          value={draft.drivetrainLossPct}
          onChange={(v) => update("drivetrainLossPct", v)}
        />
        {/* The engine belongs to the car, not to the dyno run — it is configured
            once in the vehicle profile and only mirrored here. */}
        <Field label="Hubraum" description="Aus dem Fahrzeugprofil (Motor)">
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              value={`${draft.displacementL.toFixed(1)} L · ${engineProfile(engineCode).label}`}
              readOnly
              data-testid="dyno-displacement"
            />
          )}
        </Field>
        <NumField
          label="Volumetrischer Wirkungsgrad (VE)"
          description="Nur relevant ohne MAF-Kanal"
          min={0.3}
          max={1.5}
          step={0.01}
          value={draft.volumetricEfficiency}
          onChange={(v) => update("volumetricEfficiency", v)}
        />
        <NumField
          label="Luftmasse je PS-Einheit"
          description="g/s Luft pro hp – Effizienz-Offset (Standard 0,80)"
          testId="dyno-grams-per-hp"
          min={0.4}
          max={1.5}
          step={0.01}
          value={draft.gramsPerHp}
          onChange={(v) => update("gramsPerHp", v)}
        />
      </div>

      <Divider />
      <p className="legend-label">Reifen & Übersetzung</p>
      <div className="grid grid-cols-3 gap-3">
        <NumField
          label="Breite"
          unit="mm"
          min={100}
          max={400}
          step={5}
          value={draft.tire.widthMm}
          onChange={(v) => updateTire("widthMm", v)}
        />
        <NumField
          label="Querschnitt"
          unit="%"
          min={15}
          max={90}
          step={5}
          value={draft.tire.aspectPct}
          onChange={(v) => updateTire("aspectPct", v)}
        />
        <NumField
          label="Felge"
          unit="Zoll"
          min={10}
          max={26}
          step={1}
          value={draft.tire.rimIn}
          onChange={(v) => updateTire("rimIn", v)}
        />
      </div>
      <p className="text-xs text-dim">
        Abrollumfang: {tireCircumferenceM(draft.tire).toFixed(3)} m
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Getriebeübersetzungen"
          description="Gang 1 … n, kommagetrennt"
          error={ratiosValid ? undefined : "Nur positive Zahlen, kommagetrennt"}
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              value={ratioText}
              onChange={(e) => onRatios(e.currentTarget.value)}
              data-testid="dyno-ratios"
            />
          )}
        </Field>
        <NumField
          label="Achsübersetzung"
          min={1}
          max={8}
          step={0.01}
          value={draft.finalDrive}
          onChange={(v) => update("finalDrive", v)}
        />
        <Field
          label="Gang des Pulls"
          description="Nur nötig, wenn kein Geschwindigkeits-Kanal geloggt ist"
        >
          {({ id, describedBy }) => (
            <SelectShell>
              <Select
                id={id}
                aria-describedby={describedBy}
                value={draft.gear === null ? "" : String(draft.gear)}
                onChange={(event) =>
                  update("gear", event.currentTarget.value ? Number(event.currentTarget.value) : null)
                }
                data-testid="dyno-gear"
              >
                <option value="">Automatisch aus dem Log</option>
                {draft.gearRatios.map((_, i) => (
                  <option key={i} value={String(i + 1)}>
                    {i + 1}. Gang
                  </option>
                ))}
              </Select>
            </SelectShell>
          )}
        </Field>
      </div>

      <Divider />
      <p className="legend-label">Fahrwiderstände</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumField
          label="cW-Wert"
          min={0.1}
          max={1}
          step={0.01}
          value={draft.dragCoefficient}
          onChange={(v) => update("dragCoefficient", v)}
        />
        <NumField
          label="Stirnfläche"
          unit="m²"
          min={1}
          max={5}
          step={0.01}
          value={draft.frontalAreaM2}
          onChange={(v) => update("frontalAreaM2", v)}
        />
        <NumField
          label="Rollwiderstandsbeiwert"
          min={0.005}
          max={0.05}
          step={0.001}
          value={draft.rollingResistance}
          onChange={(v) => update("rollingResistance", v)}
        />
        <NumField
          label="Rotationsmassen-Faktor"
          min={1}
          max={1.3}
          step={0.01}
          value={draft.rotatingMassFactor}
          onChange={(v) => update("rotatingMassFactor", v)}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        {draft.presetId ? (
          <Badge tone="accent">{findDynoPreset(draft.presetId)?.label}</Badge>
        ) : (
          <Badge>
            <IconRotate size={12} className="mr-1" />
            Eigenes Profil
          </Badge>
        )}
        <Button
          variant="primary"
          onClick={save}
          disabled={!ratiosValid}
          data-testid="dyno-save"
        >
          <IconDeviceFloppy size={16} />
          Speichern
        </Button>
      </div>
    </div>
  );
}
