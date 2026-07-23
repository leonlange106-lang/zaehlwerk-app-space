"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Menu,
  MenuDropdown,
  MenuItem,
  MenuTarget,
  Modal,
  PasswordInput,
  Popover,
  PopoverDropdown,
  PopoverTarget,
  Select,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconCheck,
  IconDotsVertical,
  IconKey,
  IconTrash,
  IconUserPlus,
  IconUsersGroup,
} from "@tabler/icons-react";
import { USER_ROLE_LABELS, USER_ROLES } from "@zaehlwerk/database/shared";
import type { UserRole } from "@zaehlwerk/database/shared";
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

const dateFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const roleOptions = USER_ROLES.map((role) => ({ value: role, label: USER_ROLE_LABELS[role] }));

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
  const [opened, setOpened] = useState(false);
  // Seeded from the current assignment; the caller remounts (via `key`) when the
  // saved assignment changes, so no effect is needed to resync.
  const [selected, setSelected] = useState<string[]>(user.allowedApps);

  if (user.role === "ADMIN") {
    return (
      <Badge variant="light" color="slate" size="sm">
        Alle (Admin)
      </Badge>
    );
  }

  const count = user.allowedApps.length;
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" withinPortal trapFocus shadow="md">
      <PopoverTarget>
        <Button
          size="compact-xs"
          variant="light"
          color={count === 0 ? "gray" : "slate"}
          disabled={disabled}
          onClick={() => setOpened((o) => !o)}
        >
          {count === 0 ? "Keine" : `${count} App${count > 1 ? "s" : ""}`}
        </Button>
      </PopoverTarget>
      <PopoverDropdown>
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Freigegebene Apps für {user.email}
          </Text>
          {APPS.map((app) => (
            <Checkbox
              key={app.id}
              size="sm"
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
          <Button
            size="xs"
            color="slate"
            onClick={() => {
              onSave(selected);
              setOpened(false);
            }}
          >
            Speichern
          </Button>
        </Stack>
      </PopoverDropdown>
    </Popover>
  );
}

export function UserManagementCard({ users, currentUserId }: { users: AppUser[]; currentUserId: string }) {
  const [createState, createFormAction, creating] = useActionState(createUserAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (createState.success) {
      formRef.current?.reset();
      router.refresh();
      notifications.show({ color: "green", icon: <IconCheck size={16} />, message: "Benutzer angelegt." });
    }
  }, [createState.success, router]);

  function run(action: () => Promise<{ success: boolean; error?: string }>, okMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result.success) {
        notifications.show({ color: "green", icon: <IconCheck size={16} />, message: okMessage });
        router.refresh();
      } else {
        notifications.show({ color: "red", icon: <IconAlertCircle size={16} />, message: result.error ?? "Fehler." });
      }
    });
  }

  function submitReset() {
    if (!resetTarget) return;
    const target = resetTarget;
    const password = newPassword;
    run(() => resetPassword(target.id, password), `Passwort für ${target.email} zurückgesetzt.`);
    setResetTarget(null);
    setNewPassword("");
  }

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconUsersGroup size={18} stroke={1.6} />
        <Title order={4}>Benutzer & Rechte</Title>
      </Group>

      <Table verticalSpacing="xs" fz="sm" mb="md">
        <TableThead>
          <TableTr>
            <TableTh>E-Mail</TableTh>
            <TableTh>Name</TableTh>
            <TableTh>Rolle</TableTh>
            <TableTh>Apps</TableTh>
            <TableTh>Angelegt</TableTh>
            <TableTh />
          </TableTr>
        </TableThead>
        <TableTbody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            return (
              <TableTr key={user.id}>
                <TableTd>
                  {user.email}
                  {isSelf && (
                    <Badge ml="xs" size="xs" variant="light" color="slate">
                      Du
                    </Badge>
                  )}
                </TableTd>
                <TableTd>{user.name ?? "—"}</TableTd>
                <TableTd>
                  <Select
                    size="xs"
                    variant="unstyled"
                    allowDeselect={false}
                    data={roleOptions}
                    value={user.role}
                    disabled={isPending}
                    onChange={(value) => {
                      if (value && value !== user.role) {
                        run(() => changeRole(user.id, value as UserRole), "Rolle geändert.");
                      }
                    }}
                    w={140}
                  />
                </TableTd>
                <TableTd>
                  <AppAssignment
                    key={`${user.id}:${user.allowedApps.join(",")}`}
                    user={user}
                    disabled={isPending}
                    onSave={(appIds) =>
                      run(() => setUserAppsAction(user.id, appIds), "App-Freigaben gespeichert.")
                    }
                  />
                </TableTd>
                <TableTd>{dateFormatter.format(user.createdAt)}</TableTd>
                <TableTd>
                  <Menu position="bottom-end" withinPortal>
                    <MenuTarget>
                      <ActionIcon variant="subtle" color="slate" aria-label="Aktionen">
                        <IconDotsVertical size={16} />
                      </ActionIcon>
                    </MenuTarget>
                    <MenuDropdown>
                      <MenuItem
                        leftSection={<IconKey size={14} />}
                        onClick={() => {
                          setResetTarget(user);
                          setNewPassword("");
                        }}
                      >
                        Passwort zurücksetzen
                      </MenuItem>
                      <MenuItem
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        disabled={isSelf}
                        onClick={() => {
                          if (window.confirm(`Benutzer ${user.email} wirklich löschen?`)) {
                            run(() => deleteUser(user.id), "Benutzer gelöscht.");
                          }
                        }}
                      >
                        Löschen
                      </MenuItem>
                    </MenuDropdown>
                  </Menu>
                </TableTd>
              </TableTr>
            );
          })}
        </TableTbody>
      </Table>

      <Title order={6} mb="xs">
        Neuen Benutzer anlegen
      </Title>
      <form action={createFormAction} ref={formRef}>
        <Stack gap="sm">
          <Group grow align="flex-start">
            <TextInput name="email" label="E-Mail" type="email" placeholder="user@example.com" required />
            <TextInput name="name" label="Name (optional)" placeholder="Vor- und Nachname" />
          </Group>
          <Group grow align="flex-start">
            <PasswordInput name="password" label="Passwort" description="Mind. 8 Zeichen" required />
            <Select
              name="role"
              label="Rolle"
              data={roleOptions}
              defaultValue="USER"
              allowDeselect={false}
              required
            />
          </Group>

          {createState.error && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
              {createState.error}
            </Alert>
          )}

          <Button type="submit" color="slate" leftSection={<IconUserPlus size={16} />} loading={creating} w="fit-content">
            Benutzer anlegen
          </Button>
        </Stack>
      </form>

      <Modal opened={resetTarget !== null} onClose={() => setResetTarget(null)} title="Passwort zurücksetzen" centered>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Neues Passwort für <strong>{resetTarget?.email}</strong> festlegen.
          </Text>
          <PasswordInput
            label="Neues Passwort"
            description="Mind. 8 Zeichen"
            value={newPassword}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setResetTarget(null)}>
              Abbrechen
            </Button>
            <Button color="slate" onClick={submitReset} disabled={newPassword.length < 8}>
              Zurücksetzen
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
