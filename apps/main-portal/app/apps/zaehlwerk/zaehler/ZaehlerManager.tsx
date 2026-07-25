"use client";

import type { CSSProperties } from "react";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Grid,
  GridCol,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
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
    <Stack gap="md">
      <div>
        <Title order={2}>Zähler</Title>
        <Text c="dimmed" size="sm">
          Zähler anlegen, Zählerstände erfassen und Verbrauch je Zähler einsehen.
        </Text>
      </div>

      <SegmentedControl
        hiddenFrom="sm"
        fullWidth
        value={pane}
        onChange={(value) => setPane(value as Pane)}
        aria-label="Bereich wählen"
        data={[
          { value: "zaehler", label: `Zähler (${zaehlerList.length})` },
          { value: "anlegen", label: "Erfassen" },
          { value: "import", label: "Import" },
        ]}
      />

      <Grid gutter="md">
        <GridCol
          span={{ base: 12, lg: 7 }}
          className={classes.pane}
          data-active={pane === "zaehler" ? "true" : "false"}
        >
          <Stack gap="xs">
            {zaehlerList.length === 0 && (
              <Card p="md">
                <Text c="dimmed" size="sm">
                  Noch keine Zähler angelegt. Lege über „Erfassen“ den ersten Zähler an.
                </Text>
              </Card>
            )}
            {zaehlerList.map((zaehler) => {
              const intervals = calculateConsumption(zaehler.ablesungen);
              const total = sumConsumption(intervals);
              const lastReading = zaehler.ablesungen.at(-1);

              return (
                <Card
                  key={zaehler.id}
                  component={Link}
                  href={`/apps/zaehlwerk/zaehler/${zaehler.id}`}
                  p="md"
                  className={classes.zaehlerCard}
                  // The meter's own colour becomes the card's left spine, so a
                  // list of eight meters is scannable by edge alone.
                  style={{ "--meter-color": zaehler.farbe } as CSSProperties}
                >
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <div className={classes.meterName}>
                      <Text fw={600} truncate>
                        {zaehler.name}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {zaehler.location?.name ?? "Kein Standort"}
                      </Text>
                    </div>
                    <Badge variant="outline" color="slate" size="sm">
                      {ENERGY_CATEGORY_LABELS[zaehler.kategorie]}
                    </Badge>
                  </Group>

                  <Divider my="xs" />

                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <div>
                      <Text className={classes.microLabel}>Letzter Stand</Text>
                      <Text fw={600} size="sm">
                        {lastReading
                          ? `${formatNumber(lastReading.wert)} ${zaehler.einheit}`
                          : "keine Ablesung"}
                      </Text>
                      {lastReading && (
                        <Text size="xs" c="dimmed">
                          {formatDate(lastReading.datum)}
                        </Text>
                      )}
                    </div>
                    <div className={classes.alignEnd}>
                      <Text className={classes.microLabel}>Verbrauch gesamt</Text>
                      <Text fw={600} size="sm">
                        {formatNumber(total)} {zaehler.einheit}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {zaehler.ablesungen.length} Ablesungen
                      </Text>
                    </div>
                  </Group>
                </Card>
              );
            })}
          </Stack>
        </GridCol>

        <GridCol
          span={{ base: 12, lg: 5 }}
          className={classes.pane}
          data-active={pane !== "zaehler" ? "true" : "false"}
        >
          <Stack gap="md">
            <div
              className={classes.pane}
              data-active={pane === "anlegen" ? "true" : "false"}
            >
              <Stack gap="md">
                <CreateZaehlerForm locations={locations} />
                <CreateAblesungForm zaehlerList={zaehlerList} />
              </Stack>
            </div>
            <div className={classes.pane} data-active={pane === "import" ? "true" : "false"}>
              <MeterImportCard locations={locations} />
            </div>
          </Stack>
        </GridCol>
      </Grid>
    </Stack>
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
    <Card p="md">
      <Group gap="xs" mb="sm">
        <IconGauge size={18} stroke={1.6} />
        <Title order={4}>Neuen Zähler anlegen</Title>
      </Group>

      <form action={formAction} ref={formRef}>
        <Stack gap="sm">
          <TextInput name="name" label="Name" placeholder="z. B. Strom Hauptzähler" required />
          <Select
            name="kategorie"
            label="Kategorie / Energieträger"
            placeholder="Kategorie wählen"
            required
            data={ENERGY_CATEGORIES.map((category) => ({
              value: category,
              label: ENERGY_CATEGORY_LABELS[category],
            }))}
          />
          <TextInput
            name="einheit"
            label="Einheit"
            placeholder="z. B. kWh, m³"
            description="Übliche Einheiten: kWh (Strom), m³ (Gas/Wasser)"
            required
          />
          {locations.length > 0 && (
            <Select
              name="locationId"
              label="Standort"
              placeholder="Kein Standort"
              clearable
              data={locations.map((location) => ({ value: location.id, label: location.name }))}
            />
          )}

          {state.error && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
              {state.error}
            </Alert>
          )}
          {state.success && (
            <Alert color="green" icon={<IconCheck size={16} />} variant="light">
              Zähler wurde angelegt.
            </Alert>
          )}

          <Button type="submit" color="slate" loading={pending} fullWidth>
            Zähler anlegen
          </Button>
        </Stack>
      </form>
    </Card>
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
    <Card p="md">
      <Group gap="xs" mb="sm">
        <IconGauge size={18} stroke={1.6} />
        <Title order={4}>Zählerstand erfassen</Title>
      </Group>

      {zaehlerList.length === 0 ? (
        <Text size="sm" c="dimmed">
          Lege zuerst einen Zähler an.
        </Text>
      ) : (
        <form action={formAction} ref={formRef}>
          <Stack gap="sm">
            <Select
              name="zaehlerId"
              label="Zähler"
              placeholder="Zähler wählen"
              required
              data={zaehlerList.map((zaehler) => ({ value: zaehler.id, label: zaehler.name }))}
            />
            <TextInput name="datum" label="Ablesedatum" type="date" defaultValue={today} required />
            <NumberInput name="wert" label="Zählerstand" placeholder="0" min={0} inputMode="decimal" required />
            <NumberInput
              name="kosten"
              label="Kosten (optional)"
              placeholder="0.00"
              min={0}
              decimalScale={2}
              inputMode="decimal"
            />
            <Checkbox name="zaehlerGetauscht" label="Zähler wurde bei dieser Ablesung getauscht" />
            <NumberInput
              name="startwertNeu"
              label="Startwert neuer Zähler (bei Tausch)"
              placeholder="0"
              min={0}
              inputMode="decimal"
            />
            <TextInput name="notiz" label="Notiz (optional)" placeholder="z. B. Ablesung durch Hausverwaltung" />

            {state.error && (
              <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
                {state.error}
              </Alert>
            )}
            {state.success && (
              <Alert color="green" icon={<IconCheck size={16} />} variant="light">
                Zählerstand wurde erfasst.
              </Alert>
            )}

            <Button type="submit" color="slate" loading={pending} fullWidth>
              Zählerstand speichern
            </Button>
          </Stack>
        </form>
      )}
    </Card>
  );
}
