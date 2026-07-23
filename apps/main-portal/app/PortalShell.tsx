"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Burger,
  Group,
  Menu,
  MenuDivider,
  MenuDropdown,
  MenuItem,
  MenuLabel,
  MenuTarget,
  NavLink,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBell,
  IconChartBar,
  IconGitCommit,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconLogout,
  IconMoon,
  IconSearch,
  IconSettings,
  IconStack2,
  IconSun,
} from "@tabler/icons-react";
import { USER_ROLE_LABELS } from "@zaehlwerk/database/shared";
import type { UserRole } from "@zaehlwerk/database/shared";
import { APPS, activeAppFor } from "./lib/apps";
import classes from "./PortalShell.module.css";

// Auth screens render standalone (no nav/header chrome).
const BARE_PATHS = ["/login", "/setup"];

type NavItem = { label: string; href: string; icon: typeof IconStack2; exact?: boolean };

// Per-app sidebar navigation. Keyed by app id; only apps with their own
// sub-navigation appear here. The sidebar is shown only inside such an app.
const APP_NAV: Record<string, NavItem[]> = {
  zaehlwerk: [
    { label: "Dashboard", href: "/apps/zaehlwerk", icon: IconLayoutDashboard, exact: true },
    { label: "Zähler", href: "/apps/zaehlwerk/zaehler", icon: IconStack2 },
    { label: "Berichte", href: "/apps/zaehlwerk/berichte", icon: IconChartBar },
    { label: "App-Einstellungen", href: "/apps/zaehlwerk/einstellungen", icon: IconSettings },
  ],
};

function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || source[0]!.toUpperCase();
}

