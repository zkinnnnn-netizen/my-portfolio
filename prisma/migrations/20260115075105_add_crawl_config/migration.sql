-- AlterTable
ALTER TABLE "Item" ADD COLUMN "etag" TEXT;
ALTER TABLE "Item" ADD COLUMN "lastModified" TEXT;

-- AlterTable
ALTER TABLE "Source" ADD COLUMN "crawlConfig" TEXT;
ALTER TABLE "Source" ADD COLUMN "etag" TEXT;
ALTER TABLE "Source" ADD COLUMN "lastModified" TEXT;
