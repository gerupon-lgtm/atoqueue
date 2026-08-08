import type { AppSnapshot } from "./model";

export function createEmptySnapshot(params: {
  appVersion: string;
  localDeviceId: string;
  timeZone: string;
  now: string;
}): AppSnapshot {
  return {
    schemaVersion: 4,
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
      weeklyReviewDay: 0,
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
  load(): Promise<AppSnapshot>;
  save(next: AppSnapshot): Promise<void>;
  loadDraft(): Promise<string>;
  saveDraft(value: string): Promise<void>;
  clearDraft(): Promise<void>;
}
