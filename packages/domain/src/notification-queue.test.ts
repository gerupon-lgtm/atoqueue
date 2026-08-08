import { describe, expect, it } from "vitest";
import { createEmptySnapshot } from "./repository";
import { queueTaskNotifications } from "./notification-queue";
import type { Task } from "./model";

const now = "2026-08-08T09:00:00.000Z";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-private",
    sourceCaptureId: "capture-private",
    title: "SECRET_TASK_CANARY",
    status: "active",
    dueMode: "scheduled",
    dueAt: "2026-08-08T15:00:00.000Z",
    nextReviewAt: "2026-08-08T15:00:00.000Z",
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    ...overrides,
  };
}

function ids() {
  let number = 0;
  return () => `opaque-${++number}`;
}

describe("anonymous notification queue", () => {
  it("queues all three schedules locally and maps each opaque reminder to one task", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    snapshot.settings.notificationEnabled = true;
    const queued = queueTaskNotifications({ snapshot, task: task(), now, createId: ids() });

    expect(queued.notificationOutbox).toHaveLength(3);
    expect(queued.reminderMap.map((entry) => entry.kind)).toEqual(["initial", "deadline_before", "review"]);
    expect(queued.notificationOutbox.map((item) => item.operation)).toEqual(["upsert", "upsert", "upsert"]);
    expect(JSON.stringify(queued.notificationOutbox)).not.toContain("SECRET_TASK_CANARY");
    expect(JSON.stringify(queued.notificationOutbox)).not.toContain("task-private");
  });

  it("cancels every previous anonymous reservation when the task becomes complete", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    snapshot.settings.notificationEnabled = true;
    const active = queueTaskNotifications({ snapshot, task: task(), now, createId: ids() });
    const queued = queueTaskNotifications({
      snapshot: { ...snapshot, reminderMap: active.reminderMap },
      task: task({ status: "completed", completedAt: now, revision: 2 }),
      now,
      createId: ids(),
    });

    expect(queued.reminderMap).toEqual([]);
    expect(queued.notificationOutbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "cancel", reminderId: active.reminderMap[0]?.reminderId }),
        expect.objectContaining({ operation: "cancel", reminderId: active.reminderMap[1]?.reminderId }),
        expect.objectContaining({ operation: "cancel", reminderId: active.reminderMap[2]?.reminderId }),
      ]),
    );
  });
});
