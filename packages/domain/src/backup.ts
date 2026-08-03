import { CorruptDataError } from "./errors";
import { createLocalCalendar } from "./due-date";
import { migrateSnapshot } from "./migrations";
import { calculateNextReview } from "./reminder-policy";
import { notificationTypeForTask } from "./task-actions";
import type { ActionEvent, AppSnapshot, NotificationOutboxItem, ReminderMapEntry, Task } from "./model";

export const BACKUP_FORMAT = "atoqueue-backup";
export const BACKUP_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BackupData {
  schemaVersion: AppSnapshot["schemaVersion"];
  appVersion: string;
  device: Pick<AppSnapshot["device"], "localDeviceId">;
  settings: AppSnapshot["settings"];
  captures: AppSnapshot["captures"];
  tasks: AppSnapshot["tasks"];
  reviewSessions: AppSnapshot["reviewSessions"];
  actionHistory: AppSnapshot["actionHistory"];
  savedAt: string;
}

export interface BackupDocument {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  appVersion: string;
  payload: BackupData;
  checksum: string;
}

export interface BackupCounts {
  captures: number;
  tasks: number;
  reviewSessions: number;
  actionHistory: number;
}

export interface BackupInspection {
  data: BackupData;
  counts: BackupCounts;
}

export interface RestoreBackupInput {
  current: AppSnapshot;
  serialized: string;
  now: string;
  idFactory?: (kind: "action" | "outbox" | "reminder") => string;
}

/** Produces a portable, checksum-protected document without device or Push state. */
export async function createBackup(snapshot: AppSnapshot, exportedAt = new Date().toISOString()): Promise<string> {
  const payload: BackupData = {
    schemaVersion: snapshot.schemaVersion,
    appVersion: snapshot.appVersion,
    device: { localDeviceId: snapshot.device.localDeviceId },
    settings: snapshot.settings,
    captures: snapshot.captures,
    tasks: snapshot.tasks,
    reviewSessions: snapshot.reviewSessions,
    actionHistory: snapshot.actionHistory,
    savedAt: snapshot.savedAt,
  };
  const unsigned = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, appVersion: snapshot.appVersion, payload };
  const checksum = await checksumFor(unsigned);
  return canonicalJson({ ...unsigned, checksum });
}

/** Validates every untrusted field before the UI can show replacement counts. */
export async function inspectBackup(serialized: string): Promise<BackupInspection> {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new CorruptDataError("Backup is not valid JSON.");
  }
  const document = documentFrom(raw);
  const expected = await checksumFor({
    format: document.format,
    version: document.version,
    exportedAt: document.exportedAt,
    appVersion: document.appVersion,
    payload: document.payload,
  });
  if (document.checksum !== expected) throw new CorruptDataError("Backup checksum does not match.");

  if (document.appVersion !== document.payload.appVersion) {
    throw new CorruptDataError("Backup app version does not match its payload.");
  }
  validateUtcTimestamp(document.exportedAt, "Backup export time");
  validateData(document.payload);
  return {
    data: document.payload,
    counts: countsFor(document.payload),
  };
}

/**
 * Builds an entirely new snapshot. It never mutates `current`, so callers can
 * persist exactly once only after the user has confirmed replacement.
 */
export async function restoreBackup(input: RestoreBackupInput): Promise<AppSnapshot> {
  const inspection = await inspectBackup(input.serialized);
  const snapshot = snapshotFromData(inspection.data, input.current.device);
  const restored = { ...snapshot, tasks: recalculateRestoredTasks(snapshot.tasks, input.now, snapshot.settings.timeZone) };
  const delivery = rebuildReminderDelivery(input.current.reminderMap, restored.tasks, input.now, input.idFactory);
  const actionId = idFor(input, "action");
  const event: ActionEvent = {
    id: actionId,
    entityType: "backup",
    entityId: actionId,
    action: "backup_restored",
    after: { ...inspection.counts },
    occurredAt: input.now,
  };
  return {
    ...restored,
    device: { ...input.current.device, localDeviceId: input.current.device.localDeviceId },
    actionHistory: [...restored.actionHistory, event],
    notificationOutbox: delivery.notificationOutbox,
    reminderMap: delivery.reminderMap,
    savedAt: input.now,
  };
}

export function backupFilename(date = new Date()): string {
  return `atoqueue-backup-${date.toISOString().slice(0, 10)}.json`;
}

function documentFrom(value: unknown): BackupDocument {
  if (!isRecord(value)) throw new CorruptDataError("Backup document must be an object.");
  if (value.format !== BACKUP_FORMAT) throw new CorruptDataError("Backup format is not supported.");
  if (value.version !== BACKUP_VERSION) throw new CorruptDataError("Backup version is not supported.");
  if (typeof value.exportedAt !== "string") throw new CorruptDataError("Backup export time is missing.");
  if (typeof value.appVersion !== "string") throw new CorruptDataError("Backup app version is missing.");
  if (!isRecord(value.payload)) throw new CorruptDataError("Backup payload must be an object.");
  if (typeof value.checksum !== "string") throw new CorruptDataError("Backup checksum is missing.");
  return value as unknown as BackupDocument;
}

