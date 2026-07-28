#!/bin/sh
# Migrationen anwenden — der Ersatz fuer `prisma db push` im Deploy.
#
# `db push` gleicht die Datenbank dem Schema an, ohne Historie und ohne zu
# fragen, was dabei verlorengeht. Fuer eine Anwendung, die auf fremden Instanzen
# mit Jahren an Daten laeuft, ist das die falsche Zusicherung. `migrate deploy`
# spielt stattdessen genau die Schritte ein, die noch fehlen.
#
# Der heikle Teil ist NICHT das Anwenden, sondern der Einstieg: Bestehende
# Installationen haben alle Tabellen, aber keine `_prisma_migrations`. Wuerde man
# dort einfach `migrate deploy` aufrufen, versuchte Prisma die Baseline neu
# anzulegen und braeche mit "table already exists" ab — mitten im Deploy.
#
# Deshalb wird zuerst der Zustand bestimmt:
#
#   leere Datenbank      -> `migrate deploy` legt alles an
#   Tabellen vorhanden   -> Baseline als "bereits angewendet" stempeln,
#                           danach `migrate deploy` fuer alles Spaetere
#
# Die Unterscheidung kommt von Prisma selbst (`migrate diff --to-empty`) statt
# von einer SQLite-Abfrage: Der Builder-Container hat keinen sqlite3-Client, und
# eine zweite Vorstellung davon, was "leer" heisst, waere genau die Art von
# Doppelwissen, die spaeter auseinanderlaeuft.
set -eu

BASELINE="0_init"
DB_PATH="${DATABASE_URL#file:}"
# Ueber pnpm aufgerufen, damit die CLI aus node_modules/.bin gefunden wird —
# `prisma` liegt in keinem Container-PATH. Ueberschreibbar, damit das Skript
# auch direkt getestet werden kann.
PRISMA="${PRISMA:-pnpm exec prisma}"

# ── Gesperrte Datenbank ────────────────────────────────────────────────────
# Die Migration laeuft, WAEHREND die alte Anwendung weiterlaeuft und die Datei
# offen haelt — das ist Absicht: Scheitert sie, bedient der alte Container
# unveraendert weiter, und niemand landet auf einer halb migrierten Datenbank.
#
# Der Preis dafuer ist Konkurrenz um den Schreiblock. Die Anwendung setzt seit
# OPS-02 ein `busy_timeout` und wartet deshalb geduldig; der Schema-Engine von
# Prisma tut das NICHT und gibt beim ersten Zusammentreffen sofort auf. Genau
# diese Unwucht hat ein Update zum Absturz gebracht: eine Ablesung, die im
# falschen Moment gespeichert wurde, genuegte.
#
# `busy_timeout` laesst sich dem Schema-Engine nicht mitgeben — weder ueber
# `socket_timeout` noch ueber `connection_limit` in der URL; beides wurde
# ausprobiert und aendert nichts. Bleibt: es noch einmal versuchen. Schreibende
# Zugriffe dieser Anwendung dauern Millisekunden, ein Heimserver hat einen
# Benutzer — ueber eine Minute verteilt trifft man das Fenster.
LOCK_RETRIES="${LOCK_RETRIES:-10}"
LOCK_WAIT="${LOCK_WAIT:-6}"

retry_on_lock() {
  DESC="$1"
  shift
  ATTEMPT=1
  while :; do
    if OUT="$("$@" 2>&1)"; then
      [ -n "$OUT" ] && printf '%s\n' "$OUT"
      return 0
    fi
    # Nur bei einer Sperre wiederholen. Ein Syntaxfehler in einer Migration
    # wird durch Warten nicht besser, und ihn zehnmal zu versuchen verschleiert
    # nur, was wirklich kaputt ist.
    if ! printf '%s' "$OUT" | grep -qi "database is locked"; then
      printf '%s\n' "$OUT" >&2
      return 1
    fi
    if [ "$ATTEMPT" -ge "$LOCK_RETRIES" ]; then
      printf '%s\n' "$OUT" >&2
      echo "[migrate] $DESC: Datenbank blieb ueber $LOCK_RETRIES Versuche gesperrt" >&2
      return 1
    fi
    echo "[migrate] $DESC: Datenbank gesperrt — Versuch $ATTEMPT von $LOCK_RETRIES, warte ${LOCK_WAIT}s"
    sleep "$LOCK_WAIT"
    ATTEMPT=$((ATTEMPT + 1))
  done
}

