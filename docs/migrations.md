# Datenbank-Migrationen

Zählwerk verwendet **Prisma Migrate**. Jede Schemaänderung wird als
SQL-Schritt in `packages/database/prisma/migrations/` eingecheckt und beim
Deploy in genau der Reihenfolge angewendet, in der sie entstanden ist.

## Warum nicht `db push`

`prisma db push` gleicht die Datenbank dem Schema an — ohne Historie, ohne
Rückfrage und ohne zu benennen, was dabei verschwindet. Für eine Anwendung, die
auf fremden Instanzen mit Jahren an Ablesungen läuft, ist das die falsche
Zusicherung: Ein Upgrade kann Daten löschen, ohne dass jemand es vorher sieht.

`db push` bleibt für die **lokale Entwicklung** das richtige Werkzeug (schnell,
wegwerfbar). Im Deploy läuft es nicht mehr.

## Eine Änderung machen

```sh
# 1. schema.prisma bearbeiten
# 2. Migration erzeugen und lokal anwenden
pnpm --filter @zaehlwerk/database exec prisma migrate dev --name kurzer_name
```

Das legt `prisma/migrations/<zeitstempel>_kurzer_name/migration.sql` an. **Die
Datei wird mit eingecheckt** — sie ist der Schritt, den jede Instanz später
ausführt.

Vor dem Commit prüfen, dass Migrationen und Schema deckungsgleich sind:

```sh
pnpm --filter @zaehlwerk/database exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "file:/tmp/shadow.db" --script
```

Ausgabe `-- This is an empty migration.` heißt: kein Drift.

## Die eine Regel, die zählt

> **Jede neue Spalte ist optional oder hat einen Default.**

Ein Rollback überspringt die Migration bewusst (siehe unten). Eine ältere
Anwendung läuft danach gegen das *neuere* Schema. Prisma wählt Spalten
namentlich aus, ein alter Client fragt also nie nach dem, was er nicht kennt —
mit einer Ausnahme: Eine `NOT NULL`-Spalte ohne Default lässt jedes `INSERT` des
alten Clients scheitern. Additive Migrationen auf gefüllten Tabellen brauchen
ohnehin einen Default, das ist also selten statt unmöglich.

Das Issue-Template fragt beides ab (`Schemaänderung nötig?`,
`Rollback-sicher?`), damit die Frage vor dem Code gestellt wird.

## Was beim Deploy passiert

Der Deploy läuft in zwei Prozessen. `scripts/update.sh` baut, solange die alte
Anwendung bedient; `scripts/deploy-swap.sh` (abgekoppelter Container) hält an,
migriert und fährt hoch — warum in dieser Reihenfolge, steht unter „Gesperrte
Datenbank" weiter unten.

Die Migration selbst führt der Compose-Dienst `db-migrate` aus, der
`packages/database/scripts/deploy-migrations.sh` startet:

1. **Sicherung.** Die Datenbankdatei wird mit Zeitstempel nach
   `<datenverzeichnis>/pre-migration/` kopiert, samt Journal-Dateien. Schlägt
   das fehl, bricht der Deploy ab, *bevor* geschrieben wird.
2. **Zustand bestimmen.** Leere Datenbank oder bestehende Installation?
3. **Baseline stempeln** (nur bei bestehender Installation, und nur *einmal*).
   Instanzen aus der `db push`-Zeit haben alle Tabellen, aber keine
   `_prisma_migrations`. Sie werden einmalig mit
   `migrate resolve --applied 0_init` als „auf Baseline" markiert — sonst
   versuchte Prisma, die Tabellen erneut anzulegen, und bräche mitten im Deploy
   ab. Ob der Stempel noch fehlt, beantwortet das **lesende** `migrate status`;
   siehe „Warum erst fragen, dann schreiben" unten.
4. **Anwenden.** `prisma migrate deploy` spielt die fehlenden Schritte ein.

Die Migration bleibt eine **Vorbedingung** für den Tausch: Schlägt sie fehl,
kommt die neue Version nicht hoch. Der Deployer holt dann die alte zurück.

### Gesperrte Datenbank — und warum die Anwendung dafür anhält

Bis 3.12.0-beta.6 lief die Migration **neben der laufenden Anwendung**, damit
ein Fehlschlag folgenlos bleibt. Drei Updates sind daran gescheitert. Die
Ursache ist keine unglückliche Überschneidung, sondern strukturell. Gemessen,
auf einer Datenbank **im WAL-Modus**:

| Zustand der laufenden Anwendung | `prisma migrate deploy` |
|---|---|
| nur verbunden, keine Transaktion | läuft |
| offene **Lese**transaktion | **gesperrt** |
| offene Schreibtransaktion | **gesperrt** |

Auch eine lesende. „Im WAL-Modus blockieren Leser keine Schreiber" gilt für
gewöhnliche Schreibvorgänge — für Prismas Schema-Engine nicht. Und offene
Transaktionen hat eine laufende Anwendung ständig: Das automatische Backup
kopiert mit `VACUUM INTO` und liest dabei minutenlang am Stück.

