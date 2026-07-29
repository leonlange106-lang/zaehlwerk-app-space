"use client";

// Rückfrage zu einer Server Action, die etwas Ungewöhnliches festgestellt hat.
//
// Der Fall, für den das gebaut wurde: ein Zählerstand unter dem letzten. Hart
// ablehnen ginge nicht — rückwirkendes Nachtragen und ein Zählertausch sind
// legitim, und ein Formular, das sie verbietet, erzieht zum Umgehen. Stumm
// speichern ging auch nicht, denn genau so entsteht der Tippfehler, der später
// als Loch im Bericht auftaucht.
//
// Deshalb drei Auswege statt zwei, wie in `POST /api/v1/readings`: den
// legitimen Grund eintragen · bewusst trotzdem speichern · abbrechen.

import type { ReactNode } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "./Button";
import { ResponsiveDialog } from "./ResponsiveDialog";
import type { ActionConfirmation } from "@/app/lib/action-state";

export interface ConfirmActionDialogProps {
  /** Die Rückfrage aus `ActionState.confirm`; `undefined` hält den Dialog zu. */
  confirmation: ActionConfirmation | undefined;
  /** Abbrechen — nichts wurde gespeichert. */
  onCancel: () => void;
  /** Trotzdem speichern: erneut absenden, diesmal mit dem Token. */
  onProceed: () => void;
  /** Beschriftung des Bestätigen-Knopfes. */
  proceedLabel?: string;
  /**
   * Der dritte Weg: der legitime Grund, der den Stand erklärt. Ohne ihn bleibt
   * nur „trotzdem" — und „trotzdem" ist die Antwort, die man gibt, wenn die
   * richtige Möglichkeit fehlt.
   */
  alternative?: { label: string; onSelect: () => void; hint?: ReactNode };
  "data-testid"?: string;
}

export function ConfirmActionDialog({
  confirmation,
  onCancel,
  onProceed,
  proceedLabel = "Trotzdem speichern",
  alternative,
  "data-testid": testId,
}: ConfirmActionDialogProps) {
  return (
    <ResponsiveDialog
      opened={Boolean(confirmation)}
      onClose={onCancel}
      title={confirmation?.title ?? ""}
      size="sm"
      data-testid={testId}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="button" variant="primary" onClick={onProceed}>
            {proceedLabel}
          </Button>
          {alternative && (
            <Button type="button" variant="subtle" onClick={alternative.onSelect}>
              {alternative.label}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
        </div>
      }
    >
      <div className="flex gap-3">
        <IconAlertTriangle size={20} stroke={1.7} className="mt-0.5 shrink-0 text-watch" aria-hidden />
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink">{confirmation?.message}</p>
          {alternative?.hint && <p className="text-sm text-dim">{alternative.hint}</p>}
        </div>
      </div>
    </ResponsiveDialog>
  );
}
