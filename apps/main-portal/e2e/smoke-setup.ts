import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Fresh database for the production smoke run, kept apart from the regression
// suite's: the two run against different servers, and sharing one file would let
// a half-finished dev run decide whether the production check passes.
export default function smokeSetup() {
  const e2eDir = __dirname;
  const mainPortalDir = path.join(e2eDir, "..");
  const schema = path.join(mainPortalDir, "..", "..", "packages", "database", "prisma", "schema.prisma");
  const dbPath = path.join(e2eDir, ".data", "smoke.db").replace(/\\/g, "/");

  fs.mkdirSync(path.join(e2eDir, ".data"), { recursive: true });
  // Start from nothing. Unlike the regression database this one is not reused,
  // so the cheapest reset is the file itself.
  fs.rmSync(dbPath, { force: true });

  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    AUTH_SECRET: "smoke-secret-do-not-use-in-production-0123456789",
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
