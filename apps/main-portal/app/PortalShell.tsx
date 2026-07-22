"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  ActionIcon,
  AppShell,
  Avatar,
  Group,
  NavLink,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconBell,
  IconChartBar,
  IconLayoutDashboard,
  IconMoon,
  IconSearch,
  IconSettings,
  IconStack2,
  IconSun,
  IconUsers,
} from "@tabler/icons-react";
import classes from "./PortalShell.module.css";

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

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 248, breakpoint: 0 }}
      padding="lg"
      className={classes.shell}
    >
      <AppShell.Header className={classes.header}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size={28} radius="sm" variant="filled" color="slate">
              Z
            </ThemeIcon>
            <Text fw={600} size="sm">
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
            <Avatar radius="sm" size={30} color="slate">
              LL
            </Avatar>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className={classes.navbar} p="sm">
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
      </AppShell.Navbar>

      <AppShell.Main className={classes.main}>{children}</AppShell.Main>
    </AppShell>
  );
}
