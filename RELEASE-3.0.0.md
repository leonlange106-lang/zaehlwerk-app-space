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

### 3.1 ✅ Behoben in v3.0.0-beta.5: Stable bot Beta-Stände an

**Gemeldet nach beta.3, bestätigt im Code, behoben in Paket A.** Der Channel
wirkte nur auf die *Anzeige*, nicht auf die Update-Entscheidung — und auch nicht
auf das, was tatsächlich installiert wurde. Die Beschreibung des Defekts bleibt
hier stehen, weil sie erklärt, warum die Lösung so aussieht, wie sie aussieht.

**Was jetzt gilt:**

1. **Erkennung:** `checkForUpdates()` löst den Release-Tag des Channels zu seinem
   Commit auf und fragt GitHub, wie er zum laufenden Build steht
   (`compare/base...head`). Nur `ahead` und `diverged` sind ein Update; `behind`
   heißt, die Instanz ist bereits weiter — der Alltagsfall nach einem Beta-Test.
   Gleichheit zweier SHAs kann ein Update nicht von einem Downgrade
   unterscheiden, und genau daran lag es.
2. **Installation:** Der Branch-Fallback ist weg. Ein Channel ohne
   veröffentlichte Version bietet **nichts** an und sagt das; der Update-Knopf
   lehnt mit 409 ab. Als ausdrücklicher Entwicklermodus bleibt
   `UPDATE_ALLOW_BRANCH=1` — env-only, ohne UI, absichtlich.
3. Fällt der GitHub-Vergleich aus, degradiert die Prüfung auf den alten,
   schwächeren SHA-Vergleich — **sagt es aber in der Oberfläche**, statt eine
   Sicherheit vorzutäuschen, die sie nicht hat.

<details><summary>Der ursprüngliche Befund</summary>

**Zwei Stellen, beide falsch für `stable`:**

1. **Die Erkennung.** `checkForUpdates()` berechnet
   `updateAvailable: local.sha !== latestCommit.sha` — verglichen wird gegen den
   **Branch-Head** (`fetchLatestCommit(..., branch)`), unabhängig vom Channel.
   Da jeder Beta-Tag von `main` geschnitten wird, *ist* `main`s Spitze der
   Beta-Stand. Auf `stable` meldet die Instanz deshalb ein Update, sobald ein
   Beta gemerged wurde.
2. **Die Installation.** `resolveUpdateTarget()` liefert für `stable` heute
   `ref: null` (Branch-Fallback, weil es noch kein stabiles Release gibt), also
   deployt `update.sh` `main` — **den Beta-Code**.

**Das ist meine Fehleinschätzung, nicht nur ein Anzeigefehler.** Ich hatte den
Branch-Fallback damit begründet, dass eine Instanz ohne installierbaren Stand
stumm keine Updates mehr bekäme. Für `stable` ist die Abwägung falsch: dort
Beta-Code zu installieren ist genau das, wogegen man `stable` wählt. „Für diesen
Channel ist noch nichts veröffentlicht" ist ehrlich; ein Beta unterzuschieben
nicht.

**Praktische Warnung bis zum Fix:** Wer auf `stable` steht und aktualisiert,
bekommt den Beta-Stand samt seiner Schemaänderungen. `prisma db push` ist additiv
und macht die nicht rückgängig.

</details>

**Der Fix, wenn er drankommt**

- `updateAvailable` **channel-relativ** rechnen: den laufenden Build gegen den
  Commit des Ziel-*Releases* vergleichen, nicht gegen den Branch-Head. Der Commit
  eines Tags kommt über `GET /repos/{owner}/{repo}/commits/{tag}`;
  `target_commitish` aus dem Release-Objekt taugt nicht, das ist häufig nur der
  Branch-Name.
- **Branch-Fallback für `stable` streichen.** Kein veröffentlichtes Release im
  Channel → kein Update, und die UI sagt das. Nur als ausdrücklicher
  Entwickler-Modus über eine Env-Variable behalten, nicht als stiller Default.
