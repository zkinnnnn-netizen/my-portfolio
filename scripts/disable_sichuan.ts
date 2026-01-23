import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.source.updateMany({
    where: { name: '四川大学-通知公告' },
    data: {
      isActive: false,
      lastError: 'Blocked:412_Precondition_Failed (WAF/Anti-Bot)'
    }
  });
  console.log('Disabled 四川大学-通知公告 due to 412 error.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
