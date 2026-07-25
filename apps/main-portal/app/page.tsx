import Link from "next/link";
import { IconInfoCircle, IconPlus } from "@tabler/icons-react";
import { APPS } from "./lib/apps";
import { getAllowedAppIds } from "./lib/app-access";
import { getSessionUser } from "./lib/auth-helpers";
import { AdminPanel } from "./AdminPanel";
import { BrandLogo } from "./components/BrandLogo";
import { Badge } from "./components/ui/Badge";
import { Alert } from "./components/ui/primitives";

// App Space hub (hub-and-spoke root). Lists only the apps assigned to the
// current user (admins see all). Reads the session → force-dynamic.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "App Space",
};

// Each tile is washed in its own app's accent so the hub reads as a shelf of
// distinct tools rather than a list of links — the same device the KPI tiles use.
const tile =
  "panel group relative flex flex-col overflow-hidden p-5 transition-[transform,box-shadow] duration-200";

export default async function LauncherPage() {
  const [allowedAppIds, user] = await Promise.all([getAllowedAppIds(), getSessionUser()]);
  const apps = APPS.filter((app) => allowedAppIds.includes(app.id));
  const isAdmin = user?.role === "ADMIN";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-7">
      <div className="flex flex-col items-center gap-3 pt-6 text-center">
        <BrandLogo height={52} />
        <p className="max-w-lg text-sm text-dim">
          Dein modulares Portal. Wähle eine App, um loszulegen – über das Menü oben links springst
          du jederzeit direkt in einen Bereich oder auf einen einzelnen Zähler.
        </p>
      </div>

      {apps.length === 0 && (
        <Alert
          className="mx-auto max-w-xl"
          icon={<IconInfoCircle size={18} />}
          title="Noch keine App freigegeben"
        >
          Dir wurde bisher keine App zugewiesen. Bitte wende dich an einen Administrator, um für die
          gewünschten Apps freigeschaltet zu werden.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((app) => {
          const wash = (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, ${app.accent} 20%, transparent), transparent 60%)`,
              }}
            />
          );
          const body = (
            <>
              {wash}
              <span className="relative flex items-start justify-between gap-3">
                <span
                  className="grid size-14 flex-none place-items-center rounded-panel"
                  style={{
                    background: `color-mix(in srgb, ${app.accent} 16%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${app.accent} 28%, transparent)`,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={app.icon} alt="" width={40} height={40} />
                </span>
                {!app.available && <Badge>Bald</Badge>}
              </span>
              <span className="relative mt-4 block text-[17px] font-semibold tracking-tight">
                {app.name}
              </span>
              <span className="relative mt-1 block text-sm text-dim">{app.tagline}</span>
            </>
          );

          return app.available ? (
            <Link
              key={app.id}
              href={app.href}
              className={`${tile} hover:-translate-y-0.5 hover:shadow-panel-lg`}
            >
              {body}
            </Link>
          ) : (
            <div key={app.id} className={`${tile} opacity-60`} aria-disabled>
              {body}
            </div>
          );
        })}

        <div
          className="flex flex-col items-start rounded-panel border border-dashed border-line p-5 text-dim"
          aria-hidden
        >
          <span className="grid size-14 place-items-center rounded-panel border border-dashed border-line">
            <IconPlus size={24} stroke={1.6} />
          </span>
          <span className="mt-4 block text-[17px] font-semibold tracking-tight">Weitere Apps</span>
          <span className="mt-1 block text-sm">
            Platz für zukünftige Erweiterungen des App Space.
          </span>
        </div>
      </div>

      {isAdmin && <AdminPanel />}
    </div>
  );
}
