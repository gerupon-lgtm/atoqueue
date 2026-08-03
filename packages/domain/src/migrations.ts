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

  if (version === 1) {
    validateSnapshot(snapshot, false);
    return normalizeSnapshot(upgradeV1ToV2(snapshot));
  }
  if (version === 2) {
    validateSnapshot(snapshot, true);
    return normalizeSnapshot(snapshot);
  }
  if (typeof version === "number") throw new UnsupportedSchemaVersionError(version);
  throw corrupt("schemaVersion must be 1 or 2");
}

function validateSnapshot(snapshot: RecordValue, requireReviewEventIds: boolean): void {
  string(snapshot.appVersion, "appVersion");
  device(snapshot.device);
  settings(snapshot.settings);
  entities(snapshot.captures, "captures", capture);
  entities(snapshot.tasks, "tasks", task);
  entities(snapshot.reviewSessions, "reviewSessions", (value, index) => reviewSession(value, index, requireReviewEventIds));
  entities(snapshot.actionHistory, "actionHistory", actionEvent);
  if (requireReviewEventIds) {
    validateReviewActionOwnership(snapshot.reviewSessions as unknown[], snapshot.actionHistory as unknown[]);
  }
  entities(snapshot.notificationOutbox, "notificationOutbox", notificationOutboxItem);
  entities(snapshot.reminderMap, "reminderMap", reminderMapEntry);
  string(snapshot.savedAt, "savedAt");
}

function upgradeV1ToV2(snapshot: RecordValue): RecordValue {
  return {
    ...snapshot,
    schemaVersion: 2,
    reviewSessions: (snapshot.reviewSessions as unknown[]).map((value, index) => ({
      ...object(value, `reviewSessions[${index}]`),
      actionEventIds: [],
    })),
  };
}

function normalizeSnapshot(snapshot: RecordValue): AppSnapshot {
  const normalized = copyKnown(snapshot, ["schemaVersion", "appVersion", "savedAt"]);
  const normalizedDevice = copyKnown(object(snapshot.device, "device"), [
    "localDeviceId",
    "pushDeviceId",
    "pushDeviceSecret",
    "pushSubscriptionStatus",
    "registeredAt",
  ]);
  const settingsValue = object(snapshot.settings, "settings");
  const normalizedSettings = copyKnown(settingsValue, [
    "locale",
    "timeZone",
    "notificationEnabled",
    "weeklyReviewDay",
  ]);
  if (settingsValue.quietHours !== undefined) {
    normalizedSettings.quietHours = copyKnown(
      object(settingsValue.quietHours, "settings.quietHours"),
      ["start", "end"],
    );
  }

  normalized.device = normalizedDevice;
  normalized.settings = normalizedSettings;
  normalized.captures = normalizedEntities(snapshot.captures, [
    "id",
    "body",
    "classification",
    "createdAt",
    "updatedAt",
    "classifiedAt",
    "linkedTaskId",
  ]);
  normalized.tasks = normalizedEntities(snapshot.tasks, [
    "id",
    "sourceCaptureId",
    "title",
    "category",
    "status",
    "dueMode",
    "dueAt",
    "nextReviewAt",
    "undecidedCount",
    "dismissCount",
    "postponeCount",
    "lastPromptedAt",
    "completedAt",
    "archivedAt",
    "createdAt",
    "updatedAt",
    "revision",
  ]);
  normalized.reviewSessions = normalizedEntities(snapshot.reviewSessions, [
    "id",
    "localDate",
    "orderedTaskIds",
    "currentIndex",
    "visitedTaskIds",
    "answeredTaskIds",
    "actionEventIds",
    "startedAt",
    "updatedAt",
    "completedAt",
  ]);
  normalized.actionHistory = (snapshot.actionHistory as unknown[]).map((entry) => {
    const action = copyKnown(object(entry, "actionHistory entry"), [
      "id",
      "entityType",
      "entityId",
      "action",
      "before",
      "after",
      "occurredAt",
    ]);
    if (action.before !== undefined) action.before = sanitizeActionMetadata(action.before);
    if (action.after !== undefined) action.after = sanitizeActionMetadata(action.after);
    return action;
  });
  normalized.notificationOutbox = normalizedEntities(snapshot.notificationOutbox, [
    "id",
    "operation",
    "reminderId",
    "scheduledAt",
    "notificationType",
    "taskRevision",
    "attemptCount",
    "nextAttemptAt",
    "createdAt",
  ]);
  normalized.reminderMap = normalizedEntities(snapshot.reminderMap, [
    "reminderId",
    "taskId",
    "taskRevision",
    "createdAt",
  ]);

  return normalized as unknown as AppSnapshot;
}

