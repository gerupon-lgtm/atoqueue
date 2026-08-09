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
  it("creates anonymous initial, deadline-before, and deadline-time schedules without task content", () => {
    const schedules = planNotificationSchedules({
      task: scheduledTask(),
      settings,
      now,
    });

    expect(schedules).toEqual([
      {
        kind: "initial",
        scheduledAt: "2026-08-08T10:00:00.000Z",
        notificationType: "task_review",
      },
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

  it("keeps the initial reminder when it is earlier than the task deadline", () => {
    const schedules = planNotificationSchedules({
      task: scheduledTask({
        dueAt: "2026-08-08T10:30:00.000Z",
        nextReviewAt: "2026-08-08T10:30:00.000Z",
      }),
      settings,
      now,
    });

    expect(schedules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "initial",
          scheduledAt: "2026-08-08T10:00:00.000Z",
        }),
      ]),
    );
  });

  it("omits an initial reminder at the deadline so only the deadline-time reminder remains", () => {
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

  it("omits an initial reminder later than the task deadline", () => {
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
    "keeps the initial reminder for a task with due mode %s",
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

      expect(schedules.map((schedule) => schedule.kind)).toEqual([
        "initial",
        "review",
      ]);
    },
  );
});
