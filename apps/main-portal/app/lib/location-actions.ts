"use server";

import { revalidatePath } from "next/cache";
import { Prisma, locationCreateSchema, locationUpdateSchema, prisma } from "@zaehlwerk/database";
import type { ActionState } from "./action-state";

export async function createLocationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const addressRaw = formData.get("address");

  const parsed = locationCreateSchema.safeParse({
    name: formData.get("name"),
    address: addressRaw ? addressRaw : undefined,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  try {
    await prisma.location.create({ data: parsed.data });
  } catch (error) {
    console.error("[createLocationAction]", error);
    return { success: false, error: "Der Standort konnte nicht angelegt werden." };
  }

  revalidatePath("/einstellungen");
  revalidatePath("/zaehler");
  return { success: true };
}

export async function updateLocationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const addressRaw = formData.get("address");

  const parsed = locationUpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    address: addressRaw ? addressRaw : undefined,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const { id, ...data } = parsed.data;

  try {
    await prisma.location.update({
      where: { id },
      data: { name: data.name, address: data.address ?? null },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { success: false, error: "Dieser Standort existiert nicht mehr." };
    }
    console.error("[updateLocationAction]", error);
    return { success: false, error: "Der Standort konnte nicht gespeichert werden." };
  }

  revalidatePath("/einstellungen");
  revalidatePath("/zaehler");
  return { success: true };
}

/**
 * Löscht einen Standort. Zähler behalten ihre Daten — ihre Standort-Zuordnung
 * wird durch die optionale Relation automatisch auf „kein Standort" gesetzt.
 */
export async function deleteLocationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, error: "Ungültige Eingabe." };
  }

  try {
    // Zuordnung lösen, damit das Löschen unabhängig von der referenziellen
    // Aktion der DB (SQLite) nie an einem verknüpften Zähler scheitert.
    await prisma.$transaction([
      prisma.zaehler.updateMany({ where: { locationId: id }, data: { locationId: null } }),
      prisma.location.delete({ where: { id } }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { success: false, error: "Dieser Standort existiert nicht mehr." };
    }
    console.error("[deleteLocationAction]", error);
    return { success: false, error: "Der Standort konnte nicht gelöscht werden." };
  }

  revalidatePath("/einstellungen");
  revalidatePath("/zaehler");
  return { success: true };
}
