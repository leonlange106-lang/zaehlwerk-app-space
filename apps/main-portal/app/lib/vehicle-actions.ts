"use server";

import { revalidatePath } from "next/cache";
import { vehicleInputSchema } from "@zaehlwerk/database";
import { assertAppAccess } from "./app-access";
import type { ActionState } from "./action-state";
import {
  createVehicle,
  deleteVehicle,
  listVehicles,
  setActiveVehicle,
  updateVehicle,
  type StoredVehicle,
  type VehicleInput,
} from "./vehicle-repository";
import { coerceSpec } from "@/app/apps/log-analyzer/lib/spec-store";
import { coerceDynoProfile } from "@/app/apps/log-analyzer/lib/dyno-store";
import { parseLimitOverrides } from "@/app/apps/log-analyzer/lib/limit-overrides";

// Server Actions for the vehicle entity.
//
// Every one of them calls `assertAppAccess("log-analyzer")` first. A "use server"
// export is a directly addressable endpoint that can be POSTed to from any
// route, and Next runs the action BEFORE rendering the layout whose guard would
// have redirected — so the guard has to be in the action, exactly as the other
// app-scoped action files do it.

const APP_ID = "log-analyzer";

/**
 * Validate the shape with Zod, then hand the interesting parts to the same
 * coercers the client uses.
 *
 * Zod checks that a name is present and the origin is one of three words; it is
 * the coercers that know an EGT ceiling of 95 000 is not a limit and a NaN mass
 * is not a mass. Trusting the client for either would put both into the
 * evaluation engine, which is the one place a bad number does silent damage.
 */
function toInput(raw: unknown): VehicleInput {
  const parsed = vehicleInputSchema.parse(raw);
  return {
    name: parsed.name,
    spec: coerceSpec(parsed.spec),
    limitOverrides: parseLimitOverrides(JSON.stringify(parsed.limitOverrides ?? {})),
    dynoProfile: parsed.dynoProfile ? coerceDynoProfile(parsed.dynoProfile) : null,
    profileOrigin: parsed.profileOrigin,
  };
}

function revalidate() {
  revalidatePath("/apps/log-analyzer");
  revalidatePath("/apps/log-analyzer/specs");
  revalidatePath("/apps/log-analyzer/dyno");
}

export async function listVehiclesAction(): Promise<StoredVehicle[]> {
  await assertAppAccess(APP_ID);
  return listVehicles();
}

export async function createVehicleAction(
  raw: unknown,
): Promise<ActionState & { vehicle?: StoredVehicle }> {
  await assertAppAccess(APP_ID);
  try {
    const vehicle = await createVehicle(toInput(raw));
    revalidate();
    return { success: true, vehicle };
  } catch (error) {
    console.error("[createVehicleAction]", error);
    return { success: false, error: messageFor(error, "Fahrzeug konnte nicht angelegt werden.") };
  }
}

export async function updateVehicleAction(
  id: string,
  raw: unknown,
): Promise<ActionState & { vehicle?: StoredVehicle }> {
  await assertAppAccess(APP_ID);
  try {
    const vehicle = await updateVehicle(id, toInput(raw));
    revalidate();
    return { success: true, vehicle };
  } catch (error) {
    console.error("[updateVehicleAction]", error);
    return { success: false, error: messageFor(error, "Fahrzeug konnte nicht gespeichert werden.") };
  }
}

export async function setActiveVehicleAction(id: string): Promise<ActionState> {
  await assertAppAccess(APP_ID);
  try {
    await setActiveVehicle(id);
    revalidate();
    return { success: true };
  } catch (error) {
    console.error("[setActiveVehicleAction]", error);
    return { success: false, error: "Fahrzeug konnte nicht aktiviert werden." };
  }
}

export async function deleteVehicleAction(id: string): Promise<ActionState> {
  await assertAppAccess(APP_ID);
  try {
    await deleteVehicle(id);
    revalidate();
    return { success: true };
  } catch (error) {
    console.error("[deleteVehicleAction]", error);
    return { success: false, error: "Fahrzeug konnte nicht gelöscht werden." };
  }
}

function messageFor(error: unknown, fallback: string): string {
  // A Zod message names the field the person just filled in; anything else is a
  // database or programming failure and gets the generic sentence. Matched
  // structurally rather than with `instanceof`: the app and the database package
  // can resolve to different copies of zod, and `instanceof` across two copies
  // is quietly false — which would turn every validation message into "unknown
  // error".
  const issues = (error as { issues?: { message?: string }[] } | null)?.issues;
  if (Array.isArray(issues)) return issues[0]?.message ?? fallback;
  return fallback;
}