- Gilt genauso für `beta`: auch dort darf nicht der Branch-Head zählen, sonst
  werden Commits angeboten, die nach dem letzten Beta-Tag gemerged wurden und in
  keinem Release stehen.
- **Danach ist ein stabiles `v3.0.0` die Voraussetzung**, damit der Stable-Channel
  überhaupt etwas anzubieten hat.

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

## 8. Animationen — gebaut

`tw-animate-css` 1.4.0. **Nicht** `tailwindcss-animate`: das ist ein Plugin für
Tailwind v3, und v4 hat die Plugin-API abgelöst. Reines CSS mit `@utility`-Regeln,
per `@import` in `globals.css`, keine Laufzeit-Abhängigkeit. Gesamtes CSS der App
danach **12,2 KB gz**.

**Der Fund, der das ausgelöst hat:** `Toast.tsx` benutzte `animate-in`,
`slide-in-from-top-2` und `fade-in` schon vorher — aus genau dieser
Utility-Familie, die aber nicht installiert war. Im gebauten CSS kam `animate-in`
**null mal** vor; der Toast erschien hart, obwohl der Code etwas anderes sagte.
Jetzt enthält das CSS `@keyframes enter` und `@keyframes exit`, und die Klassen
tun, was sie behaupten.

**Was animiert wird**

| Element | Bewegung |
|---|---|
| Bottom-Sheet (< `sm`) | steigt von der Kante auf, an der es verankert ist |
| Dialog (≥ `sm`) | blendet ein und skaliert von 95 % in der Mitte |
| Menü, Popover, Benutzermenü | Richtung aus `data-side`, kurzer 2er-Versatz |
| Tooltip | dito |
| Menü-Ebenenwechsel | schiebt sich aus der Richtung ein, aus der er kommt |
| Toast | von oben herein |

Das Ganze steckt in **einer** Konstante (`OVERLAY_MOTION` in `ui/primitives.tsx`),
die alle vier Radix-Overlays teilen — sonst driften sie auseinander.

**Drei Dinge, die dabei nicht offensichtlich waren**

1. **Radix hält das Element gemountet, solange eine CSS-Animation darauf läuft.**
   Deshalb gibt es ein echtes Ausblenden über `data-[state=closed]` — ohne
   JavaScript und ohne Unmount-Timing, das man falsch machen könnte.
2. **Der `enter`-Keyframe schreibt `transform` komplett neu.** Der Desktop-Dialog
   ist mit `-translate-x/y-1/2` zentriert — ohne Gegenmaßnahme wäre er während der
   Animation aus der Ecke hereingeflogen und am Ende eingerastet. Die
   `-[50%]`-Offsets ab `sm` stellen die Zentrierung als Start- **und** Endwert der
   Animation wieder her. Auf dem Handy gibt es das Problem nicht: das Sheet ist
   an der Kante verankert und trägt keinen Zentrierungs-Transform.
3. **Die 44px-Tap-Target-Prüfung maß mitten in der Einblendung.** Das Menü
   skaliert beim Öffnen kurz auf 95 %, eine Zeile maß dabei 43,43 statt 44px. Die
   Zusage gilt dem Ruhezustand, also misst der Test jetzt per `expect.poll` —
   die 44px müssen weiterhin erreicht werden, nur der Weg dorthin ist toleriert.

**Bewusst nicht animiert:** zählende Zahlen auf `MetricTile` (verzögert das
Ablesen genau der Zahl, für die die Kachel existiert), der Chart-Aufbau (die
CLS-Tests messen genau diese Phase) und ein Skeleton-Shimmer (eine Kachel ohne
Messwert soll unbestromt aussehen, nicht beschäftigt).

Alles läuft über `transform` und `opacity`, verschiebt also kein Layout — beide
CLS-Tests bleiben grün. Der `prefers-reduced-motion`-Block in `globals.css`
schaltet weiterhin global ab, ohne dass eine Aufrufstelle daran denken muss.

## 9. Arbeitspakete

Gruppiert nach dem, was denselben Code anfasst, dieselbe Voraussetzung teilt und
zusammen eine sinnvolle Version ergibt. Ein Paket = ein Branch = ein PR.