# ── Sicherung vor dem ersten Schreibzugriff ────────────────────────────────
# Ein fehlgeschlagenes Upgrade ist der haeufigste Weg, wie Nutzerdaten
# verschwinden. Die Kopie liegt neben der Datenbank im selben Volume und traegt
# den Zeitstempel, damit mehrere Versuche sich nicht ueberschreiben.
#
# Bewusst eine Dateikopie und kein `.backup`: Der Container hat keinen
# sqlite3-Client. Die Journal-Dateien werden mitgenommen, sofern vorhanden —
# ohne sie waere die Kopie im WAL-Modus unvollstaendig. Das ersetzt kein
# richtiges Backup (das macht die Anwendung), es ist das Netz fuer genau diesen
# Moment.
if [ -f "$DB_PATH" ]; then
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  BACKUP_DIR="$(dirname "$DB_PATH")/pre-migration"
  mkdir -p "$BACKUP_DIR"
  cp "$DB_PATH" "$BACKUP_DIR/$(basename "$DB_PATH").$STAMP" || {
    echo "[migrate] Sicherung fehlgeschlagen — Abbruch, bevor geschrieben wird" >&2
    exit 1
  }
  for SIDECAR in "-journal" "-wal" "-shm"; do
    [ -f "$DB_PATH$SIDECAR" ] \
      && cp "$DB_PATH$SIDECAR" "$BACKUP_DIR/$(basename "$DB_PATH")$SIDECAR.$STAMP"
  done
  echo "[migrate] Sicherung: $BACKUP_DIR/$(basename "$DB_PATH").$STAMP"
else
  echo "[migrate] keine bestehende Datenbank — nichts zu sichern"
fi

# ── Zustand bestimmen ──────────────────────────────────────────────────────
# `--to-empty` beschreibt den Weg von der Datenbank zu "nichts". Ist sie leer,
# ist dieser Weg leer; enthaelt sie Tabellen, stehen dort DROP-Anweisungen.
# Nichts davon wird ausgefuehrt — es ist nur die Frage nach dem Ist-Zustand.
#
# Die fehlende Datei wird VORHER abgefangen: `migrate diff --from-url` scheitert
# dann, und ein leeres Ergebnis sieht aus wie "nicht leer" — die Neuinstallation
# waere in den Baseline-Zweig gelaufen und haette eine Migration als angewendet
# gestempelt, die nie lief. Genau umgekehrt zum gewuenschten Verhalten.
if [ ! -f "$DB_PATH" ]; then
  DIFF="-- This is an empty migration."
else
  DIFF="$($PRISMA migrate diff --from-url "$DATABASE_URL" --to-empty --script 2>/dev/null || true)"
fi

if printf '%s' "$DIFF" | grep -q "empty migration"; then
  echo "[migrate] leere Datenbank — Schema wird neu angelegt"
else
  # ERST FRAGEN, DANN SCHREIBEN.
  #
  # Vorher stempelte diese Stelle bei jedem Update, und der Fehlschlag ("ist
  # schon vermerkt") wurde hinterher als unbedenklich eingestuft. Das ist
  # zweimal falsch: Es nimmt jedes Mal grundlos einen Schreiblock — die
  # haeufigste Gelegenheit, an der Konkurrenz mit der laufenden Anwendung
  # ueberhaupt entstehen kann —, und es unterscheidet "schon gestempelt" nicht
  # von "gesperrt". Beim zweiten Fall brach das Update ab, obwohl gar nichts zu
  # tun gewesen waere.
  #
  # `migrate status` ist LESEND und beantwortet die Frage genau: Die Baseline
  # steht nur dann als offen in der Liste, wenn sie wirklich noch fehlt.
  STATUS_OUT="$($PRISMA migrate status 2>&1 || true)"
  if printf '%s' "$STATUS_OUT" | grep -qx "$BASELINE"; then
    echo "[migrate] bestehende Datenbank — Baseline wird einmalig gestempelt"
    retry_on_lock "Baseline stempeln" $PRISMA migrate resolve --applied "$BASELINE" || {
      echo "[migrate] Stempeln der Baseline fehlgeschlagen — Abbruch" >&2
      exit 1
    }
  else
    echo "[migrate] bestehende Datenbank — Baseline ist bereits vermerkt"
  fi
fi

# ── Anwenden ───────────────────────────────────────────────────────────────
# Schlaegt das fehl, bricht das Skript mit einem Fehlercode ab. update.sh
# behandelt die Migration als Vorbedingung: Der Tausch findet dann nicht statt,
# die alte Anwendung laeuft weiter, und niemand landet auf einer halb
# migrierten Datenbank.
echo "[migrate] wende ausstehende Migrationen an"
retry_on_lock "Migrationen anwenden" $PRISMA migrate deploy
