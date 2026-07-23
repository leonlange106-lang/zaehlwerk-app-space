"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  ablesungCreateSchema,
  describeBackupError,
  fullBackupSchema,
  meterExportSchema,
  prisma,
  type BackupAblesung,
  type BackupTarif,
  type BackupZaehler,
  type FullBackup,
} from "@zaehlwerk/database";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit";
import { getSessionUser } from "./auth-helpers";

async function currentActor(): Promise<string> {
  const user = await getSessionUser();
  return user?.email ?? "unbekannt";
}

export type BackupResult = { success: boolean; message: string };
export type RestoreMode = "reset" | "merge";

function toDate(value: string | null | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

function locationRow(loc: FullBackup["data"]["locations"][number]) {
  return {
    id: loc.id,
    name: loc.name,
    address: loc.address ?? null,
    note: loc.note ?? null,
    createdAt: toDate(loc.createdAt),
  };
}

function zaehlerRow(z: BackupZaehler) {
  // updatedAt is @updatedAt-managed; let Prisma set it.
  return {
    id: z.id,
    name: z.name,
    kategorie: z.kategorie,
    einheit: z.einheit,
    farbe: z.farbe,
    icon: z.icon,
    aktiv: z.aktiv,
    sortIndex: z.sortIndex,
    locationId: z.locationId ?? null,
    createdAt: toDate(z.createdAt),
  };
}

function ablesungRow(a: BackupAblesung) {
  return {
    id: a.id,
    zaehlerId: a.zaehlerId,
    datum: new Date(a.datum),
    wert: a.wert,
    kosten: a.kosten ?? null,
    zaehlerGetauscht: a.zaehlerGetauscht,
    startwertNeu: a.startwertNeu ?? null,
    notiz: a.notiz ?? null,
    quelle: a.quelle,
    istAbgerechnet: a.istAbgerechnet,
    createdAt: toDate(a.createdAt),
  };
}

function tarifRow(t: BackupTarif) {
  return {
    id: t.id,
    zaehlerId: t.zaehlerId,
    anbieter: t.anbieter ?? null,
    produkt: t.produkt ?? null,
    gueltigAb: new Date(t.gueltigAb),
    gueltigBis: toDate(t.gueltigBis),
    arbeitspreisCtNetto: t.arbeitspreisCtNetto,
    grundpreisJahrNetto: t.grundpreisJahrNetto,
    mwstProzent: t.mwstProzent,
    notiz: t.notiz ?? null,
    createdAt: toDate(t.createdAt),
  };
}

/** Spielt ein Vollbackup ein — entweder alles ersetzen (reset) oder nur Fehlendes ergänzen (merge). */
export async function restoreBackup(jsonText: string, mode: RestoreMode): Promise<BackupResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { success: false, message: "Die Datei ist kein gültiges JSON." };
  }

  const parsed = fullBackupSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, message: `Kein gültiges Vollbackup: ${describeBackupError(parsed.error)}` };
  }
  const { locations, zaehler, ablesungen, tarife } = parsed.data.data;

  try {
    if (mode === "reset") {
      await prisma.$transaction([
        prisma.tarif.deleteMany(),
        prisma.ablesung.deleteMany(),
        prisma.zaehler.deleteMany(),
        prisma.location.deleteMany(),
        prisma.location.createMany({ data: locations.map(locationRow) }),
        prisma.zaehler.createMany({ data: zaehler.map(zaehlerRow) }),
        prisma.ablesung.createMany({ data: ablesungen.map(ablesungRow) }),
        prisma.tarif.createMany({ data: tarife.map(tarifRow) }),
      ]);
    } else {
      const [locIds, zIds, aIds, tIds] = await Promise.all([
        prisma.location.findMany({ select: { id: true } }),
        prisma.zaehler.findMany({ select: { id: true } }),
        prisma.ablesung.findMany({ select: { id: true } }),
        prisma.tarif.findMany({ select: { id: true } }),
      ]);
      const has = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
      const [existLoc, existZ, existA, existT] = [has(locIds), has(zIds), has(aIds), has(tIds)];
      const newLoc = locations.filter((l) => !existLoc.has(l.id)).map(locationRow);
      const newZ = zaehler.filter((z) => !existZ.has(z.id)).map(zaehlerRow);
      const newA = ablesungen.filter((a) => !existA.has(a.id)).map(ablesungRow);
      const newT = tarife.filter((t) => !existT.has(t.id)).map(tarifRow);
      await prisma.$transaction([
        prisma.location.createMany({ data: newLoc }),
        prisma.zaehler.createMany({ data: newZ }),
        prisma.ablesung.createMany({ data: newA }),
        prisma.tarif.createMany({ data: newT }),
      ]);
    }
  } catch (error) {
    console.error("[restoreBackup]", error);
    return { success: false, message: "Das Backup konnte nicht eingespielt werden (Details im Server-Log)." };
  }

  await recordAuditEvent(
    AUDIT_ACTIONS.dataRestore,
    await currentActor(),
    `Modus ${mode}: ${zaehler.length} Zähler, ${ablesungen.length} Ablesungen, ${tarife.length} Tarife`,
  );
  revalidatePath("/", "layout");
  const label = mode === "reset" ? "ersetzt" : "zusammengeführt";
  return {
    success: true,
    message: `Backup ${label}: ${zaehler.length} Zähler, ${ablesungen.length} Ablesungen, ${tarife.length} Tarife.`,
  };
}

export type LocationChoice =
  | { type: "existing"; id: string }
  | { type: "new"; name: string }
  | { type: "none" };

