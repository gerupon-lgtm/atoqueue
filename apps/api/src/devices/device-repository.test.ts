import { describe, expect, it } from "vitest";
import { PgDeviceRepository } from "./device-repository.js";

const activeRow = {
  id: "row-1", device_id: "device-1", endpoint: "https://push.example/original", p256dh: "p256dh", auth: "auth",
  secret_hash: "hash", status: "active", created_at: "2026-08-03T09:00:00.000Z", updated_at: "2026-08-03T09:00:00.000Z", last_error_code: null,
};

describe("PgDeviceRepository idempotent operations", () => {
  it("commits the subscription mutation and idempotency record in one transaction", async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.startsWith("SELECT * FROM device_subscriptions")) return { rows: [activeRow] };
        if (sql.startsWith("SELECT * FROM device_idempotency_operations")) return { rows: [] };
        return { rows: [] };
      },
      release: () => undefined,
    };
    const repository = new PgDeviceRepository({ connect: async () => client } as never);
    const result = await repository.runIdempotentOperation({
      deviceId: "device-1",
      operation: "subscription_update",
      idempotencyKey: "key-1",
      requestFingerprint: "fingerprint-1",
      subscription: { endpoint: "https://push.example/updated", expirationTime: null, keys: { p256dh: "new-p256dh", auth: "new-auth" } },
      responseStatus: 200,
      responseBody: { deviceId: "device-1", status: "active", updatedAt: "2026-08-03T09:01:00.000Z" },
      createdAt: "2026-08-03T09:01:00.000Z",
    });
    expect(result.kind).toBe("applied");
    expect(statements.map((statement) => statement.replace(/\s+/g, " ").trim())).toEqual([
      "BEGIN",
      "SELECT * FROM device_subscriptions WHERE device_id = $1 FOR UPDATE",
      "SELECT * FROM device_idempotency_operations WHERE device_id = $1 AND operation = $2 AND idempotency_key = $3",
      "UPDATE device_subscriptions SET endpoint = $1, p256dh = $2, auth = $3, status = 'active', updated_at = $4 WHERE device_id = $5",
      "INSERT INTO device_idempotency_operations (device_id, operation, idempotency_key, request_fingerprint, response_status, response_body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      "COMMIT",
    ]);
  });

  it.each([
    { storedFingerprint: "fingerprint-1", expected: "replay" },
    { storedFingerprint: "different-fingerprint", expected: "conflict" },
  ])("returns $expected under the locked device row without applying a second mutation", async ({ storedFingerprint, expected }) => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.startsWith("SELECT * FROM device_subscriptions")) return { rows: [activeRow] };
        if (sql.startsWith("SELECT * FROM device_idempotency_operations")) {
          return { rows: [{ request_fingerprint: storedFingerprint, response_body: JSON.stringify({ deviceId: "device-1", status: "active" }) }] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    };
    const repository = new PgDeviceRepository({ connect: async () => client } as never);
    const result = await repository.runIdempotentOperation({
      deviceId: "device-1", operation: "subscription_update", idempotencyKey: "key-1", requestFingerprint: "fingerprint-1",
      subscription: { endpoint: "https://push.example/updated", expirationTime: null, keys: { p256dh: "new-p256dh", auth: "new-auth" } },
      responseStatus: 200, responseBody: { deviceId: "device-1", status: "active" }, createdAt: "2026-08-03T09:01:00.000Z",
    });
    expect(result.kind).toBe(expected);
    expect(statements.some((statement) => statement.startsWith("SELECT * FROM device_subscriptions") && statement.includes("FOR UPDATE"))).toBe(true);
    expect(statements.some((statement) => statement.startsWith("UPDATE device_subscriptions"))).toBe(false);
    expect(statements.some((statement) => statement.startsWith("INSERT INTO device_idempotency_operations"))).toBe(false);
  });
});
