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
      {/* Aurora-Ebenen — the same three offset panels as the header mark. */}
      <rect x="21" y="12" width="30" height="21" rx="5" fill="#ffffff" opacity="0.34" />
      <rect x="17" y="21" width="30" height="21" rx="5" fill="#ffffff" opacity="0.62" />
      <rect x="13" y="30" width="30" height="21" rx="5" fill="#ffffff" />

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
