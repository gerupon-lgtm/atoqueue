import { describe, expect, it } from "vitest";
import { applyDailyRemindersMigration } from "../migrate.js";

describe("daily reminders migration", () => {
  it("replaces the cadence constraint with daily, weekly, and monthly values", async () => {
    let migrationSql = "";
    await applyDailyRemindersMigration({
      query: async (sql: string) => {
        migrationSql = sql;
      },
    } as never);

    expect(migrationSql).toMatch(/DROP CONSTRAINT IF EXISTS reminder_jobs_repeat_cadence_check/i);
    expect(migrationSql).toMatch(/CHECK \(repeat_cadence IN \('daily', 'weekly', 'monthly'\)\)/i);
  });
});
