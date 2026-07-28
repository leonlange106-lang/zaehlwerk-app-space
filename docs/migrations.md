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

`scripts/update.sh` ruft Schritt 3 über den Compose-Dienst `db-migrate` auf, der
`packages/database/scripts/deploy-migrations.sh` ausführt:

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

Die Migration ist eine **Vorbedingung** für den Container-Tausch. Schlägt sie
fehl, läuft die alte Anwendung weiter und niemand landet auf einer halb
migrierten Datenbank.

### Gesperrte Datenbank

Die Migration läuft, **während die alte Anwendung noch bedient** und die
SQLite-Datei offen hält. Das ist Absicht (siehe Absatz oben), kostet aber
Konkurrenz um den Schreiblock — und die beiden Seiten gehen damit
unterschiedlich um:

| | `busy_timeout` | bei einer Sperre |
|---|---|---|
| Anwendung (`sqlite-pragmas.ts`, seit OPS-02) | gesetzt | wartet |
| Prisma Schema-Engine (`migrate resolve`/`deploy`) | **nicht** setzbar | bricht sofort ab |

Dem Schema-Engine lässt sich kein `busy_timeout` mitgeben — weder über
`socket_timeout` noch über `connection_limit` in der URL; beides wurde
ausprobiert. Bleibt: es noch einmal versuchen. Das Skript wiederholt einen an
einer Sperre gescheiterten Aufruf `LOCK_RETRIES` mal (Standard 10) im Abstand
von `LOCK_WAIT` Sekunden (Standard 6). Schreibzugriffe dieser Anwendung dauern
Millisekunden, ein Heimserver hat einen Benutzer — über eine Minute verteilt
trifft man das Fenster.

Wiederholt wird **nur** bei `database is locked`. Ein Syntaxfehler in einer
Migration wird durchs Warten nicht besser, und ihn zehnmal zu versuchen
verschleiert nur, was wirklich kaputt ist.

### Warum erst fragen, dann schreiben

Schritt 3 stempelte früher bei *jedem* Update, und der Fehlschlag („ist schon
vermerkt") wurde hinterher als unbedenklich eingestuft. Das war zweimal falsch:
Es nahm jedes Mal grundlos einen Schreiblock — die häufigste Gelegenheit für
die Kollision oben —, und es unterschied „schon gestempelt" nicht von
„gesperrt". Im zweiten Fall brach das Update ab, obwohl gar nichts zu tun
gewesen wäre. Genau so ist ein Update auf 3.12.0-beta.4 gescheitert.

`migrate status` ist lesend und beantwortet die Frage genau: Die Baseline steht
nur dann als offen in der Liste, wenn sie wirklich noch fehlt.

Beide Fälle sind in `packages/database/scripts/test-migrations.mjs` abgedeckt —
mit einem echten zweiten Prozess, der eine Schreibtransaktion offen hält.

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
