import { createTheme, type MantineColorsTuple } from "@mantine/core";

const slate: MantineColorsTuple = [
  "#f4f6f8",
  "#e5e9ed",
  "#c9d1d9",
  "#aab6c2",
  "#90a0b0",
  "#7f92a5",
  "#778ba0",
  "#65788d",
  "#586a7e",
  "#495a6c",
];

export const theme = createTheme({
  primaryColor: "slate",
  primaryShade: 6,
  colors: { slate },
  defaultRadius: "md",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  headings: {
    fontWeight: "600",
  },
  components: {
    Card: {
      defaultProps: {
        withBorder: true,
        radius: "md",
        shadow: "none",
      },
    },
  },
});
