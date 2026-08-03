import { describe, expect, it } from "vitest";
import { PgReminderRepository } from "./reminder-repository.js";

const input = {
  id: "4ec4032e-5a92-45fe-b5a7-6e2015f028e0",
  deviceId: "a1f0f85e-8da5-4bfb-8fc4-938067ca9984",
  scheduledAt: "2026-08-06T09:00:00.000Z",
  notificationType: "task_review" as const,
  idempotencyKey: "same-key",
  now: "2026-08-03T09:00:00.000Z",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: input.id, device_id: input.deviceId, scheduled_at: input.scheduledAt, notification_type: input.notificationType,
    status: "pending", idempotency_key: input.idempotencyKey, attempt_count: 0, claimed_at: null, sent_at: null,
    last_error_code: null, created_at: input.now, updated_at: input.now, ...overrides,
  };
}

describe("PgReminderRepository upsert conflict handling", () => {
  it("maps a concurrent idempotency-key unique violation to a replay instead of leaking a database error", async () => {
    const uniqueError = Object.assign(new Error("duplicate key"), { code: "23505" });
    const client = {
      query: async (sql: string) => {
        if (sql.includes("INSERT INTO reminder_jobs")) throw uniqueError;
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = {
      connect: async () => client,
      query: async (sql: string) => sql.includes("idempotency_key") ? { rows: [row()] } : { rows: [] },
    };
    const result = await new PgReminderRepository(pool as never).upsert(input);
    expect(result).toMatchObject({ kind: "replay", record: { id: input.id } });
  });

  it("returns missing without issuing an update when the conflicting reminder belongs to another device", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("idempotency_key")) return { rows: [] };
        if (sql.includes("INSERT INTO reminder_jobs")) return { rows: [] };
        if (sql.includes("WHERE id = $1 FOR UPDATE")) return { rows: [row({ device_id: "other-device" })] };
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client, query: async () => ({ rows: [] }) };
    await expect(new PgReminderRepository(pool as never).upsert(input)).resolves.toEqual({ kind: "missing" });
    expect(queries.join("\n")).not.toContain("UPDATE reminder_jobs SET scheduled_at");
  });
});
