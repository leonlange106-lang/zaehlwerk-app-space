"use server";

import { revalidatePath } from "next/cache";
import {
  Prisma,
  ablesungCreateSchema,
  computeConsumptionStats,
  calculateConsumption,
  prisma,
  tarifCreateSchema,
  zaehlerCreateSchema,
  zaehlerUpdateSchema,
} from "@zaehlwerk/database";
import type { ActionState } from "./action-state";

/** Erste Zod-Fehlermeldung als strukturierte Action-Antwort. */
function invalidInput(error: { issues: ReadonlyArray<{ message: string }> }): ActionState {
  return { success: false, error: error.issues[0]?.message ?? "Ungültige Eingabe." };
}

export async function listZaehler() {
  return prisma.zaehler.findMany({
    where: { aktiv: true },
    orderBy: { sortIndex: "asc" },
    include: {
      location: true,
      ablesungen: { orderBy: { datum: "asc" } },
    },
  });
}

export async function getZaehlerById(id: string) {
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
  return prisma.location.findMany({ orderBy: { name: "asc" } });
}

export async function listRecentAblesungen(limit = 6) {
  return prisma.ablesung.findMany({
    orderBy: { datum: "desc" },
    take: limit,
    include: { zaehler: true },
  });
}

export async function getConsumptionSummary() {
  const zaehlerList = await listZaehler();

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

export async function createZaehlerAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = zaehlerCreateSchema.safeParse({
    name: formData.get("name"),
    kategorie: formData.get("kategorie"),
    einheit: formData.get("einheit"),
    locationId: formData.get("locationId"),
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

  revalidatePath("/zaehler");
  revalidatePath("/");
  return { success: true };
}

export async function updateZaehlerAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = zaehlerUpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    kategorie: formData.get("kategorie"),
    einheit: formData.get("einheit"),
    locationId: formData.get("locationId"),
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

  revalidatePath(`/zaehler/${id}`);
  revalidatePath("/zaehler");
  revalidatePath("/");
  return { success: true };
}

export async function createTarifAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
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

  revalidatePath(`/zaehler/${parsed.data.zaehlerId}`);
  return { success: true };
}

export async function deleteTarifAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
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

  if (typeof zaehlerId === "string") revalidatePath(`/zaehler/${zaehlerId}`);
  return { success: true };
}

export async function createAblesungAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
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

  revalidatePath("/zaehler");
  revalidatePath("/");
  return { success: true };
}
