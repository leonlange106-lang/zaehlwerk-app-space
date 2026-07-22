import { z } from "zod";
import { ENERGY_CATEGORIES } from "./categories";

export const zaehlerCreateSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich").max(120),
  kategorie: z.enum(ENERGY_CATEGORIES),
  einheit: z.string().trim().min(1, "Einheit ist erforderlich").max(20),
  locationId: z.string().uuid().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  farbe: z.string().trim().min(1).max(20).optional(),
  icon: z.string().trim().min(1).max(40).optional(),
});

export type ZaehlerCreateInput = z.infer<typeof zaehlerCreateSchema>;

export const ablesungCreateSchema = z.object({
  zaehlerId: z.string().uuid(),
  datum: z.coerce.date(),
  wert: z.coerce.number().finite().nonnegative(),
  kosten: z.coerce.number().finite().nonnegative().optional(),
  zaehlerGetauscht: z.coerce.boolean().optional().default(false),
  startwertNeu: z.coerce.number().finite().nonnegative().optional(),
  notiz: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export type AblesungCreateInput = z.infer<typeof ablesungCreateSchema>;

export const locationCreateSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich").max(120),
  address: z.string().trim().max(200).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
