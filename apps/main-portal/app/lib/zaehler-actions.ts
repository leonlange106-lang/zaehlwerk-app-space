"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import {
  Prisma,
  ablesungCreateSchema,
  ablesungUpdateSchema,
  computeConsumptionStats,
  calculateConsumption,
  prisma,
  projectAnnualConsumption,
  tarifCreateSchema,
  zaehlerCreateSchema,
  zaehlerUpdateSchema,
  type ConsumptionProjection,
} from "@zaehlwerk/database";
import type { EnergyCategoryValue } from "@zaehlwerk/database/shared";
import { assertAppAccess } from "./app-access";
import type { ActionState } from "./action-state";

// Every export of a `"use server"` module is a directly addressable endpoint —
// not just the form actions. `proxy.ts` rejects anonymous callers, but it does
// not authorize, and the `requireAppAccess()` in the Zählwerk layout cannot help
// here either: actions run BEFORE the layout renders and can be POSTed to any
// route. So each export below authorizes itself against the Zählwerk assignment.
const APP_ID = "zaehlwerk";

/** Erste Zod-Fehlermeldung als strukturierte Action-Antwort. */
function invalidInput(error: { issues: ReadonlyArray<{ message: string }> }): ActionState {
  return { success: false, error: error.issues[0]?.message ?? "Ungültige Eingabe." };
}

// Per-request memo. The dashboard reads the meter list twice (directly, and
// again through getConsumptionSummary), which used to run this query — every
// reading of every meter — twice per render.
const queryZaehler = cache(async () =>
  prisma.zaehler.findMany({
    where: { aktiv: true },
    orderBy: { sortIndex: "asc" },
    include: {
      location: true,
      ablesungen: { orderBy: { datum: "asc" } },
    },
  }),
);

export async function listZaehler() {
  await assertAppAccess(APP_ID);
  return queryZaehler();
}

export async function getZaehlerById(id: string) {
  await assertAppAccess(APP_ID);
  return prisma.zaehler.findUnique({
    where: { id },
    include: {
      location: true,
      ablesungen: { orderBy: { datum: "desc" } },
      tarife: { orderBy: { gueltigAb: "desc" } },
    },
  });
}

export async function listLocations() {
  await assertAppAccess(APP_ID);
  return prisma.location.findMany({ orderBy: { name: "asc" } });
}

export async function listRecentAblesungen(limit = 6) {
  await assertAppAccess(APP_ID);
  return prisma.ablesung.findMany({
    orderBy: { datum: "desc" },
    take: limit,
    include: { zaehler: true },
  });
}

export async function getConsumptionSummary() {
  await assertAppAccess(APP_ID);
  const zaehlerList = await queryZaehler();

  return zaehlerList.map((zaehler) => {
    const stats = computeConsumptionStats(calculateConsumption(zaehler.ablesungen));

    return {
      zaehlerId: zaehler.id,
      name: zaehler.name,
      kategorie: zaehler.kategorie,
      einheit: zaehler.einheit,
      farbe: zaehler.farbe,
      icon: zaehler.icon,
      totalConsumption: stats.total,
      avgPerDay: stats.avgPerDay,
      readingCount: zaehler.ablesungen.length,
      hasImplausibleData: stats.hasImplausibleIntervals,
    };
  });
}

export interface ProjectionSummaryEntry {
  zaehlerId: string;
  name: string;
  kategorie: EnergyCategoryValue;
  einheit: string;
  farbe: string;
  projection: ConsumptionProjection;
}

/**
 * Jahres-Hochrechnung je aktivem Zähler (inkl. Tarifkosten), für die
 * Berichte-Übersicht. Lädt Ablesungen + Tarife in einem `findMany`.
 */
export async function getProjectionSummary(): Promise<ProjectionSummaryEntry[]> {
  await assertAppAccess(APP_ID);
  const zaehlerList = await prisma.zaehler.findMany({
    where: { aktiv: true },
    orderBy: [{ kategorie: "asc" }, { sortIndex: "asc" }],
    include: {
      ablesungen: { orderBy: { datum: "asc" } },
      tarife: { orderBy: { gueltigAb: "asc" } },
    },
  });

  return zaehlerList.map((zaehler) => ({
    zaehlerId: zaehler.id,
    name: zaehler.name,
    kategorie: zaehler.kategorie,
    einheit: zaehler.einheit,
    farbe: zaehler.farbe,
    projection: projectAnnualConsumption({
      readings: zaehler.ablesungen,
      kategorie: zaehler.kategorie,
      einheit: zaehler.einheit,
      tarife: zaehler.tarife,
    }),
  }));
}

