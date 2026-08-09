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

  it("renews a conflicted task operation without replacing a concurrent global series", async () => {
    const initial = snapshotWithOutbox();
    initial.captures = [{ id: "private-inbox-capture", body: "private", classification: "unclassified", createdAt: now, updatedAt: now }];
    initial.settings.inboxReminderFrequency = "gentle";
    initial.reminderMap.push({ reminderId: "33333333-3333-4333-8333-333333333333", scope: "inbox", kind: "capture_initial", taskRevision: 0, createdAt: now });
    initial.notificationOutbox.push({ id: "global-outbox", operation: "upsert", reminderId: "33333333-3333-4333-8333-333333333333", scheduledAt: "2026-08-04T09:00:00.000Z", notificationType: "inbox_review", taskRevision: 0, attemptCount: 0, nextAttemptAt: now, createdAt: now });
    const repository = memory(initial);

    await flushOutbox({ repository, now: () => now, api: {
      upsert: async (item) => {
        if (item.reminderId === "22222222-2222-4222-8222-222222222222") throw new NotificationApiError(409, undefined, "IDEMPOTENCY_CONFLICT");
      },
      cancel: async () => undefined,
    } });

    const queued = await repository.load();
    expect(queued.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ reminderId: "22222222-2222-4222-8222-222222222222", operation: "upsert", id: expect.not.stringMatching(/^outbox$/) }),
    ]));
    expect(queued.reminderMap).toEqual(expect.arrayContaining([
      expect.objectContaining({ reminderId: "33333333-3333-4333-8333-333333333333", scope: "inbox" }),
    ]));
  });

  it("keeps each anonymous schedule kind when an idempotency conflict rebuilds a scheduled task", async () => {
    const initial = snapshotWithOutbox();
    initial.settings = {
      ...initial.settings,
      notificationEnabled: true,
      initialReminderDelayMinutes: 60,
      deadlineReminderLeadMinutes: 60,
    };
    initial.tasks[0] = {
      ...initial.tasks[0]!,
      dueMode: "scheduled",
      dueAt: "2026-08-05T12:00:00.000Z",
      nextReviewAt: "2026-08-05T12:00:00.000Z",
    };
    initial.reminderMap = [
      { reminderId: "22222222-2222-4222-8222-222222222222", taskId: "task", kind: "initial", taskRevision: 3, createdAt: now },
      { reminderId: "33333333-3333-4333-8333-333333333333", taskId: "task", kind: "deadline_before", taskRevision: 3, createdAt: now },
      { reminderId: "44444444-4444-4444-8444-444444444444", taskId: "task", kind: "review", taskRevision: 3, createdAt: now },
    ];
    const repository = memory(initial);

    await flushOutbox({
      repository,
      now: () => now,
      api: {
        upsert: async () => { throw new NotificationApiError(409, undefined, "IDEMPOTENCY_CONFLICT"); },
        cancel: async () => undefined,
      },
    });

    expect((await repository.load()).notificationOutbox.map((item) => ({
      reminderId: item.reminderId,
      scheduledAt: item.scheduledAt,
      notificationType: item.notificationType,
    }))).toEqual([
      { reminderId: "22222222-2222-4222-8222-222222222222", scheduledAt: "2026-08-04T09:00:00.000Z", notificationType: "task_review" },
      { reminderId: "33333333-3333-4333-8333-333333333333", scheduledAt: "2026-08-05T11:00:00.000Z", notificationType: "deadline_review" },
      { reminderId: "44444444-4444-4444-8444-444444444444", scheduledAt: "2026-08-05T12:00:00.000Z", notificationType: "deadline_review" },
    ]);
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

  it("drops only a missed initial or deadline-before reservation instead of turning it into a review reminder", async () => {
    const snapshot = snapshotWithOutbox();
    snapshot.reminderMap[0] = { ...snapshot.reminderMap[0]!, kind: "initial" };
    const repository = memory(snapshot);

    await flushOutbox({
      repository,
      now: () => now,
      api: {
        upsert: async () => { throw new NotificationApiError(400, undefined, "INVALID_SCHEDULE"); },
        cancel: async () => undefined,
      },
    });

    expect((await repository.load()).notificationOutbox).toEqual([]);
    expect((await repository.load()).reminderMap).toEqual([]);
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

  it("drops an inbox-wide reservation when no unresolved inbox entry remains", async () => {
    const snapshot = snapshotWithOutbox();
    snapshot.tasks = [];
    snapshot.captures = [];
    snapshot.reminderMap = [{
      reminderId: "22222222-2222-4222-8222-222222222222",
      scope: "inbox",
      kind: "capture_initial",
      taskRevision: 0,
      createdAt: now,
    }];
    snapshot.notificationOutbox[0] = {
      ...snapshot.notificationOutbox[0]!,
      taskRevision: 0,
      notificationType: "inbox_review",
    };

    const repository = memory(snapshot);
    await flushOutbox({
      repository,
      now: () => now,
      api: {
        upsert: async () => {
          throw new Error("a stale global reservation must not be sent");
        },
        cancel: async () => undefined,
      },
    });

    expect((await repository.load()).notificationOutbox).toEqual([]);
  });

  it("rebuilds an invalid global schedule without attaching local ownership to the API record", async () => {
    const snapshot = snapshotWithOutbox();
    snapshot.tasks = [];
    snapshot.captures = [{
      id: "local-capture-id",
      body: "private inbox text",
      classification: "unclassified",
      createdAt: "2026-08-04T07:00:00.000Z",
      updatedAt: now,
    }];
    snapshot.settings.inboxReminderFrequency = "gentle";
    snapshot.reminderMap = [{
      reminderId: "22222222-2222-4222-8222-222222222222",
      scope: "inbox",
      kind: "capture_initial",
      taskRevision: 0,
      createdAt: now,
    }];
    snapshot.notificationOutbox[0] = {
      ...snapshot.notificationOutbox[0]!,
      taskRevision: 0,
      notificationType: "inbox_review",
      scheduledAt: "2026-08-03T08:00:00.000Z",
    };
    const repository = memory(snapshot);

    await flushOutbox({
      repository,
      now: () => now,
      api: {
        upsert: async () => {
          throw new NotificationApiError(400, undefined, "INVALID_SCHEDULE");
        },
        cancel: async () => undefined,
      },
    });

    const saved = await repository.load();
    expect(saved.notificationOutbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "upsert",
          notificationType: "inbox_review",
          scheduledAt: now,
        }),
      ]),
    );
    expect(saved.reminderMap).toEqual(
      expect.arrayContaining([expect.objectContaining({ scope: "inbox" })]),
    );
    expect(JSON.stringify(saved.notificationOutbox)).not.toContain("local-capture-id");
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
