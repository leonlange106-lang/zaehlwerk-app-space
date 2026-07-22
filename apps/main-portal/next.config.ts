import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @zaehlwerk/database and @zaehlwerk/updater ship compiled CJS (see their
  // "build" scripts) specifically so they DON'T need transpilePackages.
  // transpilePackages would pull the Prisma-generated client into Next's own
  // server bundle, which breaks Prisma's __dirname-relative lookup of its
  // native query engine binary at runtime (it ends up searching relative to
  // a .next/server/chunks/*.js file instead of its real directory) —
  // see https://pris.ly/d/engine-not-found-nextjs and PR history on this repo.
  // Lean, self-contained server bundle for the production Docker image.
  output: "standalone",
  // Belt-and-suspenders: the native engine binary isn't a static import, so
  // Next's file tracer can miss it when copying `.next/standalone` even when
  // the module itself is left external. Documented Prisma+Next.js fix:
  // https://pris.ly/d/engine-not-found-nextjs
  outputFileTracingIncludes: {
    "/**": ["../../packages/database/generated/client/**/*"],
  },
};

export default nextConfig;
