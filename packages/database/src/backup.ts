import { z } from "zod";
import { ENERGY_CATEGORIES } from "./categories";

// Bump when the backup structure changes incompatibly. Restore refuses files
// with a different major version so old/foreign files can't silently corrupt.
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_APP_ID = "zaehlwerk-app-space";

// --- Zeilen-Schemas (spiegeln die Prisma-Modelle; Datumsfelder als ISO-Strings) ---

const isoString = z.string().min(1);

export const locationBackupSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullish(),
  note: z.string().nullish(),
  createdAt: isoString.optional(),
});

export const zaehlerBackupSchema = z.object({
  id: z.string(),
  name: z.string(),
  kategorie: z.enum(ENERGY_CATEGORIES),
  einheit: z.string(),
  farbe: z.string().optional(),
  icon: z.string().optional(),
  aktiv: z.boolean().optional(),
  sortIndex: z.number().int().optional(),
  locationId: z.string().nullish(),
  createdAt: isoString.optional(),
  updatedAt: isoString.optional(),
});

export const ablesungBackupSchema = z.object({
  id: z.string(),
  zaehlerId: z.string(),
  datum: isoString,
  wert: z.number().finite(),
  kosten: z.number().finite().nullish(),
  zaehlerGetauscht: z.boolean().optional(),
  startwertNeu: z.number().finite().nullish(),
  notiz: z.string().nullish(),
  quelle: z.string().optional(),
  istAbgerechnet: z.boolean().optional(),
  createdAt: isoString.optional(),
});

export const tarifBackupSchema = z.object({
  id: z.string(),
  zaehlerId: z.string(),
  anbieter: z.string().nullish(),
  produkt: z.string().nullish(),
  gueltigAb: isoString,
  gueltigBis: isoString.nullish(),
  arbeitspreisCtNetto: z.number().finite(),
  grundpreisJahrNetto: z.number().finite().optional(),
  mwstProzent: z.number().finite().optional(),
  notiz: z.string().nullish(),
  createdAt: isoString.optional(),
});

const backupEnvelope = {
  app: z.literal(BACKUP_APP_ID),
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  generatedAt: isoString,
};

/** Vollbackup der gesamten Instanz. */
export const fullBackupSchema = z.object({
  ...backupEnvelope,
  kind: z.literal("full-backup"),
  data: z.object({
    locations: z.array(locationBackupSchema),
    zaehler: z.array(zaehlerBackupSchema),
    ablesungen: z.array(ablesungBackupSchema),
    tarife: z.array(tarifBackupSchema),
  }),
});
export type FullBackup = z.infer<typeof fullBackupSchema>;

/** Export eines einzelnen Zählers samt Ablesungen, Tarifen und (optional) Standort. */
export const meterExportSchema = z.object({
  ...backupEnvelope,
  kind: z.literal("meter-export"),
  data: z.object({
    zaehler: zaehlerBackupSchema,
    ablesungen: z.array(ablesungBackupSchema),
    tarife: z.array(tarifBackupSchema),
    location: locationBackupSchema.nullish(),
  }),
});
export type MeterExport = z.infer<typeof meterExportSchema>;

export type BackupZaehler = z.infer<typeof zaehlerBackupSchema>;
export type BackupAblesung = z.infer<typeof ablesungBackupSchema>;
export type BackupTarif = z.infer<typeof tarifBackupSchema>;
export type BackupLocation = z.infer<typeof locationBackupSchema>;

/** Menschlich lesbarer Grund, warum eine hochgeladene Datei kein gültiges Backup ist. */
export function describeBackupError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Ungültige Backup-Datei.";
  const path = issue.path.join(".");
  return path ? `Feld „${path}“: ${issue.message}` : issue.message;
}
