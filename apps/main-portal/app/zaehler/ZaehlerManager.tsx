"use client";

import { useActionState, useEffect, useRef } from "react";
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
} from "@zaehlwerk/database/shared";
import type { listLocations, listZaehler } from "../lib/zaehler-actions";
import { createAblesungAction, createZaehlerAction } from "../lib/zaehler-actions";
import { initialActionState } from "../lib/action-state";
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

export function ZaehlerManager({
  zaehlerList,
  locations,
}: {
  zaehlerList: ZaehlerList;
  locations: LocationList;
}) {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Zähler</Title>
        <Text c="dimmed" size="sm">
          Zähler anlegen, Zählerstände erfassen und Verbrauch je Zähler einsehen.
        </Text>
      </div>

      <Grid gutter="md">
        <GridCol span={{ base: 12, lg: 7 }}>
          <Stack gap="md">
            {zaehlerList.length === 0 && (
              <Card withBorder radius="md" p="lg">
                <Text c="dimmed" size="sm">
                  Noch keine Zähler angelegt. Lege rechts den ersten Zähler an.
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
                  href={`/zaehler/${zaehler.id}`}
                  withBorder
                  radius="md"
                  p="lg"
                  className={classes.zaehlerCard}
                >
                  <Group justify="space-between" align="flex-start">
                    <Group gap="sm">
                      <span className={classes.colorDot} style={{ background: zaehler.farbe }} />
                      <div>
                        <Text fw={600}>{zaehler.name}</Text>
                        <Text size="xs" c="dimmed">
                          {zaehler.location?.name ?? "Kein Standort"}
                        </Text>
                      </div>
                    </Group>
                    <Badge variant="light" color="slate">
                      {ENERGY_CATEGORY_LABELS[zaehler.kategorie]}
                    </Badge>
                  </Group>

                  <Divider my="sm" />

                  <Group justify="space-between">
                    <div>
                      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                        Letzter Stand
                      </Text>
                      <Text fw={600}>
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
                    <div>
                      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                        Verbrauch gesamt
                      </Text>
                      <Text fw={600}>
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

        <GridCol span={{ base: 12, lg: 5 }}>
          <Stack gap="md">
            <CreateZaehlerForm locations={locations} />
            <CreateAblesungForm zaehlerList={zaehlerList} />
            <MeterImportCard locations={locations} />
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
    <Card withBorder radius="md" p="lg">
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
    <Card withBorder radius="md" p="lg">
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
            <NumberInput name="wert" label="Zählerstand" placeholder="0" min={0} required />
            <NumberInput name="kosten" label="Kosten (optional)" placeholder="0.00" min={0} decimalScale={2} />
            <Checkbox name="zaehlerGetauscht" label="Zähler wurde bei dieser Ablesung getauscht" />
            <NumberInput
              name="startwertNeu"
              label="Startwert neuer Zähler (bei Tausch)"
              placeholder="0"
              min={0}
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
