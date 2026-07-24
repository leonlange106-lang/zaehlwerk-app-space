import { ImageResponse } from "next/og";

// Real 180x180 PNG apple-touch-icon, rendered at build time from a satori-safe
// div layout (no external raster tooling). Mirrors the App Space mark: a white
// central hub with four app satellites, one accented, on the slate tile.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

function Dot({ top, left, color }: { top: number; left: number; color: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        width: 30,
        height: 30,
        borderRadius: 30,
        background: color,
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
          // Industrial slate → deep night, with the accented satellite in the
          // energy cyan the rest of the product uses.
          background: "linear-gradient(135deg, #1f293d 0%, #080c14 100%)",
        }}
      >
        <Dot top={38} left={38} color="#e5e9f0" />
        <Dot top={38} left={112} color="#e5e9f0" />
        <Dot top={112} left={38} color="#e5e9f0" />
        <Dot top={112} left={112} color="#06b6d4" />
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 46,
            background: "#ffffff",
          }}
        />
      </div>
    ),
    size,
  );
}
