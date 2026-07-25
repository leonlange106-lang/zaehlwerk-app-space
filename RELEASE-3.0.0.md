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

## 3. Release-Channel (stable / beta) — gebaut

**Was da ist**

- `Setting`-Key `update.channel` (`"stable" | "beta"`, Default `stable`), gelesen über
  `getUpdateChannel()`. In der DB, nicht in einer Env-Var: es ist eine Entscheidung
  pro Instanz und muss das Neuanlegen des Containers überleben.
- Channel-Umschalter in den Plattform-Einstellungen (`SegmentedControl`,
  `data-testid="update-channel"`), admin-only über `setUpdateChannelAction`
  → `requireAdmin()` + Audit-Eintrag.
- `fetchLatestReleaseForChannel()` im Updater. `releases/latest` von GitHub war
  dafür unbrauchbar: **Pre-Releases sind darin gar nicht enthalten**, ein Beta-Stand
  wäre also unsichtbar geblieben. Die neue Funktion listet Releases und filtert
  selbst — `stable` = ohne Pre-Release-Flag, `beta` = jede veröffentlichte Version.
  Entwürfe nie. Sortiert nach `published_at`, nicht nach GitHubs Reihenfolge.
- `resolveUpdateTarget()` (`lib/update-target.ts`) löst den Channel zu einem
  **Tag** auf. `/api/update/check` liefert ihn mit aus, `/api/update/trigger`
  reicht ihn als `UPDATE_REF` an `scripts/update.sh`.
- `scripts/update.sh` deployt bei gesetztem `UPDATE_REF` genau diesen Tag
  (`git fetch --tags` + `git checkout --detach`). Ohne `UPDATE_REF` läuft der
  bisherige Branch-Pfad — mit einem zusätzlichen `git checkout $UPDATE_BRANCH`
  davor, weil ein vorheriger Tag-Deploy HEAD detached zurücklässt und `git pull`
  dort verweigert.

**Warum beta auch stabile Releases enthält.** Eine stabile Version, die nach dem
letzten Beta erscheint, *ist* neuer. Ein Tester soll darauf wechseln und nicht
unbegrenzt auf einem älteren Pre-Release sitzen bleiben.

