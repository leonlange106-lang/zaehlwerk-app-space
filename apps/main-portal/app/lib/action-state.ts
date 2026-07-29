// Geteilter Zustandstyp für Server Actions + `useActionState`. Bewusst KEINE
// "use server"-Datei: die dürfen nur async Funktionen exportieren, nicht den
// Typ oder den Startwert-Konstanten, die Server- UND Client-Code brauchen.

/**
 * Rückfrage statt Ablehnung.
 *
 * Eine Server Action, die etwas Ungewöhnliches feststellt, hat nur zwei
 * schlechte Möglichkeiten: stumm schreiben oder hart ablehnen. Rückwirkendes
 * Nachtragen und ein Zählertausch sind legitim — ein Formular, das sie
 * verbietet, erzieht zum Umgehen. Also fragt die Action zurück und gibt dem
 * Aufrufer mit, was sie gesehen hat.
 *
 * `token` ist der Name des FormData-Feldes, das beim erneuten Absenden auf
 * `"on"` gesetzt wird, um die Rückfrage zu übergehen. Er kommt aus der Action,
 * damit die Oberfläche ihn nicht raten muss.
 */
export type ActionConfirmation = {
  token: string;
  title: string;
  message: string;
};

export type ActionState = {
  success: boolean;
  error?: string;
  /** Gesetzt, wenn die Action eine bewusste Bestätigung braucht. */
  confirm?: ActionConfirmation;
};

export const initialActionState: ActionState = { success: false };
