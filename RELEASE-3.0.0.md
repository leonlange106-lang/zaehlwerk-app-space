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
| **Mantine vollständig entfernt** | ✅ 0 Treffer für `mantine` in `app/`, `src/`, Configs, `package.json` |

---

## 2. Mantine-Ausbau — erledigt

Alle 47 Dateien migriert, die fünf Pakete (`@mantine/core`, `@mantine/hooks`,
`@mantine/notifications`, `postcss-preset-mantine`, `postcss-simple-vars`)
entfernt, `theme.ts` gelöscht, `postcss.config.mjs` auf Tailwind allein reduziert.

**Was dabei nicht offensichtlich war und für spätere Arbeit gilt:**

- **Preflight** ist jetzt an (`@import "tailwindcss"`). Der `@layer base`-Block in
  `globals.css` ist deshalb kein Notreset mehr, sondern nur noch das, was
  Preflight bewusst offenlässt: Listenmarker, Linkfarbe, Überschriften-Margins,
  `input[type=search]` in Safari.
- **Die 44px-Touch-Ziele** kamen früher aus einem globalen `@media`-Block, der
  Mantine-Klassen ansprach. Der ist weg — die Größe steckt jetzt in den
  Komponenten selbst (`min-h-11 sm:min-h-10` in Button, Field, FilePicker,
  Menüeinträgen). Ein neues interaktives Element erbt sie also **nicht**
  automatisch; es muss die Klassen mitbringen oder ein Kit-Primitiv benutzen.
- **`data-testid` auf Kit-Komponenten muss deklariert sein.** TypeScript
  beanstandet unbekannte Props mit Bindestrich auf einer Komponente nicht — sie
  verschwinden still. `Badge`, `Skeleton`, `Panel`, `Alert`, `Progress`,
  `SegmentedControl`, `ResponsiveDialog` und `TagsInput` deklarieren die Prop
  explizit; drei E2E-Locator hingen bereits an einer, die nie im DOM ankam.
- **`RangeSlider`** ist neu gebaut (zwei überlagerte `input[type=range]`, Griffe
  können nicht kreuzen), statt eine weitere Radix-Abhängigkeit zu ziehen. Nur der
  Analyzer nutzt ihn.
- **Formularfelder in E2E über die Rolle lokalisieren**, nicht über das Label:
  `getByLabel` matcht den Label-*Textinhalt* inklusive Pflichtfeld-Sternchen
  (Accessible Name `E-Mail`, Label-Text `E-Mail*`), und der Sichtbarkeits-Toggle
  eines Passwortfelds heißt selbst „Passwort anzeigen".

### 2.1 Drei Layout-Defekte, die dabei aufgefallen sind

Alle drei waren echte Bedienfehler auf dem Handy, keine Testartefakte — und alle
drei hatte Mantine vorher zufällig verdeckt.

1. **`min-width: auto` auf Flex-/Grid-Kindern.** Ein Panel mit einem Chart darin
   weigert sich, unter seine Inhaltsbreite zu schrumpfen, und zieht die ganze
   Spalte auf. Mantines `Grid` hatte das mit festen `flex-basis`-Prozenten
   überdeckt. `@utility panel` setzt jetzt `min-width: 0`.
2. **`Panel`s Action-Slot war `flex-none`** — er konnte weder schrumpfen noch
   umbrechen. Auf der Dyno-Seite steckt dort die dreiteilige Chart-Legende, deren
   Mindestbreite damit zur Mindestbreite der Seite wurde. Die Kopfzeile bricht
   jetzt um.
3. **`sr-only`-Inputs entkommen ihrem Scroll-Container.** `sr-only` ist
   `position: absolute`; ohne `position: relative` am eigenen Label wird der
   Containing Block das umschließende Panel. Ein absolut positioniertes Element
   wird nur von Vorfahren in seiner Containing-Block-Kette beschnitten — die
   versteckten Radios der `SegmentedControl` landeten deshalb bei x≈610 und
   zwangen die Seite in horizontales Scrollen. Symptom war ein links
   abgeschnittener Dialog: bei Seitenüberlauf bemisst sich `position: fixed` am
   aufgeweiteten Layout-Viewport, nicht am sichtbaren.

**Warum das lange unentdeckt blieb:** `expectNoHorizontalScroll` verglich
`scrollWidth` gegen `window.innerWidth` — und genau bei Überlauf weitet Chrome
den Layout-Viewport auf, `innerWidth` wächst mit. Die Zusicherung war also wahr
(610 ≤ 610), während die Seite tatsächlich seitwärts scrollte. Beide Helfer
messen jetzt gegen `document.documentElement.clientWidth`.

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

## 6. Backlog nach 3.0.0 (Log Analyzer)

Ideen für spätere Releases. **Erst nach** Redesign-Push, HA-/Cloudflare-Anbindung
und dem vollen 3.0.0. Hier festgehalten mit den Stellen im Code, an denen sie
ansetzen — damit später niemand von vorn sucht.

