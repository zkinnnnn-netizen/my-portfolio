export function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.POSTGRES_PRISMA_URL) return process.env.POSTGRES_PRISMA_URL;
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  return '';
}

export function getDirectUrl(): string {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  if (process.env.POSTGRES_URL_NON_POOLING) return process.env.POSTGRES_URL_NON_POOLING;
  if (process.env.DATABASE_URL_UNPOOLED) return process.env.DATABASE_URL_UNPOOLED;
  return getDatabaseUrl(); // Fallback to main URL if no direct URL found
}

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || '';
}