export async function createZaehlerAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAppAccess(APP_ID);
  const parsed = zaehlerCreateSchema.safeParse({
    name: formData.get("name"),
    kategorie: formData.get("kategorie"),
    einheit: formData.get("einheit"),
    locationId: formData.get("locationId"),
    // Absent field → undefined → the schema's optional default, i.e. "no
    // reminder". An empty string would fail `z.coerce.number()`, so the form's
    // untouched state must not reach it as "".
    ableseIntervallTage: formData.get("ableseIntervallTage") || undefined,
  });

  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    await prisma.zaehler.create({ data: parsed.data });
  } catch (error) {
    console.error("[createZaehlerAction]", error);
    return { success: false, error: "Der Zähler konnte nicht angelegt werden." };
  }

  revalidatePath("/apps/zaehlwerk/zaehler");
  revalidatePath("/apps/zaehlwerk");
  return { success: true };
}

export async function updateZaehlerAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAppAccess(APP_ID);
  const parsed = zaehlerUpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    kategorie: formData.get("kategorie"),
    einheit: formData.get("einheit"),
    locationId: formData.get("locationId"),
    ableseIntervallTage: formData.get("ableseIntervallTage") || undefined,
  });

  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  const { id, ...data } = parsed.data;

  try {
    await prisma.zaehler.update({ where: { id }, data });
  } catch (error) {
    // P2025 = Datensatz nicht gefunden (z. B. Zähler wurde zwischenzeitlich gelöscht).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { success: false, error: "Dieser Zähler existiert nicht mehr." };
    }
    console.error("[updateZaehlerAction]", error);
    return { success: false, error: "Die Änderungen konnten nicht gespeichert werden." };
  }

  revalidatePath(`/apps/zaehlwerk/zaehler/${id}`);
  revalidatePath("/apps/zaehlwerk/zaehler");
  revalidatePath("/apps/zaehlwerk");
  return { success: true };
}

/** Löscht einen Zähler samt Ablesungen und Tarifen (Cascade). */
export async function deleteZaehlerAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAppAccess(APP_ID);
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Ungültige Eingabe." };
  }

  try {
    await prisma.zaehler.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { success: false, error: "Dieser Zähler existiert nicht mehr." };
    }
    console.error("[deleteZaehlerAction]", error);
    return { success: false, error: "Der Zähler konnte nicht gelöscht werden." };
  }

  revalidatePath("/apps/zaehlwerk/zaehler");
  revalidatePath("/apps/zaehlwerk");
  return { success: true };
}

export async function createTarifAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAppAccess(APP_ID);
  const bisRaw = formData.get("gueltigBis");
  const parsed = tarifCreateSchema.safeParse({
    zaehlerId: formData.get("zaehlerId"),
    anbieter: formData.get("anbieter"),
    produkt: formData.get("produkt"),
    gueltigAb: formData.get("gueltigAb"),
    gueltigBis: bisRaw ? bisRaw : undefined,
    arbeitspreisCtNetto: formData.get("arbeitspreisCtNetto"),
    grundpreisJahrNetto: formData.get("grundpreisJahrNetto") ?? undefined,
    mwstProzent: formData.get("mwstProzent") ?? undefined,
    notiz: formData.get("notiz"),
  });

  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    await prisma.tarif.create({ data: parsed.data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { success: false, error: "Der gewählte Zähler existiert nicht mehr." };
    }
    console.error("[createTarifAction]", error);
    return { success: false, error: "Der Tarif konnte nicht gespeichert werden." };
  }

  revalidatePath(`/apps/zaehlwerk/zaehler/${parsed.data.zaehlerId}`);
  return { success: true };
}

