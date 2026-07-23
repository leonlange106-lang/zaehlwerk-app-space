import { defineConfig } from "vitest/config";

// Pure-logic unit tests for the database package. Everything under test here
// (consumption, projection, tariff, gas, Zod schemas) is Node-only and has no
// Prisma dependency, so a plain node environment is enough.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/consumption.ts",
        "src/projection.ts",
        "src/tariff.ts",
        "src/gas.ts",
        "src/schemas.ts",
        "src/auth.ts",
      ],
      reporter: ["text", "text-summary"],
    },
  },
});
