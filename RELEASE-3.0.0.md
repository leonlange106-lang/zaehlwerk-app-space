# Release 3.0.0 — Stand, offene Punkte, Plan

Arbeitsstand des UI-Umbaus und der geplanten Plattform-Themen.
Ergänzt `AUDIT.md` (Phase-1-Analyse) um das, was danach entschieden und gebaut wurde.

---

## 1. Fertig und verifiziert

| Bereich | Stand |
|---|---|
| Autorisierung (Server Actions, Log-API, Update-Routen, Backup) | ✅ verifiziert per 401/403/200-Matrix |
| Bundle: Zod- und Recharts-Leck | ✅ −177 KB gz auf jeder Route |
| Design-Sprache „Aurora Panel" (Tokens, Glas-Panels, Gradient-Akzente) | ✅ |
| Shell: Header, einheitliches Menü, Drill-down bis Zähler/Log | ✅ Mantine-frei |
| UI-Kit: Panel, Button, Badge, StatusBadge, MetricTile, KpiRail, Field, Skeleton, primitives | ✅ Mantine-frei |
| Zählwerk-Dashboard | ✅ Mantine-frei |
| App Space (Launcher) | ✅ Mantine-frei |
| Log-Bezeichnungen + Menü-Ebene (nur benannte Logs) | ✅ end-to-end verifiziert |
| Umbenennung „MGflasher Log Analyzer" → „Log Analyzer" | ✅ |
| Beta-Kennzeichnung: Remote-Import, Ingestion-API | ✅ sichtbar in Menü, Seite, Einstellungen |
| Auto-Hell/Dunkel nach Systemeinstellung (3 Modi, folgt live) | ✅ |
| Neue Marken (App Space, Zählwerk, Log Analyzer, Favicon, Apple-Icon, Wortmarke) | ✅ |

---

## 2. Offen: Mantine vollständig entfernen

**45 Dateien** importieren noch `@mantine/*`. Das ist der Rest der Migration und
die Voraussetzung dafür, Preflight einzuschalten und die Mantine-Zuordnung aus
`globals.css` zu löschen.

Nach Aufwand und Risiko gruppiert:

### 2.1 Klein (überwiegend Layout + Text)
`LinkButton`, `error.tsx`, `global-error.tsx`, `ChangelogView`, `ChartSkeletons`,
`ChannelChips`, `MetadataCard`, `ExportPanel`, `projection-ui`, `LocationsCard`,
`ZaehlwerkSettingsView`, `SmartHomeCard`, `MeterImportCard`, `SetPasswordForm`,
`TwoFactorForm`, `LoginForm`, `SetupForm`, `berichte/page`, `specs/page`.

### 2.2 Mittel (Formulare, Tabellen, Dialoge)
`ZaehlerManager`, `HistoryView`, `RemoteImportView`, `EvaluationCard`,
`ParameterPanel`, `VehicleSpecForm`, `MeterDataCard`, `ApiTokenCard`,
`AuditLogCard`, `BackupPolicyCard`, `DatabaseMaintenanceCard`, `IngestionKeyCard`,
`SecurityCard`, `SystemBackupCard`, `UserManagementCard`, `AdminPanel`,
`ResponsiveDialog`.

### 2.3 Groß (Zustandslogik + Virtualisierung + Charts)
`SettingsView` (592 Z.), `ZaehlerDetail` (577), `DynoView` (538),
`AnalyzerView` (534), `ReadingHistoryTable` (529, virtualisiert),
`ComparisonView` (400), `DynoProfileDrawer` (337), `ExportModal` (225).

### 2.4 Noch fehlende Primitiven
- **Dialog/Drawer** auf Radix Dialog (`ResponsiveDialog` neu) — Modal ⇄ Bottom-Sheet
- **Tooltip** auf Radix Tooltip
- **Toast** als Ersatz für `@mantine/notifications` (nur `HistoryView` nutzt es)
- **TagsInput** (nur `HistoryView`)
- **NumberInput**, **PasswordInput** (Sichtbarkeits-Toggle)

### 2.5 Abschluss
1. `@mantine/core`, `@mantine/hooks`, `@mantine/notifications`, `postcss-preset-mantine`
   aus `package.json`
2. `theme.ts` löschen
3. In `globals.css`: Mantine-Zuordnung + `[data-mantine-color-scheme]`-Selektoren löschen,
   `@import "tailwindcss"` **mit** Preflight, `@layer base`-Notreset entfernen
4. `postcss.config.mjs` auf Tailwind allein reduzieren
5. `$mantine-breakpoint-*` in den verbliebenen CSS-Modulen durch feste `em`-Werte ersetzen
   (`postcss-simple-vars` fällt sonst mit weg)
6. `ThemeProvider`: `dataset.mantineColorScheme`-Spiegelung entfernen

---

## 3. Offen: Release-Channel (stable / beta)

**Ziel:** In den System-Einstellungen zwischen `stable` und `beta` umschalten; das
Self-Update zieht dann den jeweils passenden Stand.

**GitHub-Aufbau**
- `main` = stable. Tags `vX.Y.Z`, GitHub-Release ohne Pre-Release-Flag.
- `next` = beta. Tags `vX.Y.Z-beta.N`, GitHub-Release **mit** Pre-Release-Flag.
- Ein Feature-Branch geht per PR nach `next`; ein Beta-Stand wird per PR
  `next → main` promoted. Keine Cherry-Picks — sonst driften die Historien.

**App-seitig**
- `Setting`-Key `update.channel` (`"stable" | "beta"`, Default `stable`)
- `scripts/update.sh`: statt fest `UPDATE_BRANCH=main` den Channel lesen und den
  neuesten passenden **Tag** auschecken (nicht den Branch-Head — ein Branch-Head
  ist kein freigegebener Stand).
