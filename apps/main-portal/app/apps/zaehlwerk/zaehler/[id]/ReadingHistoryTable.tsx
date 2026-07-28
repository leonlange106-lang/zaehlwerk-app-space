"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { Checkbox as UiCheckbox } from "@/app/components/ui/primitives";
import { Field, NumberInput, TextInput } from "@/app/components/ui/Field";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { useToast } from "@/app/components/ui/Toast";
import { Alert, Table, TableScroll, Td, Th } from "@/app/components/ui/primitives";
import {
  IconAlertCircle,
  IconChevronDown,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { deleteAblesungAction, updateAblesungAction } from "@/app/lib/zaehler-actions";
import { initialActionState } from "@/app/lib/action-state";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import cardClasses from "./ReadingHistoryTable.module.css";

// Render-ready row: all formatting/consumption/tariff math is done by the
// parent server-adjacent component so this table stays a pure view and windows
// cheaply. `tariffCost === null` renders as "–" when the tariff column is shown.
// `raw` carries the unformatted values needed to prefill the edit form.
export type ReadingRow = {
  id: string;
  datum: string;
  wert: string;
  /**
   * Anzeigename des Registers, oder `null`, wenn der Zaehler nur eines fuehrt.
   *
   * Der Elternteil entscheidet das, nicht diese Tabelle: Ein gewoehnlicher
   * Zaehler soll keine Spalte bekommen, in der in jeder Zeile dasselbe Wort
   * steht.
   */
  register: string | null;
  getauscht: boolean;
  consumption:
    | { kind: "none" }
    | { kind: "implausible" }
    | { kind: "value"; text: string };
  kosten: string;
  tariffCost: string | null;
  quelle: string;
  raw: {
    datum: string; // yyyy-mm-dd for the date input
    wert: number;
    kosten: number | null;
    notiz: string;
    getauscht: boolean;
    startwertNeu: number | null;
  };
};

// Above this many rows we virtualize; below it a plain table is simpler and
// keeps the natural page flow (no inner scroll area) for the common case.
// Virtualization is a tablet/desktop-only concern: the phone branch renders a
// card list and pages it with the button below instead.
const VIRTUALIZE_THRESHOLD = 40;
// How many cards the phone list shows before "Weitere anzeigen". Roughly three
// screens of scrolling — enough to browse, far short of a 500-card DOM.
const MOBILE_PAGE_SIZE = 25;
// Fallback estimate before a row is measured; real heights come from
// measureElement (they differ between the compact desktop and the taller,
// touch-padded mobile layout).
const ESTIMATED_ROW_HEIGHT = 45;
const VIEWPORT_HEIGHT = 520;
const MIN_TABLE_WIDTH = 580;

type RowActions = {
  onEdit: (row: ReadingRow) => void;
  onDelete: (row: ReadingRow) => void;
  deleting: boolean;
};

function RowCells({
  row,
  hasTarife,
  showRegister,
  actions,
}: {
  row: ReadingRow;
  hasTarife: boolean;
  showRegister: boolean;
  actions: RowActions;
}) {
  return (
    <>
      <Td className="whitespace-nowrap">{row.datum}</Td>
      {showRegister && (
        <Td className="whitespace-nowrap">
          <Badge>{row.register ?? "Bezug"}</Badge>
        </Td>
      )}
      <Td className="readout whitespace-nowrap">
        {row.wert}
        {row.getauscht && <Badge className="ml-2">Zähler getauscht</Badge>}
      </Td>
      <Td className="whitespace-nowrap">
        {row.consumption.kind === "none" ? (
          "–"
        ) : row.consumption.kind === "implausible" ? (
          <span className="text-watch">unplausibel</span>
        ) : (
          <span className="readout">{row.consumption.text}</span>
        )}
      </Td>
      <Td className="readout whitespace-nowrap">{row.kosten}</Td>
      {hasTarife && (
        <Td className="whitespace-nowrap text-dim">
          {row.tariffCost !== null ? <span className="readout">{row.tariffCost}</span> : "–"}
        </Td>
      )}
      <Td>
        <Badge>{row.quelle}</Badge>
      </Td>
      <Td>
        <span className="flex justify-end gap-1">
          <Tooltip label="Bearbeiten">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => actions.onEdit(row)}
              aria-label="Ablesung bearbeiten"
            >
              <IconPencil size={16} />
            </Button>
          </Tooltip>
          <Tooltip label="Löschen">
            <Button
              variant="danger"
              size="sm"
              disabled={actions.deleting}
              onClick={() => actions.onDelete(row)}
              aria-label="Ablesung löschen"
            >
              <IconTrash size={16} />
            </Button>
          </Tooltip>
        </span>
      </Td>
    </>
  );
}

