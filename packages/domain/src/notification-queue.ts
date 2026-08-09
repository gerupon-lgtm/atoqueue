import type { AppSnapshot, Capture, NotificationOutboxItem, ReminderMapEntry, RepeatCadence, Task } from "./model";
import { planNotificationSchedules, type ReminderScheduleKind } from "./notification-schedule";

export type CaptureReminderScheduleKind = "capture_initial";
export type NotificationIdFactory = (kind: "outbox" | "reminder", scheduleKind?: ReminderScheduleKind | CaptureReminderScheduleKind) => string;

/** Compatibility entrypoint: capture reminders are now planned for the whole inbox. */
export function queueCaptureNotification(input: {
  snapshot: AppSnapshot;
  capture: Capture;
  now: string;
  createId?: NotificationIdFactory;
}): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  return rebuildInboxReminderNotifications({
    snapshot: { ...input.snapshot, captures: [...input.snapshot.captures, input.capture] },
    now: input.now,
    createId: input.createId,
  });
}

/** Compatibility entrypoint: resolving a capture rebuilds the whole inbox series. */
export function cancelCaptureNotification(input: {
  snapshot: AppSnapshot;
  captureId: string;
  now: string;
  createId?: NotificationIdFactory;
}): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  return rebuildInboxReminderNotifications({
    snapshot: { ...input.snapshot, captures: input.snapshot.captures.filter((capture) => capture.id !== input.captureId) },
    now: input.now,
    createId: input.createId,
  });
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
  return rebuildInboxReminderNotifications(input);
}

/** Replaces every inbox reservation with one anonymous series anchored to the oldest unresolved capture. */
export function rebuildInboxReminderNotifications(input: GlobalRebuildInput): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  const oldest = oldestCapture(input.snapshot.captures, "unclassified");
  const frequency = input.snapshot.settings.inboxReminderFrequency;
  const offsets = frequency === "gentle" ? [0, 3, 7] : frequency === "prompt" ? [0, 1, 3, 7] : [];
  const initial = oldest ? addMinutes(oldest.createdAt, input.snapshot.settings.initialReminderDelayMinutes ?? 60) : undefined;
  const oneShots = initial && frequency !== "none"
    ? keepUpcomingOneShots(offsets.map((days) => addDays(initial, days)), input.now)
    : [];
  const schedules: GlobalSchedule[] = initial && frequency !== "none"
    ? [...oneShots.map((scheduledAt) => ({ scheduledAt })), { scheduledAt: oneShots.length === 0 ? input.now : addDays(initial, 14), repeatCadence: "weekly" }]
    : [];
  return replaceScope(input, "inbox", schedules);
}

/** Replaces every memo reservation with one anonymous series anchored to the oldest memo. */
export function rebuildMemoReviewNotifications(input: GlobalRebuildInput): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  const oldest = oldestCapture(input.snapshot.captures, "note");
  const cadence = input.snapshot.settings.memoReviewFrequency === "weekly" ? "weekly"
    : input.snapshot.settings.memoReviewFrequency === "monthly" ? "monthly" : undefined;
  const first = oldest && cadence
    ? addDays(oldest.createdAt, cadence === "monthly" ? 14 : 7)
    : undefined;
  const schedules: GlobalSchedule[] = !first || !cadence ? []
    : first < input.now
      ? [{ scheduledAt: input.now, repeatCadence: cadence }]
      : [{ scheduledAt: first }, { scheduledAt: addMemoInterval(first, cadence), repeatCadence: cadence }];
  return replaceScope(input, "memo", schedules);
}

/** Rebuilds both anonymous global series after any capture or frequency change. */
export function rebuildGlobalNotificationSchedules(input: GlobalRebuildInput): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  const inbox = rebuildInboxReminderNotifications(input);
  return rebuildMemoReviewNotifications({ ...input, snapshot: { ...input.snapshot, ...inbox } });
}

interface GlobalRebuildInput { snapshot: AppSnapshot; now: string; createId?: NotificationIdFactory }
interface GlobalSchedule { scheduledAt: string; repeatCadence?: RepeatCadence }

function replaceScope(input: GlobalRebuildInput, scope: "inbox" | "memo", schedules: GlobalSchedule[]): Pick<AppSnapshot, "notificationOutbox" | "reminderMap"> {
  const legacy = scope === "inbox" ? (entry: ReminderMapEntry) => entry.scope === "inbox" || Boolean(entry.captureId) : (entry: ReminderMapEntry) => entry.scope === "memo";
  const prior = input.snapshot.reminderMap.filter(legacy);
  const retained = input.snapshot.reminderMap.filter((entry) => !legacy(entry));
  if (isUnchangedGlobalSeries(input.snapshot, prior, schedules, scope)) {
    return { notificationOutbox: input.snapshot.notificationOutbox, reminderMap: input.snapshot.reminderMap };
  }
  const priorOutboxIds = new Set(prior.map((entry) => entry.reminderId));
  const retainedOutbox = input.snapshot.notificationOutbox.filter((item) => !priorOutboxIds.has(item.reminderId));
  const cancellations = prior.map((entry) => ({ id: createId(input, "outbox", "capture_initial"), operation: "cancel" as const, reminderId: entry.reminderId, taskRevision: 0, attemptCount: 0, nextAttemptAt: input.now, createdAt: input.now }));
  const mappings = schedules.map((schedule) => ({ reminderId: createId(input, "reminder", "capture_initial"), scope, kind: "capture_initial" as const, taskRevision: 0, createdAt: input.now }));
  const upserts = schedules.map((schedule, index) => ({ id: createId(input, "outbox", "capture_initial"), operation: "upsert" as const, reminderId: mappings[index]!.reminderId, scheduledAt: laterOf(schedule.scheduledAt, input.now), notificationType: "inbox_review" as const, ...(schedule.repeatCadence ? { repeatCadence: schedule.repeatCadence } : {}), taskRevision: 0, attemptCount: 0, nextAttemptAt: input.now, createdAt: input.now }));
  return { notificationOutbox: [...retainedOutbox, ...cancellations, ...upserts], reminderMap: [...retained, ...mappings] };
}

function isUnchangedGlobalSeries(snapshot: AppSnapshot, prior: ReminderMapEntry[], schedules: GlobalSchedule[], scope: "inbox" | "memo"): boolean {
  if (prior.length !== schedules.length || prior.some((entry) => entry.scope !== scope)) return false;
  return prior.every((entry, index) => {
    const item = snapshot.notificationOutbox.find((candidate) => candidate.reminderId === entry.reminderId && candidate.operation === "upsert");
    const schedule = schedules[index];
    return item?.scheduledAt === schedule?.scheduledAt && item.repeatCadence === schedule?.repeatCadence;
  });
}

function oldestCapture(captures: Capture[], classification: Capture["classification"]): Capture | undefined {
  return captures.filter((capture) => capture.classification === classification).sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}

function addDays(iso: string, days: number): string { return addMinutes(iso, days * 24 * 60); }
function addMemoInterval(iso: string, cadence: RepeatCadence): string {
  return cadence === "weekly" ? addDays(iso, 7) : addUtcMonths(iso, 1);
}

function addUtcMonths(iso: string, months: number): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  const targetMonth = date.getUTCMonth() + months;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const finalDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, finalDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds())).toISOString();
}

function keepUpcomingOneShots(schedules: string[], now: string): string[] {
  const next = schedules.findIndex((scheduledAt) => scheduledAt >= now);
  if (next === -1) return [];
  if (next === 0) return schedules;
  return [now, ...schedules.slice(next)];
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