**Das Gruppierungskriterium, das am meisten steuert:** Schemaänderungen greifen
erst nach einem Self-Update (`prisma db push` läuft im Deploy). Alles, was
dieselbe Migration braucht, gehört deshalb in **ein** Paket — sonst zahlt man
mehrere Update-Runden für eine Sache.

**Reihenfolge:** A → B → C → D → 🏁 **v3.0.0** → E → F → G → H → I → J

**Stand 2026-07-26:** B und D sind ausgeklammert (reine Betriebsarbeit bzw. Folge
von C). E–H sind umgesetzt; I und J stehen aus.

---

### Vor v3.0.0

#### Paket A — Channel reparieren ✅ v3.0.0-beta.5

- § 3.1: `updateAvailable` channel-relativ rechnen (gegen den Commit des
  Ziel-**Releases**, nicht gegen den Branch-Head)
- Branch-Fallback für `stable` streichen; nur noch als ausdrücklicher
  Entwickler-Modus über eine Env-Variable
- Gilt genauso für `beta` — auch dort darf der Branch-Head nicht zählen

Dazu, weil klein und im selben Branch gut aufgehoben:

- **Benannte Logs im Menü führen auf die Übersicht statt ins Log.** Der
  Menüeintrag verlinkt `/apps/log-analyzer/history?log=<id>`, aber **`?log=`
  liest niemand** — `HistoryView` hat kein `useSearchParams`, der Parameter ist
  tot. Der funktionierende Weg existiert bereits: der „Öffnen"-Knopf der
  Übersicht ruft `setActiveLogId(id)` und navigiert zum Analyzer, der ihn per
  `takeActiveLogId()` abholt.
  **Besser als diesen Mechanismus im Menü nachzubauen:** `/apps/log-analyzer`
  ein `?log=<id>` verstehen lassen und den Menüeintrag darauf zeigen. Ein
  Navigationseintrag sollte ein echter Link sein — Mittelklick, neuer Tab und
  Zurück-Knopf funktionieren nicht, wenn das Ziel nur über einen
  localStorage-Seiteneffekt erreichbar ist. Die localStorage-Übergabe bleibt für
  den Weg Analyzer → Prüfstand.

*Zusammen, weil es eine Ursache mit zwei Symptomen ist (Erkennung **und**
Installation). Getrennt behoben bliebe die Hälfte stehen.*
**Risiko:** mittel — betrifft den Deploy-Pfad, und `update.sh` lässt sich lokal
nicht durchspielen.

#### Paket B — Tunnel härten 🟢 unabhängig, sofort machbar

§ 5 Teil 1 vollständig: Access vor die gesamte Origin, Service-Tokens für
`/api/v1/*` und `/api/health`, WAF-Rate-Limits, `--no-autoupdate` + systemd,
Origin-Zertifikat.

*Reine Betriebsarbeit, kein Anwendungscode — hängt an nichts.*
**Risiko:** niedrig für die App, hoch für die Erreichbarkeit. Falsch gesetzte
Access-Regeln sperren Watch-Folder, Home-Assistant-Push und den
Docker-Healthcheck aus.

#### Paket C — Zugang: Cloudflare + 2FA-Pflicht

§ 5 Teil 2: Instanz-Schalter „2FA für alle erzwingen", Zwang **im
`proxy.ts`-Guard** (nicht nur in der UI), Cloudflare Access als äußere Schranke.

*Zusammen, weil sich die beiden Schranken ergänzen; einzeln ausgeliefert
entsteht dazwischen eine Lücke.*
**Voraussetzung:** B.

#### Paket D — Home Assistant sauber

§ 4 Weg A: eigener HTTPS-Hostname über den Tunnel, `FRAME_ANCESTORS` auf die
HA-Origin. Das Add-on **entfällt** samt seiner handgepflegten
nginx-CSP-Duplikation.

*Klein, weil es zu 90 % eine Folge von C ist: das Problem war nie der iframe,
sondern das Schema.*
**Voraussetzung:** C.

### 🏁 v3.0.0 — stabil getaggt

