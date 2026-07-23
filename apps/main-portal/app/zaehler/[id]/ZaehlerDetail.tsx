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
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconArrowLeft, IconBulb, IconCheck } from "@tabler/icons-react";
import {
  ENERGY_CATEGORIES,
  ENERGY_CATEGORY_LABELS,
  calculateConsumption,
  computeConsumptionStats,
} from "@zaehlwerk/database/shared";
import type { getZaehlerById, listLocations } from "../../lib/zaehler-actions";
import { updateZaehlerAction } from "../../lib/zaehler-actions";
import { initialActionState } from "../../lib/action-state";
import { getSmartHomeTips } from "./smart-home-tips";
import classes from "./ZaehlerDetail.module.css";

type ZaehlerWithHistory = NonNullable<Awaited<ReturnType<typeof getZaehlerById>>>;
type LocationList = Awaited<ReturnType<typeof listLocations>>;

const dateFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const perDayFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export function ZaehlerDetail({
  zaehler,
  locations,
}: {
  zaehler: ZaehlerWithHistory;
  locations: LocationList;
}) {
  const ascendingReadings = [...zaehler.ablesungen].reverse();
  const intervals = calculateConsumption(ascendingReadings);
  const stats = computeConsumptionStats(intervals);
  // toReadingId -> Intervall, das an dieser Ablesung endet. Der Verbrauch kann
  // `null` sein (unplausibel) — das rendert die Tabelle bewusst als solches.
  const intervalByReadingId = new Map(intervals.map((interval) => [interval.toReadingId, interval]));
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
            <Group justify="space-between" align="flex-start" mb="sm">
              <Title order={4}>Verlauf</Title>
              {intervals.length > 0 && (
                <Group gap="lg" align="flex-start">
                  <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                      Verbrauch gesamt
                    </Text>
                    <Text fw={600}>
                      {numberFormatter.format(stats.total)} {zaehler.einheit}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                      Ø pro Tag
                    </Text>
                    <Text fw={600}>
                      {stats.avgPerDay !== null
                        ? `${perDayFormatter.format(stats.avgPerDay)} ${zaehler.einheit}`
                        : "–"}
                    </Text>
                  </div>
                </Group>
              )}
            </Group>

            {stats.hasImplausibleIntervals && (
              <Alert color="orange" icon={<IconAlertCircle size={16} />} variant="light" mb="sm">
                Mindestens ein Intervall ist unplausibel (negativer Verbrauch) und fließt nicht in
                die Summe ein. Bitte betroffene Ablesungen prüfen.
              </Alert>
            )}

            {zaehler.ablesungen.length === 0 ? (
              <Text size="sm" c="dimmed">
                Noch keine Ablesungen erfasst.
              </Text>
            ) : (
              <Table verticalSpacing="xs" fz="sm">
                <TableThead>
                  <TableTr>
                    <TableTh>Datum</TableTh>
                    <TableTh>Zählerstand</TableTh>
                    <TableTh>Verbrauch</TableTh>
                    <TableTh>Kosten</TableTh>
                    <TableTh>Quelle</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {zaehler.ablesungen.map((ablesung) => {
                    const interval = intervalByReadingId.get(ablesung.id);
                    return (
                      <TableTr key={ablesung.id}>
                        <TableTd>{dateFormatter.format(ablesung.datum)}</TableTd>
                        <TableTd>
                          {numberFormatter.format(ablesung.wert)} {zaehler.einheit}
                          {ablesung.zaehlerGetauscht && (
                            <Badge ml="xs" size="xs" variant="light" color="orange">
                              Zähler getauscht
                            </Badge>
                          )}
                        </TableTd>
                        <TableTd>
                          {!interval ? (
                            "–"
                          ) : interval.amount === null ? (
                            <Text component="span" size="sm" c="orange">
                              unplausibel
                            </Text>
                          ) : (
                            `${numberFormatter.format(interval.amount)} ${zaehler.einheit}`
                          )}
                        </TableTd>
                        <TableTd>
                          {ablesung.kosten != null ? `${numberFormatter.format(ablesung.kosten)} €` : "–"}
                        </TableTd>
                        <TableTd>
                          <Badge size="xs" variant="outline" color="slate">
                            {ablesung.quelle}
                          </Badge>
                        </TableTd>
                      </TableTr>
                    );
                  })}
                </TableTbody>
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
  const [state, formAction, pending] = useActionState(updateZaehlerAction, initialActionState);
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
