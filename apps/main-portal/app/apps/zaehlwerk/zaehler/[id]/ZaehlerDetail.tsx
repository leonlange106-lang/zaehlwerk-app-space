"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
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
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconChartLine,
  IconCheck,
  IconGaugeFilled,
  IconReceipt2,
  IconSum,
  IconTrash,
  IconTrendingUp,
} from "@tabler/icons-react";
import {
  ENERGY_CATEGORIES,
  ENERGY_CATEGORY_LABELS,
  calculateConsumption,
  calculateTariffCost,
  computeConsumptionStats,
  gasM3ToKwh,
  pickTariffForDate,
  type ConsumptionProjection,
} from "@zaehlwerk/database/client";
import type { getZaehlerById, listLocations } from "@/app/lib/zaehler-actions";
import {
  createAblesungAction,
  createTarifAction,
  deleteTarifAction,
  deleteZaehlerAction,
  updateZaehlerAction,
} from "@/app/lib/zaehler-actions";
import { initialActionState } from "@/app/lib/action-state";
import { getSmartHomeTips } from "./smart-home-tips";
import { SmartHomeCard, type SmartHomeTokenOption } from "./SmartHomeCard";
import { MeterDataCard } from "./MeterDataCard";
import { ReadingHistoryTable, type ReadingRow } from "./ReadingHistoryTable";
import { ProjectionStats } from "@/app/apps/zaehlwerk/berichte/projection-ui";
import { MetricTile } from "@/app/components/ui/MetricTile";
import classes from "./ZaehlerDetail.module.css";

type ZaehlerWithHistory = NonNullable<Awaited<ReturnType<typeof getZaehlerById>>>;
type LocationList = Awaited<ReturnType<typeof listLocations>>;

const dateFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const perDayFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Mobile sections of the meter detail page. */
type DetailPane = "verlauf" | "erfassen" | "verwalten";

