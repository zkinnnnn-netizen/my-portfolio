
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const sourceName = '通知公告-北京大学本科招生网';
    const source = await prisma.source.findFirst({
        where: { name: sourceName }
    });

    if (!source) {
        console.error(`Source ${sourceName} not found`);
        return;
    }

    // Use raw SQL to bypass Prisma type issues
    const rows: any[] = await prisma.$queryRaw`SELECT "crawlConfig" FROM "Source" WHERE id = ${source.id}`;
    const currentConfig = rows[0]?.crawlConfig ? JSON.parse(rows[0].crawlConfig) : {};

    const newConfig = {
        ...currentConfig,
        selectors: {
            ...currentConfig.selectors,
            content: '.x-layout',
        }
    };

    await prisma.$executeRaw`
        UPDATE "Source"
        SET "crawlConfig" = ${JSON.stringify(newConfig)}
        WHERE "id" = ${source.id}
    `;

    console.log(`Updated crawlConfig for ${sourceName}:`, JSON.stringify(newConfig, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
