// The App Space wordmark, inline rather than an <img src="/logo-appspace.svg">.
//
// A referenced SVG is its own document: it cannot see the page's colour scheme,
// so a baked-in wordmark colour is either invisible on the deep-night canvas or
// invisible in light mode. Inlining it lets the type use `currentColor` and the
// Mantine tokens, which follow the theme toggle exactly like every other piece
// of text. The tile beside it keeps hard-coded colours on purpose — it carries
// its own background, so it reads on any canvas.

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
          <stop stopColor="#1f293d" />
          <stop offset="1" stopColor="#080c14" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="6" fill="url(#asl-bg)" />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="5.25"
        fill="none"
        stroke="#374151"
        strokeWidth="1.5"
      />
      <g stroke="#64748b" strokeWidth="2.4" strokeLinecap="round">
        <line x1="32" y1="32" x2="18" y2="18" />
        <line x1="32" y1="32" x2="46" y2="18" />
        <line x1="32" y1="32" x2="18" y2="46" />
        <line x1="32" y1="32" x2="46" y2="46" />
      </g>
      <rect x="12" y="12" width="12" height="12" rx="2" fill="#e5e9f0" />
      <rect x="40" y="12" width="12" height="12" rx="2" fill="#e5e9f0" />
      <rect x="12" y="40" width="12" height="12" rx="2" fill="#e5e9f0" />
      <rect x="40" y="40" width="12" height="12" rx="2" fill="#06b6d4" />
      <rect x="24" y="24" width="16" height="16" rx="2" fill="#ffffff" />

      <text x="82" y="34" fontSize="26" fontWeight="700" fill="currentColor" letterSpacing="-0.5">
        App
      </text>
      <text x="140" y="34" fontSize="26" fontWeight="400" fill="var(--mantine-color-dimmed)">
        Space
      </text>
      <text
        x="82"
        y="50"
        fontSize="11"
        fontWeight="600"
        letterSpacing="2.5"
        fill="var(--mantine-color-dimmed)"
      >
        MODULARES&#160;PORTAL
      </text>
    </svg>
  );
}
