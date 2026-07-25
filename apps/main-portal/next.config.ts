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
  //
  // @react-pdf/renderer for the same reason: it ships its own reconciler,
  // fontkit and bundled AFM font data that webpack mangles when inlined —
  // keeping it external lets it require its assets normally at runtime.
  serverExternalPackages: ["@zaehlwerk/database", "@react-pdf/renderer"],
  // Lean, self-contained server bundle for the production Docker image.
  output: "standalone",
  // Belt-and-suspenders: the native engine binary isn't a static import, so
  // Next's file tracer can miss it when copying `.next/standalone` even when
  // the module itself is left external.
  outputFileTracingIncludes: {
    "/**": ["../../packages/database/generated/client/**/*"],
  },
  // Phase 7 App-Space restructure: the Zählwerk app moved under /apps/zaehlwerk
  // and settings split into platform (/settings) vs app settings. Keep old
  // bookmarks and links working.
  async redirects() {
    return [
      { source: "/zaehler", destination: "/apps/zaehlwerk/zaehler", permanent: true },
      { source: "/zaehler/:path*", destination: "/apps/zaehlwerk/zaehler/:path*", permanent: true },
      { source: "/berichte", destination: "/apps/zaehlwerk/berichte", permanent: true },
      { source: "/einstellungen", destination: "/settings", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        // Baseline security headers on every response. Values are chosen to be
        // safe for a self-hosted, same-origin dashboard.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // The JSON API is same-origin only; there is no cross-origin browser
        // client, so we do NOT emit a permissive Access-Control-Allow-Origin.
        // Instead we make caching/framing explicit for API responses.
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Cache-Control", value: "no-store" },
          { key: "Vary", value: "Authorization, Cookie" },
        ],
      },
    ];
  },
};

// Framing policy. By default the dashboard refuses to be embedded anywhere
// (frame-ancestors 'none' + X-Frame-Options: DENY) — the right stance for a
// directly-accessed, same-origin tool. When served as a Home Assistant Ingress
// add-on, HA renders the app inside an iframe under the HA origin, so framing
// must be permitted or the panel stays blank. This is opt-in at BUILD time:
//   HA_INGRESS=true            → allow same-origin framing ('self')
//   FRAME_ANCESTORS="https://ha.local:8123"  → allow a specific ancestor
// FRAME_ANCESTORS (when set) always wins so a non-standard HA origin can be
// named explicitly.
const FRAME_ANCESTORS =
  process.env.FRAME_ANCESTORS?.trim() || (process.env.HA_INGRESS === "true" ? "'self'" : "'none'");
const FRAMING_ALLOWED = FRAME_ANCESTORS !== "'none'";

// Content-Security-Policy: Next's runtime injects inline styles and the
// pre-hydration theme script is inline by necessity, so 'unsafe-inline' is
// required for style-src (and script-src in dev, for hydration). Everything else
// is locked to same-origin.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  `frame-ancestors ${FRAME_ANCESTORS}`,
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "connect-src 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // Defense in depth alongside CSP's frame-ancestors, for older browsers. When
  // framing is permitted (HA Ingress) we drop this legacy header entirely, since
  // it can't express a single allowed ancestor and would otherwise re-block the
  // iframe; CSP frame-ancestors is the authoritative control on modern browsers.
  ...(FRAMING_ALLOWED ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  {
    // Only meaningful over HTTPS; harmless over plain HTTP on a LAN.
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

export default nextConfig;
