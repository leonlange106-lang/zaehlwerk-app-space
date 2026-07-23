// Geteilter Zustandstyp für Server Actions + `useActionState`. Bewusst KEINE
// "use server"-Datei: die dürfen nur async Funktionen exportieren, nicht den
// Typ oder den Startwert-Konstanten, die Server- UND Client-Code brauchen.

export type ActionState = {
  success: boolean;
  error?: string;
};

export const initialActionState: ActionState = { success: false };
