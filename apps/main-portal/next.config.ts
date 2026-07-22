import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@zaehlwerk/database", "@zaehlwerk/updater"],
  // Lean, self-contained server bundle for the production Docker image.
  output: "standalone",
  // Prisma resolves its query engine binary (e.g.
  // libquery_engine-linux-musl-openssl-3.0.x.so.node) by building the
  // filename at runtime from the detected platform — that's invisible to
  // Next's static file tracer, so the binary silently doesn't make it into
  // `.next/standalone` without this. Documented Prisma+Next.js fix:
  // https://pris.ly/d/engine-not-found-nextjs
  outputFileTracingIncludes: {
    "/**": ["../../packages/database/generated/client/**/*"],
  },
};

export default nextConfig;
