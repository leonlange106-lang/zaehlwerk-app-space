import type { Metadata, Viewport } from "next";
import {
  ColorSchemeScript,
  mantineHtmlProps,
  MantineProvider,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { SessionProvider } from "next-auth/react";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./globals.css";
import { theme } from "../theme";
import { PortalShell } from "./PortalShell";
import { getCurrentVersionInfo } from "./lib/version";
import { allowedAppIdsFor } from "./lib/app-access";
import { auth } from "@/auth";

export const metadata: Metadata = {
  title: "App Space",
  description: "Modulares Multi-App-Portal – Zählwerk, Log Analyzer und mehr.",
  applicationName: "App Space",
  appleWebApp: { capable: true, title: "App Space", statusBarStyle: "default" },
};

// Mobile/PWA viewport: scale to the device width and extend under the notch /
// home indicator so the fixed AppShell header sits flush on modern phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#3c4b5a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Baked build SHA (or git checkout) so every page shows the running version,
  // plus the session so the shell's user menu renders without a client fetch.
  const [version, session] = await Promise.all([getCurrentVersionInfo(), auth()]);
  // Which apps this user may see (drives launcher tiles + header app-switcher).
  const allowedAppIds = await allowedAppIdsFor(session?.user);

  return (
    <html lang="de" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="light" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="light">
          <Notifications position="top-right" />
          <SessionProvider session={session}>
            <PortalShell
              version={version ? { shortSha: version.shortSha, branch: version.branch } : null}
              allowedAppIds={allowedAppIds}
            >
              {children}
            </PortalShell>
          </SessionProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
