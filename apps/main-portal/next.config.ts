import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @zaehlwerk/database and @zaehlwerk/updater ship compiled CJS (see their
  // "build" scripts) so they don't need transpilePackages — bundling the
  // Prisma-generated client into Next's own server code breaks its
  // __dirname-relative lookup of the native query engine binary (it ends up
  // searching relative to a .next/server/chunks/*.js file instead of its
  // real directory). See https://pris.ly/d/engine-not-found-nextjs.
  //
  // serverExternalPackages is the other half: the App Router bundles every
  // server-side dependency into route chunks by default unless it's opted
  // out here, regardless of transpilePackages.
  serverExternalPackages: ["@zaehlwerk/database"],
  // Lean, self-contained server bundle for the production Docker image.
  output: "standalone",
  // Belt-and-suspenders: the native engine binary isn't a static import, so
  // Next's file tracer can miss it when copying `.next/standalone` even when
  // the module itself is left external.
  outputFileTracingIncludes: {
    "/**": ["../../packages/database/generated/client/**/*"],
  },
};

export default nextConfig;
