"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAlertCircle, IconCheck, IconMapPin, IconPencil, IconTrash } from "@tabler/icons-react";
import type { listLocations } from "@/app/lib/zaehler-actions";
import {
  createLocationAction,
  deleteLocationAction,
  updateLocationAction,
} from "@/app/lib/location-actions";
import { initialActionState } from "@/app/lib/action-state";
import { Button } from "@/app/components/ui/Button";
import { Field, TextInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { useToast } from "@/app/components/ui/Toast";
import { Alert, Table, TableScroll, Td, Th } from "@/app/components/ui/primitives";

type LocationList = Awaited<ReturnType<typeof listLocations>>;
type Location = LocationList[number];

export function LocationsCard({ locations }: { locations: LocationList }) {
  const router = useRouter();
  const toast = useToast();
  const [createState, createAction, creating] = useActionState(
    createLocationAction,
    initialActionState,
  );
  const [deletePending, startDelete] = useTransition();
  const createRef = useRef<HTMLFormElement>(null);
  const [editTarget, setEditTarget] = useState<Location | null>(null);

  useEffect(() => {
    if (createState.success) createRef.current?.reset();
  }, [createState.success]);

  function remove(location: Location) {
    if (
      !window.confirm(
        `Standort „${location.name}" löschen? Zugeordnete Zähler behalten ihre Daten und werden auf „kein Standort" gesetzt.`,
      )
    ) {
      return;
    }
    startDelete(async () => {
      const fd = new FormData();
      fd.set("id", location.id);
      const result = await deleteLocationAction(initialActionState, fd);
      toast.show({
        tone: result.success ? "ok" : "risk",
        title: result.success ? "Standort gelöscht" : "Löschen fehlgeschlagen",
        message: result.success ? undefined : (result.error ?? undefined),
      });
      if (result.success) router.refresh();
    });
  }

  return (
    <Panel title="Standorte / Zählergruppen" icon={<IconMapPin size={17} stroke={1.7} />}>
      {locations.length === 0 ? (
        <p className="mb-5 text-sm text-dim">Noch keine Standorte angelegt.</p>
      ) : (
        <TableScroll className="mb-5">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Adresse</Th>
                <Th className="text-right">Aktionen</Th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <tr key={location.id} className="last:[&>td]:border-0">
                  <Td className="font-semibold">{location.name}</Td>
                  <Td className={location.address ? undefined : "text-dim"}>
                    {location.address ?? "—"}
                  </Td>
                  <Td>
                    <span className="flex justify-end gap-1">
                      <Tooltip label="Bearbeiten">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Standort „${location.name}" bearbeiten`}
                          onClick={() => setEditTarget(location)}
                        >
                          <IconPencil size={16} />
                        </Button>
                      </Tooltip>
                      <Tooltip label="Löschen">
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={deletePending}
                          aria-label={`Standort „${location.name}" löschen`}
                          onClick={() => remove(location)}
                        >
                          <IconTrash size={16} />
                        </Button>
                      </Tooltip>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}

      <form action={createAction} ref={createRef} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Neuer Standort" required className="min-w-50 flex-1">
            {({ id }) => (
              <TextInput id={id} name="name" placeholder="z. B. Nebengebäude" required />
            )}
          </Field>
          <Field label="Adresse (optional)" className="min-w-50 flex-1">
            {({ id }) => <TextInput id={id} name="address" placeholder="Straße, Ort" />}
          </Field>
          <Button type="submit" variant="primary" disabled={creating}>
            {creating ? "Wird angelegt…" : "Hinzufügen"}
          </Button>
        </div>
        {createState.error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {createState.error}
          </Alert>
        )}
        {createState.success && (
          <Alert tone="ok" icon={<IconCheck size={16} />}>
            Standort wurde angelegt.
          </Alert>
        )}
      </form>

      <ResponsiveDialog
        opened={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="Standort bearbeiten"
        size="sm"
      >
        {editTarget && (
          <EditLocationForm
            location={editTarget}
            onDone={() => {
              setEditTarget(null);
              router.refresh();
            }}
          />
        )}
      </ResponsiveDialog>
    </Panel>
  );
}

function EditLocationForm({ location, onDone }: { location: Location; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(updateLocationAction, initialActionState);

  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);

  return (
    <form action={formAction} key={location.id} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={location.id} />
      <Field label="Name" required>
        {({ id }) => <TextInput id={id} name="name" defaultValue={location.name} required />}
      </Field>
      <Field label="Adresse (optional)">
        {({ id }) => (
          <TextInput id={id} name="address" defaultValue={location.address ?? ""} />
        )}
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
