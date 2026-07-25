const config = {
  plugins: {
    // Tailwind v4 runs first so its @import / @theme / @utility at-rules are
    // expanded before Mantine's preset transforms the result.
    //
    // globals.css imports Tailwind WITHOUT preflight for as long as Mantine is
    // still in the tree: preflight's reset would strip Mantine's component
    // styles and break every screen that hasn't been migrated yet. It gets
    // switched on in the same commit that drops the last Mantine dependency.
    "@tailwindcss/postcss": {},
    "postcss-preset-mantine": {},
    "postcss-simple-vars": {
      variables: {
        "mantine-breakpoint-xs": "36em",
        "mantine-breakpoint-sm": "48em",
        "mantine-breakpoint-md": "62em",
        "mantine-breakpoint-lg": "75em",
        "mantine-breakpoint-xl": "88em",
      },
    },
  },
};

export default config;
