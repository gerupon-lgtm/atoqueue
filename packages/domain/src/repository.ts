import type { AppSnapshot } from "./model";

export function createEmptySnapshot(params: {
  appVersion: string;
  localDeviceId: string;
  timeZone: string;
  now: string;
}): AppSnapshot {
  return {
    schemaVersion: 9,
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
    savedAt: params.now,
  };
}

export interface AppRepository {
  /** Observe committed snapshot changes, never draft edits or failed writes. */
  subscribe?(listener: () => void): () => void;
  load(): Promise<AppSnapshot>;
  save(next: AppSnapshot): Promise<void>;
  loadDraft(): Promise<string>;
  saveDraft(value: string): Promise<void>;
  clearDraft(): Promise<void>;
}
