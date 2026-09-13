import { describe, expect, it } from "vitest";
import { applyRecurringRemindersMigration } from "../migrate.js";

describe("recurring reminders migration", () => {
  it("adds a nullable weekly-or-monthly cadence column", async () => {
    let migrationSql = "";
    await applyRecurringRemindersMigration({ query: async (sql: string) => { migrationSql = sql; } } as never);
    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS repeat_cadence TEXT NULL/i);
    expect(migrationSql).toMatch(/CHECK \(repeat_cadence IN \('weekly', 'monthly'\)\)/i);
  });
});