/**
 * Importiert einen einzelnen Zähler samt Ablesungen/Tarifen. IDs werden NEU
 * vergeben (Import = Kopie hinzufügen), damit es keine Kollision mit
 * bestehenden Datensätzen gibt. Der Standort wird gemappt.
 */
export async function importMeter(jsonText: string, choice: LocationChoice): Promise<BackupResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { success: false, message: "Die Datei ist kein gültiges JSON." };
  }

  const parsed = meterExportSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, message: `Kein gültiger Zähler-Export: ${describeBackupError(parsed.error)}` };
  }
  const { zaehler, ablesungen, tarife } = parsed.data.data;

  try {
    let locationId: string | null = null;
    if (choice.type === "existing") {
      const loc = await prisma.location.findUnique({ where: { id: choice.id } });
      if (!loc) return { success: false, message: "Der gewählte Standort existiert nicht mehr." };
      locationId = loc.id;
    } else if (choice.type === "new") {
      const created = await prisma.location.create({ data: { name: choice.name } });
      locationId = created.id;
    }

    const newZaehlerId = randomUUID();
    await prisma.$transaction([
      prisma.zaehler.create({
        data: {
          id: newZaehlerId,
          name: zaehler.name,
          kategorie: zaehler.kategorie,
          einheit: zaehler.einheit,
          farbe: zaehler.farbe,
          icon: zaehler.icon,
          sortIndex: zaehler.sortIndex,
          locationId,
        },
      }),
      prisma.ablesung.createMany({
        data: ablesungen.map((a) => ({
          id: randomUUID(),
          zaehlerId: newZaehlerId,
          datum: new Date(a.datum),
          wert: a.wert,
          kosten: a.kosten ?? null,
          zaehlerGetauscht: a.zaehlerGetauscht,
          startwertNeu: a.startwertNeu ?? null,
          notiz: a.notiz ?? null,
          quelle: a.quelle,
        })),
      }),
      prisma.tarif.createMany({
        data: tarife.map((t) => ({
          id: randomUUID(),
          zaehlerId: newZaehlerId,
          anbieter: t.anbieter ?? null,
          produkt: t.produkt ?? null,
          gueltigAb: new Date(t.gueltigAb),
          gueltigBis: toDate(t.gueltigBis),
          arbeitspreisCtNetto: t.arbeitspreisCtNetto,
          grundpreisJahrNetto: t.grundpreisJahrNetto,
          mwstProzent: t.mwstProzent,
          notiz: t.notiz ?? null,
        })),
      }),
    ]);

    await recordAuditEvent(
      AUDIT_ACTIONS.dataImport,
      await currentActor(),
      `Zähler „${zaehler.name}": ${ablesungen.length} Ablesungen, ${tarife.length} Tarife`,
    );
    revalidatePath("/apps/zaehlwerk/zaehler");
    revalidatePath("/apps/zaehlwerk");
    return {
      success: true,
      message: `Zähler „${zaehler.name}“ importiert: ${ablesungen.length} Ablesungen, ${tarife.length} Tarife.`,
    };
  } catch (error) {
    console.error("[importMeter]", error);
    return { success: false, message: "Der Zähler konnte nicht importiert werden (Details im Server-Log)." };
  }
}

export interface CsvReadingInput {
  datum: string;
  wert: number;
  notiz?: string;
  zaehlerGetauscht?: boolean;
  startwertNeu?: number;
}

/** Importiert historische Zählerstände (aus CSV) in einen bestehenden Zähler. */
export async function importReadings(
  zaehlerId: string,
  readings: CsvReadingInput[],
): Promise<BackupResult> {
  const zaehler = await prisma.zaehler.findUnique({ where: { id: zaehlerId }, select: { id: true } });
  if (!zaehler) return { success: false, message: "Der Zähler existiert nicht mehr." };

  const valid: CsvReadingInput[] = [];
  let skipped = 0;
  for (const reading of readings) {
    const parsed = ablesungCreateSchema.safeParse({
      zaehlerId,
      datum: reading.datum,
      wert: reading.wert,
      zaehlerGetauscht: reading.zaehlerGetauscht ?? false,
      startwertNeu: reading.startwertNeu,
      notiz: reading.notiz,
    });
    if (parsed.success) valid.push(reading);
    else skipped += 1;
  }

  if (valid.length === 0) {
    return { success: false, message: `Keine gültige Zeile gefunden (${skipped} übersprungen).` };
  }

  try {
    await prisma.ablesung.createMany({
      data: valid.map((r) => ({
        zaehlerId,
        datum: new Date(r.datum),
        wert: r.wert,
        zaehlerGetauscht: r.zaehlerGetauscht ?? false,
        startwertNeu: r.startwertNeu ?? null,
        notiz: r.notiz ?? null,
        quelle: "import",
      })),
    });
  } catch (error) {
    console.error("[importReadings]", error);
    return { success: false, message: "Die Ablesungen konnten nicht importiert werden (Details im Server-Log)." };
  }

  await recordAuditEvent(
    AUDIT_ACTIONS.dataImport,
    await currentActor(),
    `${valid.length} Ablesungen (CSV) in Zähler ${zaehlerId}`,
  );
  revalidatePath(`/apps/zaehlwerk/zaehler/${zaehlerId}`);
  revalidatePath("/apps/zaehlwerk");
  const suffix = skipped > 0 ? ` (${skipped} ungültige übersprungen)` : "";
  return { success: true, message: `${valid.length} Ablesungen importiert${suffix}.` };
}
