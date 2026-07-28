import { listAuditEvents } from "@/app/lib/audit";
import { listUsers } from "@/app/lib/user-actions";
import { Panel } from "@/app/components/ui/Panel";
import { Table, Th, Td, TableScroll } from "@/app/components/ui/primitives";
import { IconActivity, IconUsers } from "@tabler/icons-react";
import { USER_ROLE_LABELS } from "@zaehlwerk/database/client";
import type { UserRole } from "@zaehlwerk/database/client";

// Wer hat was wann getan. Bewusst LESEND: Benutzer angelegt und Rollen vergeben
// werden weiterhin unter Plattform-Einstellungen, hier steht nur der Zustand.
//
// Das Audit-Log ist append-only und die einzige Stelle, an der eine Aktion
// nachvollziehbar bleibt, nachdem ihre Wirkung wieder verschwunden ist — die
// Glocke zeigt die Gegenwart, das hier die Vergangenheit.

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export async function AdminActivitySection() {
  const [events, users] = await Promise.all([listAuditEvents(50), listUsers()]);

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Konten" icon={<IconUsers size={17} stroke={1.7} />}>
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>E-Mail</Th>
                <Th>Rolle</Th>
                <Th>Freigegebene Apps</Th>
                <Th>Angelegt</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <Td>{user.email}</Td>
                  <Td>{USER_ROLE_LABELS[user.role as UserRole]}</Td>
                  {/* Ein Admin sieht ohnehin alles — das auszuschreiben ist
                      ehrlicher als eine leere Zelle, die nach "nichts
                      freigegeben" aussieht. */}
                  <Td>
                    {user.role === "ADMIN"
                      ? "alle (Rolle)"
                      : user.allowedApps.length > 0
                        ? user.allowedApps.join(", ")
                        : "keine"}
                  </Td>
                  <Td>{dateFormatter.format(new Date(user.createdAt))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </Panel>

      <Panel
        title="Audit-Log"
        icon={<IconActivity size={17} stroke={1.7} />}
        description="Die letzten 50 Einträge, neueste zuerst."
      >
        {events.length === 0 ? (
          <p className="py-4 text-sm text-dim">Noch keine Einträge.</p>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Zeitpunkt</Th>
                  <Th>Aktion</Th>
                  <Th>Wer</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <Td>{dateFormatter.format(new Date(event.createdAt))}</Td>
                    <Td>
                      <code className="readout text-[12px]">{event.action}</code>
                    </Td>
                    <Td>{event.actor}</Td>
                    <Td>{event.detail ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}
