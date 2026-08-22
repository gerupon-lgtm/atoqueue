import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function applyInitialMigration(pool: Pool): Promise<void> {
  const sql = await readFile(new URL("./migrations/001_initial.sql", import.meta.url), "utf8");
  await pool.query(sql);
  await applyRecurringRemindersMigration(pool);
  await applyDailyRemindersMigration(pool);
}

export async function applyRecurringRemindersMigration(pool: Pool): Promise<void> {
  const sql = await readFile(new URL("./migrations/002_recurring_reminders.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

export async function applyDailyRemindersMigration(pool: Pool): Promise<void> {
  const sql = await readFile(new URL("./migrations/003_daily_reminders.sql", import.meta.url), "utf8");
  await pool.query(sql);
}
