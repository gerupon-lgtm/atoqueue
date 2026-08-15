import type { NotificationOutboxItem, Settings, Task } from "./model";
import { createLocalCalendar } from "./due-date";

export type ReminderScheduleKind =
  | "initial"
  | "deadline_before"
  | "review"
  | "overdue_first"
  | "overdue_second"
  | "overdue_third"
  | "overdue_repeat";

export interface PlannedNotificationSchedule {
  kind: ReminderScheduleKind;
  scheduledAt: string;
  notificationType: NonNullable<NotificationOutboxItem["notificationType"]>;
  repeatCadence?: NonNullable<NotificationOutboxItem["repeatCadence"]>;
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
    | "notificationEnabled"
    | "deadlineReminderLeadMinutes"
    | "overdueTaskReminderFrequency"
    | "timeZone"
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

  // A stale deadline must not revive an API-rejected past reservation. A
  // deliberate dismiss/reschedule can still move nextReviewAt forward.
  if (input.task.nextReviewAt >= input.now) {
    schedules.push({
      kind: "review",
      scheduledAt: input.task.nextReviewAt,
      notificationType: notificationTypeForTask(input.task),
    });
  }

  if (
    input.settings.notificationEnabled
    && input.task.dueMode === "scheduled"
    && input.task.dueAt
  ) {
    schedules.push(...planOverdueSchedules({
      dueAt: input.task.dueAt,
      frequency: input.settings.overdueTaskReminderFrequency,
      now: input.now,
      timeZone: input.settings.timeZone,
    }));
  }
  return schedules.sort((left, right) =>
    left.scheduledAt.localeCompare(right.scheduledAt),
  );
}

function planOverdueSchedules(input: {
  dueAt: string;
  frequency: Settings["overdueTaskReminderFrequency"];
  now: string;
  timeZone: string;
}): PlannedNotificationSchedule[] {
  if (input.frequency === "none") return [];
  const notificationType = "deadline_review" as const;

  if (input.frequency === "prompt") {
    const first = addMinutes(input.dueAt, 4 * 60);
    return [
      ...(first >= input.now ? [{ kind: "overdue_first" as const, scheduledAt: first, notificationType }] : []),
      {
        kind: "overdue_repeat",
        scheduledAt: nextAlignedLocalOccurrence(input.dueAt, 1, 1, input.now, input.timeZone),
        notificationType,
        repeatCadence: "daily" as const,
      },
    ];
  }

  const milestones = [
    ["overdue_first", 1],
    ["overdue_second", 3],
    ["overdue_third", 7],
  ] as const;
  return [
    ...milestones.flatMap(([kind, days]) => {
      const scheduledAt = sameLocalTimeAfterDays(input.dueAt, days, input.timeZone);
      return scheduledAt >= input.now ? [{ kind, scheduledAt, notificationType }] : [];
    }),
    {
      kind: "overdue_repeat",
      scheduledAt: nextAlignedLocalOccurrence(input.dueAt, 14, 7, input.now, input.timeZone),
      notificationType,
      repeatCadence: "weekly" as const,
    },
  ];
}

function nextAlignedLocalOccurrence(
  dueAt: string,
  initialDays: number,
  intervalDays: number,
  now: string,
  timeZone: string,
): string {
  let days = initialDays;
  let scheduledAt = sameLocalTimeAfterDays(dueAt, days, timeZone);
  while (scheduledAt < now) {
    days += intervalDays;
    scheduledAt = sameLocalTimeAfterDays(dueAt, days, timeZone);
  }
  return scheduledAt;
}

function sameLocalTimeAfterDays(dueAt: string, days: number, timeZone: string): string {
  const calendar = createLocalCalendar(timeZone);
  const clock = localClock(dueAt, timeZone);
  return calendar.atTime(calendar.addDays(calendar.today(dueAt), days), clock.hour, clock.minute);
}

function localClock(instant: string, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const value = (type: "hour" | "minute") => Number(parts.find((part) => part.type === type)?.value);
  return { hour: value("hour"), minute: value("minute") };
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
