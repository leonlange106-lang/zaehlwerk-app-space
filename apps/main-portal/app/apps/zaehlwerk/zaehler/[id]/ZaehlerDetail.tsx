"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/app/components/ui/Badge";
import { Button, ButtonLink } from "@/app/components/ui/Button";
import { Field, NumberInput, Select, SelectShell, TextInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { useToast } from "@/app/components/ui/Toast";
import {
  Alert,
  Checkbox as UiCheckbox,
  Divider,
  SegmentedControl,
} from "@/app/components/ui/primitives";
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowLeft,
  IconChartLine,
  IconFlame,
  IconCheck,
  IconGaugeFilled,
  IconPencil,
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
  combineRegisterStats,
  computeConsumptionStats,
  groupReadingsByRegister,
  hasMultipleRegisters,
  convertGasToKwh,
  pickTariffForDate,
  type ConsumptionProjection,
} from "@zaehlwerk/database/client";
import type {
  getZaehlerById,
  listDeletedAblesungen,
  listLocations,
} from "@/app/lib/zaehler-actions";
import {
  createAblesungAction,
  createTarifAction,
  purgeAblesungAction,
  restoreAblesungAction,
  createUmrechnungsfaktorAction,
  deleteUmrechnungsfaktorAction,
  updateUmrechnungsfaktorAction,
  deleteTarifAction,
  deleteZaehlerAction,
  updateTarifAction,
  updateZaehlerAction,
} from "@/app/lib/zaehler-actions";
import { initialActionState } from "@/app/lib/action-state";
import { getSmartHomeTips } from "./smart-home-tips";
import { SmartHomeCard, type SmartHomeTokenOption } from "./SmartHomeCard";
import { MeterDataCard } from "./MeterDataCard";
import { ReadingHistoryTable, type ReadingRow } from "./ReadingHistoryTable";
import { ProjectionStats } from "@/app/apps/zaehlwerk/berichte/projection-ui";
import { MetricTile } from "@/app/components/ui/MetricTile";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import classes from "./ZaehlerDetail.module.css";

