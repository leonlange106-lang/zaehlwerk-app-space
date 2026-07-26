"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import {
  IconAlertCircle,
  IconInfoCircle,
  IconDotsVertical,
  IconKey,
  IconTrash,
  IconUserPlus,
  IconUsersGroup,
} from "@tabler/icons-react";
import { USER_ROLE_LABELS, USER_ROLES } from "@zaehlwerk/database/client";
import type { UserRole } from "@zaehlwerk/database/client";
import type { AppUser } from "@/app/lib/user-actions";
import {
  changeRole,
  createUserAction,
  deleteUser,
  resetPassword,
  setUserAppsAction,
} from "@/app/lib/user-actions";
import { initialActionState } from "@/app/lib/action-state";
import { APPS } from "@/app/lib/apps";
import { Badge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { Field, PasswordInput, Select, SelectShell, TextInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import { useToast } from "@/app/components/ui/Toast";
import {
  Alert,
  Checkbox,
  OVERLAY_MOTION,
  Table,
  TableScroll,
  Td,
  Th,
} from "@/app/components/ui/primitives";
import { cn } from "@/app/lib/cn";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const menuPanel =
  "z-50 overflow-hidden rounded-panel border border-line bg-elevated/95 p-1.5 shadow-panel-lg " +
  `backdrop-blur-xl ${OVERLAY_MOTION}`;
const menuItem =
  "flex w-full cursor-pointer select-none items-center gap-2.5 rounded-control px-2.5 text-[13px] " +
  "outline-none min-h-11 sm:min-h-9 transition-colors data-[highlighted]:bg-canvas " +
  "data-[disabled]:cursor-default data-[disabled]:opacity-45";

// Per-user app-assignment control. Admins implicitly have every app, so their
// cell is read-only; regular users get a checklist of the registered apps.
function AppAssignment({
  user,
  disabled,
  onSave,
}: {
  user: AppUser;
  disabled: boolean;
  onSave: (appIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // Seeded from the current assignment; the caller remounts (via `key`) when the
  // saved assignment changes, so no effect is needed to resync.
  const [selected, setSelected] = useState<string[]>(user.allowedApps);

  if (user.role === "ADMIN") {
    return <Badge>Alle (Admin)</Badge>;
  }

  const count = user.allowedApps.length;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant={count === 0 ? "ghost" : "subtle"} size="sm" disabled={disabled}>
          {count === 0 ? "Keine" : `${count} App${count > 1 ? "s" : ""}`}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={cn(menuPanel, "w-64 p-3")}>
          <p className="mb-2 text-xs text-dim">Freigegebene Apps für {user.email}</p>
          <div className="flex flex-col">
            {APPS.map((app) => (
              <Checkbox
                key={app.id}
                label={app.name}
                checked={selected.includes(app.id)}
                onChange={(event) =>
                  setSelected((prev) =>
                    event.currentTarget.checked
                      ? [...prev, app.id]
                      : prev.filter((id) => id !== app.id),
                  )
                }
              />
            ))}
          </div>
          <Button
            variant="primary"
            size="sm"
            full
            className="mt-2"
            onClick={() => {
              onSave(selected);
              setOpen(false);
            }}
          >
            Speichern
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function UserManagementCard({
  users,
  currentUserId,
}: {
  users: AppUser[];
  currentUserId: string;
}) {
  const [createState, createFormAction, creating] = useActionState(
    createUserAction,
    initialActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (createState.success) {
      formRef.current?.reset();
      router.refresh();
      toast.show({ tone: "ok", title: "Benutzer angelegt" });
    }
    // `toast` is stable (memoised in its provider); listing it would re-fire this
    // on every render of the provider's tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createState.success, router]);

  function run(action: () => Promise<{ success: boolean; error?: string }>, okMessage: string) {
    startTransition(async () => {
      const result = await action();
      toast.show({
        tone: result.success ? "ok" : "risk",
        title: result.success ? okMessage : "Fehlgeschlagen",
        message: result.success ? undefined : (result.error ?? undefined),
      });
      if (result.success) router.refresh();
    });
  }

  function submitReset() {
    if (!resetTarget) return;
    const target = resetTarget;
    const password = newPassword;
    run(() => resetPassword(target.id, password), `Passwort für ${target.email} zurückgesetzt`);
    setResetTarget(null);
    setNewPassword("");
  }

  return (
    <Panel title="Benutzer & Rechte" icon={<IconUsersGroup size={17} stroke={1.7} />}>
      <TableScroll className="mb-6">
        <Table>
          <thead>
            <tr>
              <Th>E-Mail</Th>
              <Th>Name</Th>
              <Th>Rolle</Th>
              <Th>Apps</Th>
              <Th>Angelegt</Th>
              <Th className="text-right">Aktionen</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <tr key={user.id} className="last:[&>td]:border-0">
                  <Td className="whitespace-nowrap">
                    {user.email}
                    {isSelf && <Badge className="ml-2">Du</Badge>}
                  </Td>
                  <Td>{user.name ?? "—"}</Td>
                  <Td>
                    <SelectShell>
                      <Select
                        aria-label={`Rolle von ${user.email}`}
                        className="h-9 w-36 text-[13px]"
                        value={user.role}
                        disabled={isPending}
                        onChange={(event) => {
                          const value = event.currentTarget.value as UserRole;
                          if (value !== user.role) {
                            run(() => changeRole(user.id, value), "Rolle geändert");
                          }
                        }}
                      >
                        {USER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {USER_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </Select>
                    </SelectShell>
                  </Td>
                  <Td>
                    <AppAssignment
                      key={`${user.id}:${user.allowedApps.join(",")}`}
                      user={user}
                      disabled={isPending}
                      onSave={(appIds) =>
                        run(() => setUserAppsAction(user.id, appIds), "App-Freigaben gespeichert")
                      }
                    />
                  </Td>
                  <Td className="whitespace-nowrap text-dim">
                    {dateFormatter.format(user.createdAt)}
                  </Td>
                  <Td>
                    <span className="flex justify-end">
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Aktionen für ${user.email}`}
                          >
                            <IconDotsVertical size={16} />
                          </Button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            align="end"
                            sideOffset={6}
                            className={cn(menuPanel, "w-56")}
                          >
                            <DropdownMenu.Item
                              className={menuItem}
                              onSelect={() => {
                                setResetTarget(user);
                                setNewPassword("");
                              }}
                            >
                              <IconKey size={15} className="flex-none" />
                              Passwort zurücksetzen
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className={cn(menuItem, "text-risk")}
                              disabled={isSelf}
                              onSelect={() => {
                                if (window.confirm(`Benutzer ${user.email} wirklich löschen?`)) {
                                  run(() => deleteUser(user.id), "Benutzer gelöscht");
                                }
                              }}
                            >
                              <IconTrash size={15} className="flex-none" />
                              Löschen
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>

      <h3 className="mb-1 text-[13px] font-semibold">Neuen Benutzer anlegen</h3>
      <p className="mb-2 text-xs text-dim">
        Kein Passwort nötig: Der Account wird mit einem Temp-Passwort angelegt. Beim ersten Login
        (nur mit E-Mail) vergibt der Benutzer selbst ein Passwort, bevor er die App nutzen kann.
      </p>
      {/* Der haeufigste Stolperstein beim Einladen, und er sieht nicht wie ein
          Zugangsproblem aus: ueber die LAN-Adresse warnt der Browser vor dem
          Zertifikat, und in einem iframe laedt gar nichts, ohne dass etwas
          dasteht. Ueber die oeffentliche Adresse gibt es das Problem nicht —
          deshalb steht hier, welche Adresse man weitergibt, nicht nur dass es
          eine Huerde gibt. */}
      <Alert icon={<IconInfoCircle size={16} />} className="mb-4">
        <strong className="text-ink">Welche Adresse du weitergibst, macht einen Unterschied.</strong>{" "}
        Über die öffentliche Adresse (Cloudflare) ist nichts weiter nötig — das Zertifikat ist
        überall gültig. Wer die App über die lokale Adresse im Heimnetz aufruft, muss dagegen
        einmalig das Zertifikat der Instanz installieren, sonst warnt der Browser bei jedem Aufruf
        und die Installation als App wird verweigert. Die Datei liegt unter{" "}
        <code className="readout">/caddy-root.crt</code> auf der lokalen Adresse.
      </Alert>
      <form action={createFormAction} ref={formRef} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="E-Mail" required>
            {({ id }) => (
              <TextInput
                id={id}
                name="email"
                type="email"
                placeholder="user@example.com"
                required
              />
            )}
          </Field>
          <Field label="Name (optional)">
            {({ id }) => <TextInput id={id} name="name" placeholder="Vor- und Nachname" />}
          </Field>
        </div>
        <Field label="Rolle" required className="sm:max-w-xs">
          {({ id }) => (
            <SelectShell>
              <Select id={id} name="role" defaultValue="USER" required>
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {USER_ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </SelectShell>
          )}
        </Field>

        {createState.error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {createState.error}
          </Alert>
        )}

        <Button type="submit" variant="primary" className="w-fit" disabled={creating}>
          <IconUserPlus size={16} />
          {creating ? "Wird angelegt…" : "Benutzer anlegen"}
        </Button>
      </form>

      <ResponsiveDialog
        opened={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title="Passwort zurücksetzen"
        size="sm"
        footer={
          <>
            <Button type="button" onClick={() => setResetTarget(null)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={submitReset}
              disabled={newPassword.length < 8}
            >
              Zurücksetzen
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Neues Passwort für <strong className="text-ink">{resetTarget?.email}</strong> festlegen.
          </p>
          <Field label="Neues Passwort" description="Mind. 8 Zeichen">
            {({ id, describedBy }) => (
              <PasswordInput
                id={id}
                aria-describedby={describedBy}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
                autoFocus
              />
            )}
          </Field>
        </div>
      </ResponsiveDialog>
    </Panel>
  );
}
