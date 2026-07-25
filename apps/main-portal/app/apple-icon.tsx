import { ImageResponse } from "next/og";

// Real 180x180 PNG apple-touch-icon, rendered at build time from a satori-safe
// div layout (no external raster tooling). Mirrors the App Space mark — a white
// hub with four satellites — on the accent gradient, matching icon.svg and the
// header chip. Kept in step with public/mark-appspace.svg by hand: satori takes
// a div tree, not SVG, so the geometry cannot simply be imported.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

function Satellite({ top, left, opacity }: { top: number; left: number; opacity: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        width: 28,
        height: 28,
        borderRadius: 9,
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
        <Satellite top={18} left={76} opacity={0.92} />
        <Satellite top={76} left={134} opacity={0.72} />
        <Satellite top={134} left={76} opacity={0.92} />
        <Satellite top={76} left={18} opacity={0.72} />
        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: 16,
            background: "#ffffff",
          }}
        />
      </div>
    ),
    size,
  );
}
