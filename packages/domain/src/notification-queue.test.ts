import { describe, expect, it } from "vitest";
import { createEmptySnapshot } from "./repository";
import { rebuildActiveTaskNotifications, rebuildGlobalNotificationSchedules, rebuildInboxReminderNotifications, rebuildMemoReviewNotifications, queueTaskNotifications } from "./notification-queue";
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
  // Break caught: planning reminders per capture instead of one inbox-wide series.
  it("plans the gentle inbox series from the oldest unresolved capture without exposing its identity", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    snapshot.settings.inboxReminderFrequency = "gentle";
    snapshot.captures = [
      { id: "capture-secret", body: "SECRET_CAPTURE_CANARY", classification: "unclassified", createdAt: now, updatedAt: now },
      { id: "capture-newer", body: "newer", classification: "unclassified", createdAt: now, updatedAt: now },
    ];

    const queued = rebuildInboxReminderNotifications({ snapshot, now, createId: ids() });

    expect(queued.notificationOutbox.map((item) => ({ scheduledAt: item.scheduledAt, repeatCadence: item.repeatCadence }))).toEqual([
      { scheduledAt: "2026-08-08T10:00:00.000Z", repeatCadence: undefined },
      { scheduledAt: "2026-08-11T10:00:00.000Z", repeatCadence: undefined },
      { scheduledAt: "2026-08-15T10:00:00.000Z", repeatCadence: undefined },
      { scheduledAt: "2026-08-22T10:00:00.000Z", repeatCadence: "weekly" },
    ]);
    expect(queued.reminderMap.every((entry) => entry.scope === "inbox" && !("taskId" in entry) && !("captureId" in entry))).toBe(true);
    expect(JSON.stringify(queued.notificationOutbox)).not.toContain("SECRET_CAPTURE_CANARY");
    expect(JSON.stringify(queued.notificationOutbox)).not.toContain("capture-secret");
  });

  // Break caught: prompt does not include the +1 day escalation or does not remove disabled scope reservations.
  it("replaces the inbox scope when its frequency changes", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    snapshot.settings.inboxReminderFrequency = "prompt";
    snapshot.captures = [{ id: "private", body: "private", classification: "unclassified", createdAt: now, updatedAt: now }];
    const prompt = rebuildInboxReminderNotifications({ snapshot, now, createId: ids() });

    expect(prompt.notificationOutbox.filter((item) => item.operation === "upsert").map((item) => item.scheduledAt)).toEqual([
      "2026-08-08T10:00:00.000Z", "2026-08-09T10:00:00.000Z", "2026-08-11T10:00:00.000Z", "2026-08-15T10:00:00.000Z", "2026-08-22T10:00:00.000Z",
    ]);

    snapshot.settings.inboxReminderFrequency = "none";
    const disabled = rebuildInboxReminderNotifications({ snapshot: { ...snapshot, ...prompt }, now, createId: ids() });
    expect(disabled.reminderMap).toEqual([]);
    expect(disabled.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "cancel" }),
    ]));
  });

  // Break caught: elapsed one-shots are re-sent together instead of yielding one immediate recurring reservation.
  it("drops fully elapsed inbox one-shots and queues only the recurring slot at now", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    snapshot.settings.inboxReminderFrequency = "gentle";
    snapshot.captures = [{ id: "old", body: "old", classification: "unclassified", createdAt: "2026-07-01T09:00:00.000Z", updatedAt: now }];

    const queued = rebuildInboxReminderNotifications({ snapshot, now, createId: ids() });

    expect(queued.notificationOutbox.map((item) => ({ scheduledAt: item.scheduledAt, repeatCadence: item.repeatCadence }))).toEqual([
      { scheduledAt: now, repeatCadence: "weekly" },
    ]);
  });

  // Break caught: the initial memo review is incorrectly made recurring, creating two recurring series.
  it("plans one memo one-shot followed by exactly one recurring monthly slot", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    snapshot.settings.memoReviewFrequency = "monthly";
    snapshot.captures = [{ id: "memo-private", body: "MEMO_CANARY", classification: "note", createdAt: "2026-08-08T09:00:00.000Z", updatedAt: now }];
    const queued = rebuildMemoReviewNotifications({ snapshot, now, createId: ids() });

    expect(queued.notificationOutbox.map((item) => ({ scheduledAt: item.scheduledAt, repeatCadence: item.repeatCadence }))).toEqual([
      { scheduledAt: "2026-08-22T09:00:00.000Z", repeatCadence: undefined },
      { scheduledAt: "2026-09-22T09:00:00.000Z", repeatCadence: "monthly" },
    ]);
    expect(new Set(queued.notificationOutbox.map((item) => item.scheduledAt)).size).toBe(2);
    expect(JSON.stringify(queued)).not.toContain("memo-private");
    expect(JSON.stringify(queued)).not.toContain("MEMO_CANARY");
  });

  // Break caught: treating the exact initial timestamp as elapsed suppresses its one-shot.
  it("keeps the memo one-shot when now equals its initial timestamp and schedules one later repeat", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    snapshot.settings.memoReviewFrequency = "monthly";
    snapshot.captures = [{ id: "memo-private", body: "memo", classification: "note", createdAt: "2026-07-25T09:00:00.000Z", updatedAt: now }];

    const queued = rebuildMemoReviewNotifications({ snapshot, now, createId: ids() });

    expect(queued.notificationOutbox.map((item) => ({ scheduledAt: item.scheduledAt, repeatCadence: item.repeatCadence }))).toEqual([
      { scheduledAt: "2026-08-08T09:00:00.000Z", repeatCadence: undefined },
      { scheduledAt: "2026-09-08T09:00:00.000Z", repeatCadence: "monthly" },
    ]);
  });

  // Break caught: the repeating monthly slot drifts by four-week arithmetic instead of clamping in the UTC calendar.
  it("uses the 14-day first memo slot and clamps its 31st monthly successor to month end", () => {
    const october = "2026-10-01T00:00:00.000Z";
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now: october });
    snapshot.settings.memoReviewFrequency = "monthly";
    snapshot.captures = [{ id: "memo-private", body: "memo", classification: "note", createdAt: "2026-10-17T12:00:00.000Z", updatedAt: october }];

    const queued = rebuildMemoReviewNotifications({ snapshot, now: october, createId: ids() });

    expect(queued.notificationOutbox.map((item) => item.scheduledAt)).toEqual([
      "2026-10-31T12:00:00.000Z",
      "2026-11-30T12:00:00.000Z",
    ]);
  });

  // Break caught: an elapsed memo one-shot is revived alongside a later recurring series.
  it("drops an elapsed monthly memo one-shot and queues exactly one immediate recurring slot", () => {
    const later = "2026-09-01T09:00:00.000Z";
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now: later });
    snapshot.settings.memoReviewFrequency = "monthly";
    snapshot.captures = [{ id: "memo-private", body: "memo", classification: "note", createdAt: "2026-08-01T09:00:00.000Z", updatedAt: now }];

    const queued = rebuildMemoReviewNotifications({ snapshot, now: later, createId: ids() });

    expect(queued.notificationOutbox.map((item) => ({ scheduledAt: item.scheduledAt, repeatCadence: item.repeatCadence }))).toEqual([
      { scheduledAt: later, repeatCadence: "monthly" },
    ]);
  });

  // Break caught: classification leaves a stale inbox reservation rather than rebuilding both global scopes.
  it("cancels obsolete inbox mappings and adds memo mappings in one global rebuild", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    snapshot.reminderMap = [{ reminderId: "old-inbox", scope: "inbox", kind: "capture_initial", taskRevision: 0, createdAt: now }];
    snapshot.captures = [{ id: "memo-private", body: "memo", classification: "note", createdAt: now, updatedAt: now }];
    const queued = rebuildGlobalNotificationSchedules({ snapshot, now, createId: ids() });

    expect(queued.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "cancel", reminderId: "old-inbox" }),
      expect.objectContaining({ operation: "upsert", repeatCadence: "weekly" }),
    ]));
    expect(queued.reminderMap.every((entry) => entry.scope === "memo")).toBe(true);
  });

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

  it("cancels an existing initial reminder when a changed deadline moves before it", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    snapshot.settings.notificationEnabled = true;
    const active = queueTaskNotifications({ snapshot, task: task(), now, createId: ids() });
    const initial = active.reminderMap.find((entry) => entry.kind === "initial");
    expect(initial).toBeDefined();

    const queued = queueTaskNotifications({
      snapshot: { ...snapshot, reminderMap: active.reminderMap },
      task: task({
        dueAt: "2026-08-08T09:30:00.000Z",
        nextReviewAt: "2026-08-08T09:30:00.000Z",
        revision: 2,
      }),
      now,
      createId: ids(),
    });

    expect(queued.reminderMap.some((entry) => entry.kind === "initial")).toBe(false);
    expect(queued.notificationOutbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cancel",
          reminderId: initial?.reminderId,
        }),
      ]),
    );
  });

  it("cancels an existing initial reminder when a timing setting moves it to the deadline", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    snapshot.settings.notificationEnabled = true;
    const activeTask = task();
    const active = queueTaskNotifications({ snapshot, task: activeTask, now, createId: ids() });
    const initial = active.reminderMap.find((entry) => entry.kind === "initial");
    expect(initial).toBeDefined();
    snapshot.settings.initialReminderDelayMinutes = 360;
    snapshot.tasks = [activeTask];

    const rebuilt = rebuildActiveTaskNotifications({
      snapshot: { ...snapshot, reminderMap: active.reminderMap },
      now,
      createId: ids(),
    });

    expect(rebuilt.reminderMap.some((entry) => entry.kind === "initial")).toBe(false);
    expect(rebuilt.notificationOutbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cancel",
          reminderId: initial?.reminderId,
        }),
      ]),
    );
  });
});
