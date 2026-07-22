"use server";

import { revalidatePath } from "next/cache";
import {
  ablesungCreateSchema,
  calculateConsumption,
  prisma,
  sumConsumption,
  zaehlerCreateSchema,
  zaehlerUpdateSchema,
} from "@zaehlwerk/database";

export type ActionState = {
  success: boolean;
  error?: string;
};

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
    const intervals = calculateConsumption(zaehler.ablesungen);
    const latest = intervals.at(-1) ?? null;

    return {
      zaehlerId: zaehler.id,
      name: zaehler.name,
      kategorie: zaehler.kategorie,
      einheit: zaehler.einheit,
      farbe: zaehler.farbe,
      icon: zaehler.icon,
      totalConsumption: sumConsumption(intervals),
      latestInterval: latest,
      readingCount: zaehler.ablesungen.length,
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
    return { success: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" };
  }

  await prisma.zaehler.create({ data: parsed.data });

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
    return { success: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" };
  }

  const { id, ...data } = parsed.data;
  await prisma.zaehler.update({ where: { id }, data });

  revalidatePath(`/zaehler/${id}`);
  revalidatePath("/zaehler");
  revalidatePath("/");
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
    return { success: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" };
  }

  await prisma.ablesung.create({ data: parsed.data });

  revalidatePath("/zaehler");
  revalidatePath("/");
  return { success: true };
}
