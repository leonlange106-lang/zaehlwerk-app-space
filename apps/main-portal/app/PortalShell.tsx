"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  AppShell,
  Avatar,
  Group,
  NavLink,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBell,
  IconChartBar,
  IconLayoutDashboard,
  IconSearch,
  IconSettings,
  IconStack2,
  IconUsers,
} from "@tabler/icons-react";
import classes from "./PortalShell.module.css";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: IconLayoutDashboard, disabled: false },
  { label: "Zählwerk", href: "/zaehlwerk", icon: IconStack2, disabled: true },
  { label: "Berichte", href: "/reports", icon: IconChartBar, disabled: true },
  { label: "Team", href: "/team", icon: IconUsers, disabled: true },
  { label: "Einstellungen", href: "/settings", icon: IconSettings, disabled: true },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");

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
              active={pathname === item.href}
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
