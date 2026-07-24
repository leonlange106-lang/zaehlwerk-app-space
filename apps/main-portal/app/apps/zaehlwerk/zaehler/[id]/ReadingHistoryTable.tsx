"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  Stack,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconCheck,
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
  actions,
}: {
  row: ReadingRow;
  hasTarife: boolean;
  actions: RowActions;
}) {
  return (
    <>
      <TableTd>{row.datum}</TableTd>
      <TableTd>
        {row.wert}
        {row.getauscht && (
          <Badge ml="xs" size="xs" variant="light" color="orange">
            Zähler getauscht
          </Badge>
        )}
      </TableTd>
      <TableTd>
        {row.consumption.kind === "none" ? (
          "–"
        ) : row.consumption.kind === "implausible" ? (
          <Text component="span" size="sm" c="orange">
            unplausibel
          </Text>
        ) : (
          row.consumption.text
        )}
      </TableTd>
      <TableTd>{row.kosten}</TableTd>
      {hasTarife && (
        <TableTd>
          {row.tariffCost !== null ? (
            <Text component="span" size="sm" c="dimmed">
              {row.tariffCost}
            </Text>
          ) : (
            "–"
          )}
        </TableTd>
      )}
      <TableTd>
        <Badge size="xs" variant="outline" color="slate">
          {row.quelle}
        </Badge>
      </TableTd>
      <TableTd>
        <Group gap={4} wrap="nowrap" justify="flex-end">
          <Tooltip label="Bearbeiten">
            <ActionIcon variant="subtle" color="slate" onClick={() => actions.onEdit(row)} aria-label="Ablesung bearbeiten">
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Löschen">
            <ActionIcon
              variant="subtle"
              color="red"
              loading={actions.deleting}
              onClick={() => actions.onDelete(row)}
              aria-label="Ablesung löschen"
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </TableTd>
    </>
  );
}

