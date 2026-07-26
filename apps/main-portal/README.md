# main-portal

Die Next.js-Anwendung des App Space: der Launcher, die Plattform-Einstellungen
und beide Apps (Zählwerk, Log Analyzer). Alles Weitere zum Gesamtprojekt steht
im [Wurzel-README](../../README.md); Konventionen in
[CLAUDE.md](../../CLAUDE.md), Betrieb in [DEPLOYMENT.md](../../DEPLOYMENT.md).

## Entwicklung

Immer aus dem **Repo-Wurzelverzeichnis** starten — die App hängt an den
Workspace-Paketen `@zaehlwerk/database` und `@zaehlwerk/updater`, die vorher
gebaut sein müssen. Turbo erledigt das.

```sh
pnpm install
pnpm --filter @zaehlwerk/database db:push   # Schema anlegen
pnpm dev                                    # http://localhost:3000
```

Mindestens nötig in `apps/main-portal/.env.local`:

```sh
DATABASE_URL="file:./dev.db"
AUTH_SECRET="…"    # openssl rand -base64 32
```

Beim ersten Start führt `/setup` durch die Anlage des Admin-Kontos.

## Tests

Aus **diesem** Verzeichnis:

```sh
pnpm test        # Vitest — reine Logik in lib/, colocated *.test.ts
pnpm test:e2e    # Playwright — eigene SQLite-DB, Port 3100, zwei mobile Projekte
```

Die E2E-Suite bringt ihre Datenbank selbst mit (`e2e/global-setup.ts`) und läuft
gegen einen eigenen Dev-Server auf Port 3100, kollidiert also nicht mit einem
laufenden `pnpm dev`.

Screenshots für Review laufen unter eigener Konfiguration:

```sh
pnpm exec playwright test -c e2e/shots.config.ts --project=mobile --grep "(dark)"
```

## Aufbau

```
app/
├─ components/ui/     Das UI-Kit. Es gibt KEINE Komponentenbibliothek —
│                     hier zuerst nachsehen, bevor Markup entsteht.
├─ components/shell/  Kopfzeile, Navigationsmenü, Theme, 2FA-Sperre
├─ apps/zaehlwerk/    Zähler, Ablesungen, Tarife, Berichte
├─ apps/log-analyzer/ Auswertung, Vergleich, Prüfstand, Report-Export
├─ api/               Route-Handler (REST + SSE)
├─ lib/               Serverlogik, framework-freie Regeln (die Unit-Test-Fläche)
└─ settings/          Plattform-Einstellungen
e2e/                  Playwright
src/components/pdf/   @react-pdf/renderer-Dokumente (serverseitig gerendert)
```

## Zwei Dinge, die überraschen

**`proxy.ts` ist der globale Auth-Guard** — nicht `middleware.ts`. Er
authentifiziert (kein Session → Redirect bzw. 401 für `/api`), **autorisiert
aber nicht**: Rollenprüfungen gehören in die Route (`requireAdmin()`,
`denyUnlessAdmin()`).

**Turbopack ist deaktiviert.** Der Build läuft über `--webpack`, weil ein
Prisma-Platzhalterpfad (`/ROOT/`) den Turbopack-Build bricht.
