import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Server-logic tests for the portal: crypto/TOTP primitives, API auth, and the
// v1 route handlers (with Prisma + Auth.js mocked). Node environment — none of
// these need a DOM. The `@/` alias mirrors tsconfig's paths so `@/auth` etc.
// resolve the same way they do in the app.
const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir.replace(/[\\/]$/, ""),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "app/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: [
        "app/lib/crypto.ts",
        "app/lib/totp.ts",
        "app/lib/api-auth.ts",
        "app/lib/auth-helpers.ts",
        "app/lib/rate-limit.ts",
        "app/api/v1/**/route.ts",
      ],
      reporter: ["text", "text-summary"],
    },
  },
});
