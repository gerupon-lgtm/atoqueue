import { describe, expect, it } from "vitest";
import { planNotificationSchedules } from "./notification-schedule";
import type { Settings, Task } from "./model";

const now = "2026-08-08T09:00:00.000Z";

const settings: Settings = {
  locale: "ja-JP",
  timeZone: "Asia/Tokyo",
  notificationEnabled: true,
  initialReminderDelayMinutes: 60,
  deadlineReminderLeadMinutes: 60,
  weeklyReviewDay: 0,
  inboxReminderFrequency: "none",
  memoReviewFrequency: "none",
  enterSavesCapture: true,
  customTaskCategories: [],
};

function scheduledTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-local-only",
    sourceCaptureId: "capture-local-only",
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

describe("notification scheduling policy", () => {
  it("creates anonymous deadline-before and deadline-time schedules without task content", () => {
    const schedules = planNotificationSchedules({
      task: scheduledTask(),
      settings,
      now,
    });

    expect(schedules).toEqual([
      {
        kind: "deadline_before",
        scheduledAt: "2026-08-08T14:00:00.000Z",
        notificationType: "deadline_review",
      },
      {
        kind: "review",
        scheduledAt: "2026-08-08T15:00:00.000Z",
        notificationType: "deadline_review",
      },
    ]);
    expect(JSON.stringify(schedules)).not.toContain("SECRET_TASK_CANARY");
    expect(JSON.stringify(schedules)).not.toContain("task-local-only");
  });

  it("never creates an already-past early reminder and retains the actual deadline for server-side lead delivery", () => {
    const schedules = planNotificationSchedules({
      task: scheduledTask({
        createdAt: "2026-08-08T07:00:00.000Z",
        dueAt: "2026-08-08T09:30:00.000Z",
        nextReviewAt: "2026-08-08T09:30:00.000Z",
      }),
      settings,
      now,
    });

    expect(schedules).toEqual([
      {
        kind: "review",
        scheduledAt: "2026-08-08T09:30:00.000Z",
        notificationType: "deadline_review",
      },
    ]);
  });

  it("keeps the existing single review schedule when notifications have not been enabled", () => {
    const schedules = planNotificationSchedules({
      task: scheduledTask({
        dueMode: "none",
        dueAt: undefined,
        nextReviewAt: "2026-08-11T09:00:00.000Z",
      }),
      settings: { ...settings, notificationEnabled: false },
      now,
    });

    expect(schedules).toEqual([
      {
        kind: "review",
        scheduledAt: "2026-08-11T09:00:00.000Z",
        notificationType: "task_review",
      },
    ]);
  });

  it("treats a zero-minute deadline lead as one deadline-time notification", () => {
    const schedules = planNotificationSchedules({
      task: scheduledTask({ createdAt: "2026-08-08T07:00:00.000Z" }),
      settings: { ...settings, deadlineReminderLeadMinutes: 0 },
      now,
    });

    expect(schedules).toEqual([
      {
        kind: "review",
        scheduledAt: "2026-08-08T15:00:00.000Z",
        notificationType: "deadline_review",
      },
    ]);
  });

  it("does not create a new initial reminder after the capture has become a task", () => {
    const schedules = planNotificationSchedules({
      task: scheduledTask({
        dueAt: "2026-08-08T10:30:00.000Z",
        nextReviewAt: "2026-08-08T10:30:00.000Z",
      }),
      settings,
      now,
    });

    expect(schedules.map((schedule) => schedule.kind)).toEqual([
      "deadline_before",
      "review",
    ]);
  });

  it("omits a deadline-before reminder when its calculated time is now", () => {
    const schedules = planNotificationSchedules({
      task: scheduledTask({
        dueAt: "2026-08-08T10:00:00.000Z",
        nextReviewAt: "2026-08-08T10:00:00.000Z",
      }),
      settings,
      now,
    });

    expect(schedules).toEqual([
      {
        kind: "review",
        scheduledAt: "2026-08-08T10:00:00.000Z",
        notificationType: "deadline_review",
      },
    ]);
  });

  it("omits a deadline-before reminder when its calculated time has passed", () => {
    const schedules = planNotificationSchedules({
      task: scheduledTask({
        dueAt: "2026-08-08T09:30:00.000Z",
        nextReviewAt: "2026-08-08T09:30:00.000Z",
      }),
      settings,
      now,
    });

    expect(schedules.map((schedule) => schedule.kind)).toEqual(["review"]);
  });

  it.each(["none", "unset"] as const)(
    "keeps only the normal review reminder for an organized task with due mode %s",
    (dueMode) => {
      const schedules = planNotificationSchedules({
        task: scheduledTask({
          dueMode,
          dueAt: undefined,
          nextReviewAt: "2026-08-11T09:00:00.000Z",
        }),
        settings,
        now,
      });

      expect(schedules.map((schedule) => schedule.kind)).toEqual(["review"]);
    },
  );
});
