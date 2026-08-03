import { describe, expect, it } from "vitest";
import { createEmptySnapshot, type AppRepository, type AppSnapshot } from "../../../../../packages/domain/src";
import { NotificationApiError } from "./notification-api";
import { flushOutbox } from "./outbox-sync";

const now = "2026-08-04T08:00:00.000Z";
const credentials = { deviceId: "11111111-1111-4111-8111-111111111111", deviceSecret: "secret" };

describe("flushOutbox", () => {
  it("keeps local edits and retries a server error exponentially", async () => {
    const repository = memory(snapshotWithOutbox());
    const result = await flushOutbox({ repository, now: () => now, api: { upsert: async () => { throw new NotificationApiError(503); }, cancel: async () => undefined } });

    expect(result).toEqual({ settingsError: false, registrationStale: false });
    const saved = await repository.load();
    expect(saved.notificationOutbox[0]).toMatchObject({ attemptCount: 1, nextAttemptAt: "2026-08-04T08:01:00.000Z" });
  });

  it("honors Retry-After and stops retrying an invalid request", async () => {
    const repository = memory(snapshotWithOutbox());
    await flushOutbox({ repository, now: () => now, api: { upsert: async () => { throw new NotificationApiError(429, 120); }, cancel: async () => undefined } });
    expect((await repository.load()).notificationOutbox[0]?.nextAttemptAt).toBe("2026-08-04T08:02:00.000Z");

    const badRepository = memory(snapshotWithOutbox());
    const result = await flushOutbox({ repository: badRepository, now: () => now, api: { upsert: async () => { throw new NotificationApiError(400); }, cancel: async () => undefined } });
    expect(result.settingsError).toBe(true);
    expect((await badRepository.load()).notificationOutbox).toEqual([]);
  });

  it("marks credentials stale after authorization failure and removes the completed cancel mapping", async () => {
    const stale = memory(snapshotWithOutbox());
    const result = await flushOutbox({ repository: stale, now: () => now, api: { upsert: async () => { throw new NotificationApiError(401); }, cancel: async () => undefined } });
    expect(result.registrationStale).toBe(true);
    expect((await stale.load()).device.pushDeviceSecret).toBeUndefined();
    expect((await stale.load()).settings.notificationEnabled).toBe(false);

    const cancelling = memory(snapshotWithOutbox("cancel"));
    await flushOutbox({ repository: cancelling, now: () => now, api: { upsert: async () => undefined, cancel: async () => undefined } });
    expect((await cancelling.load()).reminderMap).toEqual([]);
  });

  it("sends a restore cancellation even after its local reminder mapping was replaced", async () => {
    const snapshot = snapshotWithOutbox("cancel");
    snapshot.reminderMap = [];
    const repository = memory(snapshot);
    const cancelled: string[] = [];

    await flushOutbox({
      repository,
      now: () => now,
      api: {
        upsert: async () => undefined,
        cancel: async (item) => { cancelled.push(item.reminderId); },
      },
    });

    expect(cancelled).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect((await repository.load()).notificationOutbox).toEqual([]);
  });

  it("recovers documented error codes without retrying a successful missing cancel", async () => {
    const lostDevice = memory(snapshotWithOutbox());
    const stale = await flushOutbox({ repository: lostDevice, now: () => now, api: { upsert: async () => { throw new NotificationApiError(404, undefined, "DEVICE_NOT_FOUND"); }, cancel: async () => undefined } });
    expect(stale.registrationStale).toBe(true);
    expect((await lostDevice.load()).device.pushDeviceSecret).toBeUndefined();

    const missingCancel = memory(snapshotWithOutbox("cancel"));
    await flushOutbox({ repository: missingCancel, now: () => now, api: { upsert: async () => undefined, cancel: async () => { throw new NotificationApiError(404, undefined, "REMINDER_NOT_FOUND"); } } });
    expect((await missingCancel.load()).notificationOutbox).toEqual([]);
    expect((await missingCancel.load()).reminderMap).toEqual([]);
  });

  it("rebuilds every active reminder with fresh operation IDs after an idempotency conflict", async () => {
    const initial = snapshotWithOutbox();
    initial.tasks.push({ ...initial.tasks[0]!, id: "task-2", revision: 2 });
    initial.reminderMap.push({ reminderId: "33333333-3333-4333-8333-333333333333", taskId: "task-2", taskRevision: 2, createdAt: now });
    const repository = memory(initial);
    await flushOutbox({ repository, now: () => now, api: { upsert: async () => { throw new NotificationApiError(409, undefined, "IDEMPOTENCY_CONFLICT"); }, cancel: async () => undefined } });

    const queued = (await repository.load()).notificationOutbox;
    expect(queued).toHaveLength(2);
    expect(queued.map((item) => item.reminderId).sort()).toEqual(["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]);
    expect(queued.every((item) => item.id !== "outbox" && item.operation === "upsert" && item.attemptCount === 0)).toBe(true);
  });

  it("recalculates a rejected past schedule from the local reminder policy", async () => {
    const repository = memory(snapshotWithOutbox());
    const snapshot = await repository.load();
    snapshot.notificationOutbox[0] = { ...snapshot.notificationOutbox[0]!, scheduledAt: "2026-08-03T08:00:00.000Z" };
    snapshot.tasks[0] = { ...snapshot.tasks[0]!, nextReviewAt: "2026-08-03T08:00:00.000Z", dueMode: "none", dismissCount: 0 };
    await repository.save(snapshot);

    await flushOutbox({ repository, now: () => now, api: { upsert: async () => { throw new NotificationApiError(400, undefined, "INVALID_SCHEDULE"); }, cancel: async () => undefined } });

    expect((await repository.load()).notificationOutbox).toEqual([expect.objectContaining({
      scheduledAt: "2026-08-05T09:00:00.000Z",
      nextAttemptAt: now,
      taskRevision: 3,
    })]);
    expect((await repository.load()).notificationOutbox[0]?.id).not.toBe("outbox");
  });

  it("preserves a local edit saved while a launch flush is awaiting the API", async () => {
    const repository = memory(snapshotWithOutbox());
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const flushing = flushOutbox({ repository, now: () => now, api: { upsert: async () => waiting, cancel: async () => undefined } });
    await Promise.resolve();
    const localEdit = await repository.load();
    localEdit.tasks[0] = { ...localEdit.tasks[0]!, title: "edited only on this device", revision: 4 };
    localEdit.notificationOutbox.push({ ...localEdit.notificationOutbox[0]!, id: "newer-outbox", taskRevision: 4 });
    await repository.save(localEdit);
    release?.();
    await flushing;

    const saved = await repository.load();
    expect(saved.tasks[0]?.title).toBe("edited only on this device");
    expect(saved.notificationOutbox.map((item) => item.id)).toEqual(["newer-outbox"]);
  });

  it("discards an outbox item made for an older task revision", async () => {
    const repository = memory(snapshotWithOutbox());
    const snapshot = await repository.load();
    snapshot.tasks = [{ id: "task", sourceCaptureId: "capture", title: "local private task", status: "active", dueMode: "none", nextReviewAt: now, undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: now, updatedAt: now, revision: 4 }];
    await repository.save(snapshot);

    await flushOutbox({ repository, now: () => now, api: { upsert: async () => { throw new Error("must not call"); }, cancel: async () => undefined } });
    expect((await repository.load()).notificationOutbox).toEqual([]);
  });
});

function snapshotWithOutbox(operation: "upsert" | "cancel" = "upsert"): AppSnapshot {
  const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
  snapshot.device = { ...snapshot.device, pushDeviceId: credentials.deviceId, pushDeviceSecret: credentials.deviceSecret, pushSubscriptionStatus: "granted" };
  snapshot.notificationOutbox = [{ id: "outbox", operation, reminderId: "22222222-2222-4222-8222-222222222222", ...(operation === "upsert" ? { scheduledAt: "2026-08-04T09:00:00.000Z", notificationType: "task_review" as const } : {}), taskRevision: 3, attemptCount: 0, nextAttemptAt: now, createdAt: now }];
  snapshot.reminderMap = [{ reminderId: "22222222-2222-4222-8222-222222222222", taskId: "task", taskRevision: 3, createdAt: now }];
  snapshot.tasks = [{ id: "task", sourceCaptureId: "capture", title: "local private task", status: operation === "cancel" ? "completed" : "active", dueMode: "none", nextReviewAt: now, undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: now, updatedAt: now, revision: 3 }];
  return snapshot;
}

function memory(initial: AppSnapshot): AppRepository {
  let value = structuredClone(initial);
  return { load: async () => structuredClone(value), save: async (next) => { value = structuredClone(next); }, loadDraft: async () => "", saveDraft: async () => undefined, clearDraft: async () => undefined };
}
