import type { AppSnapshot, Capture, NotificationOutboxItem, ReminderMapEntry, Task } from "./model";
import { planNotificationSchedules, type ReminderScheduleKind } from "./notification-schedule";

export type CaptureReminderScheduleKind = "capture_initial";
export type NotificationIdFactory = (kind: "outbox" | "reminder", scheduleKind?: ReminderScheduleKind | CaptureReminderScheduleKind) => string;

/** Queues one generic reminder without exposing capture data to the server. */
export function queueCaptureNotification(input: {
  snapshot: AppSnapshot;
  capture: Capture;
  now: string;
  createId?: NotificationIdFactory;
}): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  const prior = input.snapshot.reminderMap.filter((entry) => entry.captureId === input.capture.id);
  const retained = input.snapshot.reminderMap.filter((entry) => entry.captureId !== input.capture.id);
  const mapping = prior.find((entry) => entry.kind === "capture_initial") ?? {
    reminderId: createId(input, "reminder", "capture_initial"),
    captureId: input.capture.id,
    kind: "capture_initial" as const,
    taskRevision: 0,
    createdAt: input.now,
  };
  return {
    notificationOutbox: [{
      id: createId(input, "outbox", "capture_initial"),
      operation: "upsert",
      reminderId: mapping.reminderId,
      scheduledAt: laterOf(
        addMinutes(input.capture.createdAt, input.snapshot.settings.initialReminderDelayMinutes ?? 60),
        input.now,
      ),
      notificationType: "inbox_review",
      taskRevision: 0,
      attemptCount: 0,
      nextAttemptAt: input.now,
      createdAt: input.now,
    }],
    reminderMap: [...retained, mapping],
  };
}

/** Cancels the pending inbox reminder when the user resolves a capture. */
export function cancelCaptureNotification(input: {
  snapshot: AppSnapshot;
  captureId: string;
  now: string;
  createId?: NotificationIdFactory;
}): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  const prior = input.snapshot.reminderMap.filter((entry) => entry.captureId === input.captureId);
  return {
    notificationOutbox: prior.map((entry) => ({
      id: createId(input, "outbox", "capture_initial"),
      operation: "cancel" as const,
      reminderId: entry.reminderId,
      taskRevision: 0,
      attemptCount: 0,
      nextAttemptAt: input.now,
      createdAt: input.now,
    })),
    reminderMap: input.snapshot.reminderMap.filter((entry) => entry.captureId !== input.captureId),
  };
}

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

/** Requeues unresolved captures after notification setup or a timing change. */
export function rebuildPendingCaptureNotifications(input: {
  snapshot: AppSnapshot;
  now: string;
  createId?: NotificationIdFactory;
}): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  let reminderMap = input.snapshot.reminderMap;
  const captureReminderIds = new Set(
    input.snapshot.reminderMap
      .filter((entry) => entry.kind === "capture_initial")
      .map((entry) => entry.reminderId),
  );
  const notificationOutbox = input.snapshot.notificationOutbox.filter(
    (item) => !(item.operation === "upsert" && captureReminderIds.has(item.reminderId)),
  );
  for (const capture of input.snapshot.captures) {
    if (capture.classification !== "unclassified") continue;
    const queued = queueCaptureNotification({
      snapshot: { ...input.snapshot, reminderMap },
      capture,
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

function createId(input: { createId?: NotificationIdFactory }, kind: "outbox" | "reminder", scheduleKind: ReminderScheduleKind | CaptureReminderScheduleKind): string {
  return input.createId?.(kind, scheduleKind) ?? crypto.randomUUID();
}

function scheduleKind(entry: ReminderMapEntry): ReminderScheduleKind {
  return entry.kind === "initial" || entry.kind === "deadline_before" || entry.kind === "review"
    ? entry.kind
    : "review";
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

function laterOf(left: string, right: string): string {
  return left > right ? left : right;
}
