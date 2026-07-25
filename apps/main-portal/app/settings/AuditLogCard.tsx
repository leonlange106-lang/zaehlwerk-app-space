"use client";

import { IconHistory } from "@tabler/icons-react";
import type { AuditEvent } from "@/app/lib/audit";
import { formatDateTime } from "@/app/lib/format";
import { Panel } from "@/app/components/ui/Panel";
import { Code, Table, Td, Th } from "@/app/components/ui/primitives";

// Tint the broad action families so the log scans quickly. The action string is
// always spelled out beside the colour — this is a log, and a colour on its own
// tells you nothing about what happened.
function actionToken(action: string): string {
  if (action.startsWith("user.")) return "var(--zw-watch)";
  if (action.startsWith("token.")) return "#a78bfa";
  if (action.startsWith("backup.")) return "var(--zw-ok)";
  if (action.startsWith("db.")) return "var(--zw-accent-2)";
  if (action.startsWith("system.")) return "var(--zw-risk)";
  if (action.startsWith("data.")) return "var(--zw-accent)";
  return "var(--zw-neutral)";
}

export function AuditLogCard({ events }: { events: AuditEvent[] }) {
  return (
    <Panel
      title="Audit-Log · System-Ereignisse"
      description="Protokoll kritischer Aktionen (System-Updates, Benutzer- und Token-Änderungen, Massen-Importe, Sicherungen, DB-Wartung) für die Nachvollziehbarkeit."
      icon={<IconHistory size={17} stroke={1.7} />}
    >
      {events.length === 0 ? (
        <p className="text-sm text-dim">Noch keine Ereignisse protokolliert.</p>
      ) : (
        // Capped and scrollable: the log only grows, and an unbounded table would
        // push everything below it off the page.
        <div className="max-h-90 overflow-auto">
          <Table>
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <Th>Zeitpunkt</Th>
                <Th>Aktion</Th>
                <Th>Akteur</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <Td className="whitespace-nowrap text-dim">{formatDateTime(event.createdAt)}</Td>
                  <Td>
                    <span
                      className="inline-flex items-center gap-1.5 whitespace-nowrap"
                      style={{ color: actionToken(event.action) }}
                    >
                      <span
                        aria-hidden
                        className="size-1.5 flex-none rounded-full"
                        style={{ background: "currentColor" }}
                      />
                      <Code className="border-0 bg-transparent p-0 text-[12px] text-[color:inherit]">
                        {event.action}
                      </Code>
                    </span>
                  </Td>
                  <Td className="break-words">{event.actor}</Td>
                  <Td className="break-words text-dim">{event.detail ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