export function ZaehlerDetail({
  zaehler,
  locations,
  apiTokens,
  origin,
  projection,
}: {
  zaehler: ZaehlerWithHistory;
  locations: LocationList;
  apiTokens: SmartHomeTokenOption[];
  origin: string;
  projection: ConsumptionProjection;
}) {
  const ascendingReadings = [...zaehler.ablesungen].reverse();
  const intervals = calculateConsumption(ascendingReadings);
  const stats = computeConsumptionStats(intervals);
  // toReadingId -> Intervall, das an dieser Ablesung endet. Der Verbrauch kann
  // `null` sein (unplausibel) — das rendert die Tabelle bewusst als solches.
  const intervalByReadingId = new Map(intervals.map((interval) => [interval.toReadingId, interval]));
  const tips = getSmartHomeTips(zaehler.kategorie);

  const isGas = zaehler.kategorie === "GAS";
  // Tarifbasierte Kosten je Intervall: Gas wird für die Abrechnung in kWh
  // umgerechnet, Strom/Wasser bleiben in ihrer Einheit.
  function tariffCostFor(interval: (typeof intervals)[number]): number | null {
    if (interval.amount === null) return null;
    const tarif = pickTariffForDate(zaehler.tarife, interval.to);
    if (!tarif) return null;
    const verbrauch = isGas ? gasM3ToKwh(interval.amount) : interval.amount;
    return calculateTariffCost(tarif, verbrauch, interval.days);
  }
  const hasTarife = zaehler.tarife.length > 0;
  // Phone-only section switch — same contract as the meter list. Everything is
  // rendered from the first paint; below `sm` the CSS simply gives one pane a
  // box at a time, so switching never re-flows the page.
  const [pane, setPane] = useState<DetailPane>("verlauf");

  // Render-ready rows: do the per-row formatting/consumption/tariff math once
  // here so the (potentially virtualized) history table stays a pure view.
  const readingRows: ReadingRow[] = zaehler.ablesungen.map((ablesung) => {
    const interval = intervalByReadingId.get(ablesung.id);
    const tariffCost = interval ? tariffCostFor(interval) : null;
    const consumption: ReadingRow["consumption"] = !interval
      ? { kind: "none" }
      : interval.amount === null
        ? { kind: "implausible" }
        : { kind: "value", text: `${numberFormatter.format(interval.amount)} ${zaehler.einheit}` };
    return {
      id: ablesung.id,
      datum: dateFormatter.format(ablesung.datum),
      wert: `${numberFormatter.format(ablesung.wert)} ${zaehler.einheit}`,
      getauscht: ablesung.zaehlerGetauscht,
      consumption,
      kosten: ablesung.kosten != null ? `${numberFormatter.format(ablesung.kosten)} €` : "–",
      tariffCost: hasTarife ? (tariffCost !== null ? eur.format(tariffCost) : null) : null,
      quelle: ablesung.quelle,
      raw: {
        datum: new Date(ablesung.datum).toISOString().slice(0, 10),
        wert: ablesung.wert,
        kosten: ablesung.kosten ?? null,
        notiz: ablesung.notiz ?? "",
        getauscht: ablesung.zaehlerGetauscht,
        startwertNeu: ablesung.startwertNeu ?? null,
      },
    };
  });

  return (
    <Stack gap="md">
      <div>
        <Button
          component={Link}
          href="/apps/zaehlwerk/zaehler"
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

      <SegmentedControl
        hiddenFrom="sm"
        fullWidth
        value={pane}
        onChange={(value) => setPane(value as DetailPane)}
        aria-label="Bereich wählen"
        data={[
          { value: "verlauf", label: "Verlauf" },
          { value: "erfassen", label: "Erfassen" },
          { value: "verwalten", label: "Verwalten" },
        ]}
      />

      <Grid gutter="md">
        <GridCol
          span={{ base: 12, lg: 8 }}
          className={classes.pane}
          data-active={pane === "verlauf" ? "true" : "false"}
        >
          <Card p="md">
            <Title order={4} mb="sm">
              Verlauf
            </Title>

            {intervals.length > 0 && (
              <div className={classes.detailStats}>
                <MetricTile
                  label="Verbrauch gesamt"
                  value={`${numberFormatter.format(stats.total)} ${zaehler.einheit}`}
                  hint={`${intervals.length} Intervalle`}
                  icon={<IconSum size={15} stroke={1.6} />}
                />
                <MetricTile
                  label="Ø pro Tag"
                  value={
                    stats.avgPerDay !== null
                      ? `${perDayFormatter.format(stats.avgPerDay)} ${zaehler.einheit}`
                      : "–"
                  }
                  hint="über den gesamten Zeitraum"
                  icon={<IconTrendingUp size={15} stroke={1.6} />}
                />
              </div>
            )}

            {stats.hasImplausibleIntervals && (
              <Alert color="amber" icon={<IconAlertCircle size={16} />} variant="light" mb="sm">
                Mindestens ein Intervall ist unplausibel (negativer Verbrauch) und fließt nicht in
                die Summe ein. Bitte betroffene Ablesungen prüfen.
              </Alert>
            )}

            {zaehler.ablesungen.length === 0 ? (
              <Text size="sm" c="dimmed">
                Noch keine Ablesungen erfasst.
              </Text>
            ) : (
              <ReadingHistoryTable
                rows={readingRows}
                hasTarife={hasTarife}
                zaehlerId={zaehler.id}
                einheit={zaehler.einheit}
              />
            )}
          </Card>
        </GridCol>

        <GridCol
          span={{ base: 12, lg: 4 }}
          className={classes.pane}
          data-active={pane !== "verlauf" ? "true" : "false"}
        >
          <Stack gap="md">
            <div className={classes.pane} data-active={pane === "erfassen" ? "true" : "false"}>
              <CreateReadingCard zaehler={zaehler} />
            </div>

            <div className={classes.pane} data-active={pane === "verwalten" ? "true" : "false"}>
              <Stack gap="md">
                <EditZaehlerForm zaehler={zaehler} locations={locations} />
                <MeterDataCard zaehlerId={zaehler.id} />

                <Card p="md">
                  <Group gap="xs" mb="sm">
                    <IconChartLine size={18} stroke={1.6} />
                    <Title order={4}>Jahres-Hochrechnung</Title>
                  </Group>
                  <ProjectionStats projection={projection} />
                </Card>

                <TarifeCard zaehler={zaehler} />
              </Stack>
            </div>
          </Stack>
        </GridCol>
      </Grid>

      <div className={classes.pane} data-active={pane === "verwalten" ? "true" : "false"}>
        <SmartHomeCard
          meterId={zaehler.id}
          meterName={zaehler.name}
          tips={tips}
          tokens={apiTokens}
          origin={origin}
        />
      </div>
    </Stack>
  );
}

function CreateReadingCard({ zaehler }: { zaehler: ZaehlerWithHistory }) {
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
        <IconGaugeFilled size={18} stroke={1.6} />
        <Title order={4}>Neue Ablesung erfassen</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Zählerstand direkt für <b>{zaehler.name}</b> eintragen.
      </Text>
      <form action={formAction} ref={formRef}>
        <input type="hidden" name="zaehlerId" value={zaehler.id} />
        <Stack gap="sm">
          <TextInput name="datum" label="Ablesedatum" type="date" defaultValue={today} required />
          <NumberInput
            name="wert"
            label={`Zählerstand (${zaehler.einheit})`}
            placeholder="0"
            min={0}
            inputMode="decimal"
            required
          />
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
              Ablesung wurde erfasst.
            </Alert>
          )}

          <Button type="submit" color="slate" loading={pending} fullWidth>
            Ablesung speichern
          </Button>
        </Stack>
      </form>
    </Card>
  );
}

