// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createEmptySnapshot, rebuildInboxReminderNotifications, type AppSnapshot, type NotificationOutboxItem } from "../../../../../packages/domain/src";
import { backfillOverdueTaskNotifications } from "./outbox-bootstrap";
import { flushOutbox } from "./outbox-sync";
import { NotificationApi, NotificationApiError } from "./notification-api";
import { buildApp } from "../../../../api/src/server";
import { InMemoryReminderRepository } from "../../../../api/src/reminders/reminder-repository";
import { ReminderDispatcher } from "../../../../api/src/scheduler/reminder-dispatcher";

// F-014: exercise startup, real HTTP handling and dispatch; no external push.
const initialTime = "2026-08-31T10:00:00.000Z";
function fixture() {
  let snapshot: AppSnapshot = createEmptySnapshot({ appVersion: "mvp-1.22.0", localDeviceId: "diagnostic", timeZone: "Asia/Tokyo", now: initialTime });
  snapshot.settings.notificationEnabled = true;
  snapshot.device.pushDeviceId = "diagnostic-device";
  snapshot.device.pushDeviceSecret = "diagnostic-only";
  snapshot.device.pushSubscriptionStatus = "granted";
  snapshot.captures = ["one", "two"].map(id => ({ id, body: "diagnostic", classification: "unclassified", createdAt: "2026-08-01T10:00:00.000Z", updatedAt: initialTime }));
  snapshot = { ...snapshot, ...rebuildInboxReminderNotifications({ snapshot, now: initialTime }) };
  return { load: async () => snapshot, save: async (next: AppSnapshot) => { snapshot = next; }, loadDraft: async () => "", saveDraft: async () => {}, clearDraft: async () => {} };
}

