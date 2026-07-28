-- Brennwert und Zustandszahl je Zeitraum (ZW-02).
--
-- Bis hierher rechnete Zaehlwerk Gas mit zwei festen Zahlen von 2021. Beide
-- stehen auf jeder Jahresrechnung und aendern sich, der Brennwert monatlich.

-- CreateTable
CREATE TABLE "umrechnungsfaktor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zaehlerId" TEXT NOT NULL,
    "gueltigAb" DATETIME NOT NULL,
    "gueltigBis" DATETIME,
    "brennwert" REAL NOT NULL,
    "zustandszahl" REAL NOT NULL,
    "quelle" TEXT,
    "notiz" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "umrechnungsfaktor_zaehlerId_fkey" FOREIGN KEY ("zaehlerId") REFERENCES "zaehler" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "umrechnungsfaktor_zaehlerId_gueltigAb_idx" ON "umrechnungsfaktor"("zaehlerId", "gueltigAb");

-- Bestandsdaten: je Gaszaehler EIN Faktor mit genau den Werten, mit denen
-- bisher gerechnet wurde. Damit aendert sich keine einzige angezeigte Zahl —
-- der Unterschied ist nur, dass die Annahme jetzt sichtbar und aenderbar ist.
--
-- `gueltigAb` ist der 01.01.2021 ODER die aelteste Ablesung des Zaehlers,
-- je nachdem was frueher liegt. Faengt man stur bei 2021 an, faellt jede
-- aeltere Ablesung aus der Deckung und wuerde ab sofort als "unvollstaendig"
-- angezeigt — eine Verschlechterung durch eine Migration, die ausdruecklich
-- nichts veraendern soll.
--
-- Der Stichtag steht als Millisekunden-Zahl da (1609459200000 =
-- 2021-01-01T00:00:00Z), nicht als Datumstext. Prisma legt DateTime in SQLite
-- als INTEGER ab, und SQLite vergleicht ueber Typgrenzen hinweg nach
-- Typrangfolge statt nach Wert: MIN(<integer>, '2021-01-01') liefert IMMER die
-- Zahl, egal welches Datum sie darstellt. Der Vergleich fand also gar nicht
-- statt, und das faellt nur deshalb nicht auf, weil die aelteste Ablesung
-- ohnehin die aelteste ist.
--
-- `gueltigBis` bleibt offen: Der Faktor gilt weiter, bis jemand einen neueren
-- pflegt. Ihn hier zu begrenzen hinterliesse ab morgen eine Luecke.
INSERT INTO "umrechnungsfaktor" (
    "id", "zaehlerId", "gueltigAb", "gueltigBis",
    "brennwert", "zustandszahl", "quelle", "updatedAt"
)
SELECT
    lower(
        hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
        substr(hex(randomblob(2)), 2) || '-a' ||
        substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    ),
    z."id",
    MIN(
        COALESCE((SELECT MIN(a."datum") FROM "ablesungen" a WHERE a."zaehlerId" = z."id"), 1609459200000),
        1609459200000
    ),
    NULL,
    10.312,
    0.9622,
    'Übernommen aus der festen Annahme (Stand 2021)',
    CURRENT_TIMESTAMP
FROM "zaehler" z
WHERE z."kategorie" = 'GAS';