function EditZaehlerForm({
  zaehler,
  locations,
}: {
  zaehler: ZaehlerWithHistory;
  locations: LocationList;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateZaehlerAction, initialActionState);
  const [deleting, startDelete] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  function deleteMeter() {
    if (
      !window.confirm(
        `Zähler „${zaehler.name}" endgültig löschen? Alle ${zaehler.ablesungen.length} Ablesungen und ${zaehler.tarife.length} Tarife werden mitgelöscht.`,
      )
    ) {
      return;
    }
    startDelete(async () => {
      const fd = new FormData();
      fd.set("id", zaehler.id);
      const result = await deleteZaehlerAction(initialActionState, fd);
      if (result.success) {
        notifications.show({ color: "green", icon: <IconCheck size={16} />, message: "Zähler gelöscht." });
        router.push("/apps/zaehlwerk/zaehler");
      } else {
        notifications.show({
          color: "red",
          icon: <IconAlertCircle size={16} />,
          message: result.error ?? "Fehler.",
        });
      }
    });
  }

  return (
    <Card p="md">
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

      <Divider my="md" />
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text size="xs" c="dimmed">
          Zähler unwiderruflich mit allen Ablesungen und Tarifen entfernen.
        </Text>
        <Button
          variant="light"
          color="red"
          leftSection={<IconTrash size={16} />}
          loading={deleting}
          onClick={deleteMeter}
        >
          Löschen
        </Button>
      </Group>
    </Card>
  );
}

function TarifeCard({ zaehler }: { zaehler: ZaehlerWithHistory }) {
  const [createState, createAction, creating] = useActionState(createTarifAction, initialActionState);
  const [deleteState, deleteAction] = useActionState(deleteTarifAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  const einheit = zaehler.kategorie === "GAS" ? "kWh" : zaehler.einheit;

  useEffect(() => {
    if (createState.success) {
      formRef.current?.reset();
    }
  }, [createState.success]);

  return (
    <Card p="md">
      <Group gap="xs" mb="sm">
        <IconReceipt2 size={18} stroke={1.6} />
        <Title order={4}>Tarife</Title>
      </Group>

      {zaehler.tarife.length === 0 ? (
        <Text size="sm" c="dimmed" mb="sm">
          Noch kein Tarif hinterlegt. Ohne Tarif werden Kosten nur aus erfassten Beträgen angezeigt.
        </Text>
      ) : (
        <Stack gap="xs" mb="md">
          {zaehler.tarife.map((tarif) => (
            <Group key={tarif.id} justify="space-between" wrap="nowrap" align="flex-start">
              <div>
                <Text size="sm" fw={600}>
                  {tarif.produkt ?? tarif.anbieter ?? "Tarif"}
                </Text>
                <Text size="xs" c="dimmed">
                  ab {dateFormatter.format(tarif.gueltigAb)}
                  {tarif.gueltigBis ? ` bis ${dateFormatter.format(tarif.gueltigBis)}` : ""} ·{" "}
                  {perDayFormatter.format(tarif.arbeitspreisCtNetto)} ct/{einheit} netto
                  {tarif.grundpreisJahrNetto > 0
                    ? ` · ${perDayFormatter.format(tarif.grundpreisJahrNetto)} €/Jahr GP`
                    : ""}{" "}
                  · {perDayFormatter.format(tarif.mwstProzent)} % MwSt
                </Text>
              </div>
              <form action={deleteAction}>
                <input type="hidden" name="id" value={tarif.id} />
                <input type="hidden" name="zaehlerId" value={zaehler.id} />
                <ActionIcon type="submit" variant="subtle" color="red" aria-label="Tarif löschen">
                  <IconTrash size={16} />
                </ActionIcon>
              </form>
            </Group>
          ))}
        </Stack>
      )}

      {deleteState.error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light" mb="sm">
          {deleteState.error}
        </Alert>
      )}

      <form action={createAction} ref={formRef}>
        <input type="hidden" name="zaehlerId" value={zaehler.id} />
        <Stack gap="xs">
          <TextInput name="produkt" label="Produkt / Tarifname" placeholder="z. B. Grundversorgung 2024" />
          <Group grow>
            <TextInput name="gueltigAb" label="Gültig ab" type="date" defaultValue={today} required />
            <TextInput name="gueltigBis" label="Gültig bis (optional)" type="date" />
          </Group>
          <NumberInput
            name="arbeitspreisCtNetto"
            label={`Arbeitspreis (ct/${einheit}, netto)`}
            placeholder="z. B. 34"
            min={0}
            decimalScale={4}
            inputMode="decimal"
            required
          />
          <Group grow>
            <NumberInput
              name="grundpreisJahrNetto"
              label="Grundpreis (€/Jahr, netto)"
              placeholder="0"
              min={0}
              decimalScale={2}
              inputMode="decimal"
            />
            <NumberInput
              name="mwstProzent"
              label="MwSt %"
              defaultValue={19}
              min={0}
              max={100}
              decimalScale={1}
              inputMode="decimal"
            />
          </Group>

          {createState.error && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
              {createState.error}
            </Alert>
          )}
          {createState.success && (
            <Alert color="green" icon={<IconCheck size={16} />} variant="light">
              Tarif gespeichert.
            </Alert>
          )}

          <Button type="submit" color="slate" loading={creating} fullWidth>
            Tarif hinzufügen
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
