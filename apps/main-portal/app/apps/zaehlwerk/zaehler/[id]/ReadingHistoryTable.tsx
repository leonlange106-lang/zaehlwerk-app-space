"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
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
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCheck, IconPencil, IconTrash } from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { deleteAblesungAction, updateAblesungAction } from "@/app/lib/zaehler-actions";
import { initialActionState } from "@/app/lib/action-state";

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
const VIRTUALIZE_THRESHOLD = 40;
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

      <Modal
        opened={editRow !== null}
        onClose={() => setEditRow(null)}
        title="Ablesung bearbeiten"
        centered
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
      </Modal>
    </>
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
