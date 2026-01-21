-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawText" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "hash" TEXT NOT NULL,
    "meta" TEXT,
    "digest" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("canonicalUrl", "createdAt", "digest", "fetchedAt", "hash", "id", "meta", "publishedAt", "rawText", "sourceId", "status", "title", "updatedAt", "url") SELECT "canonicalUrl", "createdAt", "digest", "fetchedAt", "hash", "id", "meta", "publishedAt", "rawText", "sourceId", "status", "title", "updatedAt", "url" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_hash_key" ON "Item"("hash");
CREATE UNIQUE INDEX "Item_sourceId_canonicalUrl_key" ON "Item"("sourceId", "canonicalUrl");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
