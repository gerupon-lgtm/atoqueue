export interface AppSnapshot {
  schemaVersion: 2;
  appVersion: string;
  device: DeviceState;
  settings: Settings;
  captures: Capture[];
  tasks: Task[];
  reviewSessions: ReviewSession[];
  actionHistory: ActionEvent[];
  notificationOutbox: NotificationOutboxItem[];
  reminderMap: ReminderMapEntry[];
  savedAt: string;
}

export interface DeviceState {
  localDeviceId: string;
  pushDeviceId?: string;
  pushDeviceSecret?: string;
  pushSubscriptionStatus:
    | "not_requested"
    | "granted"
    | "denied"
    | "unavailable";
  registeredAt?: string;
}

export interface Settings {
  locale: "ja-JP";
  timeZone: string;
  notificationEnabled: boolean;
  quietHours?: { start: string; end: string };
  weeklyReviewDay: 0;
}

export interface Capture {
  id: string;
  body: string;
  classification: "unclassified" | "task" | "note" | "unneeded";
  createdAt: string;
  updatedAt: string;
  classifiedAt?: string;
  linkedTaskId?: string;
}

export interface Task {
  id: string;
  sourceCaptureId: string;
  title: string;
  category?: "work" | "home" | "shopping" | "other";
  status: "active" | "completed" | "archived";
  dueMode: "unset" | "scheduled" | "none";
  dueAt?: string;
  nextReviewAt: string;
  undecidedCount: number;
  dismissCount: number;
  postponeCount: number;
  lastPromptedAt?: string;
  completedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export type NeglectLevel = 0 | 1 | 2 | 3 | 4;

export interface ReviewSession {
  id: string;
  localDate: string;
  orderedTaskIds: string[];
  currentIndex: number;
  visitedTaskIds: string[];
  answeredTaskIds: string[];
  actionEventIds: string[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type ActionType =
  | "capture_created"
  | "capture_classified"
  | "task_created"
  | "task_completed"
  | "task_rescheduled"
  | "task_marked_no_due"
  | "task_dismissed"
  | "task_archived"
  | "task_edited"
  | "task_reopened"
  | "backup_exported"
  | "backup_restored";

export interface ActionEvent {
  id: string;
  entityType: "capture" | "task" | "settings" | "backup";
  entityId: string;
  action: ActionType;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  occurredAt: string;
}

export interface NotificationOutboxItem {
  id: string;
  operation: "upsert" | "cancel";
  reminderId: string;
  scheduledAt?: string;
  notificationType?: "task_review" | "deadline_review" | "unset_due_review";
  taskRevision: number;
  attemptCount: number;
  nextAttemptAt: string;
  createdAt: string;
}

export interface ReminderMapEntry {
  reminderId: string;
  taskId: string;
  taskRevision: number;
  createdAt: string;
}
