"use client";

import {
  Badge,
  Card,
  Group,
  ScrollArea,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";
import type { AuditEvent } from "../lib/audit";
import { formatDateTime } from "../lib/format";

// Colour-code the broad action families so the log scans quickly.
function actionColor(action: string): string {
  if (action.startsWith("user.")) return "orange";
  if (action.startsWith("token.")) return "grape";
  if (action.startsWith("backup.")) return "teal";
  if (action.startsWith("db.")) return "blue";
  if (action.startsWith("system.")) return "red";
  if (action.startsWith("data.")) return "cyan";
  return "gray";
}

export function AuditLogCard({ events }: { events: AuditEvent[] }) {
  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconHistory size={18} stroke={1.6} />
        <Title order={4}>Audit-Log · System-Ereignisse</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Protokoll kritischer Aktionen (System-Updates, Benutzer- und Token-Änderungen, Massen-Importe,
        Sicherungen, DB-Wartung) für die Nachvollziehbarkeit.
      </Text>

      {events.length === 0 ? (
        <Text size="sm" c="dimmed">
          Noch keine Ereignisse protokolliert.
        </Text>
      ) : (
        <ScrollArea.Autosize mah={360} type="auto">
          <Table verticalSpacing="xs" fz="sm" stickyHeader>
            <TableThead>
              <TableTr>
                <TableTh>Zeitpunkt</TableTh>
                <TableTh>Aktion</TableTh>
                <TableTh>Akteur</TableTh>
                <TableTh>Details</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {events.map((event) => (
                <TableTr key={event.id}>
                  <TableTd style={{ whiteSpace: "nowrap" }}>{formatDateTime(event.createdAt)}</TableTd>
                  <TableTd>
                    <Badge size="sm" variant="light" color={actionColor(event.action)}>
                      {event.action}
                    </Badge>
                  </TableTd>
                  <TableTd style={{ wordBreak: "break-word" }}>{event.actor}</TableTd>
                  <TableTd style={{ wordBreak: "break-word" }}>{event.detail ?? "—"}</TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </ScrollArea.Autosize>
      )}
    </Card>
  );
}