export async function deleteTarifAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAppAccess(APP_ID);
  const id = formData.get("id");
  const zaehlerId = formData.get("zaehlerId");
  if (typeof id !== "string") {
    return { success: false, error: "Ungültige Eingabe." };
  }

  try {
    await prisma.tarif.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { success: false, error: "Dieser Tarif existiert nicht mehr." };
    }
    console.error("[deleteTarifAction]", error);
    return { success: false, error: "Der Tarif konnte nicht gelöscht werden." };
  }

  if (typeof zaehlerId === "string") revalidatePath(`/apps/zaehlwerk/zaehler/${zaehlerId}`);
  return { success: true };
}

export async function createAblesungAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAppAccess(APP_ID);
  const startwertNeuRaw = formData.get("startwertNeu");
  const kostenRaw = formData.get("kosten");
  const notizRaw = formData.get("notiz");

  const parsed = ablesungCreateSchema.safeParse({
    zaehlerId: formData.get("zaehlerId"),
    datum: formData.get("datum"),
    wert: formData.get("wert"),
    kosten: kostenRaw ? kostenRaw : undefined,
    zaehlerGetauscht: formData.get("zaehlerGetauscht") === "on",
    startwertNeu: startwertNeuRaw ? startwertNeuRaw : undefined,
    notiz: notizRaw ? notizRaw : undefined,
  });

  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  try {
    await prisma.ablesung.create({ data: parsed.data });
  } catch (error) {
    // P2003 = Fremdschlüssel verletzt: der referenzierte Zähler existiert nicht.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { success: false, error: "Der gewählte Zähler existiert nicht mehr." };
    }
    console.error("[createAblesungAction]", error);
    return { success: false, error: "Der Zählerstand konnte nicht gespeichert werden." };
  }

  revalidatePath("/apps/zaehlwerk/zaehler");
  revalidatePath(`/apps/zaehlwerk/zaehler/${parsed.data.zaehlerId}`);
  revalidatePath("/apps/zaehlwerk");
  return { success: true };
}

/** Bearbeitet eine bestehende Ablesung. `zaehlerId` dient nur der Revalidierung. */
export async function updateAblesungAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAppAccess(APP_ID);
  const startwertNeuRaw = formData.get("startwertNeu");
  const kostenRaw = formData.get("kosten");
  const notizRaw = formData.get("notiz");
  const zaehlerId = formData.get("zaehlerId");

  const parsed = ablesungUpdateSchema.safeParse({
    id: formData.get("id"),
    datum: formData.get("datum"),
    wert: formData.get("wert"),
    kosten: kostenRaw ? kostenRaw : undefined,
    zaehlerGetauscht: formData.get("zaehlerGetauscht") === "on",
    startwertNeu: startwertNeuRaw ? startwertNeuRaw : undefined,
    notiz: notizRaw ? notizRaw : undefined,
  });

  if (!parsed.success) {
    return invalidInput(parsed.error);
  }

  const { id, ...data } = parsed.data;

  try {
    await prisma.ablesung.update({
      where: { id },
      data: {
        datum: data.datum,
        wert: data.wert,
        kosten: data.kosten ?? null,
        zaehlerGetauscht: data.zaehlerGetauscht,
        startwertNeu: data.startwertNeu ?? null,
        notiz: data.notiz ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { success: false, error: "Diese Ablesung existiert nicht mehr." };
    }
    console.error("[updateAblesungAction]", error);
    return { success: false, error: "Die Ablesung konnte nicht gespeichert werden." };
  }

  if (typeof zaehlerId === "string") revalidatePath(`/apps/zaehlwerk/zaehler/${zaehlerId}`);
  revalidatePath("/apps/zaehlwerk/zaehler");
  revalidatePath("/apps/zaehlwerk");
  return { success: true };
}

/** Löscht eine einzelne Ablesung. `zaehlerId` dient nur der Revalidierung. */
export async function deleteAblesungAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await assertAppAccess(APP_ID);
  const id = formData.get("id");
  const zaehlerId = formData.get("zaehlerId");
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Ungültige Eingabe." };
  }

  try {
    await prisma.ablesung.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { success: false, error: "Diese Ablesung existiert nicht mehr." };
    }
    console.error("[deleteAblesungAction]", error);
    return { success: false, error: "Die Ablesung konnte nicht gelöscht werden." };
  }

  if (typeof zaehlerId === "string") revalidatePath(`/apps/zaehlwerk/zaehler/${zaehlerId}`);
  revalidatePath("/apps/zaehlwerk/zaehler");
  revalidatePath("/apps/zaehlwerk");
  return { success: true };
}
