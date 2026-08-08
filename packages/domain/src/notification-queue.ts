import type { AppSnapshot, NotificationOutboxItem, ReminderMapEntry, Task } from "./model";
import { planNotificationSchedules, type ReminderScheduleKind } from "./notification-schedule";

export type NotificationIdFactory = (kind: "outbox" | "reminder", scheduleKind?: ReminderScheduleKind) => string;

export function queueTaskNotifications(input: {
  snapshot: AppSnapshot;
  task: Task;
  now: string;
  createId?: NotificationIdFactory;
}): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  const prior = input.snapshot.reminderMap.filter((entry) => entry.taskId === input.task.id);
  const retained = input.snapshot.reminderMap.filter((entry) => entry.taskId !== input.task.id);
  const schedules = planNotificationSchedules({
    task: input.task,
    settings: input.snapshot.settings,
    now: input.now,
  });
  const priorByKind = new Map(prior.map((entry) => [scheduleKind(entry), entry]));
  const desiredKinds = new Set(schedules.map((schedule) => schedule.kind));

  const obsolete = prior.length === 0 && schedules.length === 0
    ? [{ reminderId: createId(input, "reminder", "review"), taskId: input.task.id, kind: "review" as const, taskRevision: input.task.revision, createdAt: input.now }]
    : prior;
  const cancelled = obsolete
    .filter((entry) => !desiredKinds.has(scheduleKind(entry)))
    .map((entry) => cancel(entry, input));
  const mapped = schedules.map((schedule) => createMapping(schedule.kind, priorByKind.get(schedule.kind), input));
  const upserts = schedules.map((schedule) => {
    const mapping = mapped.find((entry) => entry.kind === schedule.kind)!;
    return {
      id: createId(input, "outbox", schedule.kind),
      operation: "upsert" as const,
      reminderId: mapping.reminderId,
      scheduledAt: schedule.scheduledAt,
      notificationType: schedule.notificationType,
      taskRevision: input.task.revision,
      attemptCount: 0,
      nextAttemptAt: input.now,
      createdAt: input.now,
    };
  });

  return {
    notificationOutbox: [...cancelled, ...upserts],
    reminderMap: [...retained, ...mapped],
  };
}

/** Recreates active-task delivery records after a global timing preference changes. */
export function rebuildActiveTaskNotifications(input: {
  snapshot: AppSnapshot;
  now: string;
  createId?: NotificationIdFactory;
}): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  let reminderMap = input.snapshot.reminderMap;
  const notificationOutbox = [...input.snapshot.notificationOutbox];
  for (const task of input.snapshot.tasks) {
    if (task.status !== "active") continue;
    const queued = queueTaskNotifications({
      snapshot: { ...input.snapshot, reminderMap },
      task,
      now: input.now,
      createId: input.createId,
    });
    notificationOutbox.push(...queued.notificationOutbox);
    reminderMap = queued.reminderMap;
  }
  return { notificationOutbox, reminderMap };
}

function cancel(entry: ReminderMapEntry, input: Parameters<typeof queueTaskNotifications>[0]): NotificationOutboxItem {
  return {
    id: createId(input, "outbox", scheduleKind(entry)),
    operation: "cancel",
    reminderId: entry.reminderId,
    taskRevision: input.task.revision,
    attemptCount: 0,
    nextAttemptAt: input.now,
    createdAt: input.now,
  };
}

function createMapping(kind: ReminderScheduleKind, previous: ReminderMapEntry | undefined, input: Parameters<typeof queueTaskNotifications>[0]): ReminderMapEntry {
  return {
    reminderId: previous?.reminderId ?? createId(input, "reminder", kind),
    taskId: input.task.id,
    kind,
    taskRevision: input.task.revision,
    createdAt: previous?.createdAt ?? input.now,
  };
}

function createId(input: Parameters<typeof queueTaskNotifications>[0], kind: "outbox" | "reminder", scheduleKind: ReminderScheduleKind): string {
  return input.createId?.(kind, scheduleKind) ?? crypto.randomUUID();
}

function scheduleKind(entry: ReminderMapEntry): ReminderScheduleKind {
  return entry.kind ?? "review";
}
