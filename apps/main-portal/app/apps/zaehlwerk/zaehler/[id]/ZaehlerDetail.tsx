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
            {intervals.length > 0 && (
              <div className={classes.detailStats}>
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
              </div>
            )}

            {stats.hasImplausibleIntervals && (
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
    <Panel title="Tarife" icon={<IconReceipt2 size={17} stroke={1.7} />}>
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
              <form action={deleteAction} className="flex-none">
                <input type="hidden" name="id" value={tarif.id} />
                <input type="hidden" name="zaehlerId" value={zaehler.id} />
                <Tooltip label="Tarif löschen">
                  <Button type="submit" variant="danger" size="sm" aria-label="Tarif löschen">
                    <IconTrash size={16} />
                  </Button>
                </Tooltip>
              </form>
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
    </Panel>
  );
}
