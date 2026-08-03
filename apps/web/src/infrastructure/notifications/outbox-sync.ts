import { calculateNextReview, createLocalCalendar, notificationTypeForTask, type AppRepository, type AppSnapshot, type NotificationOutboxItem } from "../../../../../packages/domain/src";
import { NotificationApiError, type DeviceCredentials } from "./notification-api";

export interface OutboxApi {
  upsert(item: NotificationOutboxItem, credentials: DeviceCredentials): Promise<void>;
  cancel(item: NotificationOutboxItem, credentials: DeviceCredentials): Promise<void>;
}

export interface FlushOutboxInput { repository: AppRepository; api: OutboxApi; now?: () => string; }
export interface FlushOutboxResult { settingsError: boolean; registrationStale: boolean; }

/** Delivers only anonymous queue records after local task changes are safely persisted. */
export async function flushOutbox({ repository, api, now = () => new Date().toISOString() }: FlushOutboxInput): Promise<FlushOutboxResult> {
  const snapshot = await repository.load();
  let settingsError = false;
  let registrationStale = false;
  for (const item of snapshot.notificationOutbox) {
    const current = await repository.load();
    const queued = current.notificationOutbox.find((candidate) => candidate.id === item.id);
    const credentials = current.device.pushDeviceId && current.device.pushDeviceSecret
      ? { deviceId: current.device.pushDeviceId, deviceSecret: current.device.pushDeviceSecret }
      : undefined;
    if (!queued || !credentials || queued.nextAttemptAt > now()) continue;
    if (isStale(queued, current)) { await persist(repository, discard(current, queued), now()); continue; }
    try {
      if (queued.operation === "upsert") await api.upsert(queued, credentials);
      else await api.cancel(queued, credentials);
      await updateQueued(repository, queued.id, (latest, latestItem) => delivered(latest, latestItem), now());
    } catch (error) {
      if (!(error instanceof NotificationApiError)) {
        await updateQueued(repository, queued.id, (latest, latestItem) => retry(latest, latestItem, now(), 60), now());
        continue;
      }
      if (error.code === "REMINDER_NOT_FOUND" && queued.operation === "cancel") {
        await updateQueued(repository, queued.id, (latest, latestItem) => delivered(latest, latestItem), now());
        continue;
      }
      if (error.code === "INVALID_SCHEDULE") {
        await updateQueued(repository, queued.id, (latest, latestItem) => reschedule(latest, latestItem, now()), now());
        continue;
      }
      if (error.code === "IDEMPOTENCY_CONFLICT") {
        await updateQueued(repository, queued.id, (latest, latestItem) => renewIdempotencyKey(latest, latestItem, now()), now());
        continue;
      }
      if (error.status === 400 || error.code === "PAYLOAD_TOO_LARGE") {
        settingsError = true;
        await updateQueued(repository, queued.id, (latest, latestItem) => settingsFailed(discard(latest, latestItem)), now());
        continue;
      }
      if (error.status === 401 || error.code === "DEVICE_NOT_FOUND") {
        registrationStale = true;
        await updateQueued(repository, queued.id, (latest) => registrationFailed(latest), now());
        break;
      }
      const delay = error.status === 429 && error.retryAfterSeconds !== undefined
        ? error.retryAfterSeconds
        : 60 * 2 ** queued.attemptCount;
      await updateQueued(repository, queued.id, (latest, latestItem) => retry(latest, latestItem, now(), delay), now());
    }
  }
  return { settingsError, registrationStale };
}

async function updateQueued(repository: AppRepository, id: string, update: (snapshot: AppSnapshot, item: NotificationOutboxItem) => AppSnapshot, savedAt: string): Promise<void> {
  const latest = await repository.load();
  const item = latest.notificationOutbox.find((candidate) => candidate.id === id);
  if (item) await persist(repository, update(latest, item), savedAt);
}

async function persist(repository: AppRepository, snapshot: AppSnapshot, savedAt: string): Promise<void> {
  await repository.save({ ...snapshot, savedAt });
}

