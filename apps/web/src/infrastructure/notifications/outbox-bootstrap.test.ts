import { describe, expect, it, vi } from "vitest";
import { createEmptySnapshot, type AppRepository } from "../../../../../packages/domain/src";
import { installOutboxFlush, reconcileMissingNotifications } from "./outbox-bootstrap";

describe("installOutboxFlush", () => {
  it("flushes on application launch and each online event, then removes its listener", async () => {
    const target = new EventTarget();
    const flush = vi.fn().mockResolvedValue(undefined);
    const stop = installOutboxFlush(target, flush);
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(1);

    target.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(2));
    stop();
    target.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("serializes launch and reconnect repair so two snapshots cannot overwrite each other", async () => {
    const target = new EventTarget();
    let release: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => { release = resolve; });
    const flush = vi.fn()
      .mockImplementationOnce(async () => firstRun)
      .mockResolvedValue(undefined);

    installOutboxFlush(target, flush);
    await Promise.resolve();
    target.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(1);

    release?.();
    await firstRun;
    await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(2));
  });
});

describe("reconcileMissingNotifications", () => {
  // Break caught: startup repair saved its stale load and erased a capture committed meanwhile.
  it("recomputes from the latest snapshot before saving notification-only repairs", async () => {
    const stale = createEmptySnapshot({
      appVersion: "mvp-1.23.0",
      localDeviceId: "local",
      timeZone: "Asia/Tokyo",
      now: "2026-09-01T09:00:00.000Z",
    });
    stale.settings.notificationEnabled = true;
    stale.captures = [{
      id: "first-capture",
      body: "first local value",
      classification: "unclassified",
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
    }];
    const latest = structuredClone(stale);
    latest.captures.push({
      id: "concurrent-capture",
      body: "must survive startup repair",
      classification: "unclassified",
      createdAt: "2026-09-01T09:05:00.000Z",
      updatedAt: "2026-09-01T09:05:00.000Z",
    });
    let loadCount = 0;
    const save = vi.fn().mockResolvedValue(undefined);
    const repository: AppRepository = {
      load: async () => structuredClone(loadCount++ === 0 ? stale : latest),
      save,
      loadDraft: async () => "",
      saveDraft: async () => undefined,
      clearDraft: async () => undefined,
    };

    await reconcileMissingNotifications({
      repository,
      now: () => "2026-09-01T09:06:00.000Z",
    });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      captures: expect.arrayContaining([
        expect.objectContaining({ id: "concurrent-capture" }),
      ]),
      notificationOutbox: expect.arrayContaining([
        expect.objectContaining({ scheduledAt: "2026-09-01T10:05:00.000Z" }),
      ]),
    }));
  });

  // Break caught: startup only repairs overdue task mappings and leaves an unresolved inbox without a notification.
  it("persists a missing inbox reservation before startup outbox delivery", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "mvp-1.23.0",
      localDeviceId: "local",
      timeZone: "Asia/Tokyo",
      now: "2026-09-01T09:00:00.000Z",
    });
    snapshot.settings.notificationEnabled = true;
    snapshot.captures = [{
      id: "capture-local",
      body: "SECRET_CAPTURE_CANARY",
      classification: "unclassified",
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
    }];
    const save = vi.fn().mockResolvedValue(undefined);
    const repository: AppRepository = {
      load: async () => snapshot,
      save,
      loadDraft: async () => "",
      saveDraft: async () => undefined,
      clearDraft: async () => undefined,
    };

    await reconcileMissingNotifications({
      repository,
      now: () => "2026-09-01T09:01:00.000Z",
    });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      reminderMap: expect.arrayContaining([
        expect.objectContaining({ scope: "inbox", kind: "capture_initial" }),
      ]),
      notificationOutbox: expect.arrayContaining([
        expect.objectContaining({
          operation: "upsert",
          scheduledAt: "2026-09-01T10:00:00.000Z",
          notificationType: "inbox_review",
        }),
      ]),
    }));
    expect(JSON.stringify(save.mock.calls[0]?.[0].notificationOutbox)).not.toContain("SECRET_CAPTURE_CANARY");
  });

  // Break caught: startup repairs tasks and inbox items but leaves a saved memo without its review notification.
  it("persists a missing memo reservation before startup outbox delivery", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "mvp-1.23.0",
      localDeviceId: "local",
      timeZone: "Asia/Tokyo",
      now: "2026-09-01T09:00:00.000Z",
    });
    snapshot.settings.notificationEnabled = true;
    snapshot.captures = [{
      id: "memo-local",
      body: "SECRET_MEMO_CANARY",
      classification: "note",
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
    }];
    const save = vi.fn().mockResolvedValue(undefined);
    const repository: AppRepository = {
      load: async () => snapshot,
      save,
      loadDraft: async () => "",
      saveDraft: async () => undefined,
      clearDraft: async () => undefined,
    };

    await reconcileMissingNotifications({
      repository,
      now: () => "2026-09-01T09:01:00.000Z",
    });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      reminderMap: expect.arrayContaining([
        expect.objectContaining({ scope: "memo", kind: "capture_initial" }),
      ]),
      notificationOutbox: expect.arrayContaining([
        expect.objectContaining({
          operation: "upsert",
          scheduledAt: "2026-09-08T09:00:00.000Z",
          notificationType: "inbox_review",
        }),
      ]),
    }));
    expect(JSON.stringify(save.mock.calls[0]?.[0].notificationOutbox)).not.toContain("SECRET_MEMO_CANARY");
  });

  it("persists missing overdue reservations before startup outbox delivery", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "mvp-1.23.0",
      localDeviceId: "local",
      timeZone: "Asia/Tokyo",
      now: "2026-08-08T09:00:00.000Z",
    });
    snapshot.settings.notificationEnabled = true;
    snapshot.tasks = [{
      id: "task-local",
      sourceCaptureId: "capture-local",
      title: "SECRET_TASK_CANARY",
      status: "active",
      dueMode: "scheduled",
      dueAt: "2026-08-08T15:00:00.000Z",
      nextReviewAt: "2026-08-08T15:00:00.000Z",
      undecidedCount: 0,
      dismissCount: 0,
      postponeCount: 0,
      createdAt: "2026-08-08T09:00:00.000Z",
      updatedAt: "2026-08-08T09:00:00.000Z",
      revision: 1,
    }];
    const save = vi.fn().mockResolvedValue(undefined);
    const repository: AppRepository = {
      load: async () => snapshot,
      save,
      loadDraft: async () => "",
      saveDraft: async () => undefined,
      clearDraft: async () => undefined,
    };

    await reconcileMissingNotifications({
      repository,
      now: () => "2026-08-08T09:00:00.000Z",
    });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      reminderMap: expect.arrayContaining([
        expect.objectContaining({ taskId: "task-local", kind: "overdue_repeat" }),
      ]),
    }));
    expect(JSON.stringify(save.mock.calls[0]?.[0].notificationOutbox)).not.toContain("SECRET_TASK_CANARY");
  });
});
