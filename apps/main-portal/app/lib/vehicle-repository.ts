import { prisma } from "@zaehlwerk/database";
import {
  parseLimitOverrides,
  serializeLimitOverrides,
  type LimitOverrides,
} from "@/app/apps/log-analyzer/lib/limit-overrides";
import { coerceSpec } from "@/app/apps/log-analyzer/lib/spec-store";
import { coerceDynoProfile } from "@/app/apps/log-analyzer/lib/dyno-store";
import type { VehicleSpec } from "@/app/apps/log-analyzer/lib/vehicle-spec";
import type { DynoProfile } from "@/app/apps/log-analyzer/lib/dyno-spec";

// Server-side storage for named vehicles — the replacement for the two global
// localStorage profiles.
//
// Both stores kept exactly ONE profile in the browser, so logging two cars meant
// overwriting yourself, and a report was not reproducible: the profile it was
// judged against could since have become a different one. A vehicle is a record
// now, and a log points at the vehicle it was scored with.
//
// The row's JSON columns are read back through the SAME coercers the
// localStorage stores used (`coerceSpec`, `coerceDynoProfile`). That is
// deliberate reuse rather than a shortcut: those functions already encode which
// values are acceptable, and a second, drifting copy of that knowledge on the
// server is how a NaN mass reaches the physics.

export interface StoredVehicle {
  id: string;
  name: string;
  active: boolean;
  spec: VehicleSpec;
  limitOverrides: LimitOverrides;
  /** Null when none has been set — the dyno then derives from the platform. */
  dynoProfile: DynoProfile | null;
  profileOrigin: "own" | "preset" | "imported";
  createdAt: string;
}

type VehicleRow = {
  id: string;
  name: string;
  active: boolean;
  brand: string | null;
  series: string | null;
  vehicleModel: string | null;
  engineCode: string;
  transmission: string;
  catType: string;
  fuel: string;
  turbo: string;
  hpfp: string;
  stage: string;
  limitOverrides: string;
  dynoProfile: string | null;
  profileOrigin: string;
  createdAt: Date;
};

function toStored(row: VehicleRow): StoredVehicle {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    // The column names mirror VehicleSpec except for `vehicleModel`, which had
    // to be renamed: `model` is a reserved-ish word in enough tooling to be not
    // worth the argument, and Prisma's own `model` keyword sits right there.
    spec: coerceSpec({
      brand: row.brand,
      series: row.series,
      model: row.vehicleModel,
      engineCode: row.engineCode,
      transmission: row.transmission,
      catType: row.catType,
      fuel: row.fuel,
      turbo: row.turbo,
      hpfp: row.hpfp,
      stage: row.stage,
    }),
    limitOverrides: parseLimitOverrides(row.limitOverrides),
    dynoProfile: row.dynoProfile ? coerceDynoProfile(safeParse(row.dynoProfile)) : null,
    profileOrigin:
      row.profileOrigin === "preset" || row.profileOrigin === "imported"
        ? row.profileOrigin
        : "own",
    createdAt: row.createdAt.toISOString(),
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listVehicles(): Promise<StoredVehicle[]> {
  const rows = await prisma.vehicle.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  return rows.map(toStored);
}

export async function getVehicle(id: string): Promise<StoredVehicle | null> {
  const row = await prisma.vehicle.findUnique({ where: { id } });
  return row ? toStored(row) : null;
}

/** The vehicle new evaluations are scored against, or null when none exists. */
export async function getActiveVehicle(): Promise<StoredVehicle | null> {
  const row = await prisma.vehicle.findFirst({ where: { active: true } });
  return row ? toStored(row) : null;
}

export interface VehicleInput {
  name: string;
  spec: VehicleSpec;
  limitOverrides?: LimitOverrides;
  dynoProfile?: DynoProfile | null;
  profileOrigin?: StoredVehicle["profileOrigin"];
}

function toColumns(input: VehicleInput) {
  return {
    name: input.name.trim().slice(0, 120) || "Unbenanntes Fahrzeug",
    brand: input.spec.brand,
    series: input.spec.series,
    vehicleModel: input.spec.model,
    engineCode: input.spec.engineCode,
    transmission: input.spec.transmission,
    catType: input.spec.catType,
    fuel: input.spec.fuel,
    turbo: input.spec.turbo,
    hpfp: input.spec.hpfp,
    stage: input.spec.stage,
    limitOverrides: serializeLimitOverrides(input.limitOverrides ?? {}),
    dynoProfile: input.dynoProfile ? JSON.stringify(input.dynoProfile) : null,
    profileOrigin: input.profileOrigin ?? "own",
  };
}

/** Create a vehicle; the first one ever created becomes the active one. */
export async function createVehicle(input: VehicleInput): Promise<StoredVehicle> {
  const count = await prisma.vehicle.count();
  const row = await prisma.vehicle.create({
    data: { ...toColumns(input), active: count === 0 },
  });
  return toStored(row);
}

export async function updateVehicle(id: string, input: VehicleInput): Promise<StoredVehicle> {
  const row = await prisma.vehicle.update({ where: { id }, data: toColumns(input) });
  return toStored(row);
}

/**
 * Make one vehicle active.
 *
 * Two writes in a transaction, because "exactly one is active" is the invariant
 * the whole feature rests on: with two active rows `getActiveVehicle()` returns
 * whichever the database felt like, and logs would be judged against a profile
 * nobody selected.
 */
export async function setActiveVehicle(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.vehicle.updateMany({ where: { active: true }, data: { active: false } }),
    prisma.vehicle.update({ where: { id }, data: { active: true } }),
  ]);
}

/**
 * Delete a vehicle.
 *
 * Its logs are NOT deleted — `onDelete: SetNull` unlinks them. A log is
 * evidence of a drive that happened; removing a profile must not destroy it.
 * If the active vehicle goes, the next one takes over so the instance never
 * ends up with vehicles but no active one.
 */
export async function deleteVehicle(id: string): Promise<void> {
  const removed = await prisma.vehicle.findUnique({ where: { id }, select: { active: true } });
  await prisma.vehicle.delete({ where: { id } });
  if (!removed?.active) return;

  const next = await prisma.vehicle.findFirst({ orderBy: { createdAt: "asc" } });
  if (next) await prisma.vehicle.update({ where: { id: next.id }, data: { active: true } });
}
