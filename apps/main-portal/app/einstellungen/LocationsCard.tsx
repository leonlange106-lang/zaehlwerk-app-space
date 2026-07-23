"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Group,
  Modal,
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
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCheck, IconMapPin, IconPencil, IconTrash } from "@tabler/icons-react";
import type { listLocations } from "../lib/zaehler-actions";
import {
  createLocationAction,
  deleteLocationAction,
  updateLocationAction,
} from "../lib/location-actions";
import { initialActionState } from "../lib/action-state";

type LocationList = Awaited<ReturnType<typeof listLocations>>;
type Location = LocationList[number];

export function LocationsCard({ locations }: { locations: LocationList }) {
  const router = useRouter();
  const [createState, createAction, creating] = useActionState(createLocationAction, initialActionState);
  const [deletePending, startDelete] = useTransition();
  const createRef = useRef<HTMLFormElement>(null);
  const [editTarget, setEditTarget] = useState<Location | null>(null);

  useEffect(() => {
    if (createState.success) createRef.current?.reset();
  }, [createState.success]);

  function remove(location: Location) {
    if (!window.confirm(`Standort „${location.name}" löschen? Zugeordnete Zähler behalten ihre Daten und werden auf „kein Standort" gesetzt.`)) {
      return;
    }
    startDelete(async () => {
      const fd = new FormData();
      fd.set("id", location.id);
      const result = await deleteLocationAction(initialActionState, fd);
      notifications.show({
        color: result.success ? "green" : "red",
        icon: result.success ? <IconCheck size={16} /> : <IconAlertCircle size={16} />,
        message: result.success ? "Standort gelöscht." : result.error ?? "Fehler.",
      });
      if (result.success) router.refresh();
    });
  }

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconMapPin size={18} stroke={1.6} />
        <Title order={4}>Standorte / Zählergruppen</Title>
      </Group>

      {locations.length === 0 ? (
        <Text size="sm" c="dimmed" mb="sm">
          Noch keine Standorte angelegt.
        </Text>
      ) : (
        <Table verticalSpacing="xs" fz="sm" mb="md">
          <TableThead>
            <TableTr>
              <TableTh>Name</TableTh>
              <TableTh>Adresse</TableTh>
              <TableTh />
            </TableTr>
          </TableThead>
          <TableTbody>
            {locations.map((location) => (
              <TableTr key={location.id}>
                <TableTd fw={600}>{location.name}</TableTd>
                <TableTd c={location.address ? undefined : "dimmed"}>{location.address ?? "—"}</TableTd>
                <TableTd>
                  <Group gap={4} wrap="nowrap" justify="flex-end">
                    <Tooltip label="Bearbeiten">
                      <ActionIcon variant="subtle" color="slate" onClick={() => setEditTarget(location)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Löschen">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        loading={deletePending}
                        onClick={() => remove(location)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      )}

      <form action={createAction} ref={createRef}>
        <Group align="flex-end" gap="sm" wrap="wrap">
          <TextInput name="name" label="Neuer Standort" placeholder="z. B. Nebengebäude" required style={{ flex: 1, minWidth: 200 }} />
          <TextInput name="address" label="Adresse (optional)" placeholder="Straße, Ort" style={{ flex: 1, minWidth: 200 }} />
          <Button type="submit" color="slate" loading={creating}>
            Hinzufügen
          </Button>
        </Group>
        {createState.error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light" mt="sm">
            {createState.error}
          </Alert>
        )}
        {createState.success && (
          <Alert color="green" icon={<IconCheck size={16} />} variant="light" mt="sm">
            Standort wurde angelegt.
          </Alert>
        )}
      </form>

      <Modal opened={editTarget !== null} onClose={() => setEditTarget(null)} title="Standort bearbeiten" centered>
        {editTarget && (
          <EditLocationForm
            location={editTarget}
            onDone={() => {
              setEditTarget(null);
              router.refresh();
            }}
          />
        )}
      </Modal>
    </Card>
  );
}

function EditLocationForm({ location, onDone }: { location: Location; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(updateLocationAction, initialActionState);

  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);

  return (
    <form action={formAction} key={location.id}>
      <input type="hidden" name="id" value={location.id} />
      <Stack gap="sm">
        <TextInput name="name" label="Name" defaultValue={location.name} required />
        <TextInput name="address" label="Adresse (optional)" defaultValue={location.address ?? ""} />
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
