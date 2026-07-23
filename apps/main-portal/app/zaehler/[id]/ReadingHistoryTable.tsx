"use client";

import { useRef } from "react";
import {
  Badge,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from "@mantine/core";
import { useVirtualizer } from "@tanstack/react-virtual";

// Render-ready row: all formatting/consumption/tariff math is done by the
// parent server-adjacent component so this table stays a pure view and windows
// cheaply. `tariffCost === null` renders as "–" when the tariff column is shown.
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
};

// Above this many rows we virtualize; below it a plain table is simpler and
// keeps the natural page flow (no inner scroll area) for the common case.
const VIRTUALIZE_THRESHOLD = 40;
// Fallback estimate before a row is measured; real heights come from
// measureElement (they differ between the compact desktop and the taller,
// touch-padded mobile layout).
const ESTIMATED_ROW_HEIGHT = 45;
const VIEWPORT_HEIGHT = 520;
const MIN_TABLE_WIDTH = 520;

function RowCells({ row, hasTarife }: { row: ReadingRow; hasTarife: boolean }) {
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
    </TableTr>
  );
}

export function ReadingHistoryTable({
  rows,
  hasTarife,
}: {
  rows: ReadingRow[];
  hasTarife: boolean;
}) {
  if (rows.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <TableScrollContainer minWidth={MIN_TABLE_WIDTH}>
        <Table verticalSpacing="xs" fz="sm">
          <TableThead>
            <HeaderRow hasTarife={hasTarife} />
          </TableThead>
          <TableTbody>
            {rows.map((row) => (
              <TableTr key={row.id}>
                <RowCells row={row} hasTarife={hasTarife} />
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </TableScrollContainer>
    );
  }

  return <VirtualizedReadingTable rows={rows} hasTarife={hasTarife} />;
}

function VirtualizedReadingTable({
  rows,
  hasTarife,
}: {
  rows: ReadingRow[];
  hasTarife: boolean;
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
  const colSpan = hasTarife ? 6 : 5;

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
                <RowCells row={row} hasTarife={hasTarife} />
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
