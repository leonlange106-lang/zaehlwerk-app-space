// The App Space wordmark, inline rather than an <img src="/logo-appspace.svg">.
//
// A referenced SVG is its own document: it cannot see the page's colour scheme,
// so a baked-in wordmark colour is either invisible on the dark deck or invisible
// in light mode. Inlining it lets the type use `currentColor` and the --zw-*
// tokens, which follow the theme toggle exactly like every other piece of text —
// and lets the tile pick up `--zw-accent`, so the launcher wordmark and the
// header chip always carry the same gradient.

export function BrandLogo({ height = 56 }: { height?: number }) {
  return (
    <svg
      viewBox="0 0 248 64"
      height={height}
      width={(248 / 64) * height}
      role="img"
      aria-label="App Space"
      style={{ maxWidth: "100%" }}
    >
      <defs>
        <linearGradient id="asl-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--zw-accent)" />
          <stop offset="1" stopColor="var(--zw-accent-2)" />
        </linearGradient>
      </defs>
      {/* The tile keeps hard geometry but takes its colour from the app accent,
          so the wordmark on the launcher matches the chip in the header. */}
      <rect width="64" height="64" rx="15" fill="url(#asl-bg)" />
      <rect x="24" y="24" width="16" height="16" rx="5" fill="#ffffff" />
      <rect x="28" y="7" width="8" height="8" rx="2.6" fill="#ffffff" opacity="0.92" />
      <rect x="49" y="28" width="8" height="8" rx="2.6" fill="#ffffff" opacity="0.72" />
      <rect x="28" y="49" width="8" height="8" rx="2.6" fill="#ffffff" opacity="0.92" />
      <rect x="7" y="28" width="8" height="8" rx="2.6" fill="#ffffff" opacity="0.72" />

      <text x="82" y="34" fontSize="26" fontWeight="700" fill="currentColor" letterSpacing="-0.5">
        App
      </text>
      <text x="140" y="34" fontSize="26" fontWeight="400" fill="var(--zw-text-dim)">
        Space
      </text>
      <text
        x="82"
        y="50"
        fontSize="11"
        fontWeight="600"
        letterSpacing="2.5"
        fill="var(--zw-text-dim)"
      >
        MODULARES&#160;PORTAL
      </text>
    </svg>
  );
}
