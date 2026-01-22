import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl, getDirectUrl } from './env';

// Ensure environment variables are set before Prisma Client is initialized
const dbUrl = getDatabaseUrl();
const directUrl = getDirectUrl();

if (dbUrl && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = dbUrl;
}

if (directUrl && !process.env.DIRECT_URL) {
  process.env.DIRECT_URL = directUrl;
}

const prismaClientSingleton = () => {
  return new PrismaClient();
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