function validateData(data: BackupData): void {
  if (!isRecord(data.device) || typeof data.device.localDeviceId !== "string" || Object.keys(data.device).length !== 1) {
    throw new CorruptDataError("Backup device must contain only localDeviceId.");
  }
  assertUuid(data.device.localDeviceId, "Backup local device ID");
  validateBackupEntityIds(data);
  // Reuse the storage schema validator, with intentionally blank non-portable state.
  const snapshot = migrateSnapshot({
    ...data,
    device: { localDeviceId: "backup-validation", pushSubscriptionStatus: "not_requested" },
    notificationOutbox: [],
    reminderMap: [],
  });
  validateReferences(snapshot);
}

function validateBackupEntityIds(data: BackupData): void {
  if (Array.isArray(data.captures)) assertUniqueIds(data.captures, "capture");
  if (Array.isArray(data.tasks)) assertUniqueIds(data.tasks, "task");
  if (Array.isArray(data.reviewSessions)) assertUniqueIds(data.reviewSessions, "review session");
  if (Array.isArray(data.actionHistory)) assertUniqueIds(data.actionHistory, "action event");
}

function snapshotFromData(data: BackupData, device: AppSnapshot["device"]): AppSnapshot {
  return migrateSnapshot({
    ...data,
    device,
    notificationOutbox: [],
    reminderMap: [],
  });
}

function validateReferences(snapshot: AppSnapshot): void {
  assertUniqueIds(snapshot.captures, "capture");
  assertUniqueIds(snapshot.tasks, "task");
  assertUniqueIds(snapshot.reviewSessions, "review session");
  assertUniqueIds(snapshot.actionHistory, "action event");
  validateUtcTimestamp(snapshot.savedAt, "Backup saved time");
  const captureIds = new Set(snapshot.captures.map((capture) => capture.id));
  const taskIds = new Set(snapshot.tasks.map((task) => task.id));
  const actionIds = new Set(snapshot.actionHistory.map((event) => event.id));
  snapshot.captures.forEach((capture) => assertUuid(capture.id, "Capture ID"));
  snapshot.tasks.forEach((task) => assertUuid(task.id, "Task ID"));
  snapshot.reviewSessions.forEach((session) => assertUuid(session.id, "Review session ID"));
  snapshot.actionHistory.forEach((event) => assertUuid(event.id, "Action event ID"));
  const taskSourceCaptureIds = new Set<string>();
  for (const task of snapshot.tasks) {
    assertUuid(task.id, "Task ID");
    assertUuid(task.sourceCaptureId, "Task source capture ID");
    validateUtcTimestamp(task.createdAt, "Task creation time");
    validateUtcTimestamp(task.updatedAt, "Task update time");
    validateUtcTimestamp(task.nextReviewAt, "Task next review time");
    if (task.dueAt) validateUtcTimestamp(task.dueAt, "Task due time");
    if (task.lastPromptedAt) validateUtcTimestamp(task.lastPromptedAt, "Task last prompt time");
    if (task.completedAt) validateUtcTimestamp(task.completedAt, "Task completion time");
    if (task.archivedAt) validateUtcTimestamp(task.archivedAt, "Task archive time");
    if (!captureIds.has(task.sourceCaptureId)) throw new CorruptDataError("Task references an unknown capture.");
    if (taskSourceCaptureIds.has(task.sourceCaptureId)) {
      throw new CorruptDataError("Task source capture ID must be unique.");
    }
    taskSourceCaptureIds.add(task.sourceCaptureId);
  }
  for (const capture of snapshot.captures) {
    assertUuid(capture.id, "Capture ID");
    validateUtcTimestamp(capture.createdAt, "Capture creation time");
    validateUtcTimestamp(capture.updatedAt, "Capture update time");
    if (capture.classifiedAt) validateUtcTimestamp(capture.classifiedAt, "Capture classification time");
    const bodyLength = capture.body.trim().length;
    if (bodyLength < 1 || bodyLength > 280) {
      throw new CorruptDataError("Capture body must contain 1 to 280 characters.");
    }
    if (capture.classification === "task" && !capture.linkedTaskId) {
      throw new CorruptDataError("Task-classified capture must link to a task.");
    }
    if (capture.linkedTaskId) assertUuid(capture.linkedTaskId, "Capture linked task ID");
    if (capture.linkedTaskId && !taskIds.has(capture.linkedTaskId)) throw new CorruptDataError("Capture references an unknown task.");
    if (capture.linkedTaskId) {
      const task = snapshot.tasks.find((candidate) => candidate.id === capture.linkedTaskId);
      if (task?.sourceCaptureId !== capture.id) {
        throw new CorruptDataError("Capture linked task must originate from that capture.");
      }
    }
  }
  for (const session of snapshot.reviewSessions) {
    assertUuid(session.id, "Review session ID");
    assertUuidList(session.orderedTaskIds, "Review ordered task ID");
    assertUuidList(session.visitedTaskIds, "Review visited task ID");
    assertUuidList(session.answeredTaskIds, "Review answered task ID");
    assertUuidList(session.actionEventIds, "Review action event ID");
    validateLocalDate(session.localDate, "Review date");
    validateUtcTimestamp(session.startedAt, "Review start time");
    validateUtcTimestamp(session.updatedAt, "Review update time");
    if (session.completedAt) validateUtcTimestamp(session.completedAt, "Review completion time");
    if (session.orderedTaskIds.some((id) => !taskIds.has(id)) || session.visitedTaskIds.some((id) => !taskIds.has(id))) {
      throw new CorruptDataError("Review session references an unknown task.");
    }
    if (session.actionEventIds.some((id) => !actionIds.has(id))) throw new CorruptDataError("Review session references an unknown action.");
  }
  for (const event of snapshot.actionHistory) {
    assertUuid(event.id, "Action event ID");
    assertUuid(event.entityId, "Action entity ID");
    validateUtcTimestamp(event.occurredAt, "Action time");
    if (event.entityType === "capture" && !captureIds.has(event.entityId)) throw new CorruptDataError("Action references an unknown capture.");
    if (event.entityType === "task" && !taskIds.has(event.entityId)) throw new CorruptDataError("Action references an unknown task.");
  }
}

