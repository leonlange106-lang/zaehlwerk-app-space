import type { CSSProperties } from "react";
import Link from "next/link";
import { Alert, Badge, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconInfoCircle, IconPlus } from "@tabler/icons-react";
import { APPS } from "./lib/apps";
import { getAllowedAppIds } from "./lib/app-access";
import { getSessionUser } from "./lib/auth-helpers";
import { AdminPanel } from "./AdminPanel";
import { BrandLogo } from "./components/BrandLogo";
import classes from "./launcher.module.css";

// App Space hub (hub-and-spoke root). Lists only the apps assigned to the
// current user (admins see all). Reads the session → force-dynamic.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "App Space",
};

export default async function LauncherPage() {
  const [allowedAppIds, user] = await Promise.all([getAllowedAppIds(), getSessionUser()]);
  const apps = APPS.filter((app) => allowedAppIds.includes(app.id));
  const isAdmin = user?.role === "ADMIN";

  return (
    <Stack gap="lg" className={classes.wrap}>
      <Stack gap={4} align="center" className={classes.hero}>
        <BrandLogo height={52} />
        <Text c="dimmed" size="sm" ta="center" maw={520}>
          Dein modulares Portal. Wähle eine App, um loszulegen – zwischen Apps wechselst du jederzeit
          über das Raster-Symbol oben links.
        </Text>
      </Stack>

      {apps.length === 0 && (
        <Alert
          color="slate"
          variant="light"
          icon={<IconInfoCircle size={18} />}
          title="Noch keine App freigegeben"
          maw={560}
          mx="auto"
        >
          Dir wurde bisher keine App zugewiesen. Bitte wende dich an einen Administrator, um für die
          gewünschten Apps freigeschaltet zu werden.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" className={classes.grid}>
        {apps.map((app) =>
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

      {isAdmin && <AdminPanel />}
    </Stack>
  );
}