function isActiveHref(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AppSwitcher({ pathname }: { pathname: string }) {
  return (
    <Menu position="bottom-start" withArrow width={264} radius="md">
      <MenuTarget>
        <ActionIcon
          variant="subtle"
          color="slate"
          size="lg"
          radius="sm"
          aria-label="App wechseln"
        >
          <IconLayoutGrid size={19} stroke={1.6} />
        </ActionIcon>
      </MenuTarget>
      <MenuDropdown>
        <MenuLabel>Apps</MenuLabel>
        {APPS.map((app) =>
          app.available ? (
            <MenuItem
              key={app.id}
              component={Link}
              href={app.href}
              leftSection={<AppIcon src={app.icon} />}
            >
              {app.name}
            </MenuItem>
          ) : (
            <MenuItem
              key={app.id}
              disabled
              leftSection={<AppIcon src={app.icon} />}
              rightSection={
                <Badge size="xs" variant="light" color="slate">
                  Bald
                </Badge>
              }
            >
              {app.name}
            </MenuItem>
          ),
        )}
        <MenuDivider />
        <MenuItem
          component={Link}
          href="/"
          leftSection={<IconLayoutGrid size={16} />}
          data-active={pathname === "/" || undefined}
        >
          App Space (Start)
        </MenuItem>
        <MenuItem component={Link} href="/settings" leftSection={<IconSettings size={16} />}>
          Plattform-Einstellungen
        </MenuItem>
        <MenuItem component={Link} href="/changelog" leftSection={<IconGitCommit size={16} />}>
          Changelog
        </MenuItem>
      </MenuDropdown>
    </Menu>
  );
}

function AppIcon({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={18} height={18} style={{ borderRadius: 4 }} />;
}

export function PortalShell({
  children,
  version,
}: {
  children: React.ReactNode;
  version: { shortSha: string; branch: string } | null;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false);
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { data: session } = useSession();

  // Navigating on a phone should dismiss the drawer so the target page is
  // actually visible instead of hidden behind the open navbar overlay.
  useEffect(() => {
    closeMobile();
  }, [pathname, closeMobile]);

  // Login / first-boot setup render without the app chrome.
  if (BARE_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  const user = session?.user;
  const activeApp = activeAppFor(pathname);
  const navItems = activeApp ? APP_NAV[activeApp.id] ?? [] : [];
  const showNavbar = navItems.length > 0;

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={
        showNavbar
          ? {
              width: 248,
              // Below "sm" the navbar collapses into a burger-triggered drawer;
              // on tablet/desktop it stays pinned as before.
              breakpoint: "sm",
              collapsed: { mobile: !mobileOpened },
            }
          : undefined
      }
      padding="lg"
      className={classes.shell}
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            {showNavbar && (
              <Burger
                opened={mobileOpened}
                onClick={toggleMobile}
                hiddenFrom="sm"
                size="sm"
                aria-label="Navigation umschalten"
              />
            )}
            <AppSwitcher pathname={pathname} />
            <UnstyledButton component={Link} href="/" className={classes.brand} aria-label="Zum App Space">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mark-appspace.svg" alt="App Space" width={28} height={28} />
              <Text fw={600} size="sm" className={classes.brandText}>
                {activeApp ? activeApp.name : "App Space"}
              </Text>
            </UnstyledButton>
          </Group>

          <TextInput
            className={classes.search}
            placeholder="Suchen…"
            leftSection={<IconSearch size={15} />}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            size="xs"
            radius="sm"
            visibleFrom="sm"
          />

          <Group gap="sm" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              color="slate"
              size="lg"
              radius="sm"
              onClick={() => toggleColorScheme()}
              aria-label="Theme wechseln"
            >
              {colorScheme === "dark" ? <IconSun size={18} stroke={1.6} /> : <IconMoon size={18} stroke={1.6} />}
            </ActionIcon>
            <UnstyledButton className={classes.iconButton} aria-label="Benachrichtigungen">
              <IconBell size={18} stroke={1.6} />
            </UnstyledButton>
            <Menu position="bottom-end" withArrow width={220}>
              <MenuTarget>
                <UnstyledButton aria-label="Benutzermenü">
                  <Avatar radius="sm" size={30} color="slate">
                    {initialsFor(user?.name, user?.email)}
                  </Avatar>
                </UnstyledButton>
              </MenuTarget>
              <MenuDropdown>
                <MenuLabel>
                  <Text size="sm" fw={600} truncate>
                    {user?.name ?? user?.email ?? "Angemeldet"}
                  </Text>
                  {user?.email && (
                    <Text size="xs" c="dimmed" truncate>
                      {user.email}
                    </Text>
                  )}
                  {user?.role && (
                    <Text size="xs" c="dimmed">
                      {USER_ROLE_LABELS[user.role as UserRole]}
                    </Text>
                  )}
                </MenuLabel>
                <MenuDivider />
                <MenuItem
                  component={Link}
                  href="/settings"
                  leftSection={<IconSettings size={15} />}
                >
                  Plattform-Einstellungen
                </MenuItem>
                <MenuItem
                  color="red"
                  leftSection={<IconLogout size={15} />}
                  onClick={() => signOut({ callbackUrl: "/login" })}
                >
                  Abmelden
                </MenuItem>
              </MenuDropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      {showNavbar && (
        <AppShell.Navbar className={classes.navbar} p="sm">
          <Stack h="100%" justify="space-between" gap="sm">
            <Stack gap={2}>
              <Tooltip label="Zurück zum App Space" position="right" openDelay={400}>
                <NavLink
                  component={Link}
                  href="/"
                  label="Alle Apps"
                  leftSection={<IconLayoutGrid size={17} stroke={1.6} />}
                  variant="subtle"
                  color="slate"
                  className={classes.navLink}
                />
              </Tooltip>
              {navItems.map((item) => (
                <NavLink
                  key={item.href}
                  component={Link}
                  href={item.href}
                  label={item.label}
                  leftSection={<item.icon size={17} stroke={1.6} />}
                  active={isActiveHref(pathname, item.href, item.exact)}
                  variant="light"
                  color="slate"
                  className={classes.navLink}
                />
              ))}
            </Stack>

            <UnstyledButton
              component={Link}
              href="/changelog"
              className={classes.versionButton}
              data-active={isActiveHref(pathname, "/changelog") || undefined}
              title="Changelog öffnen"
            >
              <Group gap={7} wrap="nowrap">
                <IconGitCommit size={15} stroke={1.6} />
                <div>
                  <Text size="xs" fw={600} lh={1.2}>
                    Version {version?.shortSha ?? "dev"}
                  </Text>
                  <Text size="10px" c="dimmed" lh={1.2}>
                    {version?.branch ?? "lokal"} · Changelog ansehen
                  </Text>
                </div>
              </Group>
            </UnstyledButton>
          </Stack>
        </AppShell.Navbar>
      )}

      {/* Tap-to-dismiss scrim behind the open mobile drawer. Mantine's AppShell
          ships no overlay for the navbar, so without this the drawer can feel
          "stuck" — you see it but taps land on the page content behind it. */}
      {showNavbar && mobileOpened && (
        <div
          className={classes.navScrim}
          onClick={closeMobile}
          role="presentation"
          aria-hidden
        />
      )}

      <AppShell.Main className={classes.main}>{children}</AppShell.Main>
    </AppShell>
  );
}