**Der Branch-Fallback, und warum er nötig ist.** Ein Channel zeigt bewusst auf
einen Tag — ein Branch-Head ist kein freigegebener Stand. Aber dieses Repo hat
**noch keinen stabilen Release-Tag**; jedes Release bisher ist ein Pre-Release.
Ohne Fallback hätte eine Instanz auf `stable` schlicht nichts zu installieren und
würde stumm keine Updates mehr bekommen — schlimmer als dem Branch zu folgen. Also:
Hat ein Channel keine veröffentlichte Version, folgt das Update `UPDATE_BRANCH` wie
vor der Channel-Einführung, und die Einstellungen sagen das auch hin
(„Nächstes Update installiert: Branch main — für den Channel „stable" ist noch
keine Version veröffentlicht"). Sobald ein stabiles `v3.0.0` getaggt ist,
verschwindet der Fallback von selbst.

**Downgrade bleibt bewusst aus.** Ein Wechsel zurück auf Stable rollt nicht
zurück: `prisma db push` ist additiv und macht Spalten nicht rückgängig. Die
Instanz bleibt auf dem Beta-Stand, bis eine stabile Version ihn überholt. Die UI
sagt das direkt am Umschalter.

**Was noch offen ist:** der GitHub-Aufbau mit `next` als Beta-Branch (§ 7). Solange
alles über `main` läuft und Betas von dort getaggt werden, ist der Channel
funktionsfähig, aber die Trennung ist eine Konvention und keine Struktur.

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

## 7. Backlog: Plattform & UI

Gesammelte Ideen, **nichts davon umgesetzt**. Mit den Stellen im Code, an denen sie
ansetzen, und mit dem, was beim Nachsehen aufgefallen ist.

### 7.1 Update-Fortschritt mit echten Einzelschritten

Heute zeigt der Stepper vier Stufen (`UPDATE_STEPS` in `lib/update-status.ts`),
während `scripts/update.sh` gut zwanzig nummerierte Abschnitte durchläuft und in
`/data/update.log` schreibt. Der Balken springt deshalb minutenlang nicht, obwohl
sichtbar etwas passiert.

- **Ansatz:** `write_status` im Skript kennt die Stufe bereits — es müsste
  zusätzlich `step`/`stepCount` schreiben, und die Stufen müssten in
  `update-status.ts` von 4 auf die echte Liste wachsen.
- **Fallstrick:** Der Container wird mitten im Update neu erstellt, die SSE-Verbindung
  reißt ab. Der Fortschritt muss deshalb aus `/data/update-status.json` rekonstruierbar
  bleiben und darf nicht im Speicher des Servers leben — genau der Fehler, an dem
  der alte Updater auf „building" hängen blieb.
- **Nicht offensichtlich:** Ein Schritt-Zähler suggeriert gleichmäßigen Fortschritt.
  Der Docker-Build ist aber 80 % der Wartezeit. Entweder die Schritte gewichten oder
  gar keinen Prozentwert versprechen, sondern nur „Schritt 14 von 22: Image bauen".

### 7.2 Benachrichtigungs-Drawer (Glocke oben rechts)

**Die Glocke hat heute gar keinen Handler** — `PortalShell.tsx` rendert einen Button
mit `aria-label="Benachrichtigungen"` und sonst nichts. Ein Bedienelement, das
aussieht wie eines und keines ist.

- **Erste Füllung:** verfügbares Update (`/api/update/check`), fehlgeschlagenes
  automatisches Backup, überfällige Wartung — alles Zustände, die die Plattform
  schon kennt.
- **Später:** anstehende/überfällige Ablesungen. Dafür braucht ein Zähler ein
  Ableseintervall, das er heute nicht hat — also Schemaänderung, damit erst nach
  einem Self-Update wirksam.
- **Fallstrick:** Der Toast-Mechanismus (`components/ui/Toast.tsx`) ist für
  Flüchtiges gedacht und hält nichts fest. Benachrichtigungen brauchen einen
  gelesen/ungelesen-Zustand, sonst sind sie nur Toasts mit Extraschritten.

### 7.3 Suchfunktion

**Das Suchfeld im Header ist heute Dekoration:** `PortalShell.tsx` hält `query` im
State und benutzt es nirgends. Es sieht funktionsfähig aus und tut nichts — das ist
schlechter, als es wegzulassen.

- **Sinnvoller Umfang:** Zähler (Name, Standort), Logs (Bezeichnung, Dateiname,
  Tags), Einstellungsabschnitte, Changelog-Einträge.
- **Ansatz:** eine Route `api/search`, die pro Quelle begrenzt liefert, plus ein
  Ergebnis-Popover. Volltext über SQLite FTS5 wäre möglich, ist aber für diese
  Datenmengen Overkill — `contains` über die paar indizierten Spalten reicht.
- **Fallstrick:** Suche muss die App-Freigaben respektieren. Ein Treffer aus einer
  App, für die der Benutzer keine Freigabe hat, wäre ein Informationsleck —
  dieselbe Lektion wie bei den Server Actions in `AUDIT.md` § 4.1.

### 7.4 Einstellungen in Gruppen aufteilen

Die Plattform-Einstellungen sind auf dem Handy **13 629 px** hoch (gemessen im
Screenshot-Lauf). Das ist kein Bildschirm mehr, das ist eine Schriftrolle.

- **Ansatz:** Unterseiten statt eines Stapels — System & Update, Benutzer & Rechte,
  Sicherheit & Zugriff, Daten & Backup, Integrationen. Die Karten existieren bereits
  als eigenständige Komponenten, es fehlt nur das Routing.
- **Synergie:** Das Navigationsmenü kann diese Gruppen als eigene Ebene führen,
  genau wie es Zähler und Logs schon tut.

### 7.5 Fahrzeugprofile pro Fahrzeug statt global

Beim Beheben des Prüfstand-Fehlers aufgefallen: `spec-store.ts` und `dyno-store.ts`
halten **je genau ein** Profil im `localStorage`. Wer zwei Autos loggt, überschreibt
sich selbst — und ein Bericht ist nicht reproduzierbar, weil das Profil, gegen das
er bewertet wurde, inzwischen ein anderes sein kann.

- **Ansatz:** beide Profile in die DB, gekoppelt an ein benanntes Fahrzeug; das
  aktive Fahrzeug wird umgeschaltet statt überschrieben. Ein Log referenziert das
  Fahrzeug, gegen das es bewertet wurde.
- **Hängt zusammen mit** § 6.3 (eigene Fahrzeugmodelle) — dieselbe Schemaänderung.

### 7.6 Mehr Referenz-Profile für den Prüfstand

`DYNO_PRESETS` deckt **3 der 25 Katalogmodelle** ab. Für alles andere zeigt der
Prüfstand jetzt eine Warnung („Masse, Reifen, Übersetzung und Luftwiderstand sind
Platzhalter"), was ehrlich, aber kein Ersatz für Daten ist.

- **Nicht offensichtlich:** Ein erfundenes Leergewicht ist schlimmer als gar keins —
  die Schätzung sieht danach genauso selbstbewusst aus wie eine richtige. Profile
  nur mit belegten Werten ergänzen.
- **Besser als nachgelieferte Presets: eigene Referenzprofile anlegen dürfen.** Wer
  das Auto fährt, kennt Leergewicht, Reifengröße und Übersetzung — und kann sie
  belegen. Ein benanntes, wiederverwendbares Profil („E92 335i, Sommerreifen"), das
  wie ein mitgeliefertes Preset auswählbar ist, löst das Abdeckungsproblem dauerhaft
  statt es Modell für Modell nachzuziehen.
  - **Ansatz:** dieselbe Ablage wie § 7.5 — ein Profil ist ein Datensatz, kein
    Konstanten-Eintrag im Code. Die mitgelieferten Presets werden damit nur noch
    Startwerte.
  - **Teilen wäre denkbar** (Profil exportieren/importieren wie beim Zähler-Export),
    braucht aber eine Herkunftsangabe: ein fremdes Profil ist eine Schätzung eines
    Fremden, und der Prüfstand darf nicht so tun, als sei sie gemessen.

### 7.7 Marke überarbeiten und in den Header holen

Das App-Space-Zeichen taucht heute nur auf der Startseite auf; die Kopfzeile zeigt
stattdessen das Icon der *aktiven App*. Die Plattform hat damit im Alltag kein
eigenes Gesicht.

- **Gewünscht:** überarbeitetes Zeichen, das auch in der Kopfzeile steht — neben
  oder statt dem App-Icon, ohne dass die Zuordnung „in welcher App bin ich gerade"
  verloren geht. Das ist der eigentliche Entwurfskonflikt: die Kopfzeile trägt
  heute genau eine Marke, künftig zwei Ebenen.
- **Vorgehen, wenn es so weit ist:** mehrere Entwürfe in unterschiedlichen
  Designsprachen zur Auswahl vorlegen, nicht einen einzelnen Vorschlag.
- **Randbedingungen aus dem Bestand:** `components/BrandLogo.tsx` ist bewusst
  **inline** und kein `<img src>`, damit `currentColor` greift und das Zeichen dem
  Theme-Umschalter folgt — ein referenziertes SVG ist ein eigenes Dokument und kann
  das nicht. Ein neues Zeichen muss diese Eigenschaft behalten. Dazu kommen
  Favicon, Apple-Icon und das Manifest, die dieselbe Form tragen.

---

## 8. Animationen — geprüft, nicht umgesetzt

Auftrag war eine Machbarkeitsprüfung. Kurz: **machbar, günstig, und die Grundlagen
liegen bereits** — mit einem Fund, der vorher weg muss.

### 8.1 Was schon da ist

- `@media (prefers-reduced-motion: reduce)` in `globals.css` neutralisiert alle
  Animationen und Übergänge global. Jede neue Animation ist damit automatisch
  abgeschaltet, wenn das System es verlangt — die Barrierefreiheits-Pflicht ist
  bereits erfüllt und muss nicht pro Stelle wiederholt werden.
- Radix setzt auf Dialog, DropdownMenu, Popover und Tooltip `data-state="open"` /
  `"closed"` und hält das Element während einer laufenden CSS-Animation im DOM.
  Ein- **und Ausblenden** sind damit ohne eine Zeile JavaScript möglich.
- Tailwind v4 bringt `transition-*`, `duration-*`, `ease-*` und `@keyframes` über
  `@theme` mit. Für alles außer Layout-Animationen braucht es keine Bibliothek.

### 8.2 Ein Fund: drei tote Klassen

`components/ui/Toast.tsx` benutzt
`motion-safe:animate-in motion-safe:slide-in-from-top-2 motion-safe:fade-in`.
Diese Utilities stammen aus `tailwindcss-animate` — **das Paket ist nicht
installiert**. Im gebauten CSS kommt `animate-in` null mal vor: der Toast erscheint
heute hart, obwohl der Code etwas anderes suggeriert. Entweder die Klassen durch
eigene Keyframes ersetzen oder das Plugin aufnehmen; so stehenlassen ist die
schlechteste der drei Möglichkeiten.

### 8.3 Was sich lohnt, und was nicht

| Kandidat | Aufwand | Urteil |
|---|---|---|
| Dialog/Drawer ein- und ausblenden (Radix `data-state`) | klein | **Ja.** Ein Bottom-Sheet, das ohne Bewegung erscheint, wirkt wie ein Sprung. |
| Menü-Ebenenwechsel (Drill-down horizontal schieben) | mittel | **Ja.** Die Bewegung erklärt die Richtung — genau der Punkt, an dem gerade Verwirrung entstand. |
| Toast ein/aus | klein | **Ja**, ist ohnehin schon halb da (§ 8.2). |
| Zahlen-Zähler auf `MetricTile` | klein | **Nein.** Verzögert das Ablesen einer Zahl, deren einziger Zweck das Ablesen ist. |
| Chart-Aufbau (Recharts `isAnimationActive`) | klein | **Nein**, bewusst aus. Beim Umschalten von Kanälen würde jede Kurve neu aufbauen, und die CLS-Tests messen genau diese Phase. |
| Seitenübergänge (View Transitions API) | mittel | **Später.** In Next 16 mit App Router noch nicht rund, und ein halb funktionierender Übergang ist schlechter als keiner. |
| Skeleton-Shimmer | klein | **Nein.** Bewusste Designentscheidung: eine Kachel ohne Messwert soll wie ein unbestromtes Segment aussehen, nicht wie eine laufende Animation. |

### 8.4 Entschieden: über eine Animations-Utility-Bibliothek

Richtung steht — fließende Animationen sollen sauber eingebettet werden, nicht als
handgeschriebene Keyframes verstreut.

**Eine Einschränkung, die vorher geklärt gehört:** `tailwindcss-animate` ist ein
Plugin für Tailwind **v3**. Dieses Projekt läuft auf **v4**, das die Plugin-API
abgelöst hat. Der gepflegte Nachfolger mit denselben Utilities (`animate-in`,
`fade-in`, `slide-in-from-*`, `zoom-in-*`, `duration-*`) ist **`tw-animate-css`**
— reines CSS, wird per `@import` eingebunden, kein Plugin. Das ist auch der Weg,
den die shadcn-Dokumentation für v4 nimmt.

Damit sind die drei toten Klassen in `Toast.tsx` (§ 8.2) mit demselben Handgriff
erledigt: sie stammen genau aus dieser Utility-Familie und funktionieren, sobald
sie tatsächlich vorhanden ist.

**Reihenfolge, wenn es so weit ist:**
1. `tw-animate-css` aufnehmen und in `globals.css` importieren.
2. `Toast.tsx` verifizieren — die Klassen stehen schon da.
3. Radix-Overlays über `data-[state=open]` / `data-[state=closed]` animieren.
4. Menü-Ebenenwechsel als horizontale Bewegung.
5. Alles gegen `prefers-reduced-motion` prüfen — der globale Block greift
   automatisch, aber die E2E-CLS-Tests sollten den Vorher/Nachher-Wert bestätigen.

### 8.5 Kosten

Keine neue Laufzeit-Abhängigkeit nötig. `tw-animate-css` ist reines CSS (~2 KB gz nach Purge) und braucht keine Laufzeit.
`framer-motion` (~35 KB gz) ist für das Obige **nicht** nötig und würde ich hier
nicht aufnehmen — es lohnt erst bei Layout-Animationen mit geteilten Elementen,
die es hier nicht gibt.

**Ein Fallstrick, der bleibt:** Animierte Höhen verschieben Inhalte. Die
CLS-Disziplin aus `CLAUDE.md` gilt weiter — animiert werden `transform` und
`opacity`, nie `height` oder `width` von etwas, das im Fluss liegt.

---

## 9. Reihenfolge-Vorschlag

1. Pre-Release testen (aktueller Stand)
2. ~~Mantine-Rest entfernen~~ ✅ (§ 2)
3. ~~Release-Channel~~ ✅ (§ 3) — offen bleibt der `next`-Branch im GitHub-Aufbau
4. Tunnel-Hardening (§ 5, Teil 1) — unabhängig, sofort machbar
5. Cloudflare-Integration + 2FA-Zwang (§ 5, Teil 2)
6. HA über eigenen HTTPS-Hostname (§ 4, Weg A) — setzt 5 voraus
7. **v3.0.0 Full Release**
8. Danach Plattform-Backlog (§ 7) und Animationen (§ 8)
9. Zuletzt das Log-Analyzer-Backlog (§ 6)
