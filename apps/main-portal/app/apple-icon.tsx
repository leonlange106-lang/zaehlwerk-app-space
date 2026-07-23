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
          background: "linear-gradient(135deg, #586a7e 0%, #3c4b5a 100%)",
        }}
      >
        <Dot top={38} left={38} color="#e5e9ed" />
        <Dot top={38} left={112} color="#e5e9ed" />
        <Dot top={112} left={38} color="#e5e9ed" />
        <Dot top={112} left={112} color="#20c997" />
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
