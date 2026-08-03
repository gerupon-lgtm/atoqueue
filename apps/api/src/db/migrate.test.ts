import { describe, expect, it } from "vitest";
import { applyInitialMigration } from "./migrate.js";

class IdempotentPostgresFixture {
  readonly relations = new Set<string>();

  async query(sql: string): Promise<void> {
    for (const statement of sql.split(";")) {
      const relation = statement.match(/CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS\s+(\w+)/i)?.[1];
      if (relation) this.relations.add(relation);
    }
  }
}

describe("initial migration", () => {
  it("can be applied twice during a restart", async () => {
    const database = new IdempotentPostgresFixture();
    await applyInitialMigration(database as never);
    await applyInitialMigration(database as never);
    expect(database.relations).toEqual(new Set([
      "device_subscriptions",
      "reminder_jobs",
      "idx_reminder_jobs_due",
      "idx_reminder_jobs_idempotency",
      "device_idempotency_operations",
    ]));
  });
});
