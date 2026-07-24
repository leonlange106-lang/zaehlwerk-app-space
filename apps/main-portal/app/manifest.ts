import type { MetadataRoute } from "next";

// Web App Manifest (served at /manifest.webmanifest). Enables "Add to Home
// Screen" / installable-PWA behaviour with the App Space branding. SVG icons
// keep the assets crisp at any size without shipping raster files.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "App Space",
    short_name: "App Space",
    description: "Modulares Multi-App-Portal (Zählwerk, Log Analyzer & mehr).",
    // Relative start/scope so the manifest keeps working when the app is served
    // under a prefix — chiefly the Home Assistant Ingress path, which mounts the
    // add-on at /api/hassio_ingress/<token>/ and would break an absolute "/".
    start_url: ".",
    scope: ".",
    display: "standalone",
    orientation: "portrait-primary",
    // Matches the dark-native canvas, so the splash screen and the installed
    // app's chrome are the same deep slate as the dashboard itself.
    background_color: "#080c14",
    theme_color: "#080c14",
    icons: [
      {
        src: "mark-appspace.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        // `app/apple-icon.tsx` is a generated metadata route; Next serves it at
        // /apple-icon, NOT /apple-icon.png (which this used to point at, and
        // which 404s). Relative, like every other URL in this manifest.
        src: "apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
