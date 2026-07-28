<!--
  Dieser Backlog lag bis 2026-07-28 nur im Arbeitsverzeichnis einer Sitzung —
  also in einem Container, der irgendwann eingezogen wird. Damit waere er beim
  naechsten Mal weg gewesen. Deshalb liegt er jetzt hier.

  Er ersetzt kein Board. Er ist der durchgearbeitete Stand: jedes Item gegen den
  Code geprueft, mit Dateipfaden, damit erkennbar bleibt, wenn eines durch eine
  spaetere Aenderung hinfaellig wird.
-->

# Backlog — zaehlwerk-app-space

Stand: 2026-07-28 · Basis: Commit `68e02ea` (113 Commits, `main`)
Stack: Next.js 16 · React 19 · TypeScript · Prisma 6 / SQLite · Auth.js ·
Tailwind v4 + Radix · pnpm + Turborepo · Vitest + Playwright

Aufwände sind Solo-Schätzungen: **XS** ≤ 2 h · **S** ≤ 1 Abend ·
**M** ≤ 1 Wochenende · **L** > 1 Wochenende

Jedes Item unten ist gegen den Code geprüft. Dateipfade sind angegeben, damit
klar ist, wo es losgeht — und damit erkennbar bleibt, wenn ein Item durch eine
spätere Änderung hinfällig wird.

---

## Teil A — Board-Setup (GitHub Projects)

### Custom Fields

| Feld | Typ | Werte |
|---|---|---|
| `Epic` | Single select | Plattform · Zählwerk · Log-Analyzer · Qualität · Security · Betrieb · DX · App:Fahrtenbuch · App:Inventar · App:Verträge · App:Tarif · App:Homelab |
| `Horizont` | Single select | Sofort · Now · Next · Later · Icebox |
| `Wert` | Number | 1–5 — realer Alltagsnutzen für **dich**, nicht theoretischer |
| `Aufwand` | Single select | XS · S · M · L |
| `Typ` | Single select | Feature · Chore · Bug · Spike |
| `Blockiert von` | Text | Item-ID |
| `Quelle` | Single select | Backlog · AUDIT.md · RELEASE-3.0.0.md · Review |

Das Feld `Quelle` ist neu und hat einen Zweck: Du führst aktuell **drei**
Backlogs (dieses Board, die offenen Punkte in `RELEASE-3.0.0.md` § 4–7 und
`AUDIT.md` § 10). Sie sind unten zusammengeführt. `Quelle` hält nachvollziehbar,
woher ein Item stammt, damit die alten Dokumente irgendwann geschlossen werden
können statt parallel weiterzulaufen.

### Views

1. **Board „Horizont"** — Spalten Sofort / Now / Next / Later / Icebox. Dein Arbeitsblick.
2. **Table „Priorisierung"** — sortiert nach `Wert` desc, `Aufwand` asc. Zum Nachfüllen von „Now".
3. **Board „Epic"** — Gruppierung nach Epic. Zeigt, ob ein Thema halbfertig liegen bleibt.
4. **Table „Chores"** — Filter `Typ = Chore` und `Horizont != Icebox`. Hält die Wartungsschuld sichtbar.
5. **Table „Altlasten"** — Filter `Quelle != Backlog`. Leert sich idealerweise auf null.

### Labels

`epic:*` · `type:feature` `type:chore` `type:bug` `type:spike`
`area:api` `area:ui` `area:db` `area:ci` `area:docs` `area:addon` `area:auth`
`breaking` · `needs-migration` · `good-first-issue`

### Fünf Regeln

1. **„Now" ist auf 3 Items begrenzt.** Hart. Kein viertes, bevor eines fertig ist.
2. **„Sofort" ist für Bugs und verbraucht keinen Now-Slot.** Ein stiller
   Rechenfehler in produktiven Zahlen wartet nicht auf einen freien Platz.
   Missbrauch dieser Spur für Features ist der einzige Weg, wie Regel 1 kippt.
3. **Jedes Release enthält mindestens einen Chore.** Sonst frisst die
   Feature-Lust die Wartbarkeit — bei `prisma db push` ohne Migrationshistorie
   ist das dein reales Risiko.
4. **Priorisierung = Wert ÷ Aufwand.** RICE/WSJF ist bei einem Nutzer Theater.
5. **Icebox wird nicht gepflegt.** Liegt ein Item dort ein Jahr, wird es
   geschlossen, nicht verschoben.

### Issue-Template (`.github/ISSUE_TEMPLATE/backlog-item.yml`)

Anzulegen zusammen mit `CI-01` — `.github/` existiert im Repo noch nicht.

```yaml
name: Backlog Item
description: Feature, Chore, Bug oder Spike
body:
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: Was funktioniert heute nicht oder fehlt? Kein Lösungsvorschlag.
    validations: { required: true }
  - type: textarea
    id: acceptance
    attributes:
      label: Akzeptanzkriterien
      value: |
        - [ ]
        - [ ]
    validations: { required: true }
  - type: textarea
    id: notes
    attributes:
      label: Technische Notizen / betroffene Dateien
  - type: dropdown
    id: migration
    attributes:
      label: Schemaänderung nötig?
      options: ["nein", "ja - additiv", "ja - breaking"]
    validations: { required: true }
  - type: dropdown
    id: rollback
    attributes:
      label: Rollback-sicher?
      description: >
        Neue Spalten müssen optional oder defaulted sein. Ein Rollback
        überspringt die Migration bewusst - eine NOT NULL-Spalte ohne Default
        überlebt das nicht (siehe CLAUDE.md).
      options: ["nicht betroffen", "ja - additiv/defaulted", "nein - braucht Plan"]
    validations: { required: true }
```

Beide Dropdowns sind Pflicht. Das zweite ist neu und ergibt sich direkt aus dem
dokumentierten Rollback-Verhalten deines Self-Updates.

---

## Teil B — Sequenzierungslogik

Sechs Zwänge bestimmen die Reihenfolge:

1. **Stille Rechenfehler zuerst.** Zwei Stellen produzieren heute falsche Zahlen,
   die wie richtige aussehen: die nicht verdrahtete Fahrzeug-Kette (`BUG-01`)
   und der Gas-Brennwert von 2021 (`BUG-03`/`ZW-02`). Alles andere kann warten;
   Zahlen, denen du nicht trauen kannst, entwerten jede Auswertung darüber.
2. **CI vor allem Umbau.** `.github/` existiert nicht. `PR #94` liegt seit dem
   26.07. offen und bringt genau das. Ohne grünes CI sind Migration und
   Refactoring Blindflug — und Regel 3 des Boards ist nicht durchsetzbar.
3. **Prisma Migrate vor jeder Schemaänderung.** Es gibt keine
   Migrationshistorie; der Self-Update fährt `prisma db push`. Fast jedes
   fachliche Item unten ändert das Schema. Das Zeitfenster für die Nachrüstung
   schließt sich mit jeder weiteren Tabelle.