describe("inbox synchronization with two unclassified captures and no notes", () => {
  it("advances only an unregistered expired repeat to its next cadence without an immediate alert", async () => {
    const repository = fixture();
    const before = await repository.load();
    await flushOutbox({ repository, now: () => "2026-09-01T10:00:00.000Z", api: { upsert: async () => { throw new NotificationApiError(400, undefined, "INVALID_SCHEDULE"); }, cancel: async () => {} } });
    const after = await repository.load();
    expect(after.reminderMap).toEqual(before.reminderMap);
    expect(after.notificationOutbox).toHaveLength(1);
    expect(after.notificationOutbox[0]).toMatchObject({ operation: "upsert", reminderId: before.notificationOutbox[0]!.reminderId, scheduledAt: "2026-09-07T10:00:00.000Z", repeatCadence: "weekly" });
    expect(after.notificationOutbox[0]!.id).not.toBe(before.notificationOutbox[0]!.id);
  });

  it("drops an expired unregistered one-shot without recreating it on the next recalculation", async () => {
    const repository = fixture();
    const before = await repository.load();
    before.notificationOutbox[0]!.repeatCadence = undefined;
    await flushOutbox({ repository, now: () => "2026-09-01T10:00:00.000Z", api: { upsert: async () => { throw new NotificationApiError(400, undefined, "INVALID_SCHEDULE"); }, cancel: async () => {} } });
    const after = await repository.load();
    expect(after.notificationOutbox).toEqual([]);
    expect(rebuildInboxReminderNotifications({ snapshot: after, now: "2026-09-01T10:00:00.000Z" }).notificationOutbox).toEqual([]);
  });

  it("renews only a conflicting operation key and preserves its scheduled time and reminder identity", async () => {
    const repository = fixture();
    const before = await repository.load();
    await flushOutbox({ repository, now: () => initialTime, api: { upsert: async () => { throw new NotificationApiError(409, undefined, "IDEMPOTENCY_CONFLICT"); }, cancel: async () => {} } });
    const after = await repository.load();
    expect(after.reminderMap).toEqual(before.reminderMap);
    expect(after.notificationOutbox).toHaveLength(1);
    expect(after.notificationOutbox[0]).toMatchObject({ reminderId: before.notificationOutbox[0]!.reminderId, scheduledAt: initialTime, repeatCadence: "weekly" });
    expect(after.notificationOutbox[0]!.id).not.toBe(before.notificationOutbox[0]!.id);
  });
  it("real API and dispatcher must not resend a weekly inbox notification after a lost response", async () => {
    let now = initialTime;
    const reminders = new InMemoryReminderRepository();
    const app = buildApp({ version: "diagnostic", reminderRepository: reminders, now: () => now });
    try {
      const registered = await app.inject({ method: "POST", url: "/v1/devices", payload: { subscription: { endpoint: "https://push.example/diagnostic", expirationTime: null, keys: { p256dh: "diagnostic", auth: "diagnostic" } } } });
      expect(registered.statusCode).toBe(201);
      const device = registered.json();
      reminders.seedDevice({ deviceId: device.deviceId, status: "active", subscription: { endpoint: "https://push.example/diagnostic", p256dh: "diagnostic", auth: "diagnostic" } });
      const repository = fixture();
      const snapshot = await repository.load();
      snapshot.device.pushDeviceId = device.deviceId;
      snapshot.device.pushDeviceSecret = device.deviceSecret;
      await repository.save(snapshot);
      let loseResponse = true;
      const http: Array<{ method: string; status: number; error?: string }> = [];
      const api = new NotificationApi("https://diagnostic.invalid", async (url, init) => {
        const parsed = new URL(String(url));
        const response = await app.inject({ method: init!.method as "PUT" | "DELETE", url: parsed.pathname + parsed.search, headers: Object.fromEntries(new Headers(init?.headers).entries()), ...(init?.body ? { payload: String(init.body) } : {}) });
        http.push({ method: init!.method!, status: response.statusCode, ...(response.statusCode >= 400 ? { error: response.json().error.code } : {}) });
        if (init!.method === "PUT" && response.statusCode < 300 && loseResponse) { loseResponse = false; throw new Error("Lost success response"); }
        return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { "content-type": "application/json" } });
      });
      const sent: string[] = [];
      const dispatcher = new ReminderDispatcher(reminders, { send: async () => { sent.push(now); return { statusCode: 201 }; } }, () => new Date(now));
      const startup = async () => {
        await backfillOverdueTaskNotifications({ repository, now: () => now });
        await flushOutbox({ repository, api, now: () => now });
        await dispatcher.dispatchDue();
      };
      await startup();
      now = "2026-08-31T10:10:00.000Z";
      await startup();
      now = "2026-08-31T10:10:01.000Z";
      await startup();
      expect(sent).toHaveLength(1);
      expect(http.map(item => item.status)).toEqual([201, 201]);
      expect((await repository.load()).notificationOutbox).toEqual([]);
    } finally { await app.close(); }
  });
  it("plain repeated startup sends nothing after successful synchronization", async () => {
    const repository = fixture();
    const sent: NotificationOutboxItem[] = [];
    const api = { upsert: async (item: NotificationOutboxItem) => { sent.push(item); }, cancel: async () => {} };
    await flushOutbox({ repository, api, now: () => initialTime });
    for (const now of ["2026-08-31T10:10:00.000Z", "2026-08-31T10:20:00.000Z", "2026-08-31T10:30:00.000Z"]) {
      await backfillOverdueTaskNotifications({ repository, now: () => now });
      await flushOutbox({ repository, api, now: () => now });
    }
    expect(sent).toHaveLength(1);
  });
  it("unchanged inbox recalculation must not replace a registered weekly reminder with an immediate one", async () => {
    const repository = fixture();
    await flushOutbox({ repository, now: () => initialTime, api: { upsert: async () => {}, cancel: async () => {} } });
    const before = await repository.load();
    const now = "2026-08-31T10:10:00.000Z";
    const next = rebuildInboxReminderNotifications({ snapshot: before, now });
    expect(next.notificationOutbox).toEqual([]);
  });
});
