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

// Bearbeiten einer bestehenden Ablesung. Wie beim Anlegen, aber per `id`
// adressiert und ohne `zaehlerId` (der Zähler wechselt beim Editieren nie).
export const ablesungUpdateSchema = z
  .object({
    id: z.string().uuid(),
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
  .refine((data) => data.startwertNeu === undefined || data.zaehlerGetauscht, {
    path: ["startwertNeu"],
    message: "Ein Startwert ist nur bei einem Zählertausch zulässig.",
  })
  .refine(
    (data) =>
      data.startwertNeu === undefined || !data.zaehlerGetauscht || data.startwertNeu <= data.wert,
    {
      path: ["startwertNeu"],
      message: "Der Startwert des neuen Zählers darf nicht über dem Ablesewert liegen.",
    },
  );

export type AblesungUpdateInput = z.infer<typeof ablesungUpdateSchema>;

// Payload der Smart-Home-/Webhook-API (`POST /api/v1/readings`). Bewusst
// entkoppelt von `ablesungCreateSchema`: externe Geräte sprechen von `meterId`
// und `value`, und `timestamp` ist optional (fehlt es, gilt „jetzt"). So bleibt
// das öffentliche API-Vokabular stabil, auch wenn sich die internen Feldnamen
// ändern.
export const apiReadingCreateSchema = z
  .object({
    meterId: z.string().uuid("meterId muss eine gültige UUID sein."),
    value: z.coerce.number().finite().nonnegative().max(MAX_METER_VALUE),
    // Fehlt der Zeitstempel, setzt die Route „jetzt" ein (siehe Route-Handler).
    timestamp: z.coerce.date().optional(),
    note: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
    zaehlerGetauscht: z.coerce.boolean().optional().default(false),
    startwertNeu: z.coerce.number().finite().nonnegative().max(MAX_METER_VALUE).optional(),
    // Erlaubt es, einen als unplausibel (negativer Verbrauch) erkannten Stand
    // bewusst trotzdem zu speichern — z. B. nach einem echten Zählertausch,
    // den das Gerät nicht kennt.
    allowImplausible: z.coerce.boolean().optional().default(false),
  })
  .refine((data) => data.startwertNeu === undefined || data.zaehlerGetauscht, {
    path: ["startwertNeu"],
    message: "Ein Startwert ist nur bei einem Zählertausch zulässig.",
  })
  .refine(
    (data) =>
      data.startwertNeu === undefined ||
      !data.zaehlerGetauscht ||
      data.startwertNeu <= data.value,
    {
      path: ["startwertNeu"],
      message: "Der Startwert des neuen Zählers darf nicht über dem Ablesewert liegen.",
    },
  );

export type ApiReadingCreateInput = z.infer<typeof apiReadingCreateSchema>;

export const tarifCreateSchema = z
  .object({
    zaehlerId: z.string().uuid(),
    anbieter: z
      .string()
      .trim()
      .max(120)
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
    produkt: z
      .string()
      .trim()
      .max(120)
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
    gueltigAb: z.coerce.date(),
    gueltigBis: z.coerce.date().optional(),
    // Arbeitspreis netto in ct je Abrechnungseinheit; Grundpreis netto €/Jahr.
    arbeitspreisCtNetto: z.coerce.number().finite().nonnegative().max(100_000),
    grundpreisJahrNetto: z.coerce.number().finite().nonnegative().max(100_000).optional().default(0),
    mwstProzent: z.coerce.number().finite().min(0).max(100).optional().default(19),
    notiz: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
  })
  .refine((data) => !data.gueltigBis || data.gueltigBis >= data.gueltigAb, {
    path: ["gueltigBis"],
    message: "„Gültig bis“ darf nicht vor „Gültig ab“ liegen.",
  });

export type TarifCreateInput = z.infer<typeof tarifCreateSchema>;

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

export const locationUpdateSchema = z.object({
  id: z.string().uuid(),
  name: nameField,
  address: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
});

export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