function normalizedEntities(value: unknown, fields: readonly string[]): RecordValue[] {
  return (value as unknown[]).map((entry) => copyKnown(object(entry, "entity"), fields));
}

function copyKnown(value: RecordValue, fields: readonly string[]): RecordValue {
  return Object.fromEntries(
    fields
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, value[field]]),
  );
}

const derivedMetadataFields = new Set([
  "overdue",
  "isOverdue",
  "neglectLevel",
  "neglectState",
  "neglectStatus",
]);

function sanitizeActionMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeActionMetadata);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !derivedMetadataFields.has(key))
      .map(([key, nestedValue]) => [key, sanitizeActionMetadata(nestedValue)]),
  );
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
  if (entity.dueMode === "scheduled" && typeof entity.dueAt !== "string") {
    throw corrupt(`tasks[${index}].dueAt is required for scheduled tasks`);
  }
  if (entity.dueMode !== "scheduled" && entity.dueAt !== undefined) {
    throw corrupt(`tasks[${index}].dueAt is only valid for scheduled tasks`);
  }
  if (entity.status === "completed" && typeof entity.completedAt !== "string") {
    throw corrupt(`tasks[${index}].completedAt is required for completed tasks`);
  }
  if (entity.status !== "completed" && entity.completedAt !== undefined) {
    throw corrupt(`tasks[${index}].completedAt is only valid for completed tasks`);
  }
  if (entity.status === "archived" && typeof entity.archivedAt !== "string") {
    throw corrupt(`tasks[${index}].archivedAt is required for archived tasks`);
  }
  if (entity.status !== "archived" && entity.archivedAt !== undefined) {
    throw corrupt(`tasks[${index}].archivedAt is only valid for archived tasks`);
  }
  numbers(entity, ["undecidedCount", "dismissCount", "postponeCount", "revision"]);
}

function reviewSession(value: unknown, index: number, requireActionEventIds: boolean): void {
  const entity = object(value, `reviewSessions[${index}]`);
  strings(entity, ["id", "localDate", "startedAt", "updatedAt"]);
  stringArray(entity.orderedTaskIds, `reviewSessions[${index}].orderedTaskIds`);
  stringArray(entity.visitedTaskIds, `reviewSessions[${index}].visitedTaskIds`);
  stringArray(entity.answeredTaskIds, `reviewSessions[${index}].answeredTaskIds`);
  const orderedTaskIds = new Set(entity.orderedTaskIds as string[]);
  if ((entity.answeredTaskIds as string[]).some((taskId) => !orderedTaskIds.has(taskId))) {
    throw corrupt(`reviewSessions[${index}].answeredTaskIds must be a subset of orderedTaskIds`);
  }
  if (requireActionEventIds) {
    stringArray(entity.actionEventIds, `reviewSessions[${index}].actionEventIds`);
  }
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

/**
 * Version 2 session ownership is a durable reference, not a display hint.
 * Validate it after every individual entity so referential checks never need
 * to normalize or infer corrupted records.
 */
function validateReviewActionOwnership(reviewSessions: unknown[], actionHistory: unknown[]): void {
  const eventsById = new Map<string, RecordValue>();
  actionHistory.forEach((value, index) => {
    const event = object(value, `actionHistory[${index}]`);
    const id = event.id as string;
    if (eventsById.has(id)) throw corrupt(`actionHistory[${index}].id must be unique`);
    eventsById.set(id, event);
  });

  const claimedEventIds = new Set<string>();
  reviewSessions.forEach((value, index) => {
    const session = object(value, `reviewSessions[${index}]`);
    const orderedTaskIds = new Set(session.orderedTaskIds as string[]);
    const answeredTaskIds = new Set(session.answeredTaskIds as string[]);
    for (const eventId of session.actionEventIds as string[]) {
      if (claimedEventIds.has(eventId)) {
        throw corrupt(`reviewSessions[${index}].actionEventIds must not be owned by another session`);
      }
      claimedEventIds.add(eventId);

      const event = eventsById.get(eventId);
      if (!event) throw corrupt(`reviewSessions[${index}].actionEventIds references an unknown action event`);
      if (event.entityType !== "task") {
        throw corrupt(`reviewSessions[${index}].actionEventIds must reference task action events`);
      }
      if (!orderedTaskIds.has(event.entityId as string)) {
        throw corrupt(`reviewSessions[${index}].actionEventIds action event task must be within orderedTaskIds`);
      }
      if (!answeredTaskIds.has(event.entityId as string)) {
        throw corrupt(`reviewSessions[${index}].actionEventIds must reference answered tasks`);
      }
    }
  });
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