function isStale(item: NotificationOutboxItem, snapshot: AppSnapshot): boolean {
  // Restore deliberately removes obsolete mappings after queuing their anonymous cancels.
  // DELETE is idempotent, so a cancel must still reach the server without a local mapping.
  if (item.operation === "cancel") return false;
  const mapping = snapshot.reminderMap.find((entry) => entry.reminderId === item.reminderId);
  if (!mapping) return true;
  const task = snapshot.tasks.find((candidate) => candidate.id === mapping.taskId);
  return !task || task.revision !== item.taskRevision;
}

function delivered(snapshot: AppSnapshot, item: NotificationOutboxItem): AppSnapshot {
  const withoutItem = snapshot.notificationOutbox.filter((candidate) => candidate.id !== item.id);
  return {
    ...snapshot,
    notificationOutbox: withoutItem,
    ...(item.operation === "cancel" ? { reminderMap: snapshot.reminderMap.filter((entry) => entry.reminderId !== item.reminderId || entry.taskRevision !== item.taskRevision) } : {}),
  };
}

function discard(snapshot: AppSnapshot, item: NotificationOutboxItem): AppSnapshot {
  return { ...snapshot, notificationOutbox: snapshot.notificationOutbox.filter((candidate) => candidate.id !== item.id) };
}

function retry(snapshot: AppSnapshot, item: NotificationOutboxItem, now: string, delaySeconds: number): AppSnapshot {
  const nextAttemptAt = new Date(Date.parse(now) + delaySeconds * 1_000).toISOString();
  return { ...snapshot, notificationOutbox: snapshot.notificationOutbox.map((candidate) => candidate.id === item.id ? { ...candidate, attemptCount: candidate.attemptCount + 1, nextAttemptAt } : candidate) };
}

function settingsFailed(snapshot: AppSnapshot): AppSnapshot {
  return { ...snapshot, settings: { ...snapshot.settings, notificationEnabled: false } };
}

function registrationFailed(snapshot: AppSnapshot): AppSnapshot {
  const device = { ...snapshot.device };
  delete device.pushDeviceId;
  delete device.pushDeviceSecret;
  delete device.registeredAt;
  return settingsFailed({ ...snapshot, device });
}

function reschedule(snapshot: AppSnapshot, item: NotificationOutboxItem, now: string): AppSnapshot {
  const mapping = snapshot.reminderMap.find((entry) => entry.reminderId === item.reminderId);
  const task = mapping && snapshot.tasks.find((candidate) => candidate.id === mapping.taskId);
  if (!task || task.status !== "active") return discard(snapshot, item);
  const scheduledAt = calculateNextReview({
    now,
    dueMode: task.dueMode,
    undecidedCount: task.undecidedCount,
    dismissCount: task.dismissCount,
    calendar: createLocalCalendar(snapshot.settings.timeZone),
  });
  return {
    ...snapshot,
    notificationOutbox: snapshot.notificationOutbox.map((candidate) => candidate.id === item.id ? {
      ...candidate,
      id: crypto.randomUUID(),
      scheduledAt,
      notificationType: notificationTypeForTask(task),
      taskRevision: task.revision,
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
    } : candidate),
  };
}

function renewIdempotencyKey(snapshot: AppSnapshot, _item: NotificationOutboxItem, now: string): AppSnapshot {
  const active = snapshot.reminderMap.flatMap((mapping) => {
    const task = snapshot.tasks.find((candidate) => candidate.id === mapping.taskId);
    if (!task || task.status !== "active" || task.revision !== mapping.taskRevision) return [];
    return [{
      id: crypto.randomUUID(),
      operation: "upsert" as const,
      reminderId: mapping.reminderId,
      scheduledAt: task.nextReviewAt,
      notificationType: notificationTypeForTask(task),
      taskRevision: task.revision,
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
    }];
  });
  const activeReminderIds = new Set(active.map((entry) => entry.reminderId));
  return {
    ...snapshot,
    notificationOutbox: [...snapshot.notificationOutbox.filter((candidate) => candidate.operation === "cancel" || !activeReminderIds.has(candidate.reminderId)), ...active],
  };
}
