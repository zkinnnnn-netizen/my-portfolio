/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient as PgClient } from "@prisma/client";
// @ts-ignore
import { PrismaClient as SqliteClient } from "../generated/sqlite-client";

function pickUniqueWhere(row: any) {
  // 优先使用 url 作为唯一键（若存在）
  if (row.url) return { url: row.url };
  // 退化用 id
  if (row.id !== undefined) return { id: row.id };
  throw new Error("Cannot determine unique key for Source (no url / id).");
}

function stripAutoIdIfNumber(row: any) {
  // 如果 id 是数字(自增)，写入新库时不强行写 id
  if (typeof row.id === "number") {
    const { id, ...rest } = row;
    return rest;
  }
  return row;
}

async function main() {
  const src = new SqliteClient(); // SQLITE_DATABASE_URL
  const dst = new PgClient();     // DATABASE_URL

  console.log("Reading sources from SQLite...");
  const sources = await (src as any).source.findMany();

  console.log("Local sources:", sources.length);
  if (!sources.length) {
    console.log("No sources in local db. Done.");
    return;
  }

  let upserted = 0;

  for (const s of sources) {
    const where = pickUniqueWhere(s);
    const data = stripAutoIdIfNumber(s);

    await (dst as any).source.upsert({
      where,
      create: data,
      update: data,
    });

    upserted++;
  }

  console.log("Upserted to Postgres:", upserted);

  await src.$disconnect();
  await dst.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
