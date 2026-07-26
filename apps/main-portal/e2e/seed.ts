/**
 * E2E fixture seed. Runs against the dedicated E2E database (DATABASE_URL set by
 * the caller) AFTER `prisma db push` has created the schema. Idempotent-ish:
 * wipes the app tables and (re)creates a known admin + one meter with a few
 * readings so the mobile specs have deterministic content to drive.
 */
import bcrypt from "bcryptjs";
import { prisma, EnergyCategory } from "@zaehlwerk/database";
import {
  E2E_ADMIN,
  E2E_RESTRICTED,
  E2E_FIRSTLOGIN_PROJECTS,
  firstLoginEmail,
  E2E_METER_NAME,
} from "./fixtures";

async function main() {
  // Clean slate (order respects FKs).
  await prisma.ablesung.deleteMany();
  await prisma.tarif.deleteMany();
  await prisma.zaehler.deleteMany();
  await prisma.location.deleteMany();
  await prisma.apiToken.deleteMany();
  // The log-analyzer specs upload CSVs and never clean up; the E2E database file
  // is reused between local runs, so without this the stored-log list grows by a
  // dozen rows every run until /apps/log-analyzer/history renders hundreds of
  // cards and the mobile suite times out waiting for it to settle.
  await prisma.logFile.deleteMany();
  await prisma.ingestionKey.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  // Instance settings survive the deletes above, and one of them can lock the
  // whole suite out: with `security.enforceTwoFactor` left on, every page
  // renders the 2FA enrolment gate instead of the app and the seeded admin —
  // who has no second factor — fails every spec. A run that crashes midway
  // through the enforcement spec would poison the reused database permanently,
  // so the reset lives here rather than only in that spec's cleanup.
  await prisma.setting.deleteMany({ where: { key: "security.enforceTwoFactor" } });

  // Same reasoning for the notification bell's inputs and its read markers: a
  // crash in the middle of the notification spec would leave an overdue backup
  // configured, and every later spec that opens the bell would then see an item
  // it did not create. Read markers are keyed by user id, and the seed hands out
  // NEW ids on every run, so stale ones would also accumulate forever.
  await prisma.setting.deleteMany({
    where: {
      OR: [
        { key: { in: ["backup.autoEnabled", "backup.intervalHours", "backup.lastRunAt"] } },
        { key: { startsWith: "notifications.read." } },
      ],
    },
  });

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

  // Temp-password accounts (one per project): passwordless first login → forced
  // password setup. The stored hash is a throwaway; first login skips the check.
  for (const project of E2E_FIRSTLOGIN_PROJECTS) {
    await prisma.user.create({
      data: {
        email: firstLoginEmail(project),
        name: "E2E First Login",
        passwordHash: await bcrypt.hash("temp-unused-secret", 10),
        role: "USER",
        twoFactorEnabled: false,
        mustSetPassword: true,
        allowedApps: "[]",
      },
    });
  }

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

  await reclaimSpace();

  console.log(`[e2e-seed] admin + meter ${meter.id} with ${readings.length} readings ready`);
}

/**
 * Shrink the E2E database file back down after the wipe above.
 *
 * The DELETEs only mark pages free — SQLite never returns them to the
 * filesystem on its own. Because the E2E database file is REUSED between local
 * runs (it can't be replaced while the dev server holds it open, see
 * global-setup.ts), every run would otherwise leave the freed pages behind and
 * the file would creep upwards forever, driven mostly by the raw CSVs the
 * log-analyzer specs upload. VACUUM rewrites it compactly; the WAL checkpoint
 * then truncates the -wal sidecar, which grows the same way.
 *
 * Both statements go through `$queryRawUnsafe`, not `$executeRawUnsafe`:
 * `execute` rejects anything that hands back rows ("Execute returned results,
 * which is not allowed in SQLite"), and both of these do. With `execute` the
 * VACUUM threw on every single run, was swallowed by the catch below, and the
 * file this function exists to shrink grew anyway.
 *
 * Best-effort: a locked database is not a reason to fail the whole suite.
 */
async function reclaimSpace(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe("VACUUM");
    await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (error) {
    console.warn("[e2e-seed] could not reclaim space (continuing):", error);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("[e2e-seed] failed", error);
    await prisma.$disconnect();
    process.exit(1);
  });