Erst hier hat der Stable-Channel überhaupt einen Stand anzubieten.

---

### Nach v3.0.0

#### Paket E — Navigation & Auffindbarkeit ✅ v3.1.0-beta.1

- § 7.3 Suchfunktion (das Headerfeld ist heute Dekoration)
- § 7.4 Einstellungen in Gruppen (13 629 px hoch auf dem Handy)

*Zusammen, weil beide Shell und Routing anfassen und die Einstellungsgruppen
sowohl als Menüebene als auch als Suchtreffer gebraucht werden — getrennt baut
man dieselbe Struktur zweimal.* Das hat sich bestätigt: `settings/groups.ts` ist
**eine** Liste, aus der Index-Seite, Route, Menüebene und Suchindex leben.
**Achtung:** Suche muss App-Freigaben respektieren, sonst Informationsleck.

**Wie umgesetzt.** `api/search` leitet `allowedAppIdsFor(user)` pro Request neu
ab, und `matchStaticTargets()` filtert **selbst** nach App-Freigabe und
Admin-Rolle, statt sich auf den Aufrufer zu verlassen — es gibt damit keinen Pfad,
der Treffer erzeugt und das Filtern vergisst. Die Einstellungen liegen jetzt auf
`/settings/<gruppe>` (eine dynamische Route, fünf Gruppen), jede Gruppe lädt
**nur ihre eigenen** Daten; vorher liefen alle neun Abfragen bei jedem Aufruf.
Das Suchfeld ist auf dem Handy ein Icon, das ein volles Feld öffnet — vorher war
es `hidden sm:block`, das Gerät mit dem größten Bedarf hatte also gar keine Suche.

**Zwei Fallstricke, die dabei aufgefallen sind:**

- **SQLite faltet Groß-/Kleinschreibung nur für ASCII**, und `mode:
  "insensitive"` gibt es bei diesem Provider nicht. `contains: "zahler"` findet
  „Zähler", `contains: "zähler"` findet es **nicht** — in einer deutschen
  Oberfläche fällt damit der Normalfall aus, nicht der Sonderfall.
  `caseVariants()` erzeugt für nicht-ASCII-Begriffe explizite Varianten.
- **Was das SQL matcht und was der Ranker liest, müssen dieselben Felder sein.**
  Die Log-Abfrage sucht auch in `tags` und `vehicle`, der Ranker sah aber nur
  Titel und Untertitel — ein Treffer allein über ein Tag wurde geladen und dann
  stillschweigend verworfen. Zeilen tragen deshalb die gematchten Spalten mit.

**Bewusst nicht enthalten:** Changelog-*Einträge* werden nicht indiziert. Sie
kommen aus einem Live-Aufruf der GitHub-API — pro Tastendruck ein
Netzwerk-Roundtrip, und eine Suche, die ausfällt, wenn GitHub langsam ist. Die
Changelog-Seite hat ihre eigene Suche; der Index verweist nur auf sie.

#### Paket F — Zustand sichtbar machen ✅ v3.2.0-beta.1

- § 7.1 Update-Fortschritt mit echten Einzelschritten
- § 7.2 Benachrichtigungs-Drawer, **Phase 1**: Update verfügbar, Backup
  fehlgeschlagen, Wartung überfällig

*Zusammen, weil beide vom selben Update-Status und derselben SSE-Leitung leben —
und die Glocke ohne einen ersten echten Anlass leer bliebe.*
**Bewusst nicht hier:** fällige Ablesungen brauchen ein Ableseintervall am
Zähler, also eine Schemaänderung → Paket G. Eingehalten: Paket F kommt ohne
Schemaänderung aus — die Lesemarken liegen im vorhandenen `Setting`-Store.

