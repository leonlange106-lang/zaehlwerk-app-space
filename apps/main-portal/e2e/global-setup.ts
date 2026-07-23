import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Prepares the dedicated E2E database before the suite: creates the schema
// (prisma db push) and seeds a known admin + meter fixture. Runs once per
// `playwright test` invocation, so `pnpm test:e2e` is fully self-contained.
export default function globalSetup() {
  const e2eDir = __dirname;
  const mainPortalDir = path.join(e2eDir, "..");
  const schema = path.join(mainPortalDir, "..", "..", "packages", "database", "prisma", "schema.prisma");
  const dbPath = path.join(e2eDir, ".data", "e2e.db").replace(/\\/g, "/");

  fs.mkdirSync(path.join(e2eDir, ".data"), { recursive: true });

  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    AUTH_SECRET: "e2e-secret-do-not-use-in-production-0123456789",
  };

  execSync(
    `pnpm --filter @zaehlwerk/database exec prisma db push --schema "${schema}" --skip-generate --accept-data-loss`,
    { env, stdio: "inherit" },
  );
  execSync(`pnpm exec tsx "${path.join(e2eDir, "seed.ts")}"`, {
    env,
    stdio: "inherit",
    cwd: mainPortalDir,
  });
}
