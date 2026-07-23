import { z } from "zod";
import { ENERGY_CATEGORIES } from "./categories";

// Gemeinsame Bausteine, damit Create/Update dieselben Regeln teilen.
const nameField = z.string().trim().min(1, "Name ist erforderlich").max(120);
const einheitField = z.string().trim().min(1, "Einheit ist erforderlich").max(20);
// Leerer String aus einem <Select> (kein Standort gewählt) wird zu undefined.
const optionalLocationId = z
  .string()
  .uuid()
  .optional()
  .or(z.literal(""))
  .transform((value) => (value ? value : undefined));
// Zählerstände können groß werden (Gaszähler mit vielen Stellen), aber ein
// harter Deckel fängt Tippfehler/Overflow-Müll ab, bevor er in die DB kommt.
const MAX_METER_VALUE = 1_000_000_000;
const MAX_COST = 10_000_000;

export const zaehlerCreateSchema = z.object({
  name: nameField,
  kategorie: z.enum(ENERGY_CATEGORIES),
  einheit: einheitField,
  locationId: optionalLocationId,
  farbe: z.string().trim().min(1).max(20).optional(),
  icon: z.string().trim().min(1).max(40).optional(),
});

export type ZaehlerCreateInput = z.infer<typeof zaehlerCreateSchema>;

export const zaehlerUpdateSchema = z.object({
  id: z.string().uuid(),
  name: nameField,
  kategorie: z.enum(ENERGY_CATEGORIES),
  einheit: einheitField,
  locationId: optionalLocationId,
});

export type ZaehlerUpdateInput = z.infer<typeof zaehlerUpdateSchema>;

export const ablesungCreateSchema = z
  .object({
    zaehlerId: z.string().uuid(),
    datum: z.coerce.date(),
    wert: z.coerce.number().finite().nonnegative().max(MAX_METER_VALUE),
    kosten: z.coerce.number().finite().nonnegative().max(MAX_COST).optional(),
    zaehlerGetauscht: z.coerce.boolean().optional().default(false),
    startwertNeu: z.coerce.number().finite().nonnegative().max(MAX_METER_VALUE).optional(),
    notiz: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
  })
  // Ein Startwert ohne Zählertausch ist widersprüchlich — lieber früh abweisen
  // als still ignorieren (spiegelt die Validierung in schemas.py der Referenz).
  .refine((data) => data.startwertNeu === undefined || data.zaehlerGetauscht, {
    path: ["startwertNeu"],
    message: "Ein Startwert ist nur bei einem Zählertausch zulässig.",
  })
  // Der Startstand des NEUEN Zählers kann nicht über dem aktuellen Ablesewert
  // liegen — sonst wäre der Intervall-Verbrauch negativ.
  .refine(
    (data) =>
      data.startwertNeu === undefined ||
      !data.zaehlerGetauscht ||
      data.startwertNeu <= data.wert,
    {
      path: ["startwertNeu"],
      message: "Der Startwert des neuen Zählers darf nicht über dem Ablesewert liegen.",
    },
  );

export type AblesungCreateInput = z.infer<typeof ablesungCreateSchema>;

export const locationCreateSchema = z.object({
  name: nameField,
  address: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
});

export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
