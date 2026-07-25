"use client";

import type { CSSProperties } from "react";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { Checkbox as UiCheckbox } from "@/app/components/ui/primitives";
import {
  Field,
  NumberInput,
  Select,
  SelectShell,
  TextInput,
} from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { Alert, Divider, PageHeader, SegmentedControl } from "@/app/components/ui/primitives";
import { IconAlertCircle, IconCheck, IconGauge } from "@tabler/icons-react";
import {
  ENERGY_CATEGORIES,
  ENERGY_CATEGORY_LABELS,
  calculateConsumption,
  sumConsumption,
} from "@zaehlwerk/database/client";
import type { listLocations, listZaehler } from "@/app/lib/zaehler-actions";
import { createAblesungAction, createZaehlerAction } from "@/app/lib/zaehler-actions";
import { initialActionState } from "@/app/lib/action-state";
import { MeterImportCard } from "./MeterImportCard";
import classes from "./ZaehlerManager.module.css";

type ZaehlerList = Awaited<ReturnType<typeof listZaehler>>;
type LocationList = Awaited<ReturnType<typeof listLocations>>;

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    date,
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
}

/** Mobile sections. On tablet/desktop every section is on screen at once. */
type Pane = "zaehler" | "anlegen" | "import";

export function ZaehlerManager({
  zaehlerList,
  locations,
}: {
  zaehlerList: ZaehlerList;
  locations: LocationList;
}) {
  // Phone-only view switch. The three sections used to be one very long vertical
  // scroll (meter list, then two forms, then the importer); on 390px that meant
  // the forms were four screens down. The pill bar swaps between them in place.
  // Purely a CSS concern above `sm` — see `.pane` in the module, which only
  // honours `data-active` below the breakpoint, so the desktop grid is untouched
  // and the first paint is already correct (no mount-time reflow).
  const [pane, setPane] = useState<Pane>("zaehler");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Zähler"
        description="Zähler anlegen, Zählerstände erfassen und Verbrauch je Zähler einsehen."
      />

      {/* Phone-only pane switch. Hidden from `sm` up, where every pane is on
          screen at once — see `.pane` in the module. */}
      <SegmentedControl
        className="sm:hidden"
        label="Bereich wählen"
        value={pane}
        onChange={(value) => setPane(value as Pane)}
        options={[
          { value: "zaehler" as Pane, label: `Zähler (${zaehlerList.length})` },
          { value: "anlegen" as Pane, label: "Erfassen" },
          { value: "import" as Pane, label: "Import" },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-12">
        <div
          className={`${classes.pane} lg:col-span-7`}
          data-active={pane === "zaehler" ? "true" : "false"}
        >
          <div className="flex flex-col gap-2.5">
            {zaehlerList.length === 0 && (
              <Panel className="[&]:p-4">
                <p className="text-sm text-dim">
                  Noch keine Zähler angelegt. Lege über „Erfassen“ den ersten Zähler an.
                </p>
              </Panel>
            )}
            {zaehlerList.map((zaehler) => {
              const intervals = calculateConsumption(zaehler.ablesungen);
              const total = sumConsumption(intervals);
              const lastReading = zaehler.ablesungen.at(-1);

              return (
                <Link
                  key={zaehler.id}
                  href={`/apps/zaehlwerk/zaehler/${zaehler.id}`}
                  className={classes.zaehlerCard}
                  // The meter's own colour becomes the card's left spine, so a
                  // list of eight meters is scannable by edge alone.
                  style={{ "--meter-color": zaehler.farbe } as CSSProperties}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{zaehler.name}</p>
                      <p className="truncate text-xs text-dim">
                        {zaehler.location?.name ?? "Kein Standort"}
                      </p>
                    </div>
                    <Badge>{ENERGY_CATEGORY_LABELS[zaehler.kategorie]}</Badge>
                  </div>

                  <Divider className="my-3" />

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="legend-label">Letzter Stand</p>
                      <p className="readout mt-0.5 text-sm">
                        {lastReading
                          ? `${formatNumber(lastReading.wert)} ${zaehler.einheit}`
                          : "keine Ablesung"}
                      </p>
                      {lastReading && (
                        <p className="mt-0.5 text-xs text-dim">{formatDate(lastReading.datum)}</p>
                      )}
                    </div>
                    <div className="min-w-0 text-right">
                      <p className="legend-label">Verbrauch gesamt</p>
                      <p className="readout mt-0.5 text-sm">
                        {formatNumber(total)} {zaehler.einheit}
                      </p>
                      <p className="mt-0.5 text-xs text-dim">
                        {zaehler.ablesungen.length} Ablesungen
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <div
          className={`${classes.pane} lg:col-span-5`}
          data-active={pane !== "zaehler" ? "true" : "false"}
        >
          <div className="flex flex-col gap-5">
            <div className={classes.pane} data-active={pane === "anlegen" ? "true" : "false"}>
              <div className="flex flex-col gap-5">
                <CreateZaehlerForm locations={locations} />
                <CreateAblesungForm zaehlerList={zaehlerList} />
              </div>
            </div>
            <div className={classes.pane} data-active={pane === "import" ? "true" : "false"}>
              <MeterImportCard locations={locations} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateZaehlerForm({ locations }: { locations: LocationList }) {
  const [state, formAction, pending] = useActionState(createZaehlerAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <Panel title="Neuen Zähler anlegen" icon={<IconGauge size={17} stroke={1.7} />}>
      <form action={formAction} ref={formRef} className="flex flex-col gap-4">
        <Field label="Name" required>
          {({ id }) => (
            <TextInput id={id} name="name" placeholder="z. B. Strom Hauptzähler" required />
          )}
        </Field>
        <Field label="Kategorie / Energieträger" required>
          {({ id }) => (
            <SelectShell>
              <Select id={id} name="kategorie" defaultValue="" required>
                <option value="" disabled>
                  Kategorie wählen
                </option>
                {ENERGY_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {ENERGY_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
            </SelectShell>
          )}
        </Field>
        <Field
          label="Einheit"
          description="Übliche Einheiten: kWh (Strom), m³ (Gas/Wasser)"
          required
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              name="einheit"
              placeholder="z. B. kWh, m³"
              required
            />
          )}
        </Field>
        {locations.length > 0 && (
          <Field label="Standort">
            {({ id }) => (
              <SelectShell>
                <Select id={id} name="locationId" defaultValue="">
                  <option value="">Kein Standort</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
              </SelectShell>
            )}
          </Field>
        )}

        {state.error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {state.error}
          </Alert>
        )}
        {state.success && (
          <Alert tone="ok" icon={<IconCheck size={16} />}>
            Zähler wurde angelegt.
          </Alert>
        )}

        <Button type="submit" variant="primary" full disabled={pending}>
          {pending ? "Wird angelegt…" : "Zähler anlegen"}
        </Button>
      </form>
    </Panel>
  );
}

function CreateAblesungForm({ zaehlerList }: { zaehlerList: ZaehlerList }) {
  const [state, formAction, pending] = useActionState(createAblesungAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <Panel title="Zählerstand erfassen" icon={<IconGauge size={17} stroke={1.7} />}>
      {zaehlerList.length === 0 ? (
        <p className="text-sm text-dim">Lege zuerst einen Zähler an.</p>
      ) : (
        <form action={formAction} ref={formRef} className="flex flex-col gap-4">
          <Field label="Zähler" required>
            {({ id }) => (
              <SelectShell>
                <Select id={id} name="zaehlerId" defaultValue="" required>
                  <option value="" disabled>
                    Zähler wählen
                  </option>
                  {zaehlerList.map((zaehler) => (
                    <option key={zaehler.id} value={zaehler.id}>
                      {zaehler.name}
                    </option>
                  ))}
                </Select>
              </SelectShell>
            )}
          </Field>
          <Field label="Ablesedatum" required>
            {({ id }) => (
              <TextInput id={id} name="datum" type="date" defaultValue={today} required />
            )}
          </Field>
          <Field label="Zählerstand" required>
            {({ id }) => (
              <NumberInput id={id} name="wert" placeholder="0" min={0} step="any" required />
            )}
          </Field>
          <Field label="Kosten (optional)">
            {({ id }) => (
              <NumberInput id={id} name="kosten" placeholder="0.00" min={0} step="0.01" />
            )}
          </Field>
          <UiCheckbox
            name="zaehlerGetauscht"
            label="Zähler wurde bei dieser Ablesung getauscht"
          />
          <Field label="Startwert neuer Zähler (bei Tausch)">
            {({ id }) => (
              <NumberInput id={id} name="startwertNeu" placeholder="0" min={0} step="any" />
            )}
          </Field>
          <Field label="Notiz (optional)">
            {({ id }) => (
              <TextInput
                id={id}
                name="notiz"
                placeholder="z. B. Ablesung durch Hausverwaltung"
              />
            )}
          </Field>

          {state.error && (
            <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
              {state.error}
            </Alert>
          )}
          {state.success && (
            <Alert tone="ok" icon={<IconCheck size={16} />}>
              Zählerstand wurde erfasst.
            </Alert>
          )}

          <Button type="submit" variant="primary" full disabled={pending}>
            {pending ? "Wird gespeichert…" : "Zählerstand speichern"}
          </Button>
        </form>
      )}
    </Panel>
  );
}
