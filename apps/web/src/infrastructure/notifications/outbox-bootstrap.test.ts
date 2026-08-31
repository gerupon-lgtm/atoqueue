import { describe, expect, it, vi } from "vitest";
import { createEmptySnapshot, type AppRepository } from "../../../../../packages/domain/src";
import { backfillOverdueTaskNotifications, installOutboxFlush } from "./outbox-bootstrap";

describe("installOutboxFlush", () => {
  it("flushes on application launch and each online event, then removes its listener", async () => {
    const target = new EventTarget();
    const flush = vi.fn().mockResolvedValue(undefined);
    const stop = installOutboxFlush(target, flush);
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(1);

    target.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(2);
    stop();
    target.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(2);
  });
});

describe("backfillOverdueTaskNotifications", () => {
  it("persists missing overdue reservations before startup outbox delivery", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "mvp-1.21.0",
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

    await backfillOverdueTaskNotifications({
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
