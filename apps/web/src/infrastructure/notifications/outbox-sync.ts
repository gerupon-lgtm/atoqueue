import type { AppRepository, AppSnapshot, NotificationOutboxItem } from "../../../../../packages/domain/src";
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
  const credentials = snapshot.device.pushDeviceId && snapshot.device.pushDeviceSecret
    ? { deviceId: snapshot.device.pushDeviceId, deviceSecret: snapshot.device.pushDeviceSecret }
    : undefined;
  if (!credentials) return { settingsError: false, registrationStale: false };

  let next = snapshot;
  let settingsError = false;
  let registrationStale = false;
  for (const item of snapshot.notificationOutbox) {
    if (item.nextAttemptAt > now()) continue;
    if (isStale(item, next)) { next = discard(next, item); continue; }
    try {
      if (item.operation === "upsert") await api.upsert(item, credentials);
      else await api.cancel(item, credentials);
      next = delivered(next, item);
    } catch (error) {
      if (!(error instanceof NotificationApiError)) {
        next = retry(next, item, now(), 60);
        continue;
      }
      if (error.status === 400) { settingsError = true; next = discard(next, item); continue; }
      if (error.status === 401) {
        registrationStale = true;
        const device = { ...next.device };
        delete device.pushDeviceId;
        delete device.pushDeviceSecret;
        delete device.registeredAt;
        next = { ...next, device };
        break;
      }
      const delay = error.status === 429 && error.retryAfterSeconds !== undefined
        ? error.retryAfterSeconds
        : 60 * 2 ** item.attemptCount;
      next = retry(next, item, now(), delay);
    }
  }
  if (next !== snapshot) await repository.save({ ...next, savedAt: now() });
  return { settingsError, registrationStale };
}

function isStale(item: NotificationOutboxItem, snapshot: AppSnapshot): boolean {
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
    ...(item.operation === "cancel" ? { reminderMap: snapshot.reminderMap.filter((entry) => entry.reminderId !== item.reminderId) } : {}),
  };
}

function discard(snapshot: AppSnapshot, item: NotificationOutboxItem): AppSnapshot {
  return { ...snapshot, notificationOutbox: snapshot.notificationOutbox.filter((candidate) => candidate.id !== item.id) };
}

function retry(snapshot: AppSnapshot, item: NotificationOutboxItem, now: string, delaySeconds: number): AppSnapshot {
  const nextAttemptAt = new Date(Date.parse(now) + delaySeconds * 1_000).toISOString();
  return { ...snapshot, notificationOutbox: snapshot.notificationOutbox.map((candidate) => candidate.id === item.id ? { ...candidate, attemptCount: candidate.attemptCount + 1, nextAttemptAt } : candidate) };
}
