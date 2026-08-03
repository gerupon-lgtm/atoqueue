import { CorruptDataError, UnsupportedSchemaVersionError } from "./errors";
import type { AppSnapshot } from "./model";

type RecordValue = Record<string, unknown>;

const actionTypes = new Set([
  "capture_created",
  "capture_classified",
  "task_created",
  "task_completed",
  "task_rescheduled",
  "task_marked_no_due",
  "task_dismissed",
  "task_archived",
  "task_edited",
  "task_reopened",
  "backup_exported",
  "backup_restored",
]);

export function migrateSnapshot(input: unknown): AppSnapshot {
  const snapshot = object(input, "snapshot");
  const version = snapshot.schemaVersion;

  if (version !== 1) {
    if (typeof version === "number") {
      throw new UnsupportedSchemaVersionError(version);
    }
    throw corrupt("schemaVersion must be 1");
  }

  string(snapshot.appVersion, "appVersion");
  device(snapshot.device);
  settings(snapshot.settings);
  entities(snapshot.captures, "captures", capture);
  entities(snapshot.tasks, "tasks", task);
  entities(snapshot.reviewSessions, "reviewSessions", reviewSession);
  entities(snapshot.actionHistory, "actionHistory", actionEvent);
  entities(snapshot.notificationOutbox, "notificationOutbox", notificationOutboxItem);
  entities(snapshot.reminderMap, "reminderMap", reminderMapEntry);
  string(snapshot.savedAt, "savedAt");

  return snapshot as unknown as AppSnapshot;
}

function device(value: unknown): void {
  const entity = object(value, "device");
  string(entity.localDeviceId, "device.localDeviceId");
  oneOf(entity.pushSubscriptionStatus, "device.pushSubscriptionStatus", [
    "not_requested",
    "granted",
    "denied",
    "unavailable",
  ]);
  optionalString(entity.pushDeviceId, "device.pushDeviceId");
  optionalString(entity.pushDeviceSecret, "device.pushDeviceSecret");
  optionalString(entity.registeredAt, "device.registeredAt");
}

function settings(value: unknown): void {
  const entity = object(value, "settings");
  oneOf(entity.locale, "settings.locale", ["ja-JP"]);
  string(entity.timeZone, "settings.timeZone");
  boolean(entity.notificationEnabled, "settings.notificationEnabled");
  if (entity.weeklyReviewDay !== 0) {
    throw corrupt("settings.weeklyReviewDay must be 0");
  }
  if (entity.quietHours !== undefined) {
    const quietHours = object(entity.quietHours, "settings.quietHours");
    string(quietHours.start, "settings.quietHours.start");
    string(quietHours.end, "settings.quietHours.end");
  }
}

function capture(value: unknown, index: number): void {
  const entity = object(value, `captures[${index}]`);
  strings(entity, ["id", "body", "createdAt", "updatedAt"]);
  oneOf(entity.classification, `captures[${index}].classification`, [
    "unclassified",
    "task",
    "note",
    "unneeded",
  ]);
  optionalString(entity.classifiedAt, `captures[${index}].classifiedAt`);
  optionalString(entity.linkedTaskId, `captures[${index}].linkedTaskId`);
}

function task(value: unknown, index: number): void {
  const entity = object(value, `tasks[${index}]`);
  strings(entity, [
    "id",
    "sourceCaptureId",
    "title",
    "nextReviewAt",
    "createdAt",
    "updatedAt",
  ]);
  oneOf(entity.status, `tasks[${index}].status`, ["active", "completed", "archived"]);
  oneOf(entity.dueMode, `tasks[${index}].dueMode`, ["unset", "scheduled", "none"]);
  optionalOneOf(entity.category, `tasks[${index}].category`, [
    "work",
    "home",
    "shopping",
    "other",
  ]);
  optionalStrings(entity, [
    "dueAt",
    "lastPromptedAt",
    "completedAt",
    "archivedAt",
  ], `tasks[${index}]`);
  numbers(entity, ["undecidedCount", "dismissCount", "postponeCount", "revision"]);
}

