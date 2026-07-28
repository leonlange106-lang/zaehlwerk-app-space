# AUDIT.md — Full-Stack Architecture Audit & Migration Strategy

> **Stand der Gültigkeit:** § 1–5 beschreiben den Zustand vom 25.07.2026 und
> sind in Teilen überholt — insbesondere ist **Mantine vollständig entfernt**
> (die App nutzt Radix + Tailwind v4), und die dort genannten Bündelgrößen
> stammen von vor der Recharts-Auslagerung. Aktuell sind **§ 9** (umgesetzte
> Maßnahmen) und **§ 10** (offene Punkte). Ein Dokument, das zur Hälfte etwas
> anderes behauptet als der Code, ist schlechter als eines mit einem
> Verfallsdatum — daher dieser Hinweis statt einer stillen Korrektur.

**Datum:** 2026-07-25 · **Commit:** `341c640` · **Version:** 2.0.0
**Scope:** `apps/main-portal` (Next.js 16 / Mantine v7), `packages/database`, `packages/updater`

Alle Zahlen unten sind **gemessen**, nicht geschätzt: Production-Build (`next build --webpack`),
`next start` auf Port 3210, echter Login, HTML jeder Route geparst, alle ausgeführten
`<script src>`-Chunks von der Platte gzip-komprimiert. Reproduzierbar (siehe § 7).

---

## 1. Executive Summary

Der Code ist in ungewöhnlich gutem Zustand: sauberes Schema mit begründeten Indizes,
Server/Client-Trennung durchdacht, 376 Unit-Tests grün, Scheduler ohne Leaks, Security-Header
und CSP korrekt. Die Probleme liegen **nicht** dort, wo die Task-Beschreibung sie vermutet.

**Kernbefund:** Von den ~420–556 KB gz JavaScript, die heute pro Route ausgeliefert werden,
gehen **~170 KB gz auf zwei Bugs** zurück, die nichts mit Mantine zu tun haben und in
zwei Dateien behoben werden können. Mantine selbst kostet ~90 KB gz JS + 30 KB gz CSS.

| Posten (gz, moderner Browser) | Größe | Ursache | Behebbar ohne UI-Migration? |
|---|---:|---|---|
| React 19 + Next App-Router-Runtime | ~123 KB | Framework-Boden | ❌ nein |
| **Zod v4 im Client-Bundle** | **67,5 KB** | CJS-Barrel-Leck (§ 3.1) | ✅ **1 Datei** |
| **Recharts auf Login/Launcher** | **103,4 KB** | eager import (§ 3.2) | ✅ **1 Datei** |
| Mantine core + Notifications | ~90 KB | UI-Framework | nur per Migration |
| Mantine CSS (global) | ~30 KB | `styles.css` komplett | nur per Migration |
| App-Code (Route-Chunks) | 2–12 KB | – | – |

**Konsequenz für das Zielbild:** Das Ziel *„Initial JS < 120 KB gz"* ist auf Next.js App Router
**nicht erreichbar** — React + der App-Router-Client-Runtime sind allein bereits ~123 KB gz,
bevor eine Zeile Anwendungscode geladen wird. Kein UI-Framework-Tausch ändert das.
Realistisch erreichbar sind **~150 KB gz** (Quick Fixes) bzw. **~200 KB gz inkl. Mantine-Ersatz**
auf den datenintensiven Routen. Details und ein revidierter Zielkatalog in § 6.

---

## 2. Gemessener Ist-Zustand

### 2.1 Payload pro Route (Production-Build, eingeloggt als ADMIN)

| Route | JS gz | Chunks | CSS gz | HTML gz | TTFB |
|---|---:|---:|---:|---:|---:|
| `/login` (öffentlich!) | **540,5 KB** | 37 | 30,3 | 4,0 | – |
| `/setup` (öffentlich!) | 536,9 KB | 36 | 30,3 | 9,8 | – |
| `/` (Launcher) | 530,9 KB | 35 | 30,8 | 12,9 | 178 ms |
| `/apps/zaehlwerk` | 419,2 KB | 33 | 31,6 | 14,2 | 115 ms |
| `/apps/zaehlwerk/zaehler` | 430,4 KB | 36 | 30,6 | 15,9 | 118 ms |
| `/apps/zaehlwerk/berichte` | 421,0 KB | 33 | 30,2 | 14,7 | 99 ms |
| `/apps/log-analyzer` | 554,3 KB | 38 | 31,9 | 11,7 | 79 ms |
| `/apps/log-analyzer/history` | 545,0 KB | 38 | 30,2 | 11,3 | 76 ms |
| `/apps/log-analyzer/dyno` | 555,3 KB | 39 | 31,6 | 12,2 | 81 ms |
| `/settings` | 556,1 KB | 38 | 30,4 | 17,0 | 152 ms |
| `/changelog` | 537,1 KB | 37 | 30,6 | 10,4 | 401 ms |

