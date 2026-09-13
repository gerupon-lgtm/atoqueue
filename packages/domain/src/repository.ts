import type { AppSnapshot } from "./model";
import { emptyTempalistState } from "./tempalist-transfer";

export function createEmptySnapshot(params: {
  appVersion: string;
  localDeviceId: string;
  timeZone: string;
  now: string;
}): AppSnapshot {
  return {
    schemaVersion: 11,
    appVersion: params.appVersion,
    device: {
      localDeviceId: params.localDeviceId,
      pushSubscriptionStatus: "not_requested",
    },
    settings: {
      locale: "ja-JP",
      timeZone: params.timeZone,
      notificationEnabled: false,
      initialReminderDelayMinutes: 60,
      deadlineReminderLeadMinutes: 60,
      defaultDeadlineTime: "23:59",
      weeklyReviewDay: 0,
      inboxReminderFrequency: "gentle",
      overdueTaskReminderFrequency: "gentle",
      memoReviewFrequency: "weekly",
      enterSavesCapture: true,
      customTaskCategories: [],
    },
    captures: [],
    tasks: [],
    reviewSessions: [],
    actionHistory: [],
    notificationOutbox: [],
    reminderMap: [],
    tempalist: emptyTempalistState(),
    savedAt: params.now,
  };
}

export interface AppRepository {
  /** Observe committed snapshot changes, never draft edits or failed writes. */
  subscribe?(listener: () => void): () => void;
  load(): Promise<AppSnapshot>;
  save(
    next: AppSnapshot,
    options?: { replaceTempalist?: boolean },
  ): Promise<void>;
  /** Apply a pure synchronous transition inside the write lock; return input for no change. */
  updateSnapshot?(
    update: (latest: AppSnapshot) => AppSnapshot,
  ): Promise<AppSnapshot>;
  loadDraft(): Promise<string>;
  saveDraft(value: string): Promise<void>;
  clearDraft(): Promise<void>;
}

/** Legacy adapters keep their synchronous-save behavior; browser persistence provides the lock. */
export async function updateSnapshot(
  repository: AppRepository,
  update: (latest: AppSnapshot) => AppSnapshot,
): Promise<AppSnapshot> {
  if (repository.updateSnapshot) return repository.updateSnapshot(update);
  const latest = await repository.load();
  const next = update(latest);
  if (next !== latest) await repository.save(next);
  return next;
}
