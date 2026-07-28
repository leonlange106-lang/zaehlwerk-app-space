-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mustSetPassword" BOOLEAN NOT NULL DEFAULT false,
    "allowedApps" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "zaehler" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kategorie" TEXT NOT NULL,
    "einheit" TEXT NOT NULL,
    "farbe" TEXT NOT NULL DEFAULT '#495a6c',
    "icon" TEXT NOT NULL DEFAULT 'bolt',
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "ableseIntervallTage" INTEGER NOT NULL DEFAULT 0,
    "locationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "zaehler_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ablesungen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zaehlerId" TEXT NOT NULL,
    "datum" DATETIME NOT NULL,
    "wert" REAL NOT NULL,
    "kosten" REAL,
    "zaehlerGetauscht" BOOLEAN NOT NULL DEFAULT false,
    "startwertNeu" REAL,
    "notiz" TEXT,
    "quelle" TEXT NOT NULL DEFAULT 'manual',
    "istAbgerechnet" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ablesungen_zaehlerId_fkey" FOREIGN KEY ("zaehlerId") REFERENCES "zaehler" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tarife" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zaehlerId" TEXT NOT NULL,
    "anbieter" TEXT,
    "produkt" TEXT,
    "gueltigAb" DATETIME NOT NULL,
    "gueltigBis" DATETIME,
    "arbeitspreisCtNetto" REAL NOT NULL,
    "grundpreisJahrNetto" REAL NOT NULL DEFAULT 0,
    "mwstProzent" REAL NOT NULL DEFAULT 19,
    "notiz" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tarife_zaehlerId_fkey" FOREIGN KEY ("zaehlerId") REFERENCES "zaehler" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "log_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "sourceUrl" TEXT,
    "csv" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "vin" TEXT,
    "vehicle" TEXT,
    "mapVersion" TEXT,
    "software" TEXT,
    "loggedAt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'invalid',
    "health" TEXT NOT NULL DEFAULT 'safe',
    "evalVersion" TEXT,
    "contentHash" TEXT,
    "notes" TEXT,
    "recordedAt" DATETIME,
    "label" TEXT,
    "octane" TEXT,
    "tags" TEXT NOT NULL DEFAULT '',
    "vehicleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "log_files_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ingestion_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "brand" TEXT,
    "series" TEXT,
    "vehicleModel" TEXT,
    "engineCode" TEXT NOT NULL DEFAULT 'n54',
    "transmission" TEXT NOT NULL DEFAULT 'manual',
    "catType" TEXT NOT NULL DEFAULT 'oem',
    "fuel" TEXT NOT NULL DEFAULT 'ron98',
    "turbo" TEXT NOT NULL DEFAULT 'stock',
    "hpfp" TEXT NOT NULL DEFAULT 'oem',
    "stage" TEXT NOT NULL DEFAULT 'stage1',
    "limitOverrides" TEXT NOT NULL DEFAULT '{}',
    "dynoProfile" TEXT,
    "profileOrigin" TEXT NOT NULL DEFAULT 'own',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_userId_idx" ON "api_tokens"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "zaehler_locationId_idx" ON "zaehler"("locationId");

-- CreateIndex
CREATE INDEX "zaehler_aktiv_sortIndex_idx" ON "zaehler"("aktiv", "sortIndex");

-- CreateIndex
CREATE INDEX "ablesungen_zaehlerId_datum_idx" ON "ablesungen"("zaehlerId", "datum");

-- CreateIndex
CREATE INDEX "ablesungen_datum_idx" ON "ablesungen"("datum");

-- CreateIndex
CREATE INDEX "tarife_zaehlerId_gueltigAb_idx" ON "tarife"("zaehlerId", "gueltigAb");

-- CreateIndex
CREATE INDEX "log_files_recordedAt_idx" ON "log_files"("recordedAt");

-- CreateIndex
CREATE INDEX "log_files_createdAt_idx" ON "log_files"("createdAt");

-- CreateIndex
CREATE INDEX "log_files_contentHash_idx" ON "log_files"("contentHash");

-- CreateIndex
CREATE INDEX "log_files_vehicleId_idx" ON "log_files"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_keys_keyHash_key" ON "ingestion_keys"("keyHash");

-- CreateIndex
CREATE INDEX "vehicles_active_idx" ON "vehicles"("active");