function HeaderRow({ hasTarife }: { hasTarife: boolean }) {
  return (
    <TableTr>
      <TableTh>Datum</TableTh>
      <TableTh>Zählerstand</TableTh>
      <TableTh>Verbrauch</TableTh>
      <TableTh>Kosten</TableTh>
      {hasTarife && <TableTh>Kosten (Tarif)</TableTh>}
      <TableTh>Quelle</TableTh>
      <TableTh />
    </TableTr>
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
  const [deleting, startDelete] = useTransition();
  const [editRow, setEditRow] = useState<ReadingRow | null>(null);

  function onDelete(row: ReadingRow) {
    if (!window.confirm(`Ablesung vom ${row.datum} (${row.wert}) wirklich löschen?`)) return;
    startDelete(async () => {
      const fd = new FormData();
      fd.set("id", row.id);
      fd.set("zaehlerId", zaehlerId);
      const result = await deleteAblesungAction(initialActionState, fd);
      notifications.show({
        color: result.success ? "green" : "red",
        icon: result.success ? <IconCheck size={16} /> : <IconAlertCircle size={16} />,
        message: result.success ? "Ablesung gelöscht." : result.error ?? "Fehler.",
      });
      if (result.success) router.refresh();
    });
  }

  const actions: RowActions = { onEdit: setEditRow, onDelete, deleting };

  return (
    <>
      {/* Phone first, and first in the DOM: at < 600px this is the branch that
          has a box, so "the first edit button on the page" is the visible one. */}
      <ReadingCardList rows={rows} hasTarife={hasTarife} actions={actions} />

      <div className={cardClasses.tableView}>
        {rows.length <= VIRTUALIZE_THRESHOLD ? (
          <TableScrollContainer minWidth={MIN_TABLE_WIDTH}>
            <Table verticalSpacing="xs" fz="sm">
              <TableThead>
                <HeaderRow hasTarife={hasTarife} />
              </TableThead>
              <TableTbody>
                {rows.map((row) => (
                  <TableTr key={row.id}>
                    <RowCells row={row} hasTarife={hasTarife} actions={actions} />
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </TableScrollContainer>
        ) : (
          <VirtualizedReadingTable rows={rows} hasTarife={hasTarife} actions={actions} />
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
  actions,
}: {
  rows: ReadingRow[];
  hasTarife: boolean;
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
              {row.getauscht && (
                <Badge size="xs" variant="light" color="amber">
                  Zähler getauscht
                </Badge>
              )}
            </div>

            <div className={cardClasses.actions}>
              <UnstyledButton
                onClick={() => toggle(row.id)}
                aria-expanded={open}
                aria-controls={panelId}
                px={4}
                h={44}
              >
                <Group gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    {/* Constant label: swapping the wording on expand would
                        change the row's width and nudge the icons beside it. */}
                    Details
                  </Text>
                  <IconChevronDown
                    size={14}
                    stroke={1.75}
                    style={{
                      transform: open ? "rotate(180deg)" : undefined,
                      transition: "transform 150ms ease",
                    }}
                  />
                </Group>
              </UnstyledButton>

              <Group gap={4} wrap="nowrap">
                <ActionIcon
                  variant="subtle"
                  color="slate"
                  onClick={() => actions.onEdit(row)}
                  aria-label="Ablesung bearbeiten"
                >
                  <IconPencil size={17} stroke={1.75} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  loading={actions.deleting}
                  onClick={() => actions.onDelete(row)}
                  aria-label="Ablesung löschen"
                >
                  <IconTrash size={17} stroke={1.75} />
                </ActionIcon>
              </Group>
            </div>

            <Collapse in={open} id={panelId}>
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
            </Collapse>
          </div>
        );
      })}

      {rows.length > limit && (
        <Button
          variant="default"
          size="sm"
          onClick={() => setLimit((n) => n + MOBILE_PAGE_SIZE)}
        >
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
    <form action={formAction} key={row.id}>
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="zaehlerId" value={zaehlerId} />
      <Stack gap="sm">
        <TextInput name="datum" label="Ablesedatum" type="date" defaultValue={row.raw.datum} required />
        <NumberInput
          name="wert"
          label={`Zählerstand (${einheit})`}
          defaultValue={row.raw.wert}
          min={0}
          inputMode="decimal"
          required
        />
        <NumberInput
          name="kosten"
          label="Kosten (optional)"
          defaultValue={row.raw.kosten ?? undefined}
          min={0}
          decimalScale={2}
          inputMode="decimal"
        />
        <Checkbox
          name="zaehlerGetauscht"
          label="Zähler wurde bei dieser Ablesung getauscht"
          checked={getauscht}
          onChange={(event) => setGetauscht(event.currentTarget.checked)}
        />
        {getauscht && (
          <NumberInput
            name="startwertNeu"
            label="Startwert neuer Zähler"
            defaultValue={row.raw.startwertNeu ?? undefined}
            min={0}
            inputMode="decimal"
          />
        )}
        <TextInput name="notiz" label="Notiz (optional)" defaultValue={row.raw.notiz} />

        {state.error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
            {state.error}
          </Alert>
        )}

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onDone} disabled={pending}>
            Abbrechen
          </Button>
          <Button type="submit" color="slate" loading={pending}>
            Speichern
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function VirtualizedReadingTable({
  rows,
  hasTarife,
  actions,
}: {
  rows: ReadingRow[];
  hasTarife: boolean;
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
  const colSpan = hasTarife ? 7 : 6;

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
      <Table verticalSpacing="xs" fz="sm" stickyHeader style={{ minWidth: MIN_TABLE_WIDTH }}>
        <TableThead>
          <HeaderRow hasTarife={hasTarife} />
        </TableThead>
        <TableTbody>
          {paddingTop > 0 && (
            <TableTr aria-hidden style={{ height: paddingTop, border: 0 }}>
              <TableTd colSpan={colSpan} style={{ padding: 0, border: 0 }} />
            </TableTr>
          )}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index]!;
            return (
              <TableTr key={row.id} data-index={virtualRow.index} ref={virtualizer.measureElement}>
                <RowCells row={row} hasTarife={hasTarife} actions={actions} />
              </TableTr>
            );
          })}
          {paddingBottom > 0 && (
            <TableTr aria-hidden style={{ height: paddingBottom, border: 0 }}>
              <TableTd colSpan={colSpan} style={{ padding: 0, border: 0 }} />
            </TableTr>
          )}
        </TableTbody>
      </Table>
    </div>
  );
}
