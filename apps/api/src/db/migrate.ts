import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function applyInitialMigration(pool: Pool): Promise<void> {
  const sql = await readFile(new URL("./migrations/001_initial.sql", import.meta.url), "utf8");
  await pool.query(sql);
}