Daraus folgt: **Solange die alte Anwendung läuft, ist die Migration auf Glück
angewiesen.** Kein Wiederholungsbudget behebt das, es verlängert nur das Warten
— zuletzt 30 Versuche über drei Minuten, alle abgewiesen.

Deshalb migriert seit OPS-03 der **Deployer**, nachdem er die Anwendung
angehalten hat:

```
update.sh    checkout → Image bauen → Migrations-Image bauen → Übergabe
             (die alte Anwendung bedient die ganze Zeit weiter)

deploy-swap  main-portal ANHALTEN → migrieren → neue Version hoch
             scheitert die Migration → alte Version zurück
```

Der Preis ist eine **kurze Auszeit** statt gar keiner. Der lange Teil (der
Layer-Export des Migrations-Images, Minuten) bleibt in `update.sh`, wo die alte
Anwendung noch bedient; der Deployer startet den Container nur noch.

Die Zusicherung aus #108 bleibt erhalten, nur anders eingelöst: Scheitert die
Migration, fährt der Deployer die **alte** Version wieder hoch — altes Image
(`zaehlwerk-main-portal:previous`, in `update.sh` vor dem Build getaggt) und
alter Arbeitsbaum. Niemand landet auf einer halb migrierten Datenbank, und
niemand landet mit der neuen Anwendung auf einer unmigrierten.

Ein **Rollback** hält nichts an: Er migriert ohnehin nicht, die Auszeit wäre
grundlos.

Der Abbrechen-Knopf gilt deshalb nur noch bis einschließlich `building`
(`CANCELLABLE_STAGES`). Ab der Übergabe gibt es keinen Prozess mehr, den er
beenden könnte — und den Deployer mitten im Ablauf zu töten hinterließe die
Instanz ohne Anwendung.

**Das Wiederholungsbudget bleibt** (`LOCK_RETRIES`, Standard 30, `LOCK_WAIT` 6s)
und wiederholt weiterhin nur bei `database is locked`. Es ist jetzt aber die
Rückfallebene, nicht der Plan: Nach dem Anhalten sollte gar nichts mehr
konkurrieren.

Beide Prämissen sind als Test festgehalten, damit man sie zurücknehmen kann,
wenn Prisma sich ändert:

- `packages/database/scripts/test-migrations.mjs` misst die Tabelle oben.
- `scripts/test-deploy-swap.mjs` prüft die Reihenfolge Anhalten → Migrieren →
  Hochfahren und den Weg zurück, gegen ein nachgemachtes `docker`.

### Journal-Modus

`PRAGMA journal_mode` wirft nicht, wenn der Wechsel abgelehnt wird — es
*antwortet* mit dem Modus, der danach gilt. Diese Antwort wurde bis OPS-03 nie
angesehen, also meldete der Start WAL, ohne dass etwas geschehen war. Seit
OPS-03 wird sie geprüft, und `busy_timeout` steht in der Liste **vor**
`journal_mode` — sonst läuft ausgerechnet die eine Anweisung, die eine Sperre
braucht, ohne Geduld.

WAL bleibt trotzdem richtig (bessere Nebenläufigkeit im Normalbetrieb). Es war
nur nicht die Ursache der gescheiterten Updates: Die betroffene Instanz war
bereits auf WAL.

### Warum erst fragen, dann schreiben

Schritt 3 stempelte früher bei *jedem* Update, und der Fehlschlag („ist schon
vermerkt") wurde hinterher als unbedenklich eingestuft. Das war zweimal falsch:
Es nahm jedes Mal grundlos einen Schreiblock — die häufigste Gelegenheit für
die Kollision oben —, und es unterschied „schon gestempelt" nicht von
„gesperrt". Im zweiten Fall brach das Update ab, obwohl gar nichts zu tun
gewesen wäre. Genau so ist der erste Versuch auf 3.12.0-beta.4 gescheitert; der
zweite dann an der Sperre selbst — siehe oben.

`migrate status` ist lesend und beantwortet die Frage genau: Die Baseline steht
nur dann als offen in der Liste, wenn sie wirklich noch fehlt.

Alle Fälle oben sind in `packages/database/scripts/test-migrations.mjs`
abgedeckt — mit echten Nebenprozessen, die eine Schreib- bzw. Lesetransaktion
offen halten. Der Unterschied ist dort ausdrücklich festgehalten: Wiederholte
kurze Abfragen reichen als Nachstellung *nicht*, weil sie die Sperre zwischen
den Anweisungen freigeben.

## Rollback

Ein Rollback **migriert nicht zurück** — er lässt das neuere Schema stehen.
Rückwärts zu migrieren hieße, genau die Spalten zu entfernen, in die die neuere
Version bereits geschrieben hat. Das gehört nicht hinter einen
„Zurück"-Knopf.

Wenn ein Rollback wegen einer Schemaänderung wirklich nicht ausreicht, ist die
Antwort ein **Backup-Restore**, keine Rückwärtsmigration.

## Die Baseline

`0_init` beschreibt das Schema zum Zeitpunkt der Umstellung (11 Tabellen). Sie
wurde mit `migrate diff --from-empty` erzeugt und gegen das Schema
gegengeprüft — der Drift-Vergleich oben war leer. Auf Bestandsinstallationen
wird sie nie ausgeführt, nur gestempelt.
