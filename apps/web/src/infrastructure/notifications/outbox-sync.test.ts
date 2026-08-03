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

    const cancelling = memory(snapshotWithOutbox("cancel"));
    await flushOutbox({ repository: cancelling, now: () => now, api: { upsert: async () => undefined, cancel: async () => undefined } });
    expect((await cancelling.load()).reminderMap).toEqual([]);
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
