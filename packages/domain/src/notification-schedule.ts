import type { NotificationOutboxItem, Settings, Task } from "./model";

export type ReminderScheduleKind = "initial" | "deadline_before" | "review";

export interface PlannedNotificationSchedule {
  kind: ReminderScheduleKind;
  scheduledAt: string;
  notificationType: NonNullable<NotificationOutboxItem["notificationType"]>;
}

/**
 * Produces only anonymous delivery metadata.  The server receives the result
 * later through the outbox, never the task, task ID, or user-visible text.
 */
export function planNotificationSchedules(input: {
  task: Pick<
    Task,
    "status" | "dueMode" | "dueAt" | "nextReviewAt"
  >;
  settings: Pick<
    Settings,
    "notificationEnabled" | "deadlineReminderLeadMinutes"
  >;
  now: string;
}): PlannedNotificationSchedule[] {
  if (input.task.status !== "active") return [];

  const schedules: PlannedNotificationSchedule[] = [];
  if (input.settings.notificationEnabled) {
    if (input.task.dueMode === "scheduled" && input.task.dueAt) {
      const leadMinutes = input.settings.deadlineReminderLeadMinutes ?? 60;
      if (leadMinutes > 0) {
        const deadlineBefore = addMinutes(input.task.dueAt, -leadMinutes);
        if (deadlineBefore > input.now) {
          schedules.push({
            kind: "deadline_before",
            scheduledAt: deadlineBefore,
            notificationType: "deadline_review",
          });
        }
      }
    }
  }

  schedules.push({
    kind: "review",
    scheduledAt: input.task.nextReviewAt,
    notificationType: notificationTypeForTask(input.task),
  });
  return schedules.sort((left, right) =>
    left.scheduledAt.localeCompare(right.scheduledAt),
  );
}

export function notificationTypeForTask(
  task: Pick<Task, "dueMode">,
): PlannedNotificationSchedule["notificationType"] {
  if (task.dueMode === "unset") return "unset_due_review";
  if (task.dueMode === "scheduled") return "deadline_review";
  return "task_review";
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}
