import type { Metadata, Viewport } from "next";
import { SessionProvider } from "next-auth/react";
import "./globals.css";
import { PortalShell } from "./PortalShell";
import { ThemeProvider, themeScript } from "./components/shell/ThemeProvider";
import { ToastProvider } from "./components/ui/Toast";
import { TooltipProvider } from "./components/ui/Tooltip";
import { getCurrentVersionInfo } from "./lib/version";
import { allowedAppIdsFor } from "./lib/app-access";
import { resolveTwoFactorGate } from "./lib/two-factor-policy";
import { TwoFactorGate } from "./components/shell/TwoFactorGate";
import { auth } from "@/auth";

export const metadata: Metadata = {
  title: "App Space",
  description: "Modulares Multi-App-Portal – Zählwerk, Log Analyzer und mehr.",
  applicationName: "App Space",
  appleWebApp: { capable: true, title: "App Space", statusBarStyle: "default" },
};

// Mobile/PWA viewport: scale to the device width and extend under the notch /
// home indicator so the fixed AppShell header sits flush on modern phones.
// The theme colour is the deep-night canvas, so the status bar and the URL bar
// merge into the app instead of framing it with a lighter strip.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#080c14" },
    { media: "(prefers-color-scheme: light)", color: "#eef2f6" },
  ],
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

  // Instance-wide 2FA requirement. Resolved here because this layout wraps every
  // page and runs in Node (the edge guard in proxy.ts has no database — see
  // lib/two-factor-policy.ts). When it blocks, `children` is never rendered, so
  // the page's markup is not produced or sent at all.
  const twoFactorGate = await resolveTwoFactorGate(
    session?.user?.id ? { id: session.user.id } : null,
  );

  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        {/* Resolves the colour scheme onto <html> BEFORE the first paint, so a
            light-mode user never sees a dark frame. Has to be a raw script: it
            must run ahead of hydration. Default is "auto" — follow the OS. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <TooltipProvider>
              <SessionProvider session={session}>
                <PortalShell
                  version={version ? { shortSha: version.shortSha, branch: version.branch } : null}
                  allowedAppIds={allowedAppIds}
                >
                  {twoFactorGate.blocked ? (
                    <TwoFactorGate email={session?.user?.email ?? null} />
                  ) : (
                    children
                  )}
                </PortalShell>
              </SessionProvider>
            </TooltipProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
