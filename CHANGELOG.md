# Changelog

Alle wesentlichen Änderungen an Zählwerk App-Space. Format angelehnt an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/); Versionierung nach
[SemVer](https://semver.org/lang/de/).

Die App zeigt zusätzlich einen **live aus der Git-Historie generierten
Changelog** unter `/changelog` (mit Filter, Suche und Markierung des aktuell
laufenden Commits).

> **Ab 3.0 sind die [GitHub-Releases](https://github.com/leonlange106-lang/zaehlwerk-app-space/releases)
> die maßgebliche Quelle.** Sie tragen das Pre-Release-Kennzeichen, das den
> Update-Kanal (`stable`/`beta`) bestimmt — diese Datei kann das nicht abbilden
> und lief deshalb auseinander: Sie endete bei 1.0.0, während die Tags bei 3.8
> standen. Statt eine zweite, notorisch veraltete Liste zu pflegen, hält sie ab
> hier nur noch fest, wo die erste steht.

## [1.0.0] – 2026-07-23

Erstes stabiles Release. Fasst die Phasen 1–6 zusammen: vom Monorepo-Bootstrap
bis zu Authentifizierung, Smart-Home-API, Prognosen, Data Governance und
Test-Suite.

### Highlights

- **Authentifizierung & Sicherheit** – Login (Auth.js Credentials), 2FA (TOTP),
  Admin-/User-Rollen und Benutzerverwaltung, Route-Guards, Personal Access
  Tokens (nur als SHA-256-Hash gespeichert).
- **Smart-Home-API** – `POST /api/v1/readings` zur automatischen Erfassung per
  PAT, inkl. Plausibilitätsprüfung und Rate-Limiting; fertige In-App-Snippets
  sowie versionierte Home-Assistant-Blueprints und Gerätevorlagen (ESPHome,
  Tasmota, Shelly, Node-RED).
- **Verbrauch, Tarife & Prognosen** – Verbrauchsberechnung aus Ablesungen
  (inkl. Zählertausch), Tarifmodell mit Kostenberechnung, Jahresverbrauchs- und
  -kostenprognose.
- **Berichte & Exporte** – flexible Zeiträume (inkl. „Alles"), CSV-Export je
  Zähler und serverseitig gerendertes Jahres-PDF.
- **Data Governance** – Backups (manuell & automatisch), Import/Export,
  DB-Wartung, append-only Audit-Log.
- **Betrieb** – In-App-Self-Update gegen GitHub Releases mit interaktivem
  Changelog und Versions-Badge; Docker-/Proxmox-LXC-Deployment.
- **UX** – responsives, touch-optimiertes Shell mit Dark Mode, numerischem
  Keypad und virtualisierter Ablesungs-Historie.

### Details nach Phase

#### Phase 1 – Fundament
- Monorepo mit pnpm workspaces + Turborepo (#1).
- Next.js-App `main-portal` mit Mantine-v7-Desktop-Shell (#2).
- `@zaehlwerk/database`-Package und Zähler-CRUD (#3).
- Zähler-Detailseite, Dark Mode, Berichte/Einstellungen, erste
  Self-Update-Engine (#4).

#### Phase 2 – Deployment-Härtung
- Docker/Proxmox-LXC-Deployment lauffähig gemacht: `force-dynamic` für
  DB-Seiten, `public/` im Build, Prisma-Query-Engine-Auflösung im Next-
  Standalone-Output (Webpack statt Turbopack, Engine-Pfad via Env-Var) (#6–#11).
- DEPLOYMENT.md und GitHub-Auth für das private Repo dokumentiert (#5, #12).

#### Phase 3 – Code-Qualität & Kernlogik
- Audit von Verbrauchslogik, Validierung, Fehlerbehandlung und DB-Indizes (#13).
- CLAUDE.md mit aktueller Architektur und Auto-Merge-Workflow (#14).

#### Phase 4 – Berichte, Tarife & robustes Self-Update
- Serverseitige PDF-Export-Engine für die Jahresübersicht (#15, #18).
- Ehrliches, diagnostizierbares Self-Update mit Fortschritts-Stepper,
  detachtem Deployer, Live-Server-Log-Panel, Health-Probe, persistentem
  Versions-Badge und interaktivem Changelog (#16, #17, #26–#30).
- Tarifmodell mit Kostenberechnung (#21).
- Backup/Import/Export-Grundgerüst (#23).
- Betriebshärtung: automatische DB-Migration bei jedem Update, aggressives
  Docker-Pruning gegen ENOSPC, fixierter Compose-Projektname (#19, #20, #22,
  #24, #25).

#### Phase 5 – Auth, 2FA & Smart-Home-API
- Authentifizierung + Rollen (Auth.js Credentials, Route-Guards,
  Benutzerverwaltung) (#31).
- 2FA (TOTP) und Personal Access Tokens (#32).
- Smart-Home-Readings-API mit dynamischen Empfehlungen (#34).
- Flexible Berichte/Exporte und Jahresverbrauchsprognose (#35).

#### Phase 6 – Mobile, Governance & Qualität
- Mobile UX: responsives Shell, Touch-Targets, numerisches Keypad,
  virtualisierte Ablesungs-Historie (#36).
- Data Governance & Härtung, CRUD-Fixes, Mobile-Drawer-Fix (#37).
- Test-Suite (Vitest) + weitere Sicherheitshärtung; Bericht-Zeitraum „Alles" (#38).

#### Release 1.0.0
- Home-Assistant-Blueprints und Gerätevorlagen unter
  `docs/integrations/home-assistant/`; In-App-Verweis darauf.
- README.md, überarbeitete DEPLOYMENT.md (Nginx/Traefik/Cloudflare Tunnel) und
  dieser Changelog.
- Version aller Packages auf `1.0.0` gehoben.

[1.0.0]: https://github.com/leonlange106-lang/zaehlwerk-app-space/releases/tag/v1.0.0
