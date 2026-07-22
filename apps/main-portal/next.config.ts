import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@zaehlwerk/database", "@zaehlwerk/updater"],
  // Lean, self-contained server bundle for the production Docker image.
  output: "standalone",
};

export default nextConfig;
