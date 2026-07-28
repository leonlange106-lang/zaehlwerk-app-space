-- CreateTable
CREATE TABLE "meter_register" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zaehlerId" TEXT NOT NULL,
    "obisCode" TEXT NOT NULL,
    "richtung" TEXT NOT NULL DEFAULT 'BEZUG',
    "tarif" TEXT,
    "einheit" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "meter_register_zaehlerId_fkey" FOREIGN KEY ("zaehlerId") REFERENCES "zaehler" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ablesungen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zaehlerId" TEXT NOT NULL,
    "registerId" TEXT,
    "datum" DATETIME NOT NULL,
    "wert" REAL NOT NULL,
    "kosten" REAL,
    "zaehlerGetauscht" BOOLEAN NOT NULL DEFAULT false,
    "startwertNeu" REAL,
    "notiz" TEXT,
    "quelle" TEXT NOT NULL DEFAULT 'manual',
    "istAbgerechnet" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ablesungen_zaehlerId_fkey" FOREIGN KEY ("zaehlerId") REFERENCES "zaehler" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ablesungen_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "meter_register" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ablesungen" ("createdAt", "datum", "id", "istAbgerechnet", "kosten", "notiz", "quelle", "startwertNeu", "wert", "zaehlerGetauscht", "zaehlerId") SELECT "createdAt", "datum", "id", "istAbgerechnet", "kosten", "notiz", "quelle", "startwertNeu", "wert", "zaehlerGetauscht", "zaehlerId" FROM "ablesungen";
DROP TABLE "ablesungen";
ALTER TABLE "new_ablesungen" RENAME TO "ablesungen";
CREATE INDEX "ablesungen_zaehlerId_datum_idx" ON "ablesungen"("zaehlerId", "datum");
CREATE INDEX "ablesungen_datum_idx" ON "ablesungen"("datum");
CREATE INDEX "ablesungen_registerId_datum_idx" ON "ablesungen"("registerId", "datum");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "meter_register_zaehlerId_sortIndex_idx" ON "meter_register"("zaehlerId", "sortIndex");

-- CreateIndex
CREATE UNIQUE INDEX "meter_register_zaehlerId_obisCode_key" ON "meter_register"("zaehlerId", "obisCode");


-- ────────────────────────────────────────────────────────────────────────────
-- Datenmigration. Prisma erzeugt nur die Struktur; ohne diesen Teil stuenden
-- alle bestehenden Ablesungen ohne Register da.
--
-- Jeder vorhandene Zaehler bekommt sein Standardregister: OBIS 1.8.0, Richtung
-- BEZUG, Einheit und Bezeichnung vom Zaehler geerbt. Das ist genau das
-- Verhalten von vorher, nur benannt — kein bestehender Wert aendert sich.
--
-- Die Register-Id wird DETERMINISTISCH aus der Zaehler-Id gebildet statt
-- zufaellig: Damit ist die Migration wiederholbar, und wer spaeter in der
-- Datenbank nachsieht, erkennt die Zugehoerigkeit ohne Join.
INSERT INTO "meter_register" (
  "id", "zaehlerId", "obisCode", "richtung", "tarif",
  "einheit", "label", "sortIndex", "createdAt", "updatedAt"
)
SELECT
  'reg-1-8-0-' || "id", "id", '1.8.0', 'BEZUG', NULL,
  "einheit", 'Bezug', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "zaehler";

-- Alle bestehenden Ablesungen an dieses Standardregister haengen. Die Werte
-- selbst werden nicht angefasst — es aendert sich ausschliesslich, unter
-- welchem Namen die Reihe gefuehrt wird.
UPDATE "ablesungen"
SET "registerId" = 'reg-1-8-0-' || "zaehlerId"
WHERE "registerId" IS NULL;