**Zu § 7.1: die Beschreibung oben war überholt.** Sie nennt „gut zwanzig
nummerierte Abschnitte" in `update.sh` — tatsächlich sind es **vier**, und der
Kern der Beschwerde („der Balken springt minutenlang nicht") war bereits in
v3.0.0-beta mit den echten BuildKit-Schritten behoben: der Build, also rund 80 %
der Wartezeit, hat seit dem eigene Unterschritte. Zwanzig Stufen zu erfinden,
nur damit die Liste länger aussieht, hätte den Fortschritt nicht ehrlicher
gemacht. Behoben wurde stattdessen, was wirklich falsch war:

- **Der Stepper hat bei einem Rollback gelogen.** Er hakte „Datenbank migriert"
  mit grünem Haken ab — obwohl ein Rollback die Migration bewusst überspringt
  (ein älteres Schema würde `prisma db push` dazu bringen, Spalten zu löschen).
  Ausgerechnet der Schritt, dessen Verhalten man vor dem Knopfdruck verstehen
  muss, war der einzige falsch beschriftete. `mode` steht jetzt in jeder
  Statuszeile, und ein Rollback zeigt „Datenbank bleibt unverändert".
- **Keine verstrichene Zeit.** Jetzt „seit 4 min 12 s", berechnet aus den zwei
  Zeitstempeln der Statusdatei selbst — nie gegen die Uhr des Lesers, denn der
  Container wird mitten im Update neu erstellt. Eine *Rest*zeit wird bewusst
  nicht versprochen: der Docker-Build ist der größte Teil der Wartezeit, jede
  Schätzung wäre eine Zahl, für die niemand geradestehen kann.

**Zu § 7.2.** Die Glocke war ein Knopf mit `aria-label` und ohne Handler. Sie
meldet jetzt: verfügbares Update, überfälliges/nie gelaufenes automatisches
Backup, überfällige Wartung. Alles **abgeleitet** aus Zuständen, die die
Plattform ohnehin führt — es wird keine Benachrichtigungszeile geschrieben, ein
Eintrag verschwindet also, wenn seine Ursache verschwindet. Persistiert wird nur,
was gelesen wurde.

**Nicht offensichtlich, und der Grund für die Id-Regeln:** Eine Lesemarke zeigt
auf eine Id. Eine Id aus einem rohen Zeitstempel taucht eine Minute nach dem
Wegklicken wieder als ungelesen auf; eine Id ohne Version bedeutet, dass
„3.1.0 verfügbar" wegzuklicken auch 3.2.0 verstummen lässt. Deshalb: Update-Id
trägt die Version, Backup-Id ist auf den Tag gerundet. Lesemarken sind **Ids,
keine Wasserstandslinie** — eine Linie würde alles Ältere als gelesen markieren,
auch eine ernstere Bedingung, die zufällig früher beobachtet wurde.

**Was bewusst nicht gemeldet wird:** ein *abgeschaltetes* automatisches Backup
und eine nicht konfigurierte Aufbewahrung. Das sind Entscheidungen, keine Fehler
— sie zu melden erzieht dazu, die Glocke zu ignorieren, und das kostet die
Meldungen, auf die es ankommt.

#### Paket G — Fahrzeuge als echte Daten ✅ v3.3.0-beta.1 🔵 Schemaänderung

- § 7.5 Profile pro Fahrzeug statt eines globalen im `localStorage`
- § 7.6 eigene Referenzprofile anlegen
- § 6.3 eigene Fahrzeugmodelle mit ableitbaren, überschreibbaren Grenzwerten
- § 7.2 Phase 2: Ableseintervall → Benachrichtigung über fällige Ablesungen

*Zwingend zusammen: alle vier brauchen **dieselben neuen Prisma-Modelle**. In
Etappen ausgeliefert bedeutet das mehrere Migrationen für eine Sache, jede erst
nach einem Self-Update wirksam.*
**Nicht offensichtlich:** Der Bewertungs-Cache (`LogFile.evalVersion`) hasht heute
nur die Grenzwert-*Tabellen*. Benutzereigene Limits stehen nicht in diesem Hash —
ohne Anpassung zeigen gespeicherte Logs veraltete Badges.
**Größe:** das mit Abstand dickste Paket. Notfalls schneidbar in
„Fahrzeug-Entität + Profile" und „eigene Grenzwerte", aber **eine** Migration.

**Umgesetzt in einer Migration**, wie gefordert: `Vehicle` (Spec, eigene
Grenzwerte, Prüfstandsprofil, Herkunft), `LogFile.vehicleId` und
`Zaehler.ableseIntervallTage`. Alle neuen Spalten sind optional oder haben einen
Default — ein Rollback überspringt die Migration bewusst, der ältere Client läuft
also gegen das neuere Schema weiter, und genau eine `NOT NULL`-Spalte ohne
Default würde das nicht überleben.

**Gespeichert werden die Abweichungen, nicht die Grenzwerte.** Ein Fahrzeug hält
nur die Schlüssel, die jemand wirklich geändert hat. Eine vollständige Kopie
würde es auf den Tag seiner Anlage einfrieren: jede spätere Korrektur der
Tabellen in `engines.ts`/`vehicle-spec.ts` erreichte es nicht mehr, und die
gepflegten Vorgaben wären für alle, die das Formular je geöffnet haben, toter
Code. Die Plausibilitätsgrenzen werden beim Schreiben **und** beim Lesen
durchgesetzt — ein Tippfehler um eine Zehnerpotenz sieht auf dem Bildschirm nicht
falsch aus, er stuft still jeden danach bewerteten Log um.

**Der Bewertungs-Cache sieht eigene Grenzwerte jetzt.** Das war der im Backlog
notierte nicht offensichtliche Punkt und er stimmte: der automatische Hash deckt
die Grenzwert-*Tabellen* ab, ein benutzereigenes Limit war für ihn unsichtbar.
`evaluationVersionFor(effectiveLimits(...))` ist der fahrzeugbezogene Schlüssel —
die Abweichungen eines Fahrzeugs entwerten dessen eigene Logs und sonst keine.

**Ableseintervall (§ 7.2 Phase 2).** `0 = aus`, wie bei den Aufbewahrungsgrenzen.
Ein nie abgelesener Zähler gilt **nicht** als überfällig — das ist ein gerade
angelegter Zähler, und ihn im selben Moment anzumahnen ist der Weg, wie eine
Glocke ihr Publikum verliert. Anders als bei den geplanten Jobs gibt es hier
keinen Kulanzfaktor: das Intervall ist das, worum jemand gebeten hat.

#### Paket H — Auswertung erklären ✅ v3.4.0-beta.1

- § 6.1 Grenzwerte je Sensor immer anzeigen, auch wenn nicht erreicht
- § 6.2 Handlungsempfehlungen bei „Hardware-Risiko"

*Zusammen, weil beide dasselbe Urteil erklären, beide rein anzeigend sind und
keine Schemaänderung brauchen.*
**Achtung:** Ein *nicht* erreichter Grenzwert ist kein Urteil und darf nicht über
`StatusBadge` laufen. Empfehlungen ändern das Urteil nicht — **kein**
`EVALUATION_RULES_VERSION`-Bump.

**Beides eingehalten.** Die Grenzwertübersicht in der Bewertungskarte ist bewusst
neutral gehalten (`text-dim`, keine ok/watch/risk-Tokens, kein `StatusBadge`) —
ein sauberer Log darf davon nicht alarmierend aussehen. Und `remediation.ts` wird
von `evaluate-log-pull.ts` **nicht** importiert: die Empfehlungen erklären ein
Urteil, sie ändern keins, also bleibt der Zähler stehen.

**Ton der Empfehlungen.** Sortiert von naheliegend/günstig nach aufwendig, und
durchgehend als „prüfen"/„erwägen" formuliert — das sind Eingriffe an einem
Auto. Ein Test hält beides fest: dass der erste Schritt bei Klopfen die
Oktanzahl ist und der Turbolader zuletzt kommt, und dass keine Zeile im
Imperativ steht.

**Teilweise offen:** Die `ReferenceLine` in `LogCharts`/`OverlayChart` und die
Spalte im `ParameterPanel` aus § 6.1 fehlen noch — die Grenzwerte sind jetzt in
der Bewertungskarte immer sichtbar, aber nicht im Diagramm eingezeichnet.

#### Paket I — Marke

§ 7.7: Zeichen überarbeiten und in die Kopfzeile holen, Favicon, Apple-Icon und
Manifest mitziehen. Ablauf: mehrere Entwürfe in unterschiedlichen Designsprachen
zur Auswahl, dann umsetzen.

*Allein, weil in der Mitte eine Gestaltungsentscheidung steht — das passt in kein
Paket mit einem Termin.*
**Randbedingung:** `BrandLogo` bleibt inline, sonst folgt es dem Theme nicht.

**Konkreter Bestand (aus dem Wissensgraphen, 2026-07-26).** Es existieren
**zwei Generationen** derselben Marke, und die Repo-Startseite zeigt die alte:

| Datei | Stand | Verwendung |
|---|---|---|
| `apps/main-portal/public/icon-zaehlwerk.svg` | aktuell (cyan→blau) | App, Launcher |
| `apps/main-portal/public/icon-log-analyzer.svg` | aktuell (bernstein→orange) | App, Launcher |
| `apps/main-portal/public/mark-appspace.svg` | aktuell (weiß, transparent) | Kopfzeile, Login |
| `apps/main-portal/app/icon.svg` | aktuell | Favicon |
| `docs/assets/icon-zaehlwerk.svg` | **alt** (Schiefer + Blitz) | nur `README.md` |
| `docs/assets/icon-log-analyzer.svg` | **alt** (Schiefer + Lupe) | nur `README.md` |
| `docs/assets/logo-appspace.svg` | **alt** — Wortmarke, existiert **nur hier** | `README.md`-Kopf |
| `docs/assets/mark-appspace.svg` | **alt** | von nichts referenziert |

Bewusst *nicht* im Vorbeigehen repariert: die Bilder einzeln umzubiegen würde
die Gestaltungsentscheidung vorwegnehmen, die hier ansteht. Beim Umsetzen
mitnehmen: die Wortmarke hat keine aktuelle Entsprechung, `docs/assets/` sollte
danach entweder auf die ausgelieferten Dateien zeigen oder verschwinden, und
Icon-Hexwerte sind Kopien (siehe CLAUDE.md — separate Dokumente sehen die Token
nicht).

#### Paket J — Automatischer CSV-Bezug

§ 6.4: API-Anbindung / Crawler weiter evaluieren.

*Zuletzt, weil ergebnisoffen. Vor dem Bauen ist zu entscheiden, ob es überhaupt
Crawling sein muss — Push per API-Key und der Watch-Folder existieren bereits und
decken den Fall möglicherweise schon ab.*

---

### Erledigt

| | |
|---|---|
| Mantine-Ausbau (§ 2) | ✅ v3.0.0-beta.1 |
| Release-Channel gebaut (§ 3) | ✅ v3.0.0-beta.2 |
| Rollback auf frühere Version | ✅ v3.0.0-beta.4 |
| Channel-Defekt § 3.1 + `?log=`-Deeplink (Paket A) | ✅ v3.0.0-beta.5 |
| Scrubben auf dem Handy (§ 2.1 ff.) | ✅ v3.0.0-beta.3 |
| 2FA-Login-Hotfix (Cookie-Flag + PIN-Vollständigkeit) | ✅ v3.0.0-beta.12 |
| Navigation & Auffindbarkeit (Paket E) | ✅ v3.1.0-beta.1 |
| Zustand sichtbar machen (Paket F) | ✅ v3.2.0-beta.1 |
| Fahrzeuge als echte Daten (Paket G) | ✅ v3.3.0-beta.1 |
| Auswertung erklären (Paket H) | ✅ v3.4.0-beta.1 |
| Animationen (§ 8) | ✅ v3.0.0-beta.3 |

**Offen aus § 3, aber nicht paketiert:** der GitHub-Aufbau mit `next` als
Beta-Branch. Solange alles über `main` läuft und Betas von dort getaggt werden,
ist der Channel funktionsfähig — die Trennung ist dann aber eine Konvention und
keine Struktur. Sinnvoll zusammen mit Paket A, weil beide am selben Verständnis
von „was ist ein freigegebener Stand" hängen.