function recalculateRestoredTasks(tasks: Task[], now: string, timeZone: string): Task[] {
  const calendar = createLocalCalendar(timeZone);
  return tasks.map((task) => {
    if (task.status !== "active") return task;
    const nextReviewAt = task.dueMode === "scheduled" && task.dueAt && task.dueAt > now
      ? task.dueAt
      : calculateNextReview({ now, dueMode: task.dueMode, undecidedCount: task.undecidedCount, dismissCount: task.dismissCount, calendar });
    return { ...task, nextReviewAt };
  });
}

function assertUniqueIds(items: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new CorruptDataError(`Duplicate ${label} ID.`);
    ids.add(item.id);
  }
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new CorruptDataError(`${label} must be a UUID.`);
}

function assertUuidList(values: string[], label: string): void {
  values.forEach((value) => assertUuid(value, label));
}

function validateUtcTimestamp(value: string, label: string): void {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new CorruptDataError(`${label} must be an ISO 8601 UTC timestamp.`);
  }
}

function validateLocalDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new CorruptDataError(`${label} must be an ISO 8601 date.`);
  }
}

function rebuildReminderDelivery(previousMappings: AppSnapshot["reminderMap"], tasks: AppSnapshot["tasks"], now: string, idFactory?: RestoreBackupInput["idFactory"]): {
  notificationOutbox: NotificationOutboxItem[];
  reminderMap: ReminderMapEntry[];
} {
  const notificationOutbox: NotificationOutboxItem[] = previousMappings.map((mapping) => ({
    id: idFactory?.("outbox") ?? randomId(),
    operation: "cancel",
    reminderId: mapping.reminderId,
    taskRevision: mapping.taskRevision,
    attemptCount: 0,
    nextAttemptAt: now,
    createdAt: now,
  }));
  return tasks.filter((task) => task.status === "active").reduce<{ notificationOutbox: NotificationOutboxItem[]; reminderMap: ReminderMapEntry[] }>((result, task) => {
    const reminderId = idFactory?.("reminder") ?? randomId();
    result.reminderMap.push({ reminderId, taskId: task.id, taskRevision: task.revision, createdAt: now });
    result.notificationOutbox.push({
      id: idFactory?.("outbox") ?? randomId(),
      operation: "upsert",
      reminderId,
      scheduledAt: task.nextReviewAt,
      notificationType: notificationTypeForTask(task),
      taskRevision: task.revision,
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
    });
    return result;
  }, { notificationOutbox, reminderMap: [] });
}

function countsFor(data: BackupData): BackupCounts {
  return { captures: data.captures.length, tasks: data.tasks.length, reviewSessions: data.reviewSessions.length, actionHistory: data.actionHistory.length };
}

function idFor(input: RestoreBackupInput, kind: "action" | "outbox" | "reminder"): string {
  return input.idFactory?.(kind) ?? randomId();
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `backup-${Date.now()}-${Math.random()}`;
}

async function checksumFor(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