> `polyfills-*.js` (38,7 KB gz) trägt `noModule` und wird von modernen Browsern **nicht**
> geladen — in den Zahlen oben enthalten, real also ~39 KB weniger. Alle übrigen Chunks
> sind `<script async>` und werden ausgeführt.

**Die Login-Seite — ein Formular mit zwei Feldern — lädt 540 KB gz JavaScript, inklusive
der kompletten Recharts-Bibliothek.** Das ist der teuerste Einzelbefund des Audits.

### 2.2 Die größten Chunks

| Chunk | raw | gz | Inhalt (per Signatur-Analyse) |
|---|---:|---:|---|
| `2804-*` | 358 KB | 103,4 KB | Recharts |
| `7709-*` | 354 KB | 67,5 KB | **Zod v4** (1484 Treffer) + JWT |
| `69219b0a-*` | 200 KB | 61,4 KB | react-dom |
| `6446-*` | 223 KB | 59,2 KB | React + scheduler |
| `600-*` | 173 KB | 51,7 KB | `@mantine/core` |
| `5018-*`, `6693-*`, `420-*` | 119 KB | 38,3 KB | weitere Mantine-Teile |

### 2.3 Test-Baseline (vor jeder Änderung)

- **Unit:** 30 Dateien, **376 Tests, alle grün** (5,6 s)
- **E2E:** 4 Specs, 34 Tests × 2 Projekte (Mobile Chrome / Mobile Safari) = 68 Runs
- `pnpm typecheck`, `pnpm lint`, `pnpm build` laufen sauber durch

---

## 3. Befunde: Performance & Bundle

### 3.1 🔴 KRITISCH — Zod v4 landet über ein CJS-Barrel im Client-Bundle (jede Route)

`packages/database` wird mit `tsc` nach **CommonJS** kompiliert. `dist/shared.js` besteht aus
`__exportStar(require("./schemas"), exports)` — und **CJS-Re-Exports sind für Webpack nicht
tree-shakebar**.

Die Kette:

```
app/PortalShell.tsx:48          →  import { USER_ROLE_LABELS } from "@zaehlwerk/database/shared"
  → dist/shared.js (CJS-Barrel) →  require("./schemas")
    → src/schemas.ts            →  import { z } from "zod"
      → 354 KB raw / 67,5 KB gz Zod im Browser
```

`PortalShell` hängt im **Root-Layout** → das trifft **100 % aller Routen**, inklusive
`/login` und `/setup`. Der Import holt eine einzige Konstante (`USER_ROLE_LABELS`).

Betroffen sind außerdem `ZaehlerManager.tsx`, `ZaehlerDetail.tsx`, `MeterImportCard.tsx`,
`UserManagementCard.tsx`.

**Fix:** browser-sichere Konstanten (`USER_ROLE_LABELS`, `EnergyCategory`-Labels …) in ein
eigenes, zod-freies Modul ziehen und/oder `packages/database` als ESM (`"module"`-Build,
`sideEffects: false`) ausliefern, damit `__exportStar` verschwindet.
**Ersparnis: 67,5 KB gz auf jeder Route.**

### 3.2 🔴 KRITISCH — Recharts wird eager auf Login/Launcher geladen

`app/AdminPanel.tsx:30` importiert Recharts **statisch**:

```ts
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
```

`AdminPanel` ist ein `"use client"`-Component und wird aus `app/page.tsx` gerendert. Damit
liegt der 103 KB-Chunk im Client-Graph des Launchers — und wird nachweislich auch auf
`/login`, `/setup` und `/changelog` ausgeführt (verifiziert: Chunk `2804` steht im HTML
von `/login`).

Alle anderen Charts sind vorbildlich `React.lazy` (`LogCharts`, `OverlayChart`, `DynoChart`,
`ExportModal`) — **`AdminPanel` ist die einzige Ausnahme.**

**Fix:** `const AdminMetricsChart = lazy(() => import("./AdminMetricsChart"))`, plus
Skeleton gleicher Höhe (CLS-Konvention aus CLAUDE.md).
**Ersparnis: 103,4 KB gz auf `/`, `/login`, `/setup`, `/changelog`, `/settings`.**

### 3.3 🟠 `@mantine/core/styles.css` wird vollständig geladen

