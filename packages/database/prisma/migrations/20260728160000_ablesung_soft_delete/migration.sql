-- Soft-Delete und Aenderungshistorie auf Ablesungen (ZW-03).
--
-- Ein Zaehlerstand ist kein beliebiger Datensatz: Er ist ein Messwert von einem
-- Zeitpunkt, der nicht wiederkommt. Wer versehentlich die falsche Zeile trifft,
-- kann sie nicht neu ablesen.
--
-- Beide Spalten sind NULLABLE und ohne Default — die Rollback-Regel: Eine
-- aeltere Anwendung schreibt nach einem Rollback wieder ohne diese Felder, und
-- `NULL` heisst dort dasselbe wie hier ("vorhanden"). Bestehende Zeilen sind
-- damit unveraendert und weiterhin sichtbar.

-- AlterTable
ALTER TABLE "ablesungen" ADD COLUMN "geloeschtAm" DATETIME;
ALTER TABLE "ablesungen" ADD COLUMN "geloeschtVon" TEXT;

-- CreateIndex
CREATE INDEX "ablesungen_zaehlerId_geloeschtAm_datum_idx" ON "ablesungen"("zaehlerId", "geloeschtAm", "datum");

-- CreateTable
CREATE TABLE "ablesung_aenderungen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ablesungId" TEXT NOT NULL,
    "aktion" TEXT NOT NULL,
    "akteur" TEXT NOT NULL,
    "vorherWert" REAL,
    "vorherDatum" DATETIME,
    "vorherKosten" REAL,
    "vorherNotiz" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ablesung_aenderungen_ablesungId_fkey" FOREIGN KEY ("ablesungId") REFERENCES "ablesungen" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ablesung_aenderungen_ablesungId_createdAt_idx" ON "ablesung_aenderungen"("ablesungId", "createdAt");