- `/api/update/check` fragt die GitHub-Releases-API und meldet die neueste
  Version des gewählten Channels; Pre-Releases nur bei `beta`.
- UI in `SettingsView`: Channel-Auswahl mit deutlicher Warnung + `BetaBadge`.
- **Downgrade-Fall bedenken:** Wechsel von `beta` zurück auf `stable` kann eine
  ältere Version bedeuten. `prisma db push` ist additiv und macht Spalten nicht
  rückgängig — der Wechsel darf also nicht automatisch zurückrollen, sondern
  wartet auf die nächste stabile Version, die den Beta-Stand überholt. Das muss
  die UI sagen.

---

## 4. Offen: Home Assistant ohne iframe-Problem

**Aktueller Zustand.** `ha-addon/zaehlwerk_space` ist ein nginx-Reverse-Proxy mit
zwei Wegen, beide unbefriedigend:
- **Ingress** ist aktiv, aber die `config.yaml` hält selbst fest, dass ein
  Next.js-App unter dem dynamischen Ingress-Unterpfad an absoluten Asset-Pfaden
  404t.
- **`panel_iframe` auf Port 8099** ist der empfohlene Weg — und genau der bricht
  über die externe HA-Domain: die HA-Oberfläche kommt per HTTPS, das Panel zeigt
  auf `http://<LAN-IP>:8099`. Der Browser blockt das als Mixed Content, und von
  außen ist die LAN-IP ohnehin nicht erreichbar.

**Die Ursache ist nicht der iframe, sondern das Schema.** Ein iframe auf eine
HTTPS-Quelle funktioniert; ein iframe auf plain HTTP nicht. Zwei saubere Wege:

**Weg A (empfohlen, koppelt an Punkt 5): eigener HTTPS-Hostname.**
Die App bekommt über den Cloudflare-Tunnel `https://zaehlwerk.<domain>`. Das
HA-Panel zeigt dorthin — kein Mixed Content, funktioniert intern wie extern
identisch. `FRAME_ANCESTORS` beim Build auf die HA-Origin setzen. Das Add-on wird
damit **überflüssig** und kann entfallen, was die nginx-CSP-Duplikation (heute
handgepflegt und laut eigenem Kommentar synchron zu halten) gleich mit erledigt.

**Weg B: Ingress wirklich reparieren.**
Erfordert, dass Next.js unter einem dynamischen Unterpfad läuft. `basePath` ist
build-time-statisch, der Ingress-Pfad enthält aber ein pro-Installation-Token.
Praktikabel nur mit `sub_filter`-Rewriting aller `/_next/`-URLs im nginx —
fragil bei gestreamten Antworten (SSE nutzen wir an zwei Stellen) und muss bei
jedem Next-Update nachgeprüft werden. **Nicht empfohlen.**

---

## 5. Offen: Cloudflare-Anbindung mit 2FA-Pflicht + Tunnel-Hardening

**Heute:** `DEPLOYMENT.md` beschreibt einen `cloudflared`-Tunnel als Option, aber
es gibt keine Integration in der App und keine erzwungene zweite Schranke. Wer
den Hostname kennt, steht direkt am Login.

**Hardening des bestehenden Tunnels (zuerst, unabhängig vom Rest):**
1. **Cloudflare Access vor die gesamte Origin**, nicht nur vor einzelne Pfade.
   Bisher schlägt `DEPLOYMENT.md` das nur für `/api/update/trigger` vor.
2. **Ausnahmen mit Bedacht:** `/api/v1/*` (Ingestion) und `/api/health` brauchen
   Service-Tokens statt interaktivem Login — sonst brechen Watch-Folder,
   Home-Assistant-Push und der Docker-Healthcheck.
3. **WAF-Regeln:** Rate-Limit auf `/api/auth/*` und `/login`, Country-Block wo
   sinnvoll, Bot-Fight-Mode.
4. **`--no-autoupdate`** und der Tunnel als systemd-Service mit eigenem Nutzer.
5. **Origin-Zertifikat + `noTLSVerify: false`**, damit die Strecke
   Cloudflare→Origin nicht im Klartext läuft.
6. **`Strict-Transport-Security`** greift erst hinter echtem HTTPS — heute
   liefert die App den Header schon aus, was hinter dem Tunnel korrekt ist.

**2FA-Pflicht.** Zwei Ebenen, die sich ergänzen statt zu ersetzen:
- **Cloudflare Access** als äußere Schranke (One-Time-PIN oder IdP) — hält
  Unangemeldete komplett von der App fern.
- **App-seitig:** `totp.ts`/`two-factor-actions.ts` existieren bereits, 2FA ist
  aber optional. Für den Cloudflare-Betrieb: neuer Instanz-Schalter
  „2FA für alle Benutzer erzwingen", der beim Login ohne aktives TOTP in die
  Einrichtung zwingt — analog zu `mustSetPassword`, das im `proxy.ts`-Guard schon
  genau dieses Muster fährt.
- **Wichtig:** Der Zwang muss im Guard sitzen, nicht nur in der UI — dieselbe
  Lektion wie bei den Server Actions in `AUDIT.md` § 4.1.

---

## 6. Reihenfolge-Vorschlag

1. Pre-Release testen (aktueller Stand)
2. Mantine-Rest entfernen (§ 2) → das ist der Löwenanteil
3. Release-Channel (§ 3) — braucht den GitHub-Aufbau vorher
4. Tunnel-Hardening (§ 5, Teil 1) — unabhängig, sofort machbar
5. Cloudflare-Integration + 2FA-Zwang (§ 5, Teil 2)
6. HA über eigenen HTTPS-Hostname (§ 4, Weg A) — setzt 5 voraus