function HeaderRow({ hasTarife, showRegister }: { hasTarife: boolean; showRegister: boolean }) {
  return (
    <tr>
      <Th>Datum</Th>
      {showRegister && <Th>Register</Th>}
      <Th>Zählerstand</Th>
      <Th>Verbrauch</Th>
      <Th>Kosten</Th>
      {hasTarife && <Th>Kosten (Tarif)</Th>}
      <Th>Quelle</Th>
      <Th className="text-right">Aktionen</Th>
    </tr>
  );
}

export function ReadingHistoryTable({
  rows,
  hasTarife,
  zaehlerId,
  einheit,
}: {
  rows: ReadingRow[];
  hasTarife: boolean;
  zaehlerId: string;
  einheit: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [deleting, startDelete] = useTransition();
  const [editRow, setEditRow] = useState<ReadingRow | null>(null);

  function onDelete(row: ReadingRow) {
    if (!window.confirm(`Ablesung vom ${row.datum} (${row.wert}) wirklich löschen?`)) return;
    startDelete(async () => {
      const fd = new FormData();
      fd.set("id", row.id);
      fd.set("zaehlerId", zaehlerId);
      const result = await deleteAblesungAction(initialActionState, fd);
      toast.show({
        tone: result.success ? "ok" : "risk",
        title: result.success ? "Ablesung gelöscht" : "Löschen fehlgeschlagen",
        message: result.success ? undefined : (result.error ?? undefined),
      });
      if (result.success) router.refresh();
    });
  }

  const actions: RowActions = { onEdit: setEditRow, onDelete, deleting };

  // Einmal hier ableiten statt als weiteres Flag durchzureichen: Der Elternteil
  // hat die Entscheidung bereits getroffen, indem er `register` gesetzt oder auf
  // null gelassen hat.
  const showRegister = rows.some((row) => row.register !== null);

  return (
    <>
      {/* Phone first, and first in the DOM: at < 600px this is the branch that
          has a box, so "the first edit button on the page" is the visible one. */}
      <ReadingCardList
        rows={rows}
        hasTarife={hasTarife}
        showRegister={showRegister}
        actions={actions}
      />

      <div className={cardClasses.tableView}>
        {rows.length <= VIRTUALIZE_THRESHOLD ? (
          <TableScroll>
            <Table style={{ minWidth: MIN_TABLE_WIDTH }}>
              <thead>
                <HeaderRow hasTarife={hasTarife} showRegister={showRegister} />
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <RowCells
                      row={row}
                      hasTarife={hasTarife}
                      showRegister={showRegister}
                      actions={actions}
                    />
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        ) : (
          <VirtualizedReadingTable
            rows={rows}
            hasTarife={hasTarife}
            showRegister={showRegister}
            actions={actions}
          />
        )}
      </div>

      {/* Bottom sheet on a phone, centred modal on desktop. */}
      <ResponsiveDialog
        opened={editRow !== null}
        onClose={() => setEditRow(null)}
        title="Ablesung bearbeiten"
      >
        {editRow && (
          <EditReadingForm
            row={editRow}
            zaehlerId={zaehlerId}
            einheit={einheit}
            onDone={() => {
              setEditRow(null);
              router.refresh();
            }}
          />
        )}
      </ResponsiveDialog>
    </>
  );
}

/**
 * The phone presentation: one card per reading, headline figures always visible
 * and the secondary columns (Verbrauch, Kosten, Tarif, Quelle) folded into an
 * expandable panel. Edit/delete sit on their own 44px row so neither needs the
 * card to be expanded first.
 */
function ReadingCardList({
  rows,
  hasTarife,
  showRegister,
  actions,
}: {
  rows: ReadingRow[];
  hasTarife: boolean;
  showRegister: boolean;
  actions: RowActions;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(MOBILE_PAGE_SIZE);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visible = rows.slice(0, limit);

  return (
    <div className={cardClasses.cardList} role="region" aria-label="Ablesungshistorie">
      {visible.map((row) => {
        const open = expanded.has(row.id);
        const panelId = `reading-detail-${row.id}`;
        return (
          <div key={row.id} className={cardClasses.card} data-swapped={String(row.getauscht)}>
            <div className={cardClasses.head}>
              <div>
                <div className={cardClasses.date}>{row.datum}</div>
                <div className={cardClasses.value}>{row.wert}</div>
              </div>
              <span className="flex flex-wrap justify-end gap-1">
                {showRegister && <Badge>{row.register ?? "Bezug"}</Badge>}
                {row.getauscht && <Badge>Zähler getauscht</Badge>}
              </span>
            </div>

            <div className={cardClasses.actions}>
              <button
                type="button"
                onClick={() => toggle(row.id)}
                aria-expanded={open}
                aria-controls={panelId}
                className="flex h-11 items-center gap-1 px-1 text-xs text-dim"
              >
                {/* Constant label: swapping the wording on expand would change
                    the row's width and nudge the icons beside it. */}
                Details
                <IconChevronDown
                  size={14}
                  stroke={1.9}
                  style={{
                    transform: open ? "rotate(180deg)" : undefined,
                    transition: "transform 150ms ease",
                  }}
                />
              </button>

              <span className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => actions.onEdit(row)}
                  aria-label="Ablesung bearbeiten"
                >
                  <IconPencil size={17} stroke={1.9} />
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={actions.deleting}
                  onClick={() => actions.onDelete(row)}
                  aria-label="Ablesung löschen"
                >
                  <IconTrash size={17} stroke={1.9} />
                </Button>
              </span>
            </div>

            <div id={panelId} hidden={!open}>
              <dl className={cardClasses.detailGrid}>
                <dt className={cardClasses.detailKey}>Verbrauch</dt>
                <dd className={cardClasses.detailValue}>
                  {row.consumption.kind === "none"
                    ? "–"
                    : row.consumption.kind === "implausible"
                      ? "unplausibel"
                      : row.consumption.text}
                </dd>
                <dt className={cardClasses.detailKey}>Kosten</dt>
                <dd className={cardClasses.detailValue}>{row.kosten}</dd>
                {hasTarife && (
                  <>
                    <dt className={cardClasses.detailKey}>Kosten (Tarif)</dt>
                    <dd className={cardClasses.detailValue}>{row.tariffCost ?? "–"}</dd>
                  </>
                )}
                <dt className={cardClasses.detailKey}>Quelle</dt>
                <dd className={cardClasses.detailValue}>{row.quelle}</dd>
              </dl>
            </div>
          </div>
        );
      })}

      {rows.length > limit && (
        <Button size="sm" onClick={() => setLimit((n) => n + MOBILE_PAGE_SIZE)}>
          Weitere anzeigen ({rows.length - limit})
        </Button>
      )}
    </div>
  );
}

function EditReadingForm({
  row,
  zaehlerId,
  einheit,
  onDone,
}: {
  row: ReadingRow;
  zaehlerId: string;
  einheit: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateAblesungAction, initialActionState);
  const [getauscht, setGetauscht] = useState(row.raw.getauscht);

  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);

  return (
    <form action={formAction} key={row.id} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="zaehlerId" value={zaehlerId} />
      <Field label="Ablesedatum" required>
        {({ id }) => (
          <TextInput id={id} name="datum" type="date" defaultValue={row.raw.datum} required />
        )}
      </Field>
      {/* The unit is part of the label on purpose — the mobile spec fills this
          field by its accessible name, and a bare "Zählerstand" would not say
          which unit the number is in. */}
      <Field label={`Zählerstand (${einheit})`} required>
        {({ id }) => (
          <NumberInput
            id={id}
            name="wert"
            defaultValue={row.raw.wert}
            min={0}
            step="any"
            required
          />
        )}
      </Field>
      <Field label="Kosten (optional)">
        {({ id }) => (
          <NumberInput
            id={id}
            name="kosten"
            defaultValue={row.raw.kosten ?? undefined}
            min={0}
            step="0.01"
          />
        )}
      </Field>
      <UiCheckbox
        name="zaehlerGetauscht"
        label="Zähler wurde bei dieser Ablesung getauscht"
        checked={getauscht}
        onChange={(event) => setGetauscht(event.currentTarget.checked)}
      />
      {getauscht && (
        <Field label="Startwert neuer Zähler">
          {({ id }) => (
            <NumberInput
              id={id}
              name="startwertNeu"
              defaultValue={row.raw.startwertNeu ?? undefined}
              min={0}
              step="any"
            />
          )}
        </Field>
      )}
      <Field label="Notiz (optional)">
        {({ id }) => <TextInput id={id} name="notiz" defaultValue={row.raw.notiz} />}
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

function VirtualizedReadingTable({
  rows,
  hasTarife,
  showRegister,
  actions,
}: {
  rows: ReadingRow[];
  hasTarife: boolean;
  showRegister: boolean;
  actions: RowActions;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns live (non-memoizable) functions, so React Compiler
  // intentionally skips memoizing this component — expected and safe here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 12,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]!.start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1]!.end : 0;
  const colSpan = 6 + (hasTarife ? 1 : 0) + (showRegister ? 1 : 0);

  // Single scroll container handles both axes: vertical for windowing, and
  // horizontal so the wide table never overflows the phone viewport.
  return (
    <div
      ref={parentRef}
      style={{ height: VIEWPORT_HEIGHT, overflow: "auto" }}
      role="region"
      aria-label="Ablesungshistorie"
      tabIndex={0}
    >
      <Table style={{ minWidth: MIN_TABLE_WIDTH }}>
        <thead className="sticky top-0 z-10 bg-surface">
          <HeaderRow hasTarife={hasTarife} showRegister={showRegister} />
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden style={{ height: paddingTop }}>
              <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index]!;
            return (
              <tr key={row.id} data-index={virtualRow.index} ref={virtualizer.measureElement}>
                <RowCells
                  row={row}
                  hasTarife={hasTarife}
                  showRegister={showRegister}
                  actions={actions}
                />
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden style={{ height: paddingBottom }}>
              <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
