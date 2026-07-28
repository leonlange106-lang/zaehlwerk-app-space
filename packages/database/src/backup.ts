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
  // Nachgereicht, deshalb optional: Backups aus der Zeit davor kennen diese
  // Felder nicht und muessen sich weiterhin einspielen lassen.
  stellen: z.number().int().nullish(),
  ableseIntervallTage: z.number().int().nullish(),
  createdAt: isoString.optional(),
  updatedAt: isoString.optional(),
});

/**
 * Ein Zaehlwerk des Zaehlers.
 *
 * Fehlt es im Backup, faellt ein Zweirichtungszaehler beim Einspielen wieder in
 * EINE Reihe zusammen: Bezug und Einspeisung verschraenkt, jedes zweite
 * Intervall negativ. Die Zahlen sind danach falsch, ohne dass es jemandem
 * auffiele — und der Verlust laesst sich nicht rueckgaengig machen, weil die
 * Zuordnung nirgends sonst mehr steht.
 */
export const meterRegisterBackupSchema = z.object({
  id: z.string(),
  zaehlerId: z.string(),
  obisCode: z.string(),
  richtung: z.enum(["BEZUG", "EINSPEISUNG"]),
  tarif: z.string().nullish(),
  einheit: z.string(),
  label: z.string(),
  sortIndex: z.number().int().optional(),
  createdAt: isoString.optional(),
});

/**
 * Ein Gas-Umrechnungsfaktor.
 *
 * Dieselbe Lehre wie bei den Registern: Was das Backup nicht mittraegt, ist
 * nach einem Restore fort. Ohne die Faktoren rechnete die Anlage wieder mit der
 * festen Annahme von 2021 — oder, seit ZW-02, gar nicht mehr, weil ohne Faktor
 * bewusst KEINE Kostenzahl entsteht. Beides faellt erst auf, wenn jemand die
 * Gasrechnung nachrechnet.
 */
export const umrechnungsfaktorBackupSchema = z.object({
  id: z.string(),
  zaehlerId: z.string(),
  gueltigAb: isoString,
  gueltigBis: isoString.nullish(),
  brennwert: z.number().finite(),
  zustandszahl: z.number().finite(),
  quelle: z.string().nullish(),
  notiz: z.string().nullish(),
  createdAt: isoString.optional(),
});

export const ablesungBackupSchema = z.object({
  id: z.string(),
  zaehlerId: z.string(),
  /** Zugehoeriges Zaehlwerk. `null`/fehlend = Standardregister (Bezug). */
  registerId: z.string().nullish(),
  datum: isoString,
  wert: z.number().finite(),
  kosten: z.number().finite().nullish(),
  zaehlerGetauscht: z.boolean().optional(),
  startwertNeu: z.number().finite().nullish(),
  notiz: z.string().nullish(),
  quelle: z.string().optional(),
  istAbgerechnet: z.boolean().optional(),
  /**
   * Soft-Delete-Stempel.
   *
   * Muss mit ins Backup, und zwar aus beiden Richtungen: Ohne ihn kaeme eine
   * geloeschte Ablesung nach dem Einspielen als vorhandene zurueck und
   * veraenderte still jede Summe — oder, je nach Sichtweise schlimmer, ein
   * Papierkorb waere nach dem Restore leer und der Weg zurueck fort.
   */
  geloeschtAm: isoString.nullish(),
  geloeschtVon: z.string().nullish(),
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
    // Optional, damit aeltere Dateien weiterhin gelten. Fehlt die Liste, hatte
    // die Installation noch keine Register — dann ist nichts zu verlieren.
    register: z.array(meterRegisterBackupSchema).optional(),
    umrechnungsfaktoren: z.array(umrechnungsfaktorBackupSchema).optional(),
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
    register: z.array(meterRegisterBackupSchema).optional(),
    umrechnungsfaktoren: z.array(umrechnungsfaktorBackupSchema).optional(),
    ablesungen: z.array(ablesungBackupSchema),
    tarife: z.array(tarifBackupSchema),
    location: locationBackupSchema.nullish(),
  }),
});
export type MeterExport = z.infer<typeof meterExportSchema>;

export type BackupZaehler = z.infer<typeof zaehlerBackupSchema>;
export type BackupMeterRegister = z.infer<typeof meterRegisterBackupSchema>;
export type BackupUmrechnungsfaktor = z.infer<typeof umrechnungsfaktorBackupSchema>;
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
