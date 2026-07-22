"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  GridCol,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconArrowLeft, IconBulb, IconCheck } from "@tabler/icons-react";
import {
  ENERGY_CATEGORIES,
  ENERGY_CATEGORY_LABELS,
  calculateConsumption,
} from "@zaehlwerk/database/shared";
import type { getZaehlerById, listLocations } from "../../lib/zaehler-actions";
import { updateZaehlerAction } from "../../lib/zaehler-actions";
import { getSmartHomeTips } from "./smart-home-tips";
import classes from "./ZaehlerDetail.module.css";

type ZaehlerWithHistory = NonNullable<Awaited<ReturnType<typeof getZaehlerById>>>;
type LocationList = Awaited<ReturnType<typeof listLocations>>;

const initialState = { success: false, error: undefined };

const dateFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

export function ZaehlerDetail({
  zaehler,
  locations,
}: {
  zaehler: ZaehlerWithHistory;
  locations: LocationList;
}) {
  const ascendingReadings = [...zaehler.ablesungen].reverse();
  const intervals = calculateConsumption(ascendingReadings);
  const consumptionByReadingId = new Map(intervals.map((interval) => [interval.toReadingId, interval.amount]));
  const tips = getSmartHomeTips(zaehler.kategorie);

  return (
    <Stack gap="lg">
      <div>
        <Button
          component={Link}
          href="/zaehler"
          variant="subtle"
          color="slate"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
          px={0}
        >
          Zurück zu Zähler
        </Button>
        <Group justify="space-between" align="flex-start" mt="xs">
          <div>
            <Group gap="sm">
              <span className={classes.colorDot} style={{ background: zaehler.farbe }} />
              <Title order={2}>{zaehler.name}</Title>
            </Group>
            <Text c="dimmed" size="sm">
              {zaehler.location?.name ?? "Kein Standort"}
            </Text>
          </div>
          <Badge variant="light" color="slate" size="lg">
            {ENERGY_CATEGORY_LABELS[zaehler.kategorie]}
          </Badge>
        </Group>
      </div>

      <Grid gutter="md">
        <GridCol span={{ base: 12, lg: 8 }}>
          <Card withBorder radius="md" p="lg">
            <Title order={4} mb="sm">
              Verlauf
            </Title>
            {zaehler.ablesungen.length === 0 ? (
              <Text size="sm" c="dimmed">
                Noch keine Ablesungen erfasst.
              </Text>
            ) : (
              <Table verticalSpacing="xs" fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Datum</Table.Th>
                    <Table.Th>Zählerstand</Table.Th>
                    <Table.Th>Verbrauch</Table.Th>
                    <Table.Th>Kosten</Table.Th>
                    <Table.Th>Quelle</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {zaehler.ablesungen.map((ablesung) => (
                    <Table.Tr key={ablesung.id}>
                      <Table.Td>{dateFormatter.format(ablesung.datum)}</Table.Td>
                      <Table.Td>
                        {numberFormatter.format(ablesung.wert)} {zaehler.einheit}
                        {ablesung.zaehlerGetauscht && (
                          <Badge ml="xs" size="xs" variant="light" color="orange">
                            Zähler getauscht
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {consumptionByReadingId.has(ablesung.id)
                          ? `${numberFormatter.format(consumptionByReadingId.get(ablesung.id) ?? 0)} ${zaehler.einheit}`
                          : "–"}
                      </Table.Td>
                      <Table.Td>{ablesung.kosten != null ? `${numberFormatter.format(ablesung.kosten)} €` : "–"}</Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="outline" color="slate">
                          {ablesung.quelle}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        </GridCol>

        <GridCol span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            <EditZaehlerForm zaehler={zaehler} locations={locations} />

            <Card withBorder radius="md" p="lg">
              <Group gap="xs" mb="sm">
                <IconBulb size={18} stroke={1.6} />
                <Title order={4}>Smart-Home-Integration</Title>
              </Group>
              <Stack gap="sm">
                {tips.map((tip) => (
                  <div key={tip.title}>
                    <Text size="sm" fw={600}>
                      {tip.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {tip.description}
                    </Text>
                  </div>
                ))}
              </Stack>
            </Card>
          </Stack>
        </GridCol>
      </Grid>
    </Stack>
  );
}

function EditZaehlerForm({
  zaehler,
  locations,
}: {
  zaehler: ZaehlerWithHistory;
  locations: LocationList;
}) {
  const [state, formAction, pending] = useActionState(updateZaehlerAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <Card withBorder radius="md" p="lg">
      <Title order={4} mb="sm">
        Zähler bearbeiten
      </Title>
      <form action={formAction} ref={formRef}>
        <input type="hidden" name="id" value={zaehler.id} />
        <Stack gap="sm">
          <TextInput name="name" label="Name" defaultValue={zaehler.name} required />
          <Select
            name="kategorie"
            label="Kategorie / Energieträger"
            required
            defaultValue={zaehler.kategorie}
            data={ENERGY_CATEGORIES.map((category) => ({
              value: category,
              label: ENERGY_CATEGORY_LABELS[category],
            }))}
          />
          <TextInput name="einheit" label="Einheit" defaultValue={zaehler.einheit} required />
          {locations.length > 0 && (
            <Select
              name="locationId"
              label="Standort"
              placeholder="Kein Standort"
              clearable
              defaultValue={zaehler.locationId ?? undefined}
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
              Änderungen gespeichert.
            </Alert>
          )}

          <Button type="submit" color="slate" loading={pending} fullWidth>
            Speichern
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
