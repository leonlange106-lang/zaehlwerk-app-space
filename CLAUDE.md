# CLAUDE.md — zaehlwerk-app-space

> **Stand 2026-07-28:** Sechs Update-Versuche gescheitert, danach durchgelaufen.
> Vor Arbeiten am **Deploy oder an Migrationen** zuerst
> `docs/handover-2026-07-28.md` lesen — dort stehen die gemessenen Befunde und
> die Sackgassen mit PR-Nummern.

Monorepo (pnpm + Turbo), Zählwerk App-Space. **Deutsche Oberfläche.**

| Paket | Inhalt |
|---|---|
| `apps/main-portal` | Next.js 16 App Router · Tailwind v4 · Radix · CSS Modules · Recharts · Vitest + Playwright |
| `packages/database` | Prisma 6 / SQLite, als `@zaehlwerk/database` (`import { prisma } from …`) |
| `packages/updater` | Self-Update-Engine (`@zaehlwerk/updater`) |

**Weiterführend:** `docs/architecture.md` (wo was liegt) · `docs/gotchas.md`
(vollständiger Bestand) · `docs/migrations.md` (Deploy + Migrationen).

## Commands

- `pnpm install` · `pnpm dev` · `pnpm typecheck` · `pnpm lint` · `pnpm build`
- Tests aus `apps/main-portal`: `pnpm test` (Vitest) · `pnpm test:e2e` (Playwright)
- Migrationen: `pnpm --filter @zaehlwerk/database exec prisma migrate dev --name <x>`
  — die erzeugte SQL-Datei wird **mit eingecheckt**. `db push` nur lokal.
- Deploy-Prüfungen: `pnpm --filter @zaehlwerk/database test:migrations` ·
  `node scripts/test-deploy-swap.mjs`

## Konventionen

- **Es gibt keine Komponentenbibliothek.** `components/ui/` *ist* das Kit —
  erst dort nachsehen, dann ergänzen, statt Einzelstücke zu stylen. Radix nur
  für das wirklich Schwere (Focus-Trap, Scroll-Lock, Escape, ARIA): Dialog,
  DropdownMenu, Popover, Tooltip. Alles andere native Elemente + Tailwind.
- **Tailwind v4 + CSS Modules.** Module dort, wo eine Regel ein Pseudo-Element
  braucht (`::-webkit-slider-thumb`) oder die Geometrie einen Namen verdient.
- **`app/globals.css` ist die einzige Token-Quelle.** `@theme inline`
  *referenziert* die `--zw-*`-Properties, deshalb können `bg-surface` und
  `var(--zw-surface)` nicht auseinanderlaufen. Stufen: `--zw-canvas` →
  `--zw-surface` → `--zw-elevated` → `--zw-inset`. Zusammengesetzte Looks sind
  `@utility`-Regeln (`panel`, `well`, `accent-gradient`, …), keine kopierten
  Klassenketten. Nur System-Fonts — die CSP verbietet externe Font-Hosts.
- **Farbschema ist ein Attribut, nie eine Media Query.** `ThemeProvider`
  schreibt `data-theme` auf `<html>`; sein `themeScript` läuft **vor** dem
  ersten Paint.
- **Status nie allein über Farbe.** Jedes Urteil geht durch `StatusBadge`
  (`tone: ok | watch | risk | neutral`), das die Farbe mit einem Icon paart.
  Graustufendruck und Rot-Grün-Schwäche hängen daran.
- **Mobile-first (390px).** Kartenstapel werden zu `SegmentedControl` +
  `.pane[data-active]` (nur unterhalb `sm`). Dialoge über `ResponsiveDialog`.
  Dichte Tabellen unter 600px als Kartenliste — **per CSS-Media-Query, nie per
  `useMediaQuery`-Hook**, der erst nach dem Mount auflöst und die Seite vor den
  Augen des Nutzers umbricht.
- **44px Touch-Targets stecken in den Komponenten**, nicht in einem globalen
  Override. Handgebaute interaktive Elemente erben nichts.
- **Geometrie reservieren für alles, was nach dem Mount lädt** — sonst
  verschluckt der Reflow Klicks. `Skeleton` von erstem Paint an, dann das echte
  Control.
- Daten über Server Components / Server Actions. **Zod** für jede Form- und
  API-Validierung. DB-Logik in `packages/database`.
- Unit-Tests koloziert als `*.test.ts`; die framework-freie Logik in `lib/` ist
  die Testfläche.

## Git-Workflow

1. **Branch immer von `origin/main`**, nie vom vorherigen Feature-Branch:
   `git fetch origin main && git checkout -B <name> origin/main`.
2. Vor dem Commit: `pnpm typecheck`, `pnpm lint`, `pnpm build` + die passenden
   Tests. Atomare Commits, Begründung in der Nachricht — nicht nur das Was.
3. PR → Squash-Merge → `git checkout main && git pull`.
4. E2E-Artefakte (`e2e/.auth`, `.data`, `.report`, `.test-results`) sind
   git-ignoriert; die Muster brauchen ein `**/`-Präfix.

