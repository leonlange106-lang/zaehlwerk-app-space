/**
 * E2E fixture seed. Runs against the dedicated E2E database (DATABASE_URL set by
 * the caller) AFTER `prisma db push` has created the schema. Idempotent-ish:
 * wipes the app tables and (re)creates a known admin + one meter with a few
 * readings so the mobile specs have deterministic content to drive.
 */
import bcrypt from "bcryptjs";
import { prisma, EnergyCategory } from "@zaehlwerk/database";
import { E2E_ADMIN, E2E_RESTRICTED, E2E_METER_NAME } from "./fixtures";

async function main() {
  // Clean slate (order respects FKs).
  await prisma.ablesung.deleteMany();
  await prisma.tarif.deleteMany();
  await prisma.zaehler.deleteMany();
  await prisma.location.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({
    data: {
      email: E2E_ADMIN.email,
      name: "E2E Admin",
      passwordHash: await bcrypt.hash(E2E_ADMIN.password, 10),
      role: "ADMIN",
      twoFactorEnabled: false,
      // Admins implicitly see all apps; the value is set explicitly anyway.
      allowedApps: JSON.stringify(["zaehlwerk", "log-analyzer"]),
    },
  });

  // Regular user with NO apps assigned (default) → gated out of every app.
  await prisma.user.create({
    data: {
      email: E2E_RESTRICTED.email,
      name: "E2E Restricted",
      passwordHash: await bcrypt.hash(E2E_RESTRICTED.password, 10),
      role: "USER",
      twoFactorEnabled: false,
      allowedApps: "[]",
    },
  });

  const location = await prisma.location.create({
    data: { name: "E2E Standort", address: "Teststraße 1" },
  });

  const meter = await prisma.zaehler.create({
    data: {
      name: E2E_METER_NAME,
      kategorie: EnergyCategory.STROM,
      einheit: "kWh",
      farbe: "#f0b429",
      icon: "bolt",
      locationId: location.id,
    },
  });

  const now = new Date();
  const readings = [0, 1, 2, 3].map((i) => ({
    zaehlerId: meter.id,
    datum: new Date(now.getFullYear(), now.getMonth() - (3 - i), 1),
    wert: 1000 + i * 120,
    quelle: "manual",
  }));
  await prisma.ablesung.createMany({ data: readings });

  console.log(`[e2e-seed] admin + meter ${meter.id} with ${readings.length} readings ready`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("[e2e-seed] failed", error);
    await prisma.$disconnect();
    process.exit(1);
  });
