<div align="center">

<img src="./docs/assets/logo-appspace.svg" alt="App Space" height="72" />

### Modulare, selbst gehostete Multi-App-Plattform

Ein Portal nach dem **Hub-and-Spoke-Prinzip**: ein zentraler App Launcher, unter
dem eigenständige Apps laufen. Aktuell an Bord – **Zählwerk** (Verbrauchs- &
Zähler-Management für Strom, Gas, Wasser & PV) und der **Log Analyzer**
(Fahrzeug-Datenlogs auswerten, vergleichen, Leistung schätzen).

![Version](https://img.shields.io/badge/version-3.0.0--beta-1f6feb)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8)
![Prisma](https://img.shields.io/badge/Prisma-6-2d3748)
![License](https://img.shields.io/badge/license-private-lightgrey)

</div>

---

## Apps

<table>
<tr>
<td align="center" width="120"><img src="./docs/assets/icon-zaehlwerk.svg" width="56" height="56" alt="Zählwerk" /></td>
<td><strong>Zählwerk</strong> — <code>/apps/zaehlwerk</code><br/>Zähler & Standorte, Verbrauch & Kosten, Tarife, Berichte/PDF-Export, Smart-Home-Erfassung und Jahresprognose.</td>
</tr>
<tr>
<td align="center"><img src="./docs/assets/icon-log-analyzer.svg" width="56" height="56" alt="MGflasher Log Analyzer" /></td>
<td><strong>Log Analyzer</strong> — <code>/apps/log-analyzer</code><br/>Datenlogs auswerten (Pull-Erkennung, Grenzwerte je Fahrzeug), zwei Logs überlagern, Leistung schätzen (virtueller Prüfstand), PDF/PNG-Report. Import per Upload, Watch-Ordner oder API.</td>
</tr>
</table>

Plattformweite Funktionen (Login/2FA, Benutzer & Rollen, System-Updates,
Backups, Audit-Logs) liegen in den **Plattform-Einstellungen** (`/settings`);
app-spezifische Optionen jeweils in den App-Einstellungen.

## Zählwerk – Features

- **Zähler & Standorte** – beliebig viele Zähler (Strom, Gas, Wasser, PV-Erzeugung/-Einspeisung, Custom), Standorten zugeordnet, mit Farben/Icons.
- **Ablesungen & Verbrauch** – Zählerstände erfassen; der Verbrauch wird aus den Differenzen abgeleitet. Robuste Behandlung von **Zählertausch** (Startwert neu) und unplausiblen Werten.
- **Tarife & Kosten** – Arbeitspreis, Grundpreis und MwSt pro Tarifperiode; Kosten werden automatisch berechnet.
- **Berichte & Exporte** – flexible Zeiträume (inkl. „Alles"), CSV-Export je Zähler und serverseitig gerendertes **Jahres-PDF** (Strom/Gas/Wasser-Übersicht).
- **Jahresprognose** – Hochrechnung des Jahresverbrauchs und der -kosten aus dem bisherigen Verlauf.
- **Smart-Home-API** – `POST /api/v1/readings` zur automatischen Erfassung aus Home Assistant, Node-RED, ESPHome, Tasmota, Shelly … per Personal Access Token. Fertige Snippets direkt in der App und [Blueprints](./docs/integrations/home-assistant/).
- **Authentifizierung & Rollen** – Login (Auth.js Credentials), **2FA (TOTP)**, Admin-/User-Rollen, Benutzerverwaltung.
- **Personal Access Tokens (PAT)** – für skript-/gerätebasierten Zugriff; gespeichert wird nur der SHA-256-Hash.
- **Data Governance** – Backups (manuell & automatisch), Import/Export, DB-Wartung, append-only **Audit-Log** kritischer Aktionen.
- **Self-Update** – In-App-Update gegen GitHub Releases (git pull + Docker-Rebuild), mit interaktivem **Changelog** und Versions-Badge. **Release-Channel** (stable/beta), **Abbruch** bis einschließlich Migration und **Rollback** auf eine frühere Version.
- **Mobile & Dark Mode** – responsives Shell, touch-optimiert (44 px), numerisches Keypad, virtualisierte Verlaufslisten.
- **Sicherheit** – 2FA (TOTP) je Konto, optional **instanzweit erzwungen**; Durchsetzung serverseitig (Layout + API-Guards), nicht nur in der Oberfläche.

## Architektur

Monorepo (pnpm workspaces + Turborepo):

```
zaehlwerk-app-space/
├─ apps/
│  └─ main-portal/       Next.js 16 App Router · Tailwind v4 · Radix · CSS Modules
├─ packages/
│  ├─ database/          Prisma-Schema, Client, Verbrauchs-/Tarif-Logik, Zod-Schemas
│  └─ updater/           Self-Update-Engine (GitHub Releases, Changelog-Parsing)
├─ docs/integrations/    Home-Assistant-Blueprints & Gerätevorlagen
├─ Dockerfile · docker-compose.prod.yml · scripts/   Produktions-Deployment
```

- **Framework:** Next.js (App Router), Server Components & Server Actions.
- **UI:** Tailwind v4 + CSS Modules, eigenes Kit unter `app/components/ui/`. Radix
  liefert nur, was wirklich schwer ist (Fokusfalle, Scroll-Lock, Escape, ARIA):
  Dialog, DropdownMenu, Popover, Tooltip. Es gibt **keine** Komponentenbibliothek —
  Mantine wurde in 3.0.0 vollständig entfernt.
- **Datenbank:** Prisma ORM. SQLite (Default, null Setup) oder Postgres (`DATABASE_URL` + Provider umstellen).
- **Validierung:** Zod für alle Formulare und API-Mutationen.
- **Auth:** Auth.js (next-auth v5) Credentials, bcrypt-Hashes, TOTP-2FA (AES-GCM-verschlüsseltes Secret).

## Schnellstart (Entwicklung)

Voraussetzungen: **Node ≥ 20**, **pnpm 9**.

```sh
pnpm install

# DB-Schema anlegen (SQLite unter packages/database/prisma/dev.db)
pnpm --filter @zaehlwerk/database db:push
pnpm --filter @zaehlwerk/database db:seed   # optional: Demo-Daten (destruktiv!)

pnpm dev        # http://localhost:3000
```

Lege in `apps/main-portal/.env.local` mindestens an:

```sh
DATABASE_URL="file:./dev.db"
AUTH_SECRET="…"   # openssl rand -base64 32
```

Beim ersten Start führt `/setup` durch die Anlage des Admin-Kontos.

## Schnellstart (Produktion via Docker Compose)

```sh
git clone https://github.com/leonlange106-lang/zaehlwerk-app-space.git
cd zaehlwerk-app-space

cat > .env <<'EOF'
AUTH_SECRET=…                 # openssl rand -base64 32  (STABIL halten!)
GITHUB_TOKEN=github_pat_…     # nur für Self-Update/Changelog (privates Repo)
UPDATE_TRIGGER_TOKEN=…        # optional: schützt POST /api/update/trigger
EOF

export DOCKER_BUILDKIT=1
GIT_SHA=$(git rev-parse HEAD) docker compose -f docker-compose.prod.yml up -d --build

# einmalig das DB-Schema anlegen
docker compose -f docker-compose.prod.yml run --rm --build db-migrate
```

Die App lauscht auf Port `3000` – **immer hinter einen Reverse Proxy mit TLS
setzen**. Der ausführliche Leitfaden (Proxmox LXC, Docker, Portainer, Nginx/
Traefik/Cloudflare Tunnel, Self-Update-Sicherheit, Backups) steht in
**[DEPLOYMENT.md](./DEPLOYMENT.md)**.

## Environment-Variablen

| Variable | Erforderlich | Zweck |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Prisma-Verbindung. SQLite: `file:/data/zaehlwerk.db` · Postgres: `postgresql://…`. |
| `AUTH_SECRET` | ✅ | Signiert Sessions (Auth.js). **Stabil** halten – Änderung loggt alle aus. `openssl rand -base64 32`. |
| `GITHUB_TOKEN` | Für Self-Update/Changelog | Fine-grained PAT (Contents: Read) – nötig, weil das Repo privat ist. |
| `UPDATE_TRIGGER_TOKEN` | Optional | Shared Secret für `POST /api/update/trigger`. Wenn gesetzt, verlangt der Update-Button ihn (timing-safe geprüft). |
| `APP_GIT_SHA` / `GIT_SHA` | Optional | Wird beim Build eingebacken → Versions-Badge zeigt den tatsächlich laufenden Commit. |
| `TZ` | Optional | Anzeigezeitzone des Servers (Default `Europe/Berlin`). Reine Darstellung — ohne sie rendert der Container alles in UTC. |
| `INGESTION_API_KEY` | Optional | Bootstrap-Schlüssel für `POST /api/v1/logs/ingest`, bevor ein Schlüssel in der UI angelegt wurde. |
| `LOG_WATCH_DIR` | Optional | Watch-Ordner für CSV-Import (Default `/data/watch`). Leer = Watcher aus. |
| `UPDATE_ALLOW_BRANCH` | Optional | Entwicklermodus: folgt dem Branch-Head, wenn der Channel kein Release hat. Standard aus. |
| `DISABLE_2FA_ENFORCEMENT` | Notfall | Setzt die instanzweite 2FA-Pflicht aus, ohne sie zu löschen — der Weg zurück, wenn sich ein Admin aussperrt. |

## Smart-Home-Anbindung

Zählerstände lassen sich automatisch übertragen:

```
POST /api/v1/readings
Authorization: Bearer zw_pat_…
Content-Type: application/json

{ "meterId": "<uuid>", "value": 1234.56 }
```

Erstelle einen **PAT** unter *Einstellungen → API-Zugriff*, kopiere fertige
`curl`-/Home-Assistant-Snippets aus der Zähler-Detailseite (*Smart Home &
Automatische Auslesung*) oder nutze die versionierten
**[Home-Assistant-Blueprints & Gerätevorlagen](./docs/integrations/home-assistant/)**
(ESPHome, Tasmota, Shelly, Node-RED).

## Entwicklung

```sh
pnpm typecheck     # tsc --noEmit (alle Packages)
pnpm lint          # eslint
pnpm build         # turbo build
pnpm test          # vitest
```

Beitragsworkflow und Konventionen: siehe **[CLAUDE.md](./CLAUDE.md)**.
Änderungshistorie: **[CHANGELOG.md](./CHANGELOG.md)**.

## Lizenz

Privates Projekt – keine öffentliche Lizenz. Alle Rechte vorbehalten.