type ZaehlerWithHistory = NonNullable<Awaited<ReturnType<typeof getZaehlerById>>>;
type DeletedReading = Awaited<ReturnType<typeof listDeletedAblesungen>>[number];
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
  geloeschte,
}: {
  zaehler: ZaehlerWithHistory;
  locations: LocationList;
  apiTokens: SmartHomeTokenOption[];
  origin: string;
  projection: ConsumptionProjection;
  geloeschte: DeletedReading[];
}) {
  const ascendingReadings = [...zaehler.ablesungen].reverse();

  // JE REGISTER rechnen, nicht über die ganze Liste.
  //
  // Ein Zweirichtungszähler führt zwei Zählwerke, die beide für sich hochzählen
  // und abwechselnd in dieselbe Tabelle melden. Über die gemischte Liste
  // gerechnet folgt auf einen Bezugsstand von 45 000 ein Einspeisestand von
  // 1 200 — negatives Delta —, und die nächste Zeile springt um 43 800 zurück.
  // Kein einziges Intervall wäre richtig.
  //
  // Ohne Register bleibt es bei der einen Reihe: der gewöhnliche Zähler und
  // jeder Bestand aus der Zeit vor den Registern.
  const groups =
    zaehler.register.length === 0
      ? [{ register: null, readings: ascendingReadings }]
      : groupReadingsByRegister(zaehler.register, ascendingReadings);
  const series = groups.map((group) => ({
    register: group.register,
    intervals: calculateConsumption(group.readings, { stellen: zaehler.stellen }),
  }));

  const isFeedIn = (register: { richtung: string } | null) =>
    register?.richtung === "EINSPEISUNG";

  // Verbrauch ist Bezug. Eingespeiste Kilowattstunden sind kein Verbrauch, und
  // sie mitzuzählen kehrte die Aussage der Kachel um.
  const consumptionSeries = series.filter((entry) => !isFeedIn(entry.register));
  const feedInSeries = series.filter((entry) => isFeedIn(entry.register));

  const intervals = consumptionSeries.flatMap((entry) => entry.intervals);
  const stats =
    combineRegisterStats(consumptionSeries.map((entry) => computeConsumptionStats(entry.intervals))) ??
    computeConsumptionStats([]);
  const feedInStats = combineRegisterStats(
    feedInSeries.map((entry) => computeConsumptionStats(entry.intervals)),
  );

  // toReadingId -> Intervall, das an dieser Ablesung endet. Der Verbrauch kann
  // `null` sein (unplausibel) — das rendert die Tabelle bewusst als solches.
  // Über ALLE Reihen, damit auch Einspeisezeilen ihre Zahl zeigen.
  const intervalByReadingId = new Map(
    series.flatMap((entry) => entry.intervals).map((interval) => [interval.toReadingId, interval]),
  );
  // Welche Ablesung gehört zu welchem Register — für die Spalte in der Tabelle
  // und dafür, dass ein Einspeisestand keine Bezugskosten angerechnet bekommt.
  // Direkt aus der Gruppierung, die diese Frage bereits beantwortet hat.
  const registerByReadingId = new Map(
    groups.flatMap((group) => group.readings.map((reading) => [reading.id, group.register] as const)),
  );
  const showRegisterColumn = hasMultipleRegisters(zaehler.register);
  const tips = getSmartHomeTips(zaehler.kategorie);

  const isGas = zaehler.kategorie === "GAS";

  // Tarifbasierte Kosten je Intervall. Gas wird für die Abrechnung in kWh
  // umgerechnet, Strom/Wasser bleiben in ihrer Einheit.
  //
  // Die Umrechnung läuft ÜBER DEN ZEITRAUM des Intervalls, nicht über einen
  // festen Faktor: Der Brennwert ändert sich monatlich, und ein Intervall über
  // einen Wechsel hinweg wird anteilig gerechnet. Fehlt für einen Teil des
  // Zeitraums ein Faktor, kommt `null` zurück — dann gibt es hier KEINE
  // Kostenzahl statt einer geratenen. Ein geschätzter Brennwert sähe aus wie
  // ein abgelesener.
  function tariffCostFor(interval: (typeof intervals)[number]): number | null {
    if (interval.amount === null) return null;
    const tarif = pickTariffForDate(zaehler.tarife, interval.to);
    if (!tarif) return null;
    if (!isGas) return calculateTariffCost(tarif, interval.amount, interval.days);

    const converted = convertGasToKwh(
      interval.amount,
      interval.from,
      interval.to,
      zaehler.umrechnungsfaktoren,
    );
    if (converted.kwh === null) return null;
    return calculateTariffCost(tarif, converted.kwh, interval.days);
  }

  // Deckt die gepflegten Faktoren alle Intervalle ab? Nur dann darf die Seite
  // Gaskosten ohne Vorbehalt zeigen.
  const gasCoverageGap =
    isGas &&
    intervals.some(
      (interval) =>
        interval.amount !== null &&
        !convertGasToKwh(interval.amount, interval.from, interval.to, zaehler.umrechnungsfaktoren)
          .complete,
    );
  const hasTarife = zaehler.tarife.length > 0;
  // Phone-only section switch — same contract as the meter list. Everything is
  // rendered from the first paint; below `sm` the CSS simply gives one pane a
  // box at a time, so switching never re-flows the page.
  const [pane, setPane] = useState<DetailPane>("verlauf");

  // Render-ready rows: do the per-row formatting/consumption/tariff math once
  // here so the (potentially virtualized) history table stays a pure view.
  const readingRows: ReadingRow[] = zaehler.ablesungen.map((ablesung) => {
    const interval = intervalByReadingId.get(ablesung.id);
    const register = registerByReadingId.get(ablesung.id) ?? null;
    // Ein Einspeisestand bekommt KEINE Bezugskosten angerechnet. Der Tarif in
    // `zaehler.tarife` ist der Arbeitspreis, den man fürs Beziehen zahlt;
    // eingespeiste Kilowattstunden bringen eine Vergütung ein, und die beiden
    // Beträge gegeneinander zu verrechnen wäre schlicht eine andere Rechnung.
    const tariffCost = interval && !isFeedIn(register) ? tariffCostFor(interval) : null;
    const consumption: ReadingRow["consumption"] = !interval
      ? { kind: "none" }
      : interval.amount === null
        ? { kind: "implausible" }
        : { kind: "value", text: `${numberFormatter.format(interval.amount)} ${zaehler.einheit}` };
    return {
      id: ablesung.id,
      datum: dateFormatter.format(ablesung.datum),
      wert: `${numberFormatter.format(ablesung.wert)} ${zaehler.einheit}`,
      // Nur bei mehr als einer Reihe. Ein gewöhnlicher Zähler soll keine Spalte
      // bekommen, die für ihn immer dasselbe Wort enthält.
      register: showRegisterColumn ? (register?.label ?? "Bezug") : null,
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
    <div className="flex flex-col gap-5">
      <div>
        <ButtonLink
          href="/apps/zaehlwerk/zaehler"
          variant="ghost"
          size="sm"
          className="px-0"
        >
          <IconArrowLeft size={14} />
          Zurück zu Zähler
        </ButtonLink>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className={classes.colorDot} style={{ background: zaehler.farbe }} />
              <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
                {zaehler.name}
              </h1>
            </div>
            <p className="mt-1 text-sm text-dim">{zaehler.location?.name ?? "Kein Standort"}</p>
          </div>
          <Badge tone="accent">{ENERGY_CATEGORY_LABELS[zaehler.kategorie]}</Badge>
        </div>
      </div>

      <SegmentedControl
        className="sm:hidden"
        label="Bereich wählen"
        value={pane}
        onChange={(value) => setPane(value as DetailPane)}
        options={[
          { value: "verlauf" as DetailPane, label: "Verlauf" },
          { value: "erfassen" as DetailPane, label: "Erfassen" },
          { value: "verwalten" as DetailPane, label: "Verwalten" },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-12">
        <div
          className={`${classes.pane} lg:col-span-8`}
          data-active={pane === "verlauf" ? "true" : "false"}
        >
          <Panel title="Verlauf">
            {(intervals.length > 0 || feedInStats) && (
              <div className={classes.detailStats}>
                {intervals.length > 0 && (
                  <>
                    <MetricTile
                      label="Verbrauch gesamt"
                      value={`${numberFormatter.format(stats.total)} ${zaehler.einheit}`}
                      hint={`${intervals.length} Intervalle`}
                      icon={<IconSum size={18} stroke={1.7} />}
                    />
                    <MetricTile
                      label="Ø pro Tag"
                      value={
                        stats.avgPerDay !== null
                          ? `${perDayFormatter.format(stats.avgPerDay)} ${zaehler.einheit}`
                          : "–"
                      }
                      hint="über den gesamten Zeitraum"
                      icon={<IconTrendingUp size={18} stroke={1.7} />}
                    />
                  </>
                )}
                {/* Eigene Kachel statt einer Zahl in „Verbrauch gesamt": Was
                    eingespeist wurde, ist kein Verbrauch. Beides in eine Summe
                    zu werfen hiesse, zwei verschiedene Dinge zu addieren. */}
                {feedInStats && (
                  <MetricTile
                    label="Einspeisung gesamt"
                    value={`${numberFormatter.format(feedInStats.total)} ${zaehler.einheit}`}
                    hint={`${feedInStats.intervalCount} Intervalle`}
                    icon={<IconArrowBackUp size={18} stroke={1.7} />}
                  />
                )}
              </div>
            )}

            {(stats.hasImplausibleIntervals || feedInStats?.hasImplausibleIntervals) && (
              <Alert tone="watch" icon={<IconAlertCircle size={16} />} className="mb-4">
                Mindestens ein Intervall ist unplausibel (negativer Verbrauch) und fließt nicht in
                die Summe ein. Bitte betroffene Ablesungen prüfen.
              </Alert>
            )}

            {zaehler.ablesungen.length === 0 ? (
              <p className="text-sm text-dim">Noch keine Ablesungen erfasst.</p>
            ) : (
              <ReadingHistoryTable
                rows={readingRows}
                hasTarife={hasTarife}
                zaehlerId={zaehler.id}
                einheit={zaehler.einheit}
              />
            )}
          </Panel>
        </div>

        <div
          className={`${classes.pane} lg:col-span-4`}
          data-active={pane !== "verlauf" ? "true" : "false"}
        >
          <div className="flex flex-col gap-5">
            <div className={classes.pane} data-active={pane === "erfassen" ? "true" : "false"}>
              <CreateReadingCard zaehler={zaehler} />
            </div>

            <div className={classes.pane} data-active={pane === "verwalten" ? "true" : "false"}>
              <div className="flex flex-col gap-5">
                <EditZaehlerForm zaehler={zaehler} locations={locations} />
                <MeterDataCard zaehlerId={zaehler.id} />

                <Panel title="Jahres-Hochrechnung" icon={<IconChartLine size={17} stroke={1.7} />}>
                  <ProjectionStats projection={projection} />
                </Panel>

                {/* Nur bei Gas: Strom und Wasser werden in ihrer eigenen
                    Einheit abgerechnet, da gibt es nichts umzurechnen. */}
                {isGas && <GasFaktorenCard zaehler={zaehler} coverageGap={gasCoverageGap} />}
                {/* Nur wenn etwas drin liegt. Ein leerer Papierkorb ist kein
                    Bereich, sondern eine Zeile, die jedes Mal Platz kostet. */}
                {geloeschte.length > 0 && <PapierkorbCard eintraege={geloeschte} />}
                <TarifeCard zaehler={zaehler} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={classes.pane} data-active={pane === "verwalten" ? "true" : "false"}>
        <SmartHomeCard
          meterId={zaehler.id}
          meterName={zaehler.name}
          tips={tips}
          tokens={apiTokens}
          origin={origin}
          registers={zaehler.register.map((reg) => ({
            obisCode: reg.obisCode,
            label: reg.label,
          }))}
        />
      </div>
    </div>
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
    <Panel
      title="Neue Ablesung erfassen"
      icon={<IconGaugeFilled size={17} stroke={1.7} />}
      description={<>Zählerstand direkt für <strong className="text-ink">{zaehler.name}</strong> eintragen.</>}
    >
      <form action={formAction} ref={formRef} className="flex flex-col gap-4">
        <input type="hidden" name="zaehlerId" value={zaehler.id} />
        <Field label="Ablesedatum" required>
          {({ id }) => (
            <TextInput id={id} name="datum" type="date" defaultValue={today} required />
          )}
        </Field>
        {/* Unit in the label: the mobile spec fills this by accessible name, and
            a bare "Zählerstand" would not say which unit the number is in. */}
        <Field label={`Zählerstand (${zaehler.einheit})`} required>
          {({ id }) => (
            <NumberInput id={id} name="wert" placeholder="0" min={0} step="any" required />
          )}
        </Field>
        <Field label="Kosten (optional)">
          {({ id }) => (
            <NumberInput id={id} name="kosten" placeholder="0.00" min={0} step="0.01" />
          )}
        </Field>
        <UiCheckbox name="zaehlerGetauscht" label="Zähler wurde bei dieser Ablesung getauscht" />
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
            Ablesung wurde erfasst.
          </Alert>
        )}

        <Button type="submit" variant="primary" full disabled={pending}>
          {pending ? "Wird gespeichert…" : "Ablesung speichern"}
        </Button>
      </form>
    </Panel>
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
  const toast = useToast();
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
        toast.show({ tone: "ok", title: "Zähler gelöscht" });
        router.push("/apps/zaehlwerk/zaehler");
      } else {
        toast.show({
          tone: "risk",
          title: "Löschen fehlgeschlagen",
          message: result.error ?? undefined,
        });
      }
    });
  }

  return (
    <Panel title="Zähler bearbeiten">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={zaehler.id} />
        <Field label="Name" required>
          {({ id }) => <TextInput id={id} name="name" defaultValue={zaehler.name} required />}
        </Field>
        <Field label="Kategorie / Energieträger" required>
          {({ id }) => (
            <SelectShell>
              <Select id={id} name="kategorie" defaultValue={zaehler.kategorie} required>
                {ENERGY_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {ENERGY_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
            </SelectShell>
          )}
        </Field>
        <Field label="Einheit" required>
          {({ id }) => (
            <TextInput id={id} name="einheit" defaultValue={zaehler.einheit} required />
          )}
        </Field>
        {/* Beim Anlegen konnte man das Intervall setzen, danach nie wieder
            aendern — auch nicht abschalten. Wer es einmal auf 30 Tage stellte,
            wurde die Erinnerung nur durch Loeschen des Zaehlers los. Die
            Update-Action nimmt das Feld laengst entgegen; es fehlte allein im
            Formular. */}
        <Field
          label="Ableseintervall (Tage)"
          description="0 = keine Erinnerung. Sonst meldet die Glocke, wenn eine Ablesung überfällig ist."
        >
          {({ id, describedBy }) => (
            <NumberInput
              id={id}
              aria-describedby={describedBy}
              name="ableseIntervallTage"
              data-testid="zaehler-interval-edit"
              min={0}
              max={1825}
              step={1}
              defaultValue={zaehler.ableseIntervallTage}
            />
          )}
        </Field>
        {locations.length > 0 && (
          <Field label="Standort">
            {({ id }) => (
              <SelectShell>
                <Select id={id} name="locationId" defaultValue={zaehler.locationId ?? ""}>
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
            Änderungen gespeichert.
          </Alert>
        )}

        <Button type="submit" variant="primary" full disabled={pending}>
          {pending ? "Wird gespeichert…" : "Speichern"}
        </Button>
      </form>

      <Divider className="my-5" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-dim">
          Zähler unwiderruflich mit allen Ablesungen und Tarifen entfernen.
        </p>
        <Button variant="danger" disabled={deleting} onClick={deleteMeter}>
          <IconTrash size={16} />
          {deleting ? "Wird gelöscht…" : "Löschen"}
        </Button>
      </div>
    </Panel>
  );
}

type TarifRow = ZaehlerWithHistory["tarife"][number];

function TarifeCard({ zaehler }: { zaehler: ZaehlerWithHistory }) {
  const router = useRouter();
  const [createState, createAction, creating] = useActionState(createTarifAction, initialActionState);
  const [deleteState, deleteAction] = useActionState(deleteTarifAction, initialActionState);
  const [editTarif, setEditTarif] = useState<TarifRow | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  const einheit = zaehler.kategorie === "GAS" ? "kWh" : zaehler.einheit;

  useEffect(() => {
    if (createState.success) {
      formRef.current?.reset();
    }
  }, [createState.success]);

  return (
    <Panel title="Tarife" icon={<IconReceipt2 size={17} stroke={1.7} />}>
      {/* Gaskosten entstehen aus einer UMRECHNUNG, nicht aus einer Messung: der
          Zähler misst m³, abgerechnet wird kWh. Brennwert und Zustandszahl
          stehen auf jeder Jahresrechnung und schwanken — der Brennwert sogar
          monatlich. Bis beide je Zähler und Zeitraum gepflegt werden, rechnet
          Zählwerk mit einem festen Faktor von 2021, und der darf nicht als
          Messwert durchgehen. Der PDF-Report weist ihn längst aus; die
          Oberfläche schwieg. Bewusst `text-dim` ohne Statusfarbe: eine Fußnote,
          keine Warnung. */}

      {zaehler.tarife.length === 0 ? (
        <p className="mb-4 text-sm text-dim">
          Noch kein Tarif hinterlegt. Ohne Tarif werden Kosten nur aus erfassten Beträgen angezeigt.
        </p>
      ) : (
        <div className="mb-5 flex flex-col gap-3">
          {zaehler.tarife.map((tarif) => (
            <div key={tarif.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {tarif.produkt ?? tarif.anbieter ?? "Tarif"}
                </p>
                <p className="mt-0.5 text-xs text-dim">
                  ab {dateFormatter.format(tarif.gueltigAb)}
                  {tarif.gueltigBis ? ` bis ${dateFormatter.format(tarif.gueltigBis)}` : ""} ·{" "}
                  {perDayFormatter.format(tarif.arbeitspreisCtNetto)} ct/{einheit} netto
                  {tarif.grundpreisJahrNetto > 0
                    ? ` · ${perDayFormatter.format(tarif.grundpreisJahrNetto)} €/Jahr GP`
                    : ""}{" "}
                  · {perDayFormatter.format(tarif.mwstProzent)} % MwSt
                </p>
              </div>
              <span className="flex flex-none gap-1">
                {/* Bearbeiten statt loeschen-und-neu: Ein Tippfehler im
                    Arbeitspreis kostete bislang die Id des Tarifs, und damit
                    die Nachvollziehbarkeit, welcher Tarif wann galt. */}
                <Tooltip label="Tarif bearbeiten">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditTarif(tarif)}
                    aria-label="Tarif bearbeiten"
                  >
                    <IconPencil size={16} />
                  </Button>
                </Tooltip>
                <form action={deleteAction}>
                  <input type="hidden" name="id" value={tarif.id} />
                  <input type="hidden" name="zaehlerId" value={zaehler.id} />
                  <Tooltip label="Tarif löschen">
                    <Button type="submit" variant="danger" size="sm" aria-label="Tarif löschen">
                      <IconTrash size={16} />
                    </Button>
                  </Tooltip>
                </form>
              </span>
            </div>
          ))}
        </div>
      )}

      {deleteState.error && (
        <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />} className="mb-4">
          {deleteState.error}
        </Alert>
      )}

      <form action={createAction} ref={formRef} className="flex flex-col gap-3">
        <input type="hidden" name="zaehlerId" value={zaehler.id} />
        <Field label="Produkt / Tarifname">
          {({ id }) => (
            <TextInput id={id} name="produkt" placeholder="z. B. Grundversorgung 2024" />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gültig ab" required>
            {({ id }) => (
              <TextInput id={id} name="gueltigAb" type="date" defaultValue={today} required />
            )}
          </Field>
          <Field label="Gültig bis (optional)">
            {({ id }) => <TextInput id={id} name="gueltigBis" type="date" />}
          </Field>
        </div>
        <Field label={`Arbeitspreis (ct/${einheit}, netto)`} required>
          {({ id }) => (
            <NumberInput
              id={id}
              name="arbeitspreisCtNetto"
              placeholder="z. B. 34"
              min={0}
              step="0.0001"
              required
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Grundpreis (€/Jahr, netto)">
            {({ id }) => (
              <NumberInput
                id={id}
                name="grundpreisJahrNetto"
                placeholder="0"
                min={0}
                step="0.01"
              />
            )}
          </Field>
          <Field label="MwSt %">
            {({ id }) => (
              <NumberInput
                id={id}
                name="mwstProzent"
                defaultValue={19}
                min={0}
                max={100}
                step="0.1"
              />
            )}
          </Field>
        </div>

        {createState.error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {createState.error}
          </Alert>
        )}
        {createState.success && (
          <Alert tone="ok" icon={<IconCheck size={16} />}>
            Tarif gespeichert.
          </Alert>
        )}

        <Button type="submit" variant="primary" full disabled={creating}>
          {creating ? "Wird gespeichert…" : "Tarif hinzufügen"}
        </Button>
      </form>

      <ResponsiveDialog
        opened={editTarif !== null}
        onClose={() => setEditTarif(null)}
        title="Tarif bearbeiten"
      >
        {editTarif && (
          <EditTarifForm
            tarif={editTarif}
            einheit={einheit}
            onDone={() => {
              setEditTarif(null);
              router.refresh();
            }}
          />
        )}
      </ResponsiveDialog>
    </Panel>
  );
}

function EditTarifForm({
  tarif,
  einheit,
  onDone,
}: {
  tarif: TarifRow;
  einheit: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateTarifAction, initialActionState);

  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);

  const isoDate = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");

  return (
    <form action={formAction} key={tarif.id} className="flex flex-col gap-3">
      {/* Nur die Id — der Zaehler wechselt beim Bearbeiten nie, und ihn
          entgegenzunehmen hiesse, eine Verwechslung im Formular koennte die
          Kostenrechnung zweier Zaehler auf einmal verschieben. */}
      <input type="hidden" name="id" value={tarif.id} />
      <Field label="Produkt / Tarifname">
        {({ id }) => <TextInput id={id} name="produkt" defaultValue={tarif.produkt ?? ""} />}
      </Field>
      <Field label="Anbieter">
        {({ id }) => <TextInput id={id} name="anbieter" defaultValue={tarif.anbieter ?? ""} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Gültig ab" required>
          {({ id }) => (
            <TextInput
              id={id}
              name="gueltigAb"
              type="date"
              defaultValue={isoDate(tarif.gueltigAb)}
              required
            />
          )}
        </Field>
        <Field label="Gültig bis (optional)">
          {({ id }) => (
            <TextInput
              id={id}
              name="gueltigBis"
              type="date"
              defaultValue={isoDate(tarif.gueltigBis)}
            />
          )}
        </Field>
      </div>
      <Field label={`Arbeitspreis (ct/${einheit}, netto)`} required>
        {({ id }) => (
          <NumberInput
            id={id}
            name="arbeitspreisCtNetto"
            defaultValue={tarif.arbeitspreisCtNetto}
            min={0}
            step="0.0001"
            required
          />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Grundpreis (€/Jahr, netto)">
          {({ id }) => (
            <NumberInput
              id={id}
              name="grundpreisJahrNetto"
              defaultValue={tarif.grundpreisJahrNetto}
              min={0}
              step="0.01"
            />
          )}
        </Field>
        <Field label="MwSt %">
          {({ id }) => (
            <NumberInput
              id={id}
              name="mwstProzent"
              defaultValue={tarif.mwstProzent}
              min={0}
              max={100}
              step="0.1"
            />
          )}
        </Field>
      </div>
      <Field label="Notiz (optional)">
        {({ id }) => <TextInput id={id} name="notiz" defaultValue={tarif.notiz ?? ""} />}
      </Field>

      {state.error && (
        <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
          {state.error}
        </Alert>
      )}

      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" onClick={onDone} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Wird gespeichert…" : "Speichern"}
        </Button>
      </div>
    </form>
  );
}


type FaktorRow = ZaehlerWithHistory["umrechnungsfaktoren"][number];

/**
 * Brennwert und Zustandszahl je Zeitraum.
 *
 * Beide stehen auf jeder Jahresrechnung und ändern sich — der Brennwert sogar
 * monatlich. Bis ZW-02 rechnete Zählwerk mit zwei festen Zahlen von 2021; je
 * weiter das zurückliegt, desto weiter liegt die Gasrechnung daneben, und das
 * sind keine Rundungsfehler, sondern zweistellige Prozente.
 */
function GasFaktorenCard({
  zaehler,
  coverageGap,
}: {
  zaehler: ZaehlerWithHistory;
  coverageGap: boolean;
}) {
  const router = useRouter();
  const [createState, createAction, creating] = useActionState(
    createUmrechnungsfaktorAction,
    initialActionState,
  );
  const [deleteState, deleteAction] = useActionState(
    deleteUmrechnungsfaktorAction,
    initialActionState,
  );
  const [editFaktor, setEditFaktor] = useState<FaktorRow | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (createState.success) formRef.current?.reset();
  }, [createState.success]);

  const faktorFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 4 });

  return (
    <Panel title="Gas-Umrechnung (m³ → kWh)" icon={<IconFlame size={17} stroke={1.7} />}>
      <p className="mb-4 text-xs text-dim">
        kWh = m³ × Brennwert × Zustandszahl. Beide Werte stehen auf deiner Jahresrechnung; der
        Brennwert ändert sich monatlich. Ein Verbrauch über einen Faktorwechsel hinweg wird
        anteilig nach Tagen gerechnet.
      </p>

      {/* Sagt es, statt still zu raten: Ohne Faktor gibt es an dieser Stelle
          KEINE Kostenzahl. Ein geschätzter Brennwert sähe aus wie ein
          abgelesener, und niemand merkte je, dass die Rechnung auf einer
          Annahme beruht. */}
      {coverageGap && (
        <Alert tone="watch" icon={<IconAlertCircle size={16} />} className="mb-4">
          Für einen Teil des Ableseverlaufs ist kein Umrechnungsfaktor gepflegt. Die
          Tarifkosten dieser Zeiträume bleiben leer — sie werden bewusst nicht geschätzt.
        </Alert>
      )}

      {zaehler.umrechnungsfaktoren.length === 0 ? (
        <p className="mb-4 text-sm text-dim">
          Noch kein Faktor hinterlegt. Ohne ihn lassen sich für Gas keine Tarifkosten berechnen.
        </p>
      ) : (
        <div className="mb-5 flex flex-col gap-3">
          {zaehler.umrechnungsfaktoren.map((faktor) => (
            <div key={faktor.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {faktorFormatter.format(faktor.brennwert)} kWh/m³ ×{" "}
                  {faktorFormatter.format(faktor.zustandszahl)}{" "}
                  <span className="text-dim">
                    = {faktorFormatter.format(faktor.brennwert * faktor.zustandszahl)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-dim">
                  ab {dateFormatter.format(faktor.gueltigAb)}
                  {faktor.gueltigBis ? ` bis ${dateFormatter.format(faktor.gueltigBis)}` : ""}
                  {faktor.quelle ? ` · ${faktor.quelle}` : ""}
                </p>
              </div>
              <span className="flex flex-none gap-1">
                <Tooltip label="Faktor bearbeiten">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditFaktor(faktor)}
                    aria-label="Faktor bearbeiten"
                  >
                    <IconPencil size={16} />
                  </Button>
                </Tooltip>
                <form action={deleteAction}>
                  <input type="hidden" name="id" value={faktor.id} />
                  <Tooltip label="Faktor löschen">
                    <Button type="submit" variant="danger" size="sm" aria-label="Faktor löschen">
                      <IconTrash size={16} />
                    </Button>
                  </Tooltip>
                </form>
              </span>
            </div>
          ))}
        </div>
      )}

      {deleteState.error && (
        <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />} className="mb-4">
          {deleteState.error}
        </Alert>
      )}

      <form action={createAction} ref={formRef} className="flex flex-col gap-3">
        <input type="hidden" name="zaehlerId" value={zaehler.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gültig ab" required>
            {({ id }) => (
              <TextInput id={id} name="gueltigAb" type="date" defaultValue={today} required />
            )}
          </Field>
          <Field label="Gültig bis (optional)">
            {({ id }) => <TextInput id={id} name="gueltigBis" type="date" />}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Brennwert (kWh/m³)" required>
            {({ id }) => (
              <NumberInput
                id={id}
                name="brennwert"
                placeholder="z. B. 10,312"
                min={0}
                step="0.0001"
                required
              />
            )}
          </Field>
          <Field label="Zustandszahl" required>
            {({ id }) => (
              <NumberInput
                id={id}
                name="zustandszahl"
                placeholder="z. B. 0,9622"
                min={0}
                step="0.0001"
                required
              />
            )}
          </Field>
        </div>
        <Field label="Quelle (optional)">
          {({ id }) => (
            <TextInput id={id} name="quelle" placeholder="z. B. Jahresrechnung 2026" />
          )}
        </Field>

        {createState.error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {createState.error}
          </Alert>
        )}
        {createState.success && (
          <Alert tone="ok" icon={<IconCheck size={16} />}>
            Faktor gespeichert.
          </Alert>
        )}

        <Button type="submit" variant="primary" full disabled={creating}>
          {creating ? "Wird gespeichert…" : "Faktor hinzufügen"}
        </Button>
      </form>

      <ResponsiveDialog
        opened={editFaktor !== null}
        onClose={() => setEditFaktor(null)}
        title="Umrechnungsfaktor bearbeiten"
      >
        {editFaktor && (
          <EditFaktorForm
            faktor={editFaktor}
            onDone={() => {
              setEditFaktor(null);
              router.refresh();
            }}
          />
        )}
      </ResponsiveDialog>
    </Panel>
  );
}

function EditFaktorForm({ faktor, onDone }: { faktor: FaktorRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(
    updateUmrechnungsfaktorAction,
    initialActionState,
  );

  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);

  const isoDate = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");

  return (
    <form action={formAction} key={faktor.id} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={faktor.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Gültig ab" required>
          {({ id }) => (
            <TextInput
              id={id}
              name="gueltigAb"
              type="date"
              defaultValue={isoDate(faktor.gueltigAb)}
              required
            />
          )}
        </Field>
        <Field label="Gültig bis (optional)">
          {({ id }) => (
            <TextInput
              id={id}
              name="gueltigBis"
              type="date"
              defaultValue={isoDate(faktor.gueltigBis)}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Brennwert (kWh/m³)" required>
          {({ id }) => (
            <NumberInput
              id={id}
              name="brennwert"
              defaultValue={faktor.brennwert}
              min={0}
              step="0.0001"
              required
            />
          )}
        </Field>
        <Field label="Zustandszahl" required>
          {({ id }) => (
            <NumberInput
              id={id}
              name="zustandszahl"
              defaultValue={faktor.zustandszahl}
              min={0}
              step="0.0001"
              required
            />
          )}
        </Field>
      </div>
      <Field label="Quelle (optional)">
        {({ id }) => <TextInput id={id} name="quelle" defaultValue={faktor.quelle ?? ""} />}
      </Field>
      <Field label="Notiz (optional)">
        {({ id }) => <TextInput id={id} name="notiz" defaultValue={faktor.notiz ?? ""} />}
      </Field>

      {state.error && (
        <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
          {state.error}
        </Alert>
      )}

      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" onClick={onDone} disabled={pending}>
          Abbrechen
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Wird gespeichert…" : "Speichern"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Geloeschte Ablesungen — der Grund, warum der Soft-Delete einer ist.
 *
 * Ohne diesen Weg zurueck waere er nur eine teurere Art zu loeschen.
 */
function PapierkorbCard({ eintraege }: { eintraege: DeletedReading[] }) {
  const router = useRouter();
  const [restoreState, restoreAction] = useActionState(restoreAblesungAction, initialActionState);
  const [purgeState, purgeAction] = useActionState(purgeAblesungAction, initialActionState);

  useEffect(() => {
    if (restoreState.success || purgeState.success) router.refresh();
  }, [restoreState.success, purgeState.success, router]);

  return (
    <Panel title="Papierkorb" icon={<IconTrash size={17} stroke={1.7} />}>
      <p className="mb-4 text-xs text-dim">
        Gelöschte Ablesungen zählen nirgends mit — nicht im Verlauf, nicht in den Summen, nicht
        in Berichten. Sie liegen hier, bis du sie zurückholst oder endgültig entfernst.
      </p>

      <div className="flex flex-col gap-3">
        {eintraege.map((eintrag) => (
          <div key={eintrag.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="readout text-sm font-semibold">
                {numberFormatter.format(eintrag.wert)}
              </p>
              <p className="mt-0.5 text-xs text-dim">
                vom {dateFormatter.format(eintrag.datum)}
                {eintrag.geloeschtAm
                  ? ` · gelöscht am ${dateFormatter.format(eintrag.geloeschtAm)}`
                  : ""}
                {eintrag.geloeschtVon ? ` von ${eintrag.geloeschtVon}` : ""}
              </p>
            </div>
            <span className="flex flex-none gap-1">
              <form action={restoreAction}>
                <input type="hidden" name="id" value={eintrag.id} />
                <Tooltip label="Zurückholen">
                  <Button type="submit" size="sm" aria-label="Ablesung zurückholen">
                    <IconArrowBackUp size={16} />
                  </Button>
                </Tooltip>
              </form>
              {/* Endgueltig entfernen geht NUR von hier aus. Der Umweg ist der
                  Punkt: Wer wirklich loeschen will, muss es zweimal sagen. */}
              <form
                action={purgeAction}
                onSubmit={(event) => {
                  if (
                    !window.confirm(
                      `Ablesung ${numberFormatter.format(eintrag.wert)} vom ` +
                        `${dateFormatter.format(eintrag.datum)} endgültig entfernen? ` +
                        "Das lässt sich nicht rückgängig machen.",
                    )
                  ) {
                    event.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="id" value={eintrag.id} />
                <Tooltip label="Endgültig entfernen">
                  <Button
                    type="submit"
                    variant="danger"
                    size="sm"
                    aria-label="Ablesung endgültig entfernen"
                  >
                    <IconTrash size={16} />
                  </Button>
                </Tooltip>
              </form>
            </span>
          </div>
        ))}
      </div>

      {(restoreState.error || purgeState.error) && (
        <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />} className="mt-4">
          {restoreState.error ?? purgeState.error}
        </Alert>
      )}
    </Panel>
  );
}