function reviewSession(value: unknown, index: number): void {
  const entity = object(value, `reviewSessions[${index}]`);
  strings(entity, ["id", "localDate", "startedAt", "updatedAt"]);
  stringArray(entity.orderedTaskIds, `reviewSessions[${index}].orderedTaskIds`);
  stringArray(entity.visitedTaskIds, `reviewSessions[${index}].visitedTaskIds`);
  stringArray(entity.answeredTaskIds, `reviewSessions[${index}].answeredTaskIds`);
  number(entity.currentIndex, `reviewSessions[${index}].currentIndex`);
  optionalString(entity.completedAt, `reviewSessions[${index}].completedAt`);
}

function actionEvent(value: unknown, index: number): void {
  const entity = object(value, `actionHistory[${index}]`);
  strings(entity, ["id", "entityId", "occurredAt"]);
  oneOf(entity.entityType, `actionHistory[${index}].entityType`, [
    "capture",
    "task",
    "settings",
    "backup",
  ]);
  oneOf(entity.action, `actionHistory[${index}].action`, actionTypes);
  optionalObject(entity.before, `actionHistory[${index}].before`);
  optionalObject(entity.after, `actionHistory[${index}].after`);
}

function notificationOutboxItem(value: unknown, index: number): void {
  const entity = object(value, `notificationOutbox[${index}]`);
  strings(entity, ["id", "reminderId", "nextAttemptAt", "createdAt"]);
  oneOf(entity.operation, `notificationOutbox[${index}].operation`, ["upsert", "cancel"]);
  optionalOneOf(entity.notificationType, `notificationOutbox[${index}].notificationType`, [
    "task_review",
    "deadline_review",
    "unset_due_review",
  ]);
  optionalString(entity.scheduledAt, `notificationOutbox[${index}].scheduledAt`);
  numbers(entity, ["taskRevision", "attemptCount"]);
}

function reminderMapEntry(value: unknown, index: number): void {
  const entity = object(value, `reminderMap[${index}]`);
  strings(entity, ["reminderId", "taskId", "createdAt"]);
  number(entity.taskRevision, `reminderMap[${index}].taskRevision`);
}

function entities(
  value: unknown,
  name: string,
  validate: (value: unknown, index: number) => void,
): void {
  if (!Array.isArray(value)) {
    throw corrupt(`${name} must be an array`);
  }
  value.forEach(validate);
}

function object(value: unknown, name: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw corrupt(`${name} must be an object`);
  }
  return value as RecordValue;
}

function optionalObject(value: unknown, name: string): void {
  if (value !== undefined) object(value, name);
}

function string(value: unknown, name: string): void {
  if (typeof value !== "string") throw corrupt(`${name} must be a string`);
}

function optionalString(value: unknown, name: string): void {
  if (value !== undefined) string(value, name);
}

function strings(value: RecordValue, names: string[]): void {
  names.forEach((name) => string(value[name], name));
}

function optionalStrings(value: RecordValue, names: string[], prefix: string): void {
  names.forEach((name) => optionalString(value[name], `${prefix}.${name}`));
}

function stringArray(value: unknown, name: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw corrupt(`${name} must be an array of strings`);
  }
}

function number(value: unknown, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw corrupt(`${name} must be a finite number`);
  }
}

function numbers(value: RecordValue, names: string[]): void {
  names.forEach((name) => number(value[name], name));
}

function boolean(value: unknown, name: string): void {
  if (typeof value !== "boolean") throw corrupt(`${name} must be a boolean`);
}

function oneOf(
  value: unknown,
  name: string,
  allowed: readonly string[] | ReadonlySet<string>,
): void {
  const isAllowed =
    typeof value === "string" &&
    (Array.isArray(allowed)
      ? allowed.includes(value)
      : (allowed as ReadonlySet<string>).has(value));
  if (!isAllowed) {
    throw corrupt(`${name} is invalid`);
  }
}

function optionalOneOf(
  value: unknown,
  name: string,
  allowed: readonly string[] | ReadonlySet<string>,
): void {
  if (value !== undefined) oneOf(value, name, allowed);
}

function corrupt(message: string): CorruptDataError {
  return new CorruptDataError(message);
}
