import type { MetadataRoute } from "next";

// Web App Manifest (served at /manifest.webmanifest). Enables "Add to Home
// Screen" / installable-PWA behaviour with the App Space branding. SVG icons
// keep the assets crisp at any size without shipping raster files.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "App Space",
    short_name: "App Space",
    description: "Modulares Multi-App-Portal (Zählwerk, Log Analyzer & mehr).",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#3c4b5a",
    icons: [
      {
        src: "/mark-appspace.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
