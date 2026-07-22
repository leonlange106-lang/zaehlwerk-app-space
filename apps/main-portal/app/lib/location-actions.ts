"use server";

import { revalidatePath } from "next/cache";
import { locationCreateSchema, prisma } from "@zaehlwerk/database";
import type { ActionState } from "./zaehler-actions";

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
    return { success: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" };
  }

  await prisma.location.create({ data: parsed.data });

  revalidatePath("/einstellungen");
  revalidatePath("/zaehler");
  return { success: true };
}
