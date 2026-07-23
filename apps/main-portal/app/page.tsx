import type { CSSProperties } from "react";
import Link from "next/link";
import { Badge, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { APPS } from "./lib/apps";
import classes from "./launcher.module.css";

// App Space hub (hub-and-spoke root). Lists the installed apps as launch tiles.
// No DB access — safe to render without force-dynamic; the shell around it
// already reflects auth/version.
export const metadata = {
  title: "App Space",
};

export default function LauncherPage() {
  return (
    <Stack gap="xl" className={classes.wrap}>
      <Stack gap={4} align="center" className={classes.hero}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-appspace.svg" alt="App Space" height={56} className={classes.logo} />
        <Text c="dimmed" size="sm" ta="center" maw={520}>
          Dein modulares Portal. Wähle eine App, um loszulegen – zwischen Apps wechselst du jederzeit
          über das Raster-Symbol oben links.
        </Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg" className={classes.grid}>
        {APPS.map((app) =>
          app.available ? (
            <Link key={app.id} href={app.href} className={classes.tile}>
              <span className={classes.iconWrap} style={{ "--accent": app.accent } as CSSProperties}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={app.icon} alt="" width={48} height={48} />
              </span>
              <Text fw={600} mt="md">
                {app.name}
              </Text>
              <Text size="sm" c="dimmed" mt={2}>
                {app.tagline}
              </Text>
            </Link>
          ) : (
            <div key={app.id} className={`${classes.tile} ${classes.tileDisabled}`} aria-disabled>
              <Group justify="space-between" w="100%">
                <span className={classes.iconWrap} style={{ "--accent": app.accent } as CSSProperties}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={app.icon} alt="" width={48} height={48} />
                </span>
                <Badge variant="light" color="slate" size="sm">
                  Bald
                </Badge>
              </Group>
              <Text fw={600} mt="md">
                {app.name}
              </Text>
              <Text size="sm" c="dimmed" mt={2}>
                {app.tagline}
              </Text>
            </div>
          ),
        )}

        <div className={`${classes.tile} ${classes.tilePlaceholder}`} aria-hidden>
          <span className={classes.plusWrap}>
            <IconPlus size={26} stroke={1.6} />
          </span>
          <Text fw={600} mt="md" c="dimmed">
            Weitere Apps
          </Text>
          <Text size="sm" c="dimmed" mt={2}>
            Platz für zukünftige Erweiterungen des App Space.
          </Text>
        </div>
      </SimpleGrid>
    </Stack>
  );
}
