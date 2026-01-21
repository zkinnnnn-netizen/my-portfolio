
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const filePath = path.join(__dirname, '../manual_sources.json');
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(filePath, 'utf-8');
  const sources = JSON.parse(rawData);

  console.log(`Found ${sources.length} sources to import...`);

  let count = 0;
  let errors = 0;

  for (const src of sources) {
    try {
      // Prepare data
      const data = {
        name: src.name,
        type: src.type,
        url: src.url,
        regionTag: src.regionTag,
        categoryTag: src.categoryTag,
        priority: src.priority,
        isActive: src.isActive,
        fetchIntervalMinutes: src.fetchIntervalMinutes,
        crawlConfig: JSON.stringify(src.crawlConfig)
      };

      // Upsert
      await prisma.source.upsert({
        where: { url: src.url },
        update: data,
        create: data
      });

      console.log(`Processed: ${src.name}`);
      count++;
    } catch (e) {
      console.error(`Error processing ${src.name}: ${e.message}`);
      errors++;
    }
  }

  console.log(`Import complete. Successfully processed: ${count}, Errors: ${errors}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
