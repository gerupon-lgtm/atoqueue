import { describe, expect, it } from "vitest";
import { InMemoryReminderRepository, PgReminderRepository } from "./reminder-repository.js";

const input = {
  id: "4ec4032e-5a92-45fe-b5a7-6e2015f028e0",
  deviceId: "a1f0f85e-8da5-4bfb-8fc4-938067ca9984",
  scheduledAt: "2026-08-06T09:00:00.000Z",
  notificationType: "task_review" as const,
  repeatCadence: null,
  idempotencyKey: "same-key",
  now: "2026-08-03T09:00:00.000Z",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: input.id, device_id: input.deviceId, scheduled_at: input.scheduledAt, notification_type: input.notificationType,
    status: "pending", idempotency_key: input.idempotencyKey, attempt_count: 0, claimed_at: null, sent_at: null,
    last_error_code: null, repeat_cadence: null, created_at: input.now, updated_at: input.now, ...overrides,
  };
}

describe("PgReminderRepository upsert conflict handling", () => {
  it("rejects an unregistered past schedule before any database mutation", async () => {
    const queries: string[] = [];
    const client = { query: async (sql: string) => { queries.push(sql); return { rows: [] }; }, release: () => undefined };
    const result = await new PgReminderRepository({ connect: async () => client } as never).upsert({ ...input, now: "2026-08-07T09:00:00.000Z" });
    expect(result).toEqual({ kind: "invalid_schedule" });
    expect(queries.some(sql => /^(INSERT|UPDATE)/.test(sql))).toBe(false);
    expect(queries).toContain("COMMIT");
  });
  it("only requeues a claimed recurring job while its device subscription remains active", async () => {
    const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const client = {
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (sql.includes("FOR UPDATE")) return { rows: [{ device_id: input.deviceId, status: "disabled" }] };
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = {
      connect: async () => client,
      query: async () => ({ rows: [] }),
    };

    await new PgReminderRepository(pool as never).rescheduleAfterSend(input.id, "2026-08-06T09:00:00.000Z", "2026-08-13T09:00:00.000Z", "2026-08-06T09:01:00.000Z");

    expect(queries.map((query) => query.sql)).toEqual(expect.arrayContaining(["BEGIN", "COMMIT"]));
    expect(queries.find((query) => query.sql.includes("FOR UPDATE"))?.sql).toContain("device_subscriptions");
    expect(queries.some((query) => query.sql.startsWith("UPDATE reminder_jobs"))).toBe(false);
  });

  it("locks the device before a 410 failure invalidates every pending or claimed job", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("FROM device_subscriptions WHERE")) return { rows: [{ status: "active" }] };
        if (sql.includes("WHERE id=$3")) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };

    await new PgReminderRepository({ connect: async () => client } as never).disableDeviceAndFailPending(input.deviceId, input.id, "2026-08-06T09:00:00.000Z", "2026-08-06T09:01:00.000Z", "push_410");

    const lockIndex = queries.findIndex((sql) => sql.includes("FOR UPDATE"));
    const failClaimIndex = queries.findIndex((sql) => sql.includes("WHERE id=$3"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(failClaimIndex).toBeGreaterThan(lockIndex);
    expect(queries.some((sql) => sql.includes("status IN ('pending','claimed')"))).toBe(true);
  });

  it("replays a legacy one-shot operation and normalizes its missing cadence to null", async () => {
    const client = {
      query: async (sql: string) => sql.includes("reminder_idempotency_operations")
        ? { rows: [{ request_fingerprint: JSON.stringify({ id: input.id, scheduledAt: input.scheduledAt, notificationType: input.notificationType }), response_body: JSON.stringify({ id: input.id, deviceId: input.deviceId, scheduledAt: input.scheduledAt, notificationType: input.notificationType, status: "pending", idempotencyKey: input.idempotencyKey, attemptCount: 0, claimedAt: null, sentAt: null, lastErrorCode: null, createdAt: input.now, updatedAt: input.now }) }] }
        : { rows: [] },
      release: () => undefined,
    };
    const result = await new PgReminderRepository({ connect: async () => client } as never).upsert({ ...input, now: "2026-08-07T09:00:00.000Z" });
    expect(result).toMatchObject({ kind: "replay", record: { repeatCadence: null } });
  });

  it("does not apply legacy fingerprint compatibility to a recurring request", async () => {
    const client = {
      query: async (sql: string) => sql.includes("reminder_idempotency_operations")
        ? { rows: [{ request_fingerprint: JSON.stringify({ id: input.id, scheduledAt: input.scheduledAt, notificationType: input.notificationType }), response_body: JSON.stringify(row()) }] }
        : { rows: [] },
      release: () => undefined,
    };
    await expect(new PgReminderRepository({ connect: async () => client } as never).upsert({ ...input, repeatCadence: "monthly" })).resolves.toEqual({ kind: "conflict" });
  });

  it("maps a concurrent idempotency-key unique violation to a replay instead of leaking a database error", async () => {
    const uniqueError = Object.assign(new Error("duplicate key"), { code: "23505" });
    const client = {
      query: async (sql: string) => {
        if (sql.includes("INSERT INTO reminder_jobs")) throw uniqueError;
        return { rows: [] };
      },
      release: () => undefined,
    };
    let operationLookups = 0;
    const pool = {
      connect: async () => client,
      query: async (sql: string) => {
        if (sql.includes("reminder_idempotency_operations")) {
          operationLookups += 1;
          return operationLookups === 1 ? { rows: [{ request_fingerprint: JSON.stringify({ id: input.id, scheduledAt: input.scheduledAt, notificationType: input.notificationType, repeatCadence: input.repeatCadence }), response_body: JSON.stringify(row()) }] } : { rows: [] };
        }
        return sql.includes("idempotency_key") ? { rows: [row()] } : { rows: [] };
      },
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

describe("reminder idempotency history", () => {
  it("only reschedules a matching active claim", async () => {
    const repository = new InMemoryReminderRepository();
    repository.seedDevice({ deviceId: input.deviceId, status: "active", subscription: { endpoint: "https://push.example/subscription", p256dh: "p", auth: "a" } });
    repository.seed({ id: input.id, deviceId: input.deviceId, scheduledAt: input.scheduledAt, notificationType: input.notificationType, repeatCadence: "weekly", status: "pending", attemptCount: 0, claimedAt: null });
    const [claim] = await repository.claimDue(input.scheduledAt, 1);

    await repository.rescheduleAfterSend(input.id, "stale-claim", "2026-08-13T09:00:00.000Z", "2026-08-06T09:00:00.000Z");
    expect(repository.get(input.id)).toMatchObject({ status: "claimed", claimedAt: claim!.claimedAt });

    await repository.rescheduleAfterSend(input.id, claim!.claimedAt!, "2026-08-13T09:00:00.000Z", "2026-08-06T09:00:00.000Z");
    expect(repository.get(input.id)).toMatchObject({ status: "pending", claimedAt: null, scheduledAt: "2026-08-13T09:00:00.000Z" });
  });

  it("does not recreate a recurring job after another claim disables the device", async () => {
    const repository = new InMemoryReminderRepository();
    repository.seedDevice({ deviceId: input.deviceId, status: "active", subscription: { endpoint: "https://push.example/subscription", p256dh: "p", auth: "a" } });
    repository.seed({ id: "expired", deviceId: input.deviceId, scheduledAt: input.scheduledAt, notificationType: input.notificationType, repeatCadence: null, status: "pending", attemptCount: 0, claimedAt: null });
    repository.seed({ id: input.id, deviceId: input.deviceId, scheduledAt: input.scheduledAt, notificationType: input.notificationType, repeatCadence: "weekly", status: "pending", attemptCount: 0, claimedAt: null });
    const claims = await repository.claimDue(input.scheduledAt, 2);
    const expired = claims.find((claim) => claim.id === "expired")!;
    const recurring = claims.find((claim) => claim.id === input.id)!;

    await repository.disableDeviceAndFailPending(input.deviceId, expired.id, expired.claimedAt!, "2026-08-06T09:01:00.000Z", "push_410");
    await repository.rescheduleAfterSend(recurring.id, recurring.claimedAt!, "2026-08-13T09:00:00.000Z", "2026-08-06T09:01:01.000Z");

    expect(repository.device(input.deviceId)?.status).toBe("disabled");
    expect(repository.get(recurring.id)).toMatchObject({ status: "failed", scheduledAt: input.scheduledAt });
  });

  it("does not retry or recover a claimed job for a disabled device", async () => {
    const repository = new InMemoryReminderRepository();
    repository.seedDevice({ deviceId: input.deviceId, status: "disabled", subscription: { endpoint: "https://push.example/subscription", p256dh: "p", auth: "a" } });
    repository.seed({ id: input.id, deviceId: input.deviceId, scheduledAt: input.scheduledAt, notificationType: input.notificationType, repeatCadence: "weekly", status: "claimed", attemptCount: 0, claimedAt: "2026-08-06T08:00:00.000Z" });

    await repository.retry(input.id, "2026-08-06T08:00:00.000Z", "2026-08-06T09:05:00.000Z", 1, "2026-08-06T09:00:00.000Z", "push_error");
    await repository.recoverStaleClaims("2026-08-06T08:30:00.000Z", "2026-08-06T09:00:00.000Z");

    expect(repository.get(input.id)).toMatchObject({ status: "claimed", scheduledAt: input.scheduledAt });
  });

  it("stores monthly cadence and treats a cadence change as an idempotency conflict", async () => {
    const repository = new InMemoryReminderRepository();
    const created = await repository.upsert({ ...input, repeatCadence: "monthly" });
    const conflict = await repository.upsert({ ...input, repeatCadence: "weekly" });
    expect(created).toMatchObject({ kind: "created", record: { repeatCadence: "monthly" } });
    expect(conflict).toEqual({ kind: "conflict" });
  });

  it("accepts an explicit null cadence for one-off reminders", async () => {
    const repository = new InMemoryReminderRepository();
    await repository.upsert({ ...input, repeatCadence: null });
    expect(repository.get(input.id)).toMatchObject({ repeatCadence: null });
  });

  it("replays A/key-1 after B/key-2 without reverting the current reminder", async () => {
    const repository = new InMemoryReminderRepository();
    const first = await repository.upsert(input);
    const second = await repository.upsert({ ...input, scheduledAt: "2026-08-07T09:00:00.000Z", idempotencyKey: "key-2", now: "2026-08-04T09:00:00.000Z" });
    const replay = await repository.upsert(input);
    expect(first).toMatchObject({ kind: "created" });
    expect(second).toMatchObject({ kind: "updated" });
    expect(replay).toMatchObject({ kind: "replay", record: { scheduledAt: input.scheduledAt, updatedAt: input.now } });
    expect(repository.get(input.id)).toMatchObject({ scheduledAt: "2026-08-07T09:00:00.000Z", idempotencyKey: "key-2" });
  });
});