4. **`ZW-01` hat einen echten Termin.** Register `2.8.0` läuft am mME mit der
   Einspeisung los, ob Zählwerk es liest oder nicht. Nicht erfasste Zeitreihe
   ist unwiederbringlich. Einziges Item mit externem Datum.
5. **Datenqualität vor Auswertungsfeatures.** Anomalieerkennung, Budget und
   Benchmark rechnen alle auf denselben Deltas. Solange Rollover, Brennwert und
   Registertrennung nicht sauber sind, produzieren alle drei gleichzeitig
   Unsinn — und du debuggst drei Features statt einer Ursache.
6. **Neue Apps sind nicht blockiert.** Das Monorepo existiert
   (`pnpm-workspace.yaml`, `turbo.json`, `packages/database`,
   `packages/updater`), ebenso die App-Registry (`app/lib/apps.ts`) mit
   Rollen- und Freigabelogik (`lib/app-access.ts`). Eine neue App ist ein
   Eintrag in `APPS[]` plus ein Routen-Verzeichnis — kein Plattformprojekt.
   Sie stehen trotzdem hinten, weil Zwang 1–5 wichtiger ist, nicht weil etwas
   fehlt.

---

## Teil C — Roadmap

### SOFORT — Bugs

| ID | Titel | Aufw. | Wert | Quelle |
|---|---|---|---|---|
| `PLT-01` | **Zielbild**: eigenständige Dienste + Portal, Admin-/User-Ansicht | L | 5 | Review |

### NOW (3)

| ID | Titel | Aufw. | Wert | Blockiert von |
|---|---|---|---|---|

### NEXT

| ID | Titel | Aufw. | Wert | Blockiert von | Quelle |
|---|---|---|---|---|---|
| `QLT-02` | E2E gegen Production-Build statt `next dev` | S | 4 | `CI-01` | AUDIT § 4.9 |
| `UI-02` | Ladezustände: Skeletons, Spinner, Fortschritt | S | 4 | — | Review |
| `ZW-10` | Plausibilitätsprüfung auch beim Erfassen über die Oberfläche | S | 5 | — | Review |

### LATER

| ID | Titel | Aufw. | Wert | Blockiert von | Quelle |
|---|---|---|---|---|---|
| `ZW-06a` | **Abschlagsabgleich** (Nachzahlung/Guthaben) | M | 5 | `ZW-02` | Backlog |
| `ZW-05` | Anomalieerkennung (Rolling Median + MAD) | M | 5 | `ZW-02`, `ZW-04` | Backlog |
| `ZW-06b` | Ziele & Budget mit Ampel + HA-Sensor | S | 4 | `ZW-06a` | Backlog |
| `ZW-07` | Witterungsbereinigung (VDI 3807) + Benchmark | S | 4 | `ZW-02` | Backlog |
| `ZW-08` | Interpolation fehlender Ablesungen | S | 3 | `ZW-04` | Backlog |
| `HA-01` | Home Assistant ohne iframe (eigener Hostname) | M | 5 | — | RELEASE § 4 |
| `SEC-05` | Cloudflare-Hardening (Access, Service-Tokens, WAF) | M | 4 | — | RELEASE § 5 |
| `LA-01` | `ReferenceLine` + Grenzwertspalte im ParameterPanel | S | 4 | `BUG-01` | RELEASE § 6.1 |
| `LA-02` | Prüfstand-Referenzprofile (3 von 25 Modellen) | M | 3 | `BUG-01` | RELEASE § 7.6 |
| `QLT-04` | Restore-Test im CI | S | 4 | `CI-01` | Backlog |
| `QLT-05` | CSV-Batching in `refreshStaleVerdicts()` | S | 3 | — | AUDIT § 4.5 |
| `SEC-03` | Renovate + npm audit + Trivy + SBOM | S | 4 | `CI-01` | Backlog |
| `OPS-04` | Strukturiertes JSON-Logging + Request-ID | S | 3 | `API-01` | Backlog |
| `DX-01` | Deterministischer Seed-Generator (25 Jahre) | S | 4 | — | Backlog |
| `DX-02` | ADRs in `docs/adr/` | XS | 3 | — | Backlog |
| `DX-03` | semantic-release | M | 3 | `CI-01`, `DOC-01` | Backlog |
| `UI-01` | Bundle-Budget im CI | S | 2 | `CI-01` | Backlog |
| `API-03` | OpenAPI-Spec → generierter TS-Client | M | 3 | `API-02` | Backlog |
| `KFZ-01` | App Fahrtenbuch (auf `Vehicle` aufsetzend) | M | 5 | `BUG-01` | Backlog |
| `INV-01` | App Inventar & Wartungsplaner | L | 5 | — | Backlog |
| `VTR-01` | App Verträge & Abos | M | 4 | `ZW-02` | Backlog |
| `TRF-01` | App Dynamischer Stromtarif-Optimizer | M | 4 | `ZW-01` | Backlog |
| `LAB-01` | App Homelab-Statusboard | M | 4 | — | Backlog |


### ERLEDIGT seit `68e02ea`

Nicht aus Ordnungsliebe hier, sondern weil ein Backlog, der Erledigtes
weiterführt, beim nächsten Mal wieder durchgelesen werden muss.

| ID | Titel | Geliefert in |
|---|---|---|
| `CI-01` | GitHub Actions + Smoke-Test | #94 |
| `BUG-01` | Fahrzeug-Kette verdrahtet | #99 |
| `BUG-02` | Ingestion-Auth passiert den Edge-Guard | #100 |
| `BUG-03` | Gas-Brennwert nicht mehr geraten | #101 + #117 |
| `OPS-01` | Prisma Migrate statt `db push` | #102 |
| `ZW-01` | Zweirichtungszähler (Register-Modell) | #103, #104, #105, #107, #114 |
| `OPS-02` | SQLite-PRAGMAs (WAL, busy_timeout) | #110 |
| `SEC-04` | `SECURITY.md` + Meldeweg | #111 |
| `DOC-01` | Versionswahrheiten auf eine reduziert | #111 |
| `ZW-09` | Ableseintervall pflegbar | #112 |
| `ZW-04` | Rollover-Erkennung | #113 |
| `SEC-01` | Rate-Limit + Lockout auf `/login` | #109 |
| `API-01` | Einheitliches Fehlerformat (RFC 9457) | #115 |
| `API-02` | Schreibseite `/api/v1` + `updateTarifAction` | #116 |
| `ZW-02` | Gas-Faktoren zeitraumbezogen | #117 |
| `QLT-01` | `listLogs()` paginiert | #118 |
| `ZW-03` | Soft-Delete + Änderungshistorie | #119 |
| `QLT-03` | Migrations-Test gegen echte Datenbestände | #120 |

