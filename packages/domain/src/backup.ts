import { CorruptDataError } from "./errors";
import { migrateSnapshot } from "./migrations";
import { notificationTypeForTask } from "./task-actions";
import type { ActionEvent, AppSnapshot, NotificationOutboxItem, ReminderMapEntry } from "./model";

export const BACKUP_FORMAT = "atoqueue-backup";
export const BACKUP_VERSION = 1;

export interface BackupData {
  schemaVersion: AppSnapshot["schemaVersion"];
  appVersion: string;
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
  data: BackupData;
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
export async function createBackup(snapshot: AppSnapshot): Promise<string> {
  const data: BackupData = {
    schemaVersion: snapshot.schemaVersion,
    appVersion: snapshot.appVersion,
    settings: snapshot.settings,
    captures: snapshot.captures,
    tasks: snapshot.tasks,
    reviewSessions: snapshot.reviewSessions,
    actionHistory: snapshot.actionHistory,
    savedAt: snapshot.savedAt,
  };
  const unsigned = { format: BACKUP_FORMAT, version: BACKUP_VERSION, data };
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
  const expected = await checksumFor({ format: document.format, version: document.version, data: document.data });
  if (document.checksum !== expected) throw new CorruptDataError("Backup checksum does not match.");

  validateData(document.data);
  return {
    data: document.data,
    counts: countsFor(document.data),
  };
}

/**
 * Builds an entirely new snapshot. It never mutates `current`, so callers can
 * persist exactly once only after the user has confirmed replacement.
 */
export async function restoreBackup(input: RestoreBackupInput): Promise<AppSnapshot> {
  const inspection = await inspectBackup(input.serialized);
  const restored = snapshotFromData(inspection.data, input.current.device);
  const delivery = rebuildReminderDelivery(restored.tasks, input.now, input.idFactory);
  const event: ActionEvent = {
    id: idFor(input, "action"),
    entityType: "backup",
    entityId: "local-backup",
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
  if (!isRecord(value.data)) throw new CorruptDataError("Backup data must be an object.");
  if (typeof value.checksum !== "string") throw new CorruptDataError("Backup checksum is missing.");
  return value as unknown as BackupDocument;
}

function validateData(data: BackupData): void {
  // Reuse the storage schema validator, with intentionally blank non-portable state.
  const snapshot = migrateSnapshot({
    ...data,
    device: { localDeviceId: "backup-validation", pushSubscriptionStatus: "not_requested" },
    notificationOutbox: [],
    reminderMap: [],
  });
  validateReferences(snapshot);
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
  const captureIds = new Set(snapshot.captures.map((capture) => capture.id));
  const taskIds = new Set(snapshot.tasks.map((task) => task.id));
  const actionIds = new Set(snapshot.actionHistory.map((event) => event.id));
  for (const task of snapshot.tasks) {
    if (!captureIds.has(task.sourceCaptureId)) throw new CorruptDataError("Task references an unknown capture.");
  }
  for (const capture of snapshot.captures) {
    if (capture.linkedTaskId && !taskIds.has(capture.linkedTaskId)) throw new CorruptDataError("Capture references an unknown task.");
  }
  for (const session of snapshot.reviewSessions) {
    if (session.orderedTaskIds.some((id) => !taskIds.has(id)) || session.visitedTaskIds.some((id) => !taskIds.has(id))) {
      throw new CorruptDataError("Review session references an unknown task.");
    }
    if (session.actionEventIds.some((id) => !actionIds.has(id))) throw new CorruptDataError("Review session references an unknown action.");
  }
  for (const event of snapshot.actionHistory) {
    if (event.entityType === "capture" && !captureIds.has(event.entityId)) throw new CorruptDataError("Action references an unknown capture.");
    if (event.entityType === "task" && !taskIds.has(event.entityId)) throw new CorruptDataError("Action references an unknown task.");
  }
}

function rebuildReminderDelivery(tasks: AppSnapshot["tasks"], now: string, idFactory?: RestoreBackupInput["idFactory"]): {
  notificationOutbox: NotificationOutboxItem[];
  reminderMap: ReminderMapEntry[];
} {
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
  }, { notificationOutbox: [], reminderMap: [] });
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
