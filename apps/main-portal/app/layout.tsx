import type { Metadata } from "next";
import {
  ColorSchemeScript,
  mantineHtmlProps,
  MantineProvider,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./globals.css";
import { theme } from "../theme";
import { PortalShell } from "./PortalShell";
import { getCurrentVersionInfo } from "./lib/version";

export const metadata: Metadata = {
  title: "Main Portal",
  description: "Zaehlwerk Main Portal",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Baked build SHA (or git checkout) so every page shows the running version.
  const version = await getCurrentVersionInfo();

  return (
    <html lang="de" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="light" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="light">
          <Notifications position="top-right" />
          <PortalShell version={version ? { shortSha: version.shortSha, branch: version.branch } : null}>
            {children}
          </PortalShell>
        </MantineProvider>
      </body>
    </html>
  );
}