## Gotchas — die teuersten

Vollständige Liste in `docs/gotchas.md`. Diese hier haben je einen Release
gekostet:

### Deploy und Datenbank

- **`scripts/update.sh` läuft aus dem IMAGE, nicht aus dem Checkout**
  (`COPY /repo/scripts ./scripts`). Eine Änderung dort greift ein Update zu
  spät — und wenn das nächste scheitert, nie. Was beim *nächsten* Update wirken
  muss, gehört in `packages/database/scripts/deploy-migrations.sh`: Das steckt
  im `db-migrate`-Image, das jedes Update neu baut.
- **Prismas Schema-Engine verträgt neben sich keine offene Transaktion** —
  auch keine lesende, auch im WAL-Modus. Gemessen: nur verbunden → läuft;
  offene Lese- oder Schreibtransaktion → gesperrt. Deshalb hält die Migration
  die Anwendung an. `busy_timeout` lässt sich dem Engine nicht mitgeben.
- **`PRAGMA journal_mode` wirft nicht, wenn es abgelehnt wird — es ANTWORTET**
  mit dem Modus, der danach gilt. Die Antwort muss gelesen werden, sonst meldet
  der Start WAL, während die Datei im `delete`-Modus bleibt.
- **Bind-Mount-Quellen löst der HOST-Daemon auf.** `update.sh` läuft im
  Container mit `cwd=/repo`, also montiert ein `- .:/repo` ein leeres
  Verzeichnis über den Code. `db-migrate` mountet nur den Socket und hält die
  App über den **Containernamen** an.
- **Während der Migration steht die Anwendung** — das Live-Protokoll friert
  dabei ein (der SSE-Stream stirbt mit ihr). Ein Refresh nach dem Neustart
  zeigt den wahren Stand. Sieht aus wie ein Absturz, ist keiner.
- **Jede neue Spalte ist optional oder hat einen Default.** Ein Rollback
  überspringt die Migration bewusst; eine `NOT NULL`-Spalte ohne Default ist
  der eine Fall, den ein älterer Client nicht überlebt.
- **Ein Rollback migriert nie rückwärts.** Das entfernte genau die Spalten, in
  die die neuere Version schon geschrieben hat. Reicht ein Rollback nicht, ist
  die Antwort ein Backup-Restore.

### Sicherheit

- **Ein Deploy-Endpunkt darf nie einen beliebigen Ref annehmen.**
  `/api/update/rollback` checkt aus *und baut* — ein ungeprüfter Ref ist
  Remote-Code-Execution über jede gekaperte Admin-Session. Die erlaubte Menge
  wird serverseitig je Request neu abgeleitet, nie aus dem Request übernommen.
- **`proxy.ts` ist der globale Auth-Guard, aber er autorisiert nicht.**
  Rollenprüfungen bleiben in der Route (`getSessionUser().role`,
  `requireAdmin()`). Eine Admin-Route ohne diese Prüfung ist für jeden
  angemeldeten Nutzer erreichbar.
- **Ein Suchtreffer ist eine Autorisierungsentscheidung.** `/api/search` leitet
  die erlaubten Apps je Request neu ab; ein Treffer aus einer gesperrten App
  benennt Daten, von deren Existenz das Konto nichts wissen darf.
- **Ein selbst gesetztes Cookie nimmt `secure` aus der VERBINDUNG**, nie aus
  `NODE_ENV` (`isSecureConnection()`). Ein `secure`-Cookie über HTTP verwirft
  der Browser lautlos — und Port 3000 ohne TLS ist eine unterstützte
  Betriebsart. Die E2E-Suite kann das nicht fangen (sie läuft auf `next dev`).

### Build und Tests

- **Eine Build-Zeit-Variable muss in `turbo.json` deklariert sein**, sonst
  existiert sie nicht. Turborepo 2 filtert die Umgebung; `next.config.ts` liest
  `FRAME_ANCESTORS`/`HA_INGRESS` beim Bauen. Fehlt der Eintrag, wirkt die
  Einstellung nicht und invalidiert nicht einmal den Cache.
- **Ein Konflikt im PR heißt KEINE CI, nicht rote CI.** GitHub kann den
  Merge-Commit nicht bilden, auf dem `pull_request`-Workflows laufen — der PR
  sieht dann still aus, und „keine Fehler" liest sich wie „bestanden".
- **`data-testid` an einer Kit-Komponente muss in deren Props deklariert sein**,
  sonst wird es stumm verworfen und der E2E-Locator scheitert erst zur Laufzeit.
- **Formularfelder in E2E über die ROLLE finden, nicht über das Label.**
  `getByLabel` matcht den Label-*Text* inklusive Pflichtmarkierung.
- **Ein Test, der auch ohne den Fix besteht, beweist nichts.** Zu jedem
  Regressionstest gehört die Gegenprobe: Fix entfernen, Test muss fallen.