**`OPS-03`** ist neu vergeben: In der Historie steht darunter der Umbau des
Deploys (#122–#126). Das ursprüngliche `OPS-03` (JSON-Logging) heißt jetzt
`OPS-04` und ist offen.

**`QLT-02` nur halb.** Der Smoke-Test läuft gegen den Production-Build, die
E2E-Suite weiterhin gegen `next dev` (`playwright.config.ts`). Genau daher kam
der Safari-Fehlschlag, den erst das Vorwärmen der Routen entschärft hat — das
Item bleibt offen.

### ICEBOX

| ID | Titel | Notiz |
|---|---|---|
| `ZW-90` | Wärmepumpen-JAZ | Nur relevant, falls WP kommt |
| `ZW-91` | Zählerstandsmeldung an Versorger | Nice-to-have, ersetzt keine Pflicht |
| `LA-90` | Dashboard mit Widget-Katalog | Konzept in `AUDIT.md` § 6, nichts gebaut |
| `PLT-90` | i18n | Nur bei Veröffentlichung — UI ist durchgängig deutsch |
| `PLT-92` | Eigene Lovelace Card | Nur wenn `HA-01` das iframe-Problem nicht löst |
| `UI-90` | PWA / Offline-Erfassung | Hoher Nutzen, hoher Aufwand — bewusst geparkt |

**Gestrichen** gegenüber der Vorfassung, weil bereits erledigt: Monorepo/Shared
Core, CSP + Security-Header, HttpOnly-Cookies, Standalone-Docker,
PDF-Jahresbericht, HA-Add-on-Repo, Zählerwechsel-Handling, Test-Fundament,
TanStack/Pinia-Refactoring.

---

## Teil D — Items im Detail

### SOFORT

---

#### `BUG-01` — Fahrzeug-Kette verdrahten
`Epic: Log-Analyzer` · `Typ: Bug` · `S` · `Wert 5` · `area:db` `area:ui`

**Problem.** Fahrzeugprofile mit eigenen Grenzwerten sind vollständig gebaut —
und wirkungslos. Analyzer und Prüfstand bewerten jedes Log gegen
`DEFAULT_VEHICLE_SPEC`, unabhängig davon, welches Fahrzeug gepflegt oder aktiv
ist. Vier Belege:

| Stelle | Befund |
|---|---|
| `LogFile.vehicleId` (Schema) | Kein einziger Treffer in `apps/main-portal/app/` — nie geschrieben, nie gelesen |
| `app/lib/vehicle-repository.ts:107` | `getActiveVehicle()` hat keine Aufrufer |
| `lib/limit-overrides.ts`, `lib/evaluation-version.ts:69` | `effectiveLimits()` und `evaluationVersionFor()` nur in Tests verwendet |
| `AnalyzerView.tsx:86`, `DynoView.tsx:119` | Lesen die Spec über `loadVehicleSpec()` aus localStorage — `saveVehicleSpec()` wird nirgends aufgerufen |

`VehicleSpecForm` schreibt seit Paket G ausschließlich in die DB. Der
localStorage-Pfad, aus dem die Views lesen, wird seitdem von niemandem mehr
befüllt. `Vehicle.limitOverrides` und `Vehicle.dynoProfile` haben damit keinen
Effekt auf irgendeine Auswertung.

Besonders unangenehm: Der `evalVersion`-Fingerprint, der laut `CLAUDE.md` genau
diesen Fall abfangen soll („eine benutzerdefinierte Grenze ist unsichtbar für den
automatischen Hash"), wird aus der Default-Konstante gebildet und greift ins Leere.

**Akzeptanzkriterien**
- [ ] `AnalyzerView` und `DynoView` beziehen die Spec über `getActiveVehicle()`
      aus der DB, nicht aus localStorage
- [ ] Bewertung läuft über `effectiveLimits(vehicle)`, Cache-Key über
      `evaluationVersionFor(effectiveLimits(...))` — die per-Fahrzeug-Variante
- [ ] `LogFile.vehicleId` wird bei Ingestion und Upload gesetzt; die
      Detailansicht zeigt, gegen welches Fahrzeug bewertet wurde
- [ ] Bestehende Logs mit `vehicleId = null` behalten die Default-Bewertung und
      werden nicht rückwirkend umbewertet
- [ ] `saveVehicleSpec()` / `spec-store.ts` entfernt, soweit nicht mehr als
      Coercer gebraucht — toter Pfad bleibt nicht liegen
- [ ] Stale Kommentar `VehicleSpecForm.tsx:57` („persists to localStorage — no
      server round trip") korrigiert
- [ ] `CLAUDE.md` an der betroffenen Stelle korrigiert
- [ ] Regressionstest: Fahrzeug mit abweichendem Limit → Log wird anders
      bewertet als mit Default-Spec (der Test, der heute fehlt)

**Notiz.** Reihenfolge beachten: Erst verdrahten, dann `LA-01`/`LA-02` — beide
zeigen Grenzwerte in der UI und wären sonst genauso wirkungslos.

---

#### `BUG-02` — Ingestion-Auth passiert den Edge-Guard nicht
`Epic: Security` · `Typ: Bug` · `XS` · `Wert 4` · `area:auth` `area:api`

**Problem (zu verifizieren).** `proxy.ts:38-42` lässt über `PAT_API_PREFIXES`
nur `Authorization: Bearer zw_pat_…` durch. Die Ingestion authentifiziert mit
`X-API-Key` oder `Bearer zw_ing_…` (`lib/ingestion-auth.ts:26`). Nach Aktenlage
wird ein Ingest-Request auf `/api/v1/logs/ingest` damit am Edge mit 401
abgewiesen, bevor der Route-Handler seine eigene Prüfung ausführt.

Warum das unentdeckt blieb: Die vier Route-Tests rufen `POST()` direkt auf und
umgehen den Guard vollständig.

**Erster Schritt ist Verifikation, nicht Reparatur:**

```sh
curl -i -X POST https://<instanz>/api/v1/logs/ingest \
  -H "X-API-Key: zw_ing_…" -H "Content-Type: text/csv" --data-binary @log.csv
```

401 mit JSON-Body vom Guard → bestätigt. Antwort vom Handler → hinfällig, Item
schließen.

**Akzeptanzkriterien (falls bestätigt)**
- [ ] `proxy.ts` lässt `zw_ing_`-Bearer und `X-API-Key` für den
      Ingest-Präfix durch — Autorisierung bleibt im Handler
- [ ] Der Edge-Guard erhält keine DB-Abhängigkeit (Edge-Runtime)
- [ ] E2E- oder Integrationstest **über den Guard**, nicht am Handler vorbei —
      sonst wiederholt sich die Lücke
- [ ] Prüfen, ob `/api/export`, `/api/backup` dasselbe Problem haben

**Nebenbefund, gleich mit erledigen:** `proxy.ts:16` listet `/api/setup` in
`PUBLIC_API_PREFIXES`, aber `app/api/setup/route.ts` existiert nicht — Setup
läuft über die Server Action `setupAdminAction`. Toter Allowlist-Eintrag,
entfernen.

---

#### `BUG-03` — Gas-Brennwert als Annahme kenntlich machen
`Epic: Zählwerk` · `Typ: Bug` · `XS` · `Wert 4` · `area:ui`

**Problem.** `packages/database/src/gas.ts` rechnet mit fest verdrahteten
Konstanten:

```ts
// Werte aus dem Original-Projekt (Za_hler.xlsm, Stand 2021+).
export const GAS_BRENNWERT = 10.312;    // kWh/m³
export const GAS_ZUSTANDSZAHL = 0.9622;
```

Der Brennwert schwankt monatlich und steht auf jeder Jahresrechnung. Jede
Gaskostenberechnung seit 2021 nutzt den Wert von 2021 — in Tarifrechnung *und*
PDF-Report. Die richtige Lösung ist `ZW-02`; das dauert. Bis dahin darf die App
diese Zahlen nicht unkommentiert als Tatsache zeigen.

**Akzeptanzkriterien**
- [ ] Überall, wo ein aus m³ abgeleiteter kWh- oder €-Wert für Gas erscheint
      (Zähler-Detail, Berichte, PDF), steht der verwendete Faktor mit Stand dabei
- [ ] Formulierung als Annahme, nicht als Messwert — z. B. „Brennwert 10,312
      (Annahme, Stand 2021)"
- [ ] `Tooltip` oder Fußnote verweist darauf, dass der Wert je Abrechnung variiert
- [ ] Kein Statusfarben-Einsatz — das ist eine Fußnote, keine Warnung
      (vgl. `CLAUDE.md`: „eine unerreichte Grenze ist kein Urteil")

**Notiz.** Bewusst nur Anzeige. Keine Schemaänderung, kein Rechenweg angefasst —
das ist `ZW-02`. Dieses Item existiert, damit die Zeit bis dahin ehrlich ist.

---

### NOW

---

#### `CI-01` — PR #94 abschließen
`Epic: Qualität` · `Typ: Chore` · `S` · `Wert 5` · `area:ci`

**Problem.** `.github/` existiert im Repo nicht — weder Workflows noch
Issue-Templates. `CLAUDE.md` beschreibt `gh pr merge --auto` „falls
Branch-Protection CI verlangt"; es gibt keine. PR #94 („ci: GitHub Actions, plus
ein Smoke-Test gegen den Production-Build") liegt seit dem 26.07. offen und
bringt genau das. Commit `0e95a5c` zeigt, dass auf dem CI-Branch bereits ein
Smoke-Lauf existierte.

Ohne CI ist `OPS-01` nicht absicherbar und Board-Regel 3 nicht durchsetzbar.

**Akzeptanzkriterien**
- [ ] PR #94 reviewed, grün, gemerged
- [ ] Workflow läuft bei jedem PR: `pnpm typecheck`, `pnpm lint`, `pnpm build`,
      `pnpm test`
- [ ] Playwright-Suite im CI (mindestens Chromium; WebKit falls Laufzeit trägt)
- [ ] Smoke-Test gegen den **Production-Build**, nicht gegen `next dev`
- [ ] Branch-Protection auf `main`: CI muss grün sein
- [ ] `.github/ISSUE_TEMPLATE/backlog-item.yml` aus Teil A mit committen
- [ ] CI-Badge im README

---

#### `OPS-01` — Prisma Migrate einführen
`Epic: Betrieb` · `Typ: Chore` · `M` · `Wert 5` · `needs-migration` · blockiert von `CI-01`

**Problem.** `packages/database/prisma/` enthält nur `schema.prisma` und
`seed.ts` — **kein `migrations/`**. Der Self-Update fährt laut `CLAUDE.md`
`prisma db push` beim Deploy: Das macht die DB dem Schema gleich, ohne
Historie und ohne Prüfung, was dabei verloren geht.

Deine eigene `CLAUDE.md` beschreibt den gefährlichen Fall bereits:

> „`prisma db push` macht die DB dem übergebenen Schema gleich, *in beide
> Richtungen*: bei einem älteren Schema will es die Spalten der neueren Version
> löschen — es bricht entweder ab oder zerstört mit `--accept-data-loss` echte
> Daten."

Deshalb überspringt ein Rollback die Migration bewusst. Das ist eine tragfähige
Notlösung, aber keine Grundlage für `ZW-01`, `ZW-02`, `ZW-03` und `ZW-04` — die
alle das Schema anfassen.

**Der heikle Teil ist der Einstieg**, nicht Prisma Migrate selbst: Bestehende
Installationen haben Tabellen, aber keine `_prisma_migrations`.

**Akzeptanzkriterien**
- [ ] Baseline-Migration, die exakt dem aktuellen Schema entspricht
      (`prisma migrate diff --from-empty --to-schema-datamodel`), **manuell geprüft**
- [ ] Bestehende Instanzen werden beim ersten Start per
      `prisma migrate resolve --applied <baseline>` gestempelt, nicht neu angelegt
- [ ] Startup-Logik: leere DB → `migrate deploy`; Tabellen ohne
      `_prisma_migrations` → stempeln, dann `migrate deploy`; sonst `migrate deploy`
- [ ] `db push` aus `scripts/update.sh` entfernt, ersetzt durch `migrate deploy`
- [ ] Automatisches DB-Backup **vor** jeder Migration, mit Versionsstempel im
      Dateinamen (Backup-Engine existiert: `lib/backup-engine.ts`)
- [ ] Fehlgeschlagene Migration → Container startet **nicht** mit halbmigrierter
      DB, sondern loggt verständlich und stoppt
- [ ] Rollback-Verhalten bleibt dokumentiert und bewusst migrationsfrei;
      `CLAUDE.md` entsprechend aktualisiert
- [ ] `docs/migrations.md`: wie erzeugt man eine Revision, was ist rollback-sicher

**Notiz.** Der Rollback-Gotcha aus `CLAUDE.md` bleibt gültig und wird durch
dieses Item *nicht* gelöst — er wird nur sauber begründbar. Die Regel „jede neue
Spalte ist optional oder defaulted" gehört ins Issue-Template (Teil A) und ist
dort bereits enthalten.

---

#### `ZW-01` — Zweirichtungszähler (Register-Modell)
`Epic: Zählwerk` · `Typ: Feature` · `M` · `Wert 5` · `needs-migration` · blockiert von `OPS-01`

**Problem.** `Zaehler` hat genau **eine** `einheit`, `Ablesung` genau **einen**
`wert`. Kein Register, kein OBIS-Code, keine Richtung. Der verbaute mME ist
zweirichtungsfähig; mit der Einspeisung läuft Register `2.8.0` los. Was in der
Zwischenzeit nicht erfasst wird, ist als Zeitreihe unwiederbringlich verloren.

**Das einzige Item im Backlog mit einem externen Termin.**

**Modellentscheidung.** Nicht „ein Zähler, ein Wert", sondern **ein Zähler mit
n Registern**. Deckt Doppeltarif (HT/NT, `1.8.1`/`1.8.2`) mit ab, ohne das
Schema erneut anfassen zu müssen.

```
Zaehler 1—n MeterRegister (obisCode, richtung, tarif?, einheit, label)
MeterRegister 1—n Ablesung
```

**Akzeptanzkriterien**
- [ ] Model `MeterRegister` mit `obisCode`, `richtung` (`BEZUG`/`EINSPEISUNG`),
      `tarif` (nullable), `einheit`, `label`, `sortIndex`
- [ ] Migration: jeder bestehende Zähler bekommt automatisch ein
      Default-Register (`1.8.0`, `BEZUG`); **keine bestehende Ablesung ändert
      ihren Wert oder geht verloren**
- [ ] `Ablesung.registerId` additiv und defaulted (Rollback-Regel)
- [ ] `packages/database/src/consumption.ts` rechnet je Register; bestehende
      Tests bleiben grün
- [ ] `POST /api/v1/readings` akzeptiert einen Registerbezug; ohne Angabe →
      Default-Register (bestehende Smart-Home-Automationen brechen nicht)
- [ ] `GET /api/v1/meters` weist Register getrennt aus
- [ ] UI: mehrere Register je Zähler sicht- und pflegbar, Diagramme je Register
      und kombiniert
- [ ] Kennzahlen **Netzbezug** und **Einspeisung** für frei wählbaren Zeitraum
- [ ] Kostenrechnung trennt Einspeisevergütung vom Arbeitspreis
      (`packages/database/src/tariff.ts`)
- [ ] Regressionstest: Zähler mit `1.8.0` + `2.8.0`, gemischte Ablesungen,
      korrekte Deltas je Register

**Notizen.**
- **Eigenverbrauchsquote und Autarkiegrad bewusst nicht in diesem Item.** Beide
  brauchen die PV-Erzeugung als drittes Register bzw. den Wechselrichter als
  Quelle. Solange die fehlt, sauber als „nicht berechenbar" ausweisen statt zu
  schätzen. Eigenes Folge-Item.
- Für das HA-Energy-Dashboard: Bezug und Einspeisung als **getrennte** Sensoren
  mit `state_class: total_increasing`, `device_class: energy`. Nicht saldieren.
- `EnergyCategory` hat bereits `PV_ERZEUGUNG` und `PV_EINSPEISUNG` — prüfen, ob
  die Kategorien nach Einführung der Register noch die richtige Achse sind oder
  redundant werden.

---

### NEXT — die wichtigsten

---

#### `ZW-02` — Gas-Faktoren zeitraumbezogen
`Epic: Zählwerk` · `Typ: Feature` · `S` · `Wert 5` · `needs-migration`

**Problem.** Siehe `BUG-03`: feste Konstanten von 2021. `kWh = m³ ×
Zustandszahl × Brennwert`, beide Faktoren stehen auf jeder Jahresrechnung und
ändern sich, der Brennwert monatlich.

**Warum nur `S`:** Das zeitraumbezogene Muster existiert bereits — `Tarif` hat
`gueltigAb`/`gueltigBis` samt Index `[zaehlerId, gueltigAb]` und die Auswahllogik
`pickTariffForDate()` in `packages/database/src/tariff.ts`. Das ist die Vorlage;
`gas.ts` bekommt dieselbe Struktur.

**Akzeptanzkriterien**
- [ ] Model `Umrechnungsfaktor` mit `zaehlerId`, `gueltigAb`, `gueltigBis?`,
      `brennwert`, `zustandszahl`
- [ ] Umrechnung **zeitraumbezogen**: ein Delta über eine Faktorgrenze wird
      anteilig gerechnet
- [ ] UI zur Pflege mit Gültigkeitszeiträumen und Überlappungsprüfung
- [ ] Fehlender Faktor → Wert als „unvollständig" markiert, **nicht** stillschweigend
      mit dem Nachbarwert gerechnet
- [ ] Migration legt aus den heutigen Konstanten einen Faktor ab 2021 an —
      bestehende Zahlen ändern sich dadurch nicht
- [ ] `GAS_KWH_FACTOR` als Fallback entfernt oder klar als Notnagel markiert
- [ ] PDF-Report weist den je Zeitraum verwendeten Faktor aus
- [ ] Tests: Delta über Faktorwechsel, fehlender Faktor, überlappende Faktoren
- [ ] `BUG-03`-Fußnoten entfernt, sobald echte Faktoren gepflegt sind

---

#### `SEC-01` — Rate-Limit + Lockout auf `/login`
`Epic: Security` · `Typ: Chore` · `XS` · `Wert 4` · `area:auth`

**Warum `XS`:** Die Infrastruktur existiert. `app/lib/rate-limit.ts` (mit Test
und `clientIdentifier`) läuft bereits auf `/api/v1/meters`, `/api/v1/readings`,
`/api/v1/logs/ingest`, `/api/v1/system/backup` und `fetch-remote`. **Nur der
Login ist nicht angeschlossen** (`app/login/`, `app/lib/login-actions.ts`).

**Akzeptanzkriterien**
- [ ] `/login` limitiert: z. B. 5 Versuche / 15 min pro IP **und** pro E-Mail
- [ ] Auch die 2FA-Challenge (`/login/2fa`) limitiert — sonst ist der zweite
      Faktor der ungeschützte Teil
- [ ] Fehlgeschlagene Logins landen im Audit-Log (`lib/audit.ts`)
- [ ] Antwortzeit und Fehlermeldung identisch für „User existiert nicht" und
      „falsches Passwort" (keine User-Enumeration)
- [ ] Hinter Cloudflare Tunnel kommt die IP aus `X-Forwarded-For` — korrekt
      auswerten, sonst limitierst du alle Nutzer gemeinsam
- [ ] Der bestehende Fehlerpfad `diagnoseTwoFactorFailure()` bleibt
      unterscheidungsfähig — ein Lockout muss als Lockout erkennbar sein, sonst
      schickst du den Nutzer in dieselbe Sackgasse, die dieses Feature vermeiden soll

**Notiz.** `SEC-05` (Cloudflare-WAF) deckt das teilweise auf Infrastrukturebene
ab. Beides ist sinnvoll — die App darf sich nicht darauf verlassen, immer hinter
Cloudflare zu stehen (`docker-compose.prod.yml` veröffentlicht Port 3000 direkt).

---

#### `API-02` — Schreibseite `/api/v1`
`Epic: Plattform` · `Typ: Feature` · `M` · `Wert 4` · blockiert von `API-01`

**Problem.** Die öffentliche API ist asymmetrisch: `GET /api/v1/meters` (seit
`68e02ea`) und `POST /api/v1/readings` — mehr nicht. Kein Weg, einen Zähler
anzulegen oder zu ändern; keiner, eine einzelne Ablesung zu lesen, zu
korrigieren oder zu löschen. Für eine HA-Integration, die auch korrigieren soll,
ist das die offensichtliche Lücke.

Dazu ein Nebenbefund: `createTarifAction` und `deleteTarifAction` existieren,
aber **kein `updateTarifAction`** — ein Tarif kann nur ersetzt, nicht korrigiert
werden.

**Akzeptanzkriterien**
- [ ] `GET/PATCH/DELETE /api/v1/readings/[id]`
- [ ] `POST/PATCH /api/v1/meters` (Anlegen/Ändern), `DELETE` mit Bedacht —
      Ablesungen hängen per Cascade daran
- [ ] `updateTarifAction` inkl. UI
- [ ] Alle neuen Routen mit Rate-Limit, PAT-Auth und Audit-Eintrag
- [ ] Fehler im Format aus `API-01`
- [ ] Route-Tests **über den Guard**, nicht nur am Handler (Lehre aus `BUG-02`)
- [ ] `docs/integrations/home-assistant/` um die Schreibbeispiele ergänzt

---

### LATER — die größeren Brocken

---

#### `ZW-06a` — Abschlagsabgleich
`Epic: Zählwerk` · `Typ: Feature` · `M` · `Wert 5` · blockiert von `ZW-02`

**Bewusst vor `ZW-06b` gezogen.** Von allen Auswertungsfeatures ist das
dasjenige mit dem höchsten Alltagsnutzen: Der Abgleich zwischen monatlichem
Abschlag und tatsächlichen Kosten beantwortet die einzige Frage, die man sich
unterjährig wirklich stellt — Nachzahlung oder Guthaben.

Die Grundlage existiert: `packages/database/src/projection.ts`
(`projectAnnualConsumption`, Methoden `linear | seasonal | auto`, mit
`ProjectionConfidence`) und `projection-ui.tsx` in den Berichten.

**Akzeptanzkriterien**
- [ ] Abschlag je Zähler oder Vertrag pflegbar (Betrag + Intervall + gültig ab)
- [ ] Gegenüberstellung: gezahlte Abschläge bis heute vs. tatsächliche Kosten
- [ ] Hochrechnung auf Abrechnungsende → erwartete Nachzahlung/Guthaben, mit
      der bestehenden `ProjectionConfidence` ausgewiesen
- [ ] Bei niedriger Konfidenz keine Eurozahl ohne Spanne — eine falsche
      Punktprognose ist schlechter als keine
- [ ] Als HA-Sensor via API verfügbar
- [ ] Tests gegen den Seed-Datensatz aus `DX-01`

---

#### `ZW-05` — Anomalieerkennung
`Epic: Zählwerk` · `Typ: Feature` · `M` · `Wert 5` · blockiert von `ZW-02`, `ZW-04`

**Bewusst ohne ML.** Rolling Median + MAD ist robust gegen genau die Ausreißer,
die es finden soll, braucht keine Trainingsdaten und ist erklärbar — ein
Verdacht, den du nicht nachvollziehen kannst, ist wertlos.

```
median   = rolling_median(delta, window=30)
mad      = rolling_median(|delta − median|, window=30)
z_robust = 0.6745 × (delta − median) / mad
Anomalie wenn |z_robust| > 3.5
```

**Passt architektonisch sauber:** `lib/notifications.ts` ist rein und getestet,
Meldungen werden aus Bedingungen **abgeleitet** statt geschrieben. Eine Anomalie
ist dort eine weitere Bedingung — nur die Quittierung braucht Persistenz.

**Akzeptanzkriterien**
- [ ] Erkennung läuft nach Ingestion, Ergebnis persistiert (nicht bei jedem
      Seitenaufruf neu gerechnet)
- [ ] Saisonalität: Vergleichsfenster ist derselbe Zeitraum der Vorjahre, nicht
      die letzten 30 Tage — sonst ist jeder Herbst eine Gasanomalie
- [ ] Anomalie wird **markiert, nie gelöscht oder korrigiert**
- [ ] Quittieren mit Grund („Gäste", „Ablesefehler", „Heizung defekt");
      quittierte Anomalien werden nicht erneut gemeldet
- [ ] Meldung über die bestehende Glocke; die Regel „der Zustand, nicht die
      Historie" gilt weiter — eine quittierte Anomalie verschwindet
- [ ] Sonderregel Wasser: Durchfluss > 0 über X Stunden ohne Unterbrechung →
      **Leckverdacht**, eigene Kategorie mit höherer Dringlichkeit
- [ ] Sonderregel Strom: nächtliches Minimum über 30 Tage = Dauerlast/Standby,
      als eigene Kennzahl
- [ ] Status über `StatusBadge` (`tone: ok | watch | risk`) — nie Farbe allein
- [ ] Tests mit synthetisch injizierten Anomalien aus dem Seed-Generator

---

#### `KFZ-01` — App Fahrtenbuch
`Epic: App:Fahrtenbuch` · `Typ: Feature` · `M` · `Wert 5` · blockiert von `BUG-01`

**Wichtig: kein zweites Fahrzeug-Entity.** Der Log Analyzer hat bereits
`Vehicle` (Prisma), `lib/vehicle-repository.ts`, `lib/vehicle-actions.ts` und
`VehicleSpecForm.tsx`. Ein paralleles Fahrzeugmodell wäre ein
Datenpflege-Albtraum — dasselbe Auto zweimal anlegen, zwei Wahrheiten.

Das Fahrtenbuch setzt auf `Vehicle` auf. Damit ist es **`M`, nicht `L`**, und
`BUG-01` ist die Voraussetzung: Erst muss die Fahrzeug-Kette überhaupt tragen.

**Akzeptanzkriterien (MVP)**
- [ ] Neue App in `app/lib/apps.ts` + Routen unter `app/apps/fahrtenbuch/`,
      Freigabe über `allowedApps` wie bei den bestehenden Apps
- [ ] Tankungen: Datum, km, Liter, €/l, **voll/teilweise**
- [ ] Verbrauch **nur zwischen zwei Volltankungen**; Teiltankungen dazwischen
      aufsummiert — alles andere liefert systematisch falsche Werte
- [ ] Wartungen und freie Kostenposten
- [ ] Kennzahlen: l/100 km, €/100 km, €/Monat, Gesamtkosten je Fahrzeug
- [ ] Fristen (HU/AU, Service) als ICS-Feed und/oder HA-`todo`-Entity
- [ ] Import aus Spritmonitor-CSV
- [ ] **Tuning-/Mod-Historie**: Softwarestände (MGFlasher, xHP), verbaute Teile
      mit Datum und Kosten, Radsätze — freies Schema mit Typ + Datum + Notiz +
      Foto, keine Überkonstruktion. Verbindet sich natürlich mit den
      Log-Analyzer-Daten desselben Fahrzeugs (`mapVersion`, `software`
      stehen bereits auf `LogFile`)

---

#### `ZW-10` — Plausibilität auch beim Erfassen über die Oberfläche
`Epic: Zählwerk` · `Typ: Bug` · `S` · `Wert 5`

**Problem.** Ein Stand unter dem letzten lässt sich über das Formular ohne
Weiteres speichern, auch ohne Zählerwechsel. Vom Nutzer gefunden, nicht von
einem Test.

Die Rechnung ist dabei **nicht** falsch: `calculateConsumption` erkennt den
Rückgang und setzt das Intervall auf `amount: null` („nicht plausibel"), und die
Detailseite sowie der Bericht zeigen dafür eine Warnung. Das Loch liegt davor —
`createAblesungAction` (`app/lib/zaehler-actions.ts`) validiert das Schema und
schreibt, mehr nicht.

**Die Asymmetrie ist der eigentliche Punkt.** `POST /api/v1/readings` lehnt
genau diesen Fall seit `API-02` mit **422** ab und verlangt entweder
`zaehlerGetauscht` + `startwertNeu` oder ein ausdrückliches
`allowImplausible: true`. Die Prüfung existiert also bereits — sie hängt nur am
maschinennahen Weg. Ein Vertipper beim Abtippen vom Zähler ist mindestens so
wahrscheinlich wie eine fehlerhafte Automation; der Mensch bekommt hier weniger
Schutz als das Skript.

**Nicht hart ablehnen — fragen.** Rückwirkendes Nachtragen und ein
Zählerüberlauf (`ZW-04`) sind legitime Fälle. Ein Formular, das sie verbietet,
erzieht zum Umgehen.

**Akzeptanzkriterien**
- [ ] `createAblesungAction` prüft dieselbe Bedingung wie der API-Handler —
      über dieselbe Funktion, nicht über eine zweite Vorstellung davon, was
      plausibel ist
- [ ] Bei Unplausibilität eine Rückfrage mit der konkreten Zahl („Verbrauch wäre
      −42 kWh"), nicht ein pauschales „ungültig"
- [ ] Drei Auswege, wie in der API: Zählerwechsel eintragen · trotzdem speichern
      · abbrechen
- [ ] Dasselbe beim **Bearbeiten** einer Ablesung, nicht nur beim Anlegen
- [ ] Der bestehende Nachlauf (`hasImplausibleIntervals`-Warnung) bleibt — er
      fängt die Fälle, die bewusst gespeichert wurden
- [ ] Test über die Server Action, nicht nur über die Rechenfunktion (die ist
      längst getestet; die fehlende Stelle ist der Aufruf)

**Notiz.** Beim selben Durchgang aufgefallen und offen: Der **Papierkorb**
(`ZW-03`) erscheint nur auf der Detailseite eines Zählers und nur, wenn etwas
darin liegt. Das war Absicht — ein leerer Papierkorb ist Lärm —, aber wer die
Funktion sucht, ohne vorher gelöscht zu haben, findet sie nicht. Kleiner
Nachtrag, kein eigenes Item wert: entweder ein Hinweis in den
Zählwerk-Einstellungen oder ein leerer Zustand mit einem Satz.

---

#### `UI-02` — Ladezustände, die etwas aussagen
`Epic: Plattform` · `Typ: Feature` · `S` · `Wert 4`

**Problem.** Die Oberfläche sagt beim Warten nichts oder das Falsche. Zwei
Beispiele, die schon aufgefallen sind: Die Detailseite eines Zählers lädt
`getZaehlerById`, `listLocations`, `listActiveApiTokens` und
`listDeletedAblesungen` parallel — bis alles da ist, steht die Seite leer. Und
der E2E-Test lief in Safari in ein Timeout, weil `next dev` die Route erst
kompilierte; sichtbar war: nichts.

**Die eigentliche Frage ist nicht „welche Animation", sondern „was weiß der
Nutzer in dieser Sekunde".** Deshalb eine Regel je Wartezeit, nicht ein Bauteil
für alles:

| Wartezeit | Mittel | Warum |
|---|---|---|
| < 200 ms | gar nichts | Ein Aufblitzen ist störender als die Pause |
| 200 ms – 1 s | Spinner am Auslöser (Knopf) | Der Ort der Ursache, nicht die halbe Seite |
| > 1 s, Form bekannt | **Skeleton** in der echten Silhouette | Nimmt den Sprung beim Einsetzen weg (CLS) |
| > 1 s, Form unbekannt | Fortschritt/Text | Ein Skeleton, der lügt, ist schlechter als keiner |
| bekannter Anteil | Fortschrittsbalken | Nur wenn der Anteil ECHT ist, siehe Notiz |

**Akzeptanzkriterien**
- [ ] `loading.tsx` für die Routen mit Server-Datenladung — Next liefert dafür
      bereits Suspense-Grenzen, das ist der günstigste Teil
- [ ] Skeletons bilden die **tatsächliche** Silhouette ab (Kartenraster,
      Tabellenzeilen, Chart-Fläche), nicht ein generisches graues Rechteck
- [ ] Kein Layoutsprung beim Einsetzen der echten Daten
- [ ] Knöpfe mit Server-Action zeigen ihren eigenen Zustand (`useFormStatus`)
      und sind währenddessen gesperrt — doppeltes Absenden ist der eigentliche
      Schaden
- [ ] `prefers-reduced-motion` respektiert: Pulsieren aus, Fläche bleibt
- [ ] Ladezustände sind für Screenreader angesagt (`aria-busy`, `role="status"`)
- [ ] Ein Wiederholen-Weg bei Fehlschlag — ein Skeleton, das nie endet, ist die
      schlechteste aller Antworten
- [ ] Die Bauteile liegen zentral (`components/ui/`) und werden benutzt, statt
      je Seite neu erfunden

**Notiz.** Der Update-Fortschritt (`UpdateSettingsCard`) ist das Vorbild UND die
Warnung: Er zeigt echte Build-Schritte, weil der alte Balken geraten hat und bei
„building" hängenblieb. Ein Fortschrittsbalken ohne echten Anteil ist eine
Lüge mit Animation. Wo der Anteil unbekannt ist, gehört ein Skeleton hin.

---

#### `PLT-01` — Zielbild: Portal vor eigenständigen Diensten
`Epic: Plattform` · `Typ: Spike → Feature` · `L` · `Wert 5` · blockiert von `LAB-01`

**Das Ziel.** Jede App läuft als eigener Docker-Container, LXC oder VM auf
Proxmox. Die Startseite zeigt, was da ist, lässt hin- und herspringen, Neues
hinzufügen und Bestehendes anpassen. Dazu **zwei Ansichten**, zwischen denen ein
Admin per Klick wechselt: in der User-Ansicht wird nur benutzt, in der
Admin-Ansicht angelegt, geändert, gelöscht, verwaltet und getestet.

**Warum das jetzt oben steht.** Nicht wegen des Portals — wegen der
Fehlerklasse darunter. Sechs Update-Versuche sind an einem einzigen
Strukturproblem gescheitert: `main-portal` ist gleichzeitig *die Anwendung*,
*der Halter der Datenbank* und *der Prozess, der das Update ausführt*. Deshalb
konkurriert jede Migration mit der laufenden App um dieselbe SQLite-Datei, und
deshalb killt jedes Anhalten den Updater. Jede Abhilfe war eine Verrenkung um
diese drei Rollen herum.

Trennt man die Apps in eigene Container/LXC/VMs, verschwindet das:

- Jede App hat ihre eigene Datenbank (bis auf die Benutzer, siehe unten).
- Ein Update betrifft **nur** die eine App; alles andere läuft weiter.
- Wer migriert, hält niemanden auf, den er zum Weiterarbeiten braucht.

Das ist kein Nebeneffekt, sondern das stärkste Argument für dieses Item — und
der Grund, warum es vor den hübschen Teilen kommt. Die **Benutzerverwaltung**
bleibt geteilt und ist damit die eine Stelle, die weiterhin sorgfältig gelöst
werden muss (Frage 1 unten).

**Warum das ein `L` und ein Spike zuerst ist.** Heute ist `main-portal` ein
Monolith: Zählwerk, Log-Analyzer und Admin sind Routen *einer* Next.js-App mit
*einer* SQLite-Datei und *einer* Auth.js-Session. „Alle Apps sind eigene
Container" heißt, drei Dinge zu beantworten, die es heute nicht gibt:

1. **Wer ist angemeldet?** Eine Session, die über Dienstgrenzen trägt —
   Forward-Auth am Reverse Proxy (Caddy steht schon davor) oder ein echter
   IdP. Ohne das meldet man sich pro App neu an, und das Portal ist ein
   Lesezeichen-Ordner mit mehr Schritten.
2. **Wem gehören die Daten?** Eine SQLite-Datei verträgt keine zwei Container
   als Schreiber — der Rest dieses Sitzungsprotokolls handelt von genau diesem
   Thema. Jeder Dienst braucht seine eigene, oder es braucht einen Serverdienst
   davor.
3. **Woher weiß das Portal, was es gibt?** Statische Liste, Labels an den
   Containern, oder Proxmox-API. Nur Letzteres erfüllt „dynamisch".

**Akzeptanzkriterien — Stufe 1 (Spike, `S`)**
- [ ] Entscheidung dokumentiert als ADR (`DX-02`): Forward-Auth vs. IdP,
      Discovery-Quelle, Datenhoheit je Dienst
- [ ] Ein bestehender Dienst probeweise hinter Forward-Auth — beweist die Kette,
      bevor irgendetwas zerlegt wird

**Akzeptanzkriterien — Stufe 2 (Ansichtswechsel, `S`)**
- [ ] Umschalter Admin/User in der Navigation, Zustand serverseitig geprüft
- [ ] In der User-Ansicht sind verändernde Wege nicht nur ausgeblendet, sondern
      **abgewiesen** — sonst ist es Kosmetik vor derselben Server-Action
- [ ] Der Zustand überlebt einen Neuladen und ist der Rolle untergeordnet: Ein
      Nicht-Admin kann nicht in die Admin-Ansicht, auch nicht per URL

**Akzeptanzkriterien — Stufe 3 (Portal, `M`–`L`)**
- [ ] Startseite listet Dienste aus der in Stufe 1 gewählten Quelle
- [ ] Zustand je Dienst (läuft / gestoppt / nicht erreichbar), nicht nur ein Link
- [ ] Anlegen/Ändern/Entfernen eines Eintrags in der Admin-Ansicht
- [ ] „Testen" je Dienst: Erreichbarkeit und Health-Endpunkt, mit Befund
- [ ] Ein nicht erreichbarer Dienst macht das Portal nicht kaputt

**Notiz.** Stufe 2 ist von Stufe 1 und 3 **unabhängig** und schon heute
wertvoll — sie betrifft den bestehenden Monolithen genauso. Wenn von diesem
Item je nur ein Teil kommt, sollte es dieser sein. Stufe 3 überschneidet sich
stark mit `LAB-01` (Proxmox-API, Token-Handling, Zustandsanzeige): Wer `LAB-01`
baut, hat die halbe Discovery schon. Deshalb die Reihenfolge — `LAB-01` zuerst,
nicht weil es wichtiger ist, sondern weil es billiger dieselbe Frage klärt.

---

#### `LAB-01` — App Homelab-Statusboard
`Epic: App:Homelab` · `Typ: Feature` · `M` · `Wert 4`

**Akzeptanzkriterien**
- [ ] Proxmox über API-Token (`PVEAPIToken=user@pam!id=uuid`), Rolle
      `PVEAuditor` (read-only)
- [ ] `/api2/json/cluster/resources?type=vm` für alle Guests
- [ ] **Kumulierte Ansicht**: zugewiesene vCPU vs. physische Kerne
      (Overcommit-Faktor sichtbar), zugewiesener vs. tatsächlich genutzter RAM
- [ ] Aufschlüsselung je Guest, sortierbar; gestoppte Guests separat
- [ ] Node-Ebene: Load, RAM, Storage-Pools, Temperatur falls verfügbar
- [ ] **Historie** über einen Zeitraum, nicht nur Momentaufnahme — sonst ist es
      nur eine hübschere Proxmox-UI
- [ ] Ampeln: Alter des letzten Backups je Guest, Zertifikatslaufzeiten,
      ausstehende Updates, USV-Status
- [ ] Token verschlüsselt gespeichert (`lib/crypto.ts` existiert, AES-GCM), nie geloggt

**Notiz.** Der Wert liegt in Aggregation und Historie. Proxmox zeigt jeden Guest;
was es nicht zeigt, ist „mein RAM-Overcommit liegt seit drei Wochen bei 140 %".
Der bestehende Admin-Bereich (`app/apps/admin/`, `lib/system-metrics.ts`) ist
das Vorbild für Aufbau und Fehlerbild — inklusive der guten Eigenschaft, ohne
Konfiguration eine Anleitung statt eines Fehlers zu zeigen.

---

## Teil E — Konkrete nächste Schritte

1. **PR #94 abschließen** (`CI-01`). Ohne CI ist alles Weitere Blindflug, und
   das Board-Setup aus Teil A wird mit demselben Commit eingecheckt.
2. **`BUG-02` verifizieren** — ein `curl` gegen die laufende Instanz. Zwei
   Minuten, und du weißt, ob die Ingestion-API überhaupt je funktioniert hat.
3. **`BUG-01` beheben.** Solange gepflegte Fahrzeugprofile wirkungslos sind,
   ist jede Log-Bewertung und jede Prüfstandszahl still falsch — und `LA-01`
   und `LA-02` wären auf Sand gebaut.
4. **`BUG-03`** als Beipackzettel, bis `ZW-02` steht.
5. **`OPS-01` starten**, weil `ZW-01` darauf wartet — und `ZW-01` einen Termin hat.
6. **`ZW-01` fertig haben, bevor die Einspeisung ans Netz geht.** Der einzige
   Punkt in diesem Dokument, bei dem Verzögerung dauerhaften Datenverlust bedeutet.
7. **`RELEASE-3.0.0.md` und `AUDIT.md` entlasten:** Die dort offenen Punkte sind
   oben als Items mit `Quelle` erfasst. Sobald sie im Board stehen, die Abschnitte
   in den Dokumenten als „überführt" markieren — sonst führst du weiter drei Listen.
