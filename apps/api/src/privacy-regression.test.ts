import { randomUUID } from "node:crypto";
import type { InjectOptions } from "fastify";
import { describe, expect, it } from "vitest";
import { InMemoryDeviceRepository } from "./devices/device-repository.js";
import { InMemoryReminderRepository } from "./reminders/reminder-repository.js";
import { ReminderDispatcher } from "./scheduler/reminder-dispatcher.js";
import { buildApp } from "./server.js";

const canary = "SECRET_TASK_CANARY_8D3";
const subscription = { endpoint: "https://push.example/private-device", expirationTime: null, keys: { p256dh: "p256dh", auth: "auth" } };

describe("F-013 privacy regression", () => {
  it("never serializes a task-text canary through HTTP, repository records, logs, or Push", async () => {
    const logs: string[] = [];
    const devices = new InMemoryDeviceRepository();
    const reminders = new InMemoryReminderRepository();
    const app = buildApp({ version: "test", repository: devices, reminderRepository: reminders, now: () => "2026-08-04T09:00:00.000Z", logger: { write: (line) => logs.push(line) } });
    const captures: string[] = [];
    const capture = async (request: InjectOptions) => {
      const response = await app.inject(request);
      captures.push(response.body);
      return response;
    };

    captures.push((await capture({ method: "GET", url: "/healthz" })).body);
    captures.push((await capture({ method: "GET", url: "/v1/push/public-key" })).body);
    const created = await capture({ method: "POST", url: "/v1/devices", payload: { subscription } });
    const { deviceId, deviceSecret } = created.json() as { deviceId: string; deviceSecret: string };
    reminders.seedDevice({ deviceId, status: "active", subscription: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } });
    await capture({ method: "PUT", url: `/v1/devices/${deviceId}/subscription`, headers: { authorization: `Bearer ${deviceSecret}`, "idempotency-key": "update" }, payload: { subscription } });
    const reminderId = randomUUID();
    await capture({ method: "PUT", url: `/v1/reminders/${reminderId}`, headers: { authorization: `Bearer ${deviceSecret}`, "idempotency-key": "upsert" }, payload: { deviceId, scheduledAt: "2026-08-04T09:00:00.000Z", notificationType: "task_review" } });
    await capture({ method: "PUT", url: `/v1/reminders/${randomUUID()}`, headers: { authorization: `Bearer ${deviceSecret}`, "idempotency-key": "forbidden" }, payload: { deviceId, scheduledAt: "2026-08-04T09:00:00.000Z", notificationType: "task_review", title: canary } });
    await capture({ method: "DELETE", url: `/v1/reminders/${randomUUID()}?deviceId=${deviceId}`, headers: { authorization: `Bearer ${deviceSecret}` } });

    const pushes: unknown[] = [];
    await new ReminderDispatcher(reminders, { send: async (input) => { pushes.push(input); return { statusCode: 201 }; } }, () => new Date("2026-08-04T09:00:00.000Z")).dispatchDue();
    const serialized = [captures.join("\n"), JSON.stringify(reminders), JSON.stringify(devices), JSON.stringify(pushes), logs.join("\n")].join("\n");
    expect(serialized).not.toContain(canary);
    expect(pushes).toEqual([expect.objectContaining({ payload: { type: "review_due", reminderId, url: `/today?reminder=${reminderId}` } })]);
    await app.close();
  });

  it("keeps a pending reminder across an API process restart and still sends a generic payload", async () => {
    const devices = new InMemoryDeviceRepository();
    const reminders = new InMemoryReminderRepository();
    const first = buildApp({ version: "test", repository: devices, reminderRepository: reminders, now: () => "2026-08-04T09:00:00.000Z" });
    const created = await first.inject({ method: "POST", url: "/v1/devices", payload: { subscription } });
    const { deviceId, deviceSecret } = created.json() as { deviceId: string; deviceSecret: string };
    reminders.seedDevice({ deviceId, status: "active", subscription: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } });
    const reminderId = randomUUID();
    await first.inject({ method: "PUT", url: `/v1/reminders/${reminderId}`, headers: { authorization: `Bearer ${deviceSecret}`, "idempotency-key": "restart-upsert" }, payload: { deviceId, scheduledAt: "2026-08-04T09:05:00.000Z", notificationType: "task_review" } });
    await first.close();

    const restarted = buildApp({ version: "test", repository: devices, reminderRepository: reminders });
    const sends: unknown[] = [];
    await new ReminderDispatcher(reminders, { send: async (input) => { sends.push(input); return { statusCode: 201 }; } }, () => new Date("2026-08-04T09:05:00.000Z")).dispatchDue();
    expect(sends).toEqual([expect.objectContaining({ payload: { type: "review_due", reminderId, url: `/today?reminder=${reminderId}` } })]);
    await restarted.close();
  });
});
