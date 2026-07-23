"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  ActionIcon,
  AppShell,
  Avatar,
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
  ThemeIcon,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBell,
  IconChartBar,
  IconGitCommit,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconSearch,
  IconSettings,
  IconStack2,
  IconSun,
  IconUsers,
} from "@tabler/icons-react";
import { USER_ROLE_LABELS } from "@zaehlwerk/database/shared";
import type { UserRole } from "@zaehlwerk/database/shared";
import classes from "./PortalShell.module.css";

// Auth screens render standalone (no nav/header chrome).
const BARE_PATHS = ["/login", "/setup"];

function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || source[0]!.toUpperCase();
}

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: IconLayoutDashboard, disabled: false },
  { label: "Zählwerk", href: "/zaehler", icon: IconStack2, disabled: false },
  { label: "Berichte", href: "/berichte", icon: IconChartBar, disabled: false },
  { label: "Team", href: "/team", icon: IconUsers, disabled: true },
  { label: "Einstellungen", href: "/einstellungen", icon: IconSettings, disabled: false },
];

function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
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

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: 248,
        // Below "sm" the navbar collapses into a burger-triggered drawer;
        // on tablet/desktop it stays pinned as before.
        breakpoint: "sm",
        collapsed: { mobile: !mobileOpened },
      }}
      padding="lg"
      className={classes.shell}
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Burger
              opened={mobileOpened}
              onClick={toggleMobile}
              hiddenFrom="sm"
              size="sm"
              aria-label="Navigation umschalten"
            />
            <ThemeIcon size={28} radius="sm" variant="filled" color="slate">
              Z
            </ThemeIcon>
            <Text fw={600} size="sm" className={classes.brandText}>
              Zaehlwerk Main Portal
            </Text>
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

      <AppShell.Navbar className={classes.navbar} p="sm">
        <Stack h="100%" justify="space-between" gap="sm">
          <Stack gap={2}>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.href}
                href={item.disabled ? undefined : item.href}
                label={item.label}
                leftSection={<item.icon size={17} stroke={1.6} />}
                active={isActiveHref(pathname, item.href)}
                disabled={item.disabled}
                variant="light"
                color="slate"
                className={classes.navLink}
                rightSection={
                  item.disabled ? (
                    <Text size="xs" c="dimmed">
                      bald
                    </Text>
                  ) : undefined
                }
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

      {/* Tap-to-dismiss scrim behind the open mobile drawer. Mantine's AppShell
          ships no overlay for the navbar, so without this the drawer can feel
          "stuck" — you see it but taps land on the page content behind it. */}
      {mobileOpened && (
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
