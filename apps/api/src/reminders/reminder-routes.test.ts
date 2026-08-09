import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../server.js";
import { InMemoryDeviceRepository } from "../devices/device-repository.js";
import { InMemoryReminderRepository } from "./reminder-repository.js";

const subscription = {
  endpoint: "https://push.example/reminder-device",
  expirationTime: null,
  keys: { p256dh: "private-p256dh", auth: "private-auth" },
};
const testNow = () => "2026-08-01T09:00:00.000Z";

async function register(app: ReturnType<typeof buildApp>, endpoint = subscription.endpoint) {
  const response = await app.inject({ method: "POST", url: "/v1/devices", payload: { subscription: { ...subscription, endpoint } } });
  return response.json() as { deviceId: string; deviceSecret: string };
}

function upsertRequest(device: { deviceId: string; deviceSecret: string }, reminderId: string, key: string, scheduledAt = "2026-08-06T09:00:00.000Z", repeatCadence?: "weekly" | "monthly") {
  return {
    method: "PUT" as const,
    url: `/v1/reminders/${reminderId}`,
    headers: { authorization: `Bearer ${device.deviceSecret}`, "idempotency-key": key },
    payload: { deviceId: device.deviceId, scheduledAt, notificationType: "task_review", ...(repeatCadence ? { repeatCadence } : {}) },
  };
}

describe("reminder routes", () => {
  it("returns the requested weekly cadence without accepting private ownership fields", async () => {
    const reminders = new InMemoryReminderRepository();
    const app = buildApp({ version: "0.1.0", repository: new InMemoryDeviceRepository(), reminderRepository: reminders, now: testNow });
    const device = await register(app);
    const created = await app.inject(upsertRequest(device, randomUUID(), "weekly-1", undefined, "weekly"));
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ repeatCadence: "weekly" });
    const rejected = await app.inject({ ...upsertRequest(device, randomUUID(), "private-1"), payload: { ...upsertRequest(device, randomUUID(), "private-1").payload, owner: "SECRET_OWNER" } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).not.toContain("SECRET_OWNER");
    await app.close();
  });

  it("creates and fully replaces an authenticated device reminder without storing task data", async () => {
    const reminders = new InMemoryReminderRepository();
    const app = buildApp({ version: "0.1.0", repository: new InMemoryDeviceRepository(), reminderRepository: reminders, now: testNow });
    const device = await register(app);
    const reminderId = randomUUID();
    const first = await app.inject(upsertRequest(device, reminderId, "create-1"));
    expect(first.statusCode).toBe(201);
    const replacement = await app.inject(upsertRequest(device, reminderId, "replace-1", "2026-08-07T09:00:00.000Z"));
    expect(replacement.statusCode).toBe(200);
    expect(reminders.get(reminderId)).toMatchObject({ deviceId: device.deviceId, scheduledAt: "2026-08-07T09:00:00.000Z", notificationType: "task_review", status: "pending" });
    expect(Object.keys(reminders.get(reminderId) ?? {})).toEqual(expect.arrayContaining(["id", "deviceId", "scheduledAt", "notificationType", "status", "idempotencyKey"]));
    expect(JSON.stringify(reminders.get(reminderId))).not.toContain("SECRET_TASK_CANARY");
    await app.close();
  });

  it("cancels idempotently for its owner and returns 404 for another device", async () => {
    const app = buildApp({ version: "0.1.0", repository: new InMemoryDeviceRepository(), reminderRepository: new InMemoryReminderRepository(), now: testNow });
    const firstDevice = await register(app, "https://push.example/first");
    const secondDevice = await register(app, "https://push.example/second");
    const reminderId = randomUUID();
    await app.inject(upsertRequest(firstDevice, reminderId, "create-1"));
    const foreign = await app.inject({ method: "DELETE", url: `/v1/reminders/${reminderId}?deviceId=${secondDevice.deviceId}`, headers: { authorization: `Bearer ${secondDevice.deviceSecret}` } });
    expect(foreign.statusCode).toBe(404);
    const own = { method: "DELETE" as const, url: `/v1/reminders/${reminderId}?deviceId=${firstDevice.deviceId}`, headers: { authorization: `Bearer ${firstDevice.deviceSecret}` } };
    expect((await app.inject(own)).statusCode).toBe(204);
    expect((await app.inject(own)).statusCode).toBe(204);
    await app.close();
  });

  it("returns 404 without changing a reminder when a different device reuses its id", async () => {
    const reminders = new InMemoryReminderRepository();
    const app = buildApp({ version: "0.1.0", repository: new InMemoryDeviceRepository(), reminderRepository: reminders, now: testNow });
    const owner = await register(app, "https://push.example/owner");
    const other = await register(app, "https://push.example/other-owner");
    const reminderId = randomUUID();
    await app.inject(upsertRequest(owner, reminderId, "owner-create", "2026-08-06T09:00:00.000Z"));
    const response = await app.inject(upsertRequest(other, reminderId, "foreign-overwrite", "2026-08-07T09:00:00.000Z"));
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("REMINDER_NOT_FOUND");
    expect(reminders.get(reminderId)).toMatchObject({ deviceId: owner.deviceId, scheduledAt: "2026-08-06T09:00:00.000Z" });
    await app.close();
  });

  it("replays an idempotent upsert and rejects a changed request with the same key", async () => {
    const app = buildApp({ version: "0.1.0", repository: new InMemoryDeviceRepository(), reminderRepository: new InMemoryReminderRepository(), now: testNow });
    const device = await register(app);
    const reminderId = randomUUID();
    const request = upsertRequest(device, reminderId, "replay-1");
    const first = await app.inject(request);
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(first.statusCode);
    expect(replay.json()).toEqual(first.json());
    const conflict = await app.inject({ ...request, payload: { ...request.payload, scheduledAt: "2026-08-09T09:00:00.000Z" } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    await app.close();
  });

  it.each(["title", "body", "taskId", "category", "dueAt", "actionHistory"])("rejects forbidden field %s", async (field) => {
    const app = buildApp({ version: "0.1.0", repository: new InMemoryDeviceRepository(), reminderRepository: new InMemoryReminderRepository(), now: testNow });
    const device = await register(app);
    const response = await app.inject({ ...upsertRequest(device, randomUUID(), "forbidden-1"), payload: { ...upsertRequest(device, randomUUID(), "forbidden-1").payload, [field]: "SECRET_TASK_CANARY" } });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("SECRET_TASK_CANARY");
    await app.close();
  });

  it("rejects schedules more than five minutes in the past", async () => {
    const app = buildApp({ version: "0.1.0", repository: new InMemoryDeviceRepository(), reminderRepository: new InMemoryReminderRepository(), now: () => "2026-08-06T09:00:00.000Z" });
    const device = await register(app);
    const response = await app.inject(upsertRequest(device, randomUUID(), "old-1", "2026-08-06T08:54:59.000Z"));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_SCHEDULE");
    await app.close();
  });
});
