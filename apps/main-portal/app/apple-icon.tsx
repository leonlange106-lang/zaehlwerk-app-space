import { ImageResponse } from "next/og";

// Real 180x180 PNG apple-touch-icon, rendered at build time from a satori-safe
// div layout (no external raster tooling). Mirrors the App Space mark — the
// three offset "Aurora-Ebenen" panels — on the accent gradient, matching
// icon.svg and the header chip. Kept in step with public/mark-appspace.svg BY
// HAND: satori takes a div tree, not SVG, so the geometry cannot be imported.
// Change one, change the other.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** One panel of the stack. 64px-space geometry scaled by 180/64 ≈ 2.8125. */
function Plane({ top, left, opacity }: { top: number; left: number; opacity: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        width: 84,
        height: 59,
        borderRadius: 14,
        background: "#ffffff",
        opacity,
      }}
    />
  );
}

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          alignItems: "center",
          justifyContent: "center",
          // The Zählwerk accent — the default app context and the gradient the
          // shell's brand chip carries.
          background: "linear-gradient(135deg, #22d3ee 0%, #4f7cff 100%)",
        }}
      >
        <Plane top={34} left={59} opacity={0.34} />
        <Plane top={59} left={48} opacity={0.62} />
        <Plane top={84} left={37} opacity={1} />
      </div>
    ),
    size,
  );
}