30 KB gz CSS auf jeder Route — die Stylesheets **aller** Mantine-Komponenten, auch der nie
verwendeten. Mantine v7 unterstützt per-Komponenten-Imports
(`@mantine/core/styles/Button.css` …); genutzt wird das nicht.

### 3.4 🟠 46 von 73 Komponenten sind `"use client"`

63 % der Komponenten sind Client-Components. Ein relevanter Teil davon ist es nur, weil
Mantine-Komponenten (Menu, Tooltip, SegmentedControl) Client-Kontext brauchen — nicht,
weil der Code Interaktivität bräuchte.

### 3.5 🟢 Keine Memory-Leaks gefunden

Explizit geprüft und **sauber**:
- `lib/rate-limit.ts` — probabilistischer Sweep, Map wächst nicht unbegrenzt
- `lib/update-state.ts` — Poller stoppt beim letzten Unsubscribe (`maybeStopPolling`)
- `lib/backup-scheduler.ts`, `lib/maintenance-scheduler.ts` — `setInterval` mit Guard
- SSE-Routen — `heartbeat` wird auf `request.signal.abort` aufgeräumt
- `HistoryView.tsx` — `EventSource` wird im Cleanup geschlossen

---

## 4. Befunde: Datenbank & API

### 4.1 🔴 KRITISCH — `zaehler-actions.ts` exportiert 6 ungeschützte Read-Funktionen als Server Actions

Die Datei beginnt mit `"use server"`. In Next.js macht das **jeden Export zu einem
öffentlich adressierbaren HTTP-Endpunkt** — nicht nur die Form-Actions. Es gibt in der
gesamten Datei **keinen einzigen** `getSessionUser()`/`requireAppAccess()`-Aufruf:

| Export | Wirkung bei direktem Aufruf |
|---|---|
| `listZaehler`, `getZaehlerById`, `listLocations`, `listRecentAblesungen`, `getConsumptionSummary`, `getProjectionSummary` | vollständiger Datenabzug |
| `createZaehlerAction`, `updateZaehlerAction`, **`deleteZaehlerAction`** | Schreiben/Löschen |
| `createAblesungAction`, `updateAblesungAction`, **`deleteAblesungAction`** | Schreiben/Löschen |
| `createTarifAction`, **`deleteTarifAction`** | Schreiben/Löschen |

`proxy.ts` blockt zwar **unauthentifizierte** Aufrufe — aber wie CLAUDE.md selbst festhält:
*„What the guard does not do is authorize."* Ein eingeloggter `USER` **ohne** `zaehlwerk`-
Freigabe kann jede dieser Actions aufrufen. `requireAppAccess()` im Layout schützt nicht,
weil Server Actions **vor** dem Rendern des Layouts ausgeführt werden und an eine beliebige
Route gepostet werden können.

Gleiches Muster in `lib/location-actions.ts` (0 Auth-Checks).

### 4.2 🔴 Log-Analyzer-API ohne Autorisierung

| Route | Auth |
|---|---|
| `GET/POST /api/apps/log-analyzer/logs` | nur `auth()` **für den Audit-Eintrag**, keine Prüfung |
| `GET/PATCH/DELETE /api/apps/log-analyzer/logs/[id]` | **keine** |
| `POST /api/apps/log-analyzer/report` | **keine** |

Jeder eingeloggte Nutzer kann fremde Fahrzeug-Datalogs (inkl. VIN) lesen, taggen und löschen.

### 4.3 🔴 `POST /api/update/trigger` ohne Admin-Prüfung