### 6.1 Grenzwerte je Sensor anzeigen, auch wenn nicht erreicht

Heute wird ein Grenzwert nur sichtbar, wenn er verletzt wurde (als `Violation`
mit Marker im Chart). Gewünscht: Min/Max je Kanal immer sichtbar.

- **Quelle:** `lib/engines.ts` + `lib/vehicle-spec.ts` kennen die Limits bereits
  zum Auswertungszeitpunkt; `evaluateLogPull()` müsste sie nur mit ausgeben statt
  nur gegen sie zu prüfen.
- **Darstellung:** `ReferenceLine` in `LogCharts`/`OverlayChart` plus eine Spalte
  im `ParameterPanel`.
- **Fallstrick:** Ein *nicht* erreichter Grenzwert ist **kein Urteil**. Er darf
  nicht über `StatusBadge` oder die ok/watch/risk-Tokens laufen, sonst sieht ein
  völlig unauffälliger Log alarmierend aus. Eigene, neutrale Darstellung.

### 6.2 Handlungsempfehlungen bei „Hardware-Risiko"

- **Anker:** `SafetyAlert.id` ist bereits stabil (`knock`, …). Eine Map
  `alertId → Empfehlungen[]` in einem eigenen Modul (z. B.
  `lib/remediation.ts`), geordnet von billig/wahrscheinlich nach teuer:
  höhere Oktanzahl → Zündkerzen → Zündspulen → Chargepipe/Ladeluftstrecke.
- **Ton:** Das sind Eingriffe an einem Fahrzeug. Formulierung als „prüfen" /
  „erwägen", nicht als Anweisung, und mit dem Hinweis, dass die Auswertung ein
  Datenlog interpretiert und keine Diagnose ersetzt.
- **Wichtig:** Empfehlungen ändern das Urteil **nicht** — sie erklären es nur.
  Deshalb ist hier **kein** `EVALUATION_RULES_VERSION`-Bump nötig. (Genau das
  wird reflexhaft gemacht; er gehört nur an Änderungen der Bewertungs*logik*.)

### 6.3 Eigene Fahrzeugmodelle mit ableitbaren, überschreibbaren Grenzwerten

- **Heute:** `lib/catalog.ts` + `lib/engineProfiles.ts` liefern die Profile,
  `lib/spec-store.ts` hält die Auswahl im **localStorage**.
- **Nötig:** Eigene Modelle gehören in die DB (neues Prisma-Modell) — also
  Schemaänderung und damit erst nach einem Self-Update wirksam.
- **UI-Wunsch:** abgeleiteter Wert durchgestrichen daneben, manueller Wert rot.
  **Achtung:** Rot allein verstößt gegen die Projektregel, dass Farbe nie
  alleiniger Bedeutungsträger ist (Graustufendruck der Berichte, Rot-Grün-
  Schwäche). Der manuelle Wert braucht eine zweite Ebene — Label „manuell" oder
  ein Icon.
- **Nicht offensichtlich:** Der Bewertungs-Cache (`LogFile.evalVersion`) hasht
  heute die Grenzwert-*Tabellen*. Benutzereigene Limits stehen nicht in diesem
  Hash — ein geändertes eigenes Modell würde die gespeicherten Verdikte also
  **nicht** invalidieren. Der Cache-Key muss die aktive Spec mit einbeziehen,
  sonst zeigen Logs veraltete Badges.

### 6.4 API-Anbindung / automatischer CSV-Pull weiter evaluieren

- **Vorhandene Bausteine:** `api/apps/log-analyzer/fetch-remote` (Share-Link),
  `api/v1/logs/ingest` (Push per API-Key), `apps/log-analyzer/watcher`
  (Watch-Folder). Alle drei sind aktuell als **Beta** gekennzeichnet.
- **Offen:** Ein echter Crawler zieht wiederkehrend von einer fremden Seite —
  das braucht eine Prüfung von Nutzungsbedingungen und Authentifizierung, ein
  Rate-Limit gegen die Fremdseite und einen Umgang mit Layout-Änderungen dort.
  Vor dem Bauen entscheiden, ob es wirklich Crawling sein muss oder ob ein
  Push-Weg (der schon existiert) reicht.

---

## 7. Reihenfolge-Vorschlag

1. Pre-Release testen (aktueller Stand)
2. Mantine-Rest entfernen (§ 2) → das ist der Löwenanteil
3. Release-Channel (§ 3) — braucht den GitHub-Aufbau vorher
4. Tunnel-Hardening (§ 5, Teil 1) — unabhängig, sofort machbar
5. Cloudflare-Integration + 2FA-Zwang (§ 5, Teil 2)
6. HA über eigenen HTTPS-Hostname (§ 4, Weg A) — setzt 5 voraus
7. **v3.0.0 Full Release**
8. Danach erst das Log-Analyzer-Backlog (§ 6)