Ist `UPDATE_TRIGGER_TOKEN` nicht gesetzt (Default!), kann **jeder eingeloggte Nutzer** ein
System-Update auslösen — inkl. Container-Neubau und Neustart. `auth()` wird im Handler
aufgerufen, aber ausschließlich für den Audit-Log-Eintrag. Der Doc-Kommentar
(„This app has no user/session system") ist veraltet.

Ebenfalls ohne Rollen-Check: `/api/update/status`, `/api/update/log`, `/api/update/check`,
`/api/system/update/state`, `/api/system/update/stream`.

### 4.4 🟠 Dashboard führt dieselbe schwere Query doppelt aus

`app/apps/zaehlwerk/page.tsx:55`:

```ts
const [zaehlerList, locations, recentAblesungen, consumptionSummary] = await Promise.all([
  listZaehler(),          // ← lädt ALLE Ablesungen aller Zähler
  listLocations(),
  listRecentAblesungen(6),
  getConsumptionSummary(),// ← ruft intern erneut listZaehler()
]);
```

`getConsumptionSummary()` ruft `listZaehler()` selbst auf. Ohne `React.cache()` läuft die
Query **zweimal pro Request**. `listZaehler()` lädt zudem `ablesungen` **unbegrenzt** —
für die Kachel „Aktive Zähler" wird nur `.length` gebraucht.

**Fix:** `React.cache()` um die Reader legen; für Zählwerte `_count` statt Vollmaterialisierung.

### 4.5 🟠 `refreshStaleVerdicts()` lädt nach `EVALUATION_RULES_VERSION`-Bump alle CSVs gleichzeitig

`lib/log-repository.ts:187` — ein `findMany({ where: { id: { in: [...alle stale ids] } } })`
ohne Batching, danach `Promise.all` über alle Zeilen. Die CSV-Spalte ist laut Schema-Kommentar
die mit Abstand größte. Auf dem LXC (bekanntes ENOSPC-/RAM-Thema) ist der erste Request nach
einem Version-Bump ein OOM-Risiko. **Fix:** in Batches von ~25 verarbeiten.

### 4.6 🟠 `listLogs()` ohne Pagination

Liefert **alle** Logs als Summaries. Wächst linear mit der Nutzung; die Retention-Policy ist
laut CLAUDE.md standardmäßig **aus** (`0 = unlimited`).

### 4.7 🟠 SQLite läuft ohne WAL-Modus

Kein `PRAGMA journal_mode=WAL` im Code (nur `PRAGMA optimize` in `db-maintenance.ts:93`).
Default ist `DELETE` — Schreiber blockieren Leser. Bei parallelen SSE-Streams, Watch-Folder-
Importen und Backup-Scheduler ist WAL ein spürbarer, billiger Gewinn.

### 4.8 🟢 Schema und Indizes sind sauber

`@@index([zaehlerId, datum])`, `@@index([aktiv, sortIndex])`, `@@index([contentHash])` decken
die tatsächlichen Query-Pfade ab und sind im Schema begründet. **Keine fehlenden Indizes
gefunden.** `SUMMARY_SELECT` hält die CSV-Spalte konsequent aus Listen-Queries heraus.

### 4.9 🟠 E2E läuft gegen `next dev`

`playwright.config.ts:44` startet `next dev`. Die Suite kann damit produktionsspezifische
Regressionen (Chunk-Splitting, Minification, RSC-Payloads) prinzipiell nicht sehen — und ist
langsamer.

---

## 5. Vorschlag: Neuer UI-Stack

### 5.1 Bewertung der Optionen

| Option | Initial JS | Aufwand | Risiko | Bewertung |
|---|---:|---|---|---|
| **A — Mantine behalten, Bugs fixen** | ~250 KB | 1–2 Tage | sehr gering | Beste Rendite pro Aufwand |
| **B — Tailwind v4 + Radix/shadcn** | ~200 KB | 46 Komponenten | hoch | Volle Layout-Freiheit, empfohlen wenn Dashboard-Dynamik das Ziel ist |
| **C — Base UI** | ~205 KB | wie B | höher | Jünger, kleineres Ökosystem, kein Vorteil ggü. Radix |
| **D — komplett headless/eigen** | ~180 KB | sehr hoch | sehr hoch | A11y-Arbeit (Focus-Trap, Menüs) wird unterschätzt |

**Empfehlung: A zuerst (sofort), dann B** — nicht B allein. Die 170 KB aus § 3.1/3.2 fallen
bei einer Mantine-Migration **nicht** mit weg; sie würden nur unter dem Rewrite verschwinden
und dessen Nutzen optisch aufblähen.

### 5.2 Zielstack (Option B)

- **Tailwind CSS v4** — CSS-first-Config, die `--zw-*`-Tokens aus `globals.css` werden
  direkt zu `@theme`-Tokens. **Kein zweites Token-System** — die bestehende Elevation-Leiter
  (`--zw-canvas` → `--zw-surface` → `--zw-elevated`) bleibt die einzige Wahrheit und
  `theme.ts` entfällt ersatzlos. Das erfüllt „zero duplicate token definitions" wörtlich.
- **Radix Primitives** (via shadcn-Rezepten, einkopiert statt Dependency) für Dialog, Menu,
  Popover, Tooltip, Select, Tabs — die sechs Mantine-Bausteine, die A11y-kritisch sind.
- **CVA** für Varianten, `tailwind-merge` für Klassen-Konflikte.
- **Recharts bleibt** — lazy, wie heute. Ein Chart-Rewrite ist ein separates Projekt und
  nicht Teil dieser Migration.
- **Beibehalten:** `StatusBadge` (Icon+Farbe, nie Farbe allein), `KpiRail`, `MetricTile`,
  `ResponsiveDialog`, die CSS-Media-Query-Umschaltung (**kein `useMediaQuery`**), die
  Geometrie-Reservierung für async Controls. Das sind harte Projektkonventionen, keine
  Mantine-Artefakte.

### 5.3 Migrationsreihenfolge (risikoarm → risikoreich)

1. `components/ui/` (5 Komponenten, keine Route hängt an ihrer Struktur)
2. `PortalShell` + Layout (macht das Root-Layout mantine-frei → größter Chunk-Gewinn)
3. Zählwerk-Routen (weniger Komponenten, gute E2E-Abdeckung)
4. Log-Analyzer-Routen (die 500+-Zeilen-Views, höchstes Risiko)
5. `settings/` + `AdminPanel`
6. Mantine-Dependencies entfernen, `theme.ts` löschen

Jeder Schritt ein eigener Feature-Branch, `pnpm typecheck && lint && build && test` + E2E
grün, bevor der nächste beginnt.

---

## 6. Vorschlag: Dynamisches Dashboard

### 6.1 Architektur

```
app/components/dashboard/
  DashboardGrid.tsx      "use client" — dnd-kit Sortable + CSS-Grid, Resize per Pointer
  WidgetFrame.tsx        Chrome: Titel, Drag-Handle, Menü (Konfigurieren/Entfernen)
  WidgetRegistry.ts      id → { component: lazy(), defaultSize, minSize, title, appId }
  useDashboardLayout.ts  optimistisches State-Management + Persistenz
lib/dashboard-layout.ts  Zod-Schema, Server Actions (MIT Auth-Check), Defaults
```

**Grid statt Pixel:** 12 Spalten (Desktop) / 6 (Tablet) / 1 (Mobile), Widgets tragen
`{ x, y, w, h }` in Grid-Einheiten. Rendering über natives CSS Grid
(`grid-column: span w`) — kein absolutes Positionieren, damit Mobile ohne Sonderfall
einfach zur Einspaltigkeit kollabiert.

**`dnd-kit` statt `react-grid-layout`:** ~12 KB gz statt ~40 KB, keine `useMediaQuery`-
basierten Breakpoints (die gegen die CLS-Konvention verstoßen würden), volle Tastatur- und
Screenreader-Unterstützung ab Werk. Der Editor-Modus wird **lazy** geladen — im Lesemodus
kostet das Dashboard 0 KB extra.

### 6.2 Persistenz

Neues Prisma-Modell (via `prisma db push`, deployt sich über das Self-Update):

```prisma
model DashboardLayout {
  id        String   @id @default(uuid())
  userId    String
  appId     String              // "zaehlwerk" | "log-analyzer"
  layout    String              // JSON, zod-validiert beim Lesen
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, appId])
}
```

Server-Render aus der DB (kein Flash eines Default-Layouts), Schreiben über eine
Server Action **mit** `getSessionUser()`-Prüfung — anders als § 4.1. Unbekannte Widget-IDs
werden beim Parsen verworfen, damit ein entferntes Widget kein Layout zerschießt.

### 6.3 Widget-Katalog (erste Ausbaustufe)

| Widget | Quelle | App |
|---|---|---|
| KPI-Kachel (konfigurierbare Kennzahl) | `getConsumptionSummary` | Zählwerk |
| Verbrauchs-Chart (Zeitraum wählbar) | `calculateConsumption` | Zählwerk |
| Letzte Ablesungen | `listRecentAblesungen` | Zählwerk |
| Jahres-Hochrechnung | `getProjectionSummary` | Zählwerk |
| Zähler-Status-Matrix | `listZaehler` | Zählwerk |
| Log-Status-Verteilung | `listLogs` | Log Analyzer |
| Letzte Pulls | `listLogs` | Log Analyzer |
| System-Metriken | `lib/system-metrics` | Admin |

### 6.4 CLS = 0.00 im Editor-Modus

Der Editor-Modus ist genau der Fall, vor dem die CLAUDE.md-Konvention warnt: Controls, die
nach Mount erscheinen. Umsetzung: Editor-Chrome von erster Farbe an im DOM (`visibility`
statt Conditional-Mount), Widget-Skeletons mit exakt der Zielhöhe aus `WidgetRegistry`,
Drag-Vorschau per `transform` (löst kein Reflow aus). Abgesichert durch einen neuen
CLS-Test in `e2e/` nach dem Muster von `log-analyzer.spec.ts`.

### 6.5 Revidierter Zielkatalog

| Metrik | Ziel (Task) | Realistisch | Begründung |
|---|---|---|---|
| Initial JS | < 120 KB gz | **~150 KB** (Quick Fix) → **~200 KB** (nach Migration, datenintensive Routen) | React+Next-Runtime allein = ~123 KB gz |
| Lighthouse Mobile/Desktop | ≥ 98 | ≥ 95 mobil / ≥ 98 desktop | erreichbar nach § 3.1–3.3 |
| LCP | < 1,2 s | ✅ erreichbar | server-gerendert, LAN |
| INP | < 50 ms | ✅ erreichbar | – |
| CLS | 0.00 | ✅ erreichbar | Konvention existiert bereits |
| Tests | 0 kaputt | ✅ | 376 Unit + 68 E2E-Runs als Gate |

> Das JS-Ziel ist der einzige Punkt, der so nicht haltbar ist. Wer < 120 KB gz zwingend
> braucht, müsste den App Router verlassen (Astro/SvelteKit o. ä.) — ein anderes Projekt.

---

## 7. Messung reproduzieren

```bash
cd apps/main-portal && pnpm build
DATABASE_URL="file:/abs/pfad/dev.db" AUTH_SECRET="…" AUTH_TRUST_HOST=true \
  pnpm exec next start -p 3210
# HTML jeder Route abrufen, <script src> extrahieren, Chunks von der Platte gzippen
```

---

## 8. Plattform-Evaluation: Framework-Wechsel?

Explizit geprüft, weil das JS-Budget nur durch einen Wechsel des Frameworks unter
~120 KB gz zu bringen wäre.

### 8.1 Was ein Wechsel einbringen würde

Der gemessene Next-Boden von ~123 KB gz besteht aus zwei Teilen:

| Anteil | gz | Reduzierbar? |
|---|---:|---|
| React 19 + react-dom (Kern) | ~45 KB | nein, in jedem React-Stack |
| App-Router-/RSC-Client-Runtime (Flight-Client, Router, Prefetch, Server-Action-Client) | **~78 KB** | nur durch Framework-Wechsel |

| Plattform | Boden | Quelle |
|---|---:|---|
| Next 16 App Router | **123 KB gz** | in diesem Repo gemessen |
| React + Vite / React Router v7 | ~50 KB gz | Literaturwert, hier nicht gemessen |
| Astro + React-Islands | 0 KB (statische Shell) / ~50 KB je Island-Route | Literaturwert |
| SvelteKit | ~18 KB gz | Literaturwert |

**Aber:** Ohne RSC verlieren wir, dass **27 Server-Components heute gar nicht ausgeliefert
werden**. Fallen sie in den Client-Graph, kommen ~30–50 KB gz zurück. Netto-Ersparnis eines
Wechsels auf React Router v7 also realistisch **~35 KB gz** — für einen kompletten Umbau von
Routing und Data-Loading. Das lohnt nicht.

Nur ein Wechsel *aus React heraus* (SvelteKit) brächte die ~100 KB. Dem stehen drei harte
Blocker entgegen.

### 8.2 Die drei Blocker

1. **`@react-pdf/renderer` ist React-only.** `src/components/pdf/LogAnalyzerReport.tsx` (476 Z.)
   + `YearlyOverviewReport.tsx` (361 Z.) = 837 Zeilen React, die die PDF-Berichte erzeugen.
   In Svelte/Astro-nativ müsste die PDF-Erzeugung komplett neu gebaut werden — anderes
   Layout-Modell, andere Bibliothek. Der teuerste und am wenigsten offensichtliche Posten.
2. **Recharts ist React-only.** 4 Chart-Komponenten + Dyno-Plot + der geteilte
   `SERIES_COLORS`/`ChartLegend`-Vertrag.
3. **Die Deploy-Pipeline ist Next-förmig.** `output: standalone`,
   `outputFileTracingIncludes` für die Prisma-Engine, `scripts/update.sh`,
   `deploy-swap.sh`, Docker, HA-Ingress. Die Commit-Historie (PR #9, #10) zeigt, wie viel
   Arbeit in „Prisma + Next + standalone läuft im Container tatsächlich" steckt. Das wäre
   komplett neu zu erarbeiten.

Dazu: 68 E2E-Runs neu. Es überleben nur die **376 Unit-Tests** — die liegen als reine Logik
in `lib/` und sind framework-agnostisch. Das spricht für das bestehende Design, ändert aber
nichts an den Kosten.

### 8.3 Warum die Rechnung hier ohnehin kippt

Die App ist eine **selbst gehostete Single-Instance-Anwendung im LAN**. 100 KB gz sind dort
im zweistelligen Millisekundenbereich. Der reale Kosten­treiber ist Parse-/Execute-Zeit auf
dem Telefon — und die wird von den 170 KB aus § 3.1/3.2 plus Mantine dominiert, also genau
von dem, was ohnehin entfernt wird.

### 8.4 Turbopack — heute nachgemessen, bleibt aus

PR #10 hat den Build auf `--webpack` festgenagelt (Prisma-Engine-500er). Unter Next
**16.2.11 neu getestet**: Der Build läuft durch, aber der Bug besteht **unverändert** —
der Server-Chunk enthält weiterhin

```
/ROOT/packages/database/generated/client/runtime/library.js
```

(119 `/ROOT/`-Vorkommen im Server-Output). Zusätzlich ist das Client-Chunking *schlechter*:
59 Chunks / 1025 KB gz mit **drei identischen 107-KB-Chunks** — die Deduplizierung greift
nicht. `--webpack` bleibt also richtig; der Kommentar in `package.json` ist weiterhin gültig.

### 8.5 Ergebnis

**Empfehlung: Next.js 16 App Router bleibt die Basisplattform.** Nicht aus Trägheit, sondern
weil der einzige Stack mit relevantem Einsparpotenzial (Svelte) drei Blocker hat, deren
Beseitigung teurer ist als der gesamte hier geplante Umbau — bei einem Gewinn, der im
LAN-Betrieb nicht spürbar ist.

Was stattdessen an der Plattform zu tun ist: die eingebauten Optimierungen aktivieren, die
derzeit **aus** sind (alle in 16.2.11 verfügbar, verifiziert):

| Feature | Status | Wirkung |
|---|---|---|
| `experimental.reactCompiler` | aus | Auto-Memoisierung → adressiert „unnötige Re-Renders" direkt; ersetzt die 27 manuellen `useCallback`/`useMemo` in `AnalyzerView` |
| `optimizePackageImports` | für Mantine/Tabler nicht gesetzt | Barrel-Importe → Deep-Importe |
| `cacheComponents` / `ppr` | aus | statische Shell → LCP |
| Turbopack-Build | aus (korrekt, § 8.4) | — |

---

## 9. Umgesetzt (Branch `feature/audit-security-and-bundle`)

### 9.1 Bundle — gemessen vorher/nachher

Identische Messmethode wie § 2.1 (Production-Build, `next start`, eingeloggt).

| Route | vor dem Audit | nach Zod/Recharts | nach Mantine-Ausbau | Δ gesamt |
|---|---:|---:|---:|---:|
| `/login` | 540,5 KB | 362,9 KB | **229,4 KB** | −311,1 |
| `/` | 530,9 KB | 353,3 KB | **229,0 KB** | −301,9 |
| `/apps/zaehlwerk` | 419,2 KB | 350,6 KB | **223,9 KB** | −195,3 |
| `/apps/zaehlwerk/zaehler` | 430,4 KB | 360,8 KB | **233,7 KB** | −196,7 |
| `/apps/zaehlwerk/berichte` | 421,0 KB | 352,4 KB | **227,6 KB** | −193,4 |
| `/apps/log-analyzer` | 554,3 KB | 376,8 KB | **252,2 KB** | −302,1 |
| `/apps/log-analyzer/history` | 545,0 KB | 367,4 KB | **240,7 KB** | −304,3 |
| `/apps/log-analyzer/dyno` | 555,3 KB | 377,7 KB | **248,5 KB** | −306,8 |
| `/settings` | 556,1 KB | 377,3 KB | **253,1 KB** | −303,0 |
| `/changelog` | 537,1 KB | 359,5 KB | **229,9 KB** | −307,2 |

Alle drei Spalten mit derselben Methode gemessen (§ 7): Production-Build, `next start`,
eingeloggt, `<script src>` aus dem HTML jeder Route, Chunks von der Platte gzippt.

**Der Mantine-Ausbau bringt weitere 124–134 KB gz je Route** — mehr als der Zod- und der
Recharts-Fix zusammen. Gegenüber dem Ausgangszustand liegen die Routen jetzt
**55–58 % niedriger**.

Recharts und Zod sind auf **keiner** Route mehr im initialen Graph (verifiziert durch
Chunk-Inhaltsprüfung, nicht nur an der Größe). Abzüglich der `noModule`-Polyfills
(38,7 KB, moderne Browser laden sie nicht) liegen die Routen bei **~185–214 KB gz**.

Dass auch die Log-Analyzer-Routen 177 KB am Zod/Recharts-Schritt verloren, war nicht
offensichtlich: Recharts hing über den Shared-Chunk des Root-Layouts im eager Graph
*aller* Routen, nicht nur des Launchers — die `React.lazy`-Grenzen dort waren wirkungslos,
solange `AdminPanel` es statisch importierte.

### 9.2 Autorisierung — verifiziert

Matrix gegen den laufenden Production-Server, drei Identitäten:

| Endpunkt | anonym | `USER` ohne App-Freigabe | `ADMIN` |
|---|---|---|---|
| `GET /api/apps/log-analyzer/logs` | 401 | **403** | 200 |
| `GET /api/apps/log-analyzer/logs/[id]` | 401 | **403** | 404 |
| `DELETE /api/apps/log-analyzer/logs/[id]` | 401 | **403** | 404 |
| `GET /api/update/status` · `check` | 401 | **403** | 200 · 502¹ |
| `POST /api/update/trigger` | 401 | **403** | 202 |
| `GET /api/system/update/state` | 401 | **403** | 200 |
| `GET /api/backup/download` | 401 | **403** | 200 |
| `GET /api/system/metrics` | 401 | **403** | 200 |

¹ 502 = externer Netzwerkaufruf, offline erwartbar.

Geschlossen wurden:
- **14 Server Actions** in `zaehler-actions.ts` + **3** in `location-actions.ts` → `assertAppAccess("zaehlwerk")`
- **Log-Analyzer-API** (Liste, Einzellog, Report, SSE-Stream) → `denyUnlessAppAccess("log-analyzer")`
- **Update-Routen** (Trigger, Status, Log, Check, State, Stream) → `denyUnlessAdmin()`
- **Zusatzfund beim Nachziehen:** `backup-actions.ts` nutzte `getSessionUser()` ausschließlich
  für den Audit-Eintrag. `restoreBackup` — im Modus „reset" löscht es **alle** Tabellen — war
  damit für jeden eingeloggten Nutzer aufrufbar, ebenso `/api/backup/download` (Vollabzug der
  Instanz). Beide jetzt **Admin-only**; `importMeter`/`importReadings` auf Zählwerk-Zugriff.

> **Verhaltensänderung:** `SystemBackupCard` wurde bisher jedem Nutzer angezeigt und ist jetzt
> auf Admins beschränkt, damit UI und Durchsetzung übereinstimmen. Falls Nicht-Admins bewusst
> ein eigenes Backup ziehen können sollen, braucht das einen eigenen, auf ihre Daten
> begrenzten Endpunkt — der Vollabzug ist dafür das falsche Werkzeug.

### 9.3 Weitere Fixes

- **§ 4.4 Doppelquery:** `listZaehler()` hinter `React.cache()`; das Dashboard führte sie
  zweimal pro Request aus (direkt + über `getConsumptionSummary`). Auch die
  App-Zuordnung (`allowedAppIdsFor`) ist jetzt pro Request memoisiert.
- **§ 3.1 Ursache behoben, nicht umgangen:** neuer zod-freier Einstiegspunkt
  `@zaehlwerk/database/client` (`src/client.ts`), Rollen-Konstanten nach `src/roles.ts`
  ausgelagert. `shared.ts` bleibt der Server-Barrel.
- `MeterImportCard` prüft die Preview jetzt strukturell statt per Zod — die maßgebliche
  Validierung lief ohnehin server-seitig in `importMeter`.

### 9.4 Testlage

`pnpm typecheck` · `pnpm lint` · **376 Unit-Tests** · **91 E2E-Tests** (2 Chromium-only
übersprungen) — alle grün. Keine Testanpassung nötig.

---

## 10. Empfohlene Reihenfolge

| # | Maßnahme | § | Aufwand | Wirkung |
|---|---|---|---|---|
| 1 | Auth-Checks: Server Actions + Log-API + Update-Trigger | 4.1–4.3 | S | **Sicherheit** |
| 2 | Zod aus dem Client-Bundle | 3.1 | S | −67,5 KB überall |
| 3 | `AdminPanel` → `lazy` | 3.2 | XS | −103 KB auf 5 Routen |
| 4 | `React.cache()` + `_count` im Dashboard | 4.4 | S | halbe DB-Last |
| 5 | CSV-Batching, `listLogs`-Pagination, WAL | 4.5–4.7 | M | Stabilität |
| 6 | Mantine-CSS granular ODER Stack-Migration | 3.3 / 5 | XS / XL | −30 KB / −120 KB |
| 7 | Dynamisches Dashboard | 6 | L | Feature |
| 8 | E2E gegen Production-Build | 4.9 | S | Testqualität |

Schritte 1–5 sind unabhängig von der UI-Entscheidung und sollten **zuerst** laufen.
