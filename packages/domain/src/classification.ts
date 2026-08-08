import { AlreadyClassifiedError } from "./errors";
import type { AppSnapshot, Capture, Task } from "./model";
import type { DueResolution } from "./due-date";
import { cancelCaptureNotification, queueTaskNotifications, type NotificationIdFactory } from "./notification-queue";

export interface ClassifyCaptureInput {
  snapshot: AppSnapshot;
  captureId: string;
  now: string;
}

export interface ConfirmTaskInput extends ClassifyCaptureInput {
  taskId: string;
  title: string;
  category?: Task["category"];
  due: DueResolution;
  idFactory?: NotificationIdFactory;
}

export function suggestClassification(body: string): "task" | "unknown" {
  const normalized = body.trim();
  return /(?:買う|する|行く|予約|提出|連絡|支払|確認|準備|修理|返す|call|buy|send|todo)/iu.test(normalized)
    ? "task"
    : "unknown";
}

export function confirmTask(input: ConfirmTaskInput): AppSnapshot {
  const capture = getUnclassifiedCapture(input.snapshot, input.captureId);
  const title = input.title.trim();
  if (!title) throw new Error("A task title is required.");
  validateDueResolution(input.due);
  if (input.snapshot.tasks.some((task) => task.id === input.taskId)) {
    throw new Error("A task ID must be unique.");
  }

  const updatedCapture: Capture = {
    ...capture,
    classification: "task",
    classifiedAt: input.now,
    linkedTaskId: input.taskId,
    updatedAt: input.now,
  };
  const task: Task = {
    id: input.taskId,
    sourceCaptureId: capture.id,
    title,
    ...(input.category ? { category: input.category } : {}),
    status: "active",
    dueMode: input.due.dueMode,
    ...(input.due.dueAt ? { dueAt: input.due.dueAt } : {}),
    nextReviewAt: input.due.nextReviewAt,
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: input.now,
    updatedAt: input.now,
    revision: 1,
  };
  const captureCancellation = cancelCaptureNotification({
    snapshot: input.snapshot,
    captureId: capture.id,
    now: input.now,
    createId: input.idFactory,
  });
  const notification = queueTaskNotifications({
    snapshot: { ...input.snapshot, reminderMap: captureCancellation.reminderMap },
    task,
    now: input.now,
    createId: input.idFactory,
  });

  return {
    ...input.snapshot,
    captures: replaceCapture(input.snapshot, updatedCapture),
    tasks: [...input.snapshot.tasks, task],
    notificationOutbox: [...input.snapshot.notificationOutbox, ...captureCancellation.notificationOutbox, ...notification.notificationOutbox],
    reminderMap: notification.reminderMap,
    actionHistory: [
      ...input.snapshot.actionHistory,
      captureClassificationEvent(updatedCapture, input.now),
      {
        id: `${task.id}:task_created`,
        entityType: "task",
        entityId: task.id,
        action: "task_created",
        after: { sourceCaptureId: task.sourceCaptureId, dueMode: task.dueMode },
        occurredAt: input.now,
      },
    ],
    savedAt: input.now,
  };
}

function validateDueResolution(due: DueResolution): void {
  if (due.dueMode === "scheduled" && !due.dueAt) {
    throw new Error("Scheduled tasks require a due date.");
  }
  if (due.dueMode !== "scheduled" && due.dueAt) {
    throw new Error("Only scheduled tasks can have a due date.");
  }
}

export function markAsNote(input: ClassifyCaptureInput): AppSnapshot {
  return classifyWithoutTask(input, "note");
}

export function markAsUnneeded(input: ClassifyCaptureInput): AppSnapshot {
  return classifyWithoutTask(input, "unneeded");
}

function classifyWithoutTask(
  input: ClassifyCaptureInput,
  classification: "note" | "unneeded",
): AppSnapshot {
  const capture = getUnclassifiedCapture(input.snapshot, input.captureId);
  const updatedCapture: Capture = {
    ...capture,
    classification,
    classifiedAt: input.now,
    updatedAt: input.now,
  };

  const captureCancellation = cancelCaptureNotification({
    snapshot: input.snapshot,
    captureId: input.captureId,
    now: input.now,
  });
  return {
    ...input.snapshot,
    captures: replaceCapture(input.snapshot, updatedCapture),
    notificationOutbox: [...input.snapshot.notificationOutbox, ...captureCancellation.notificationOutbox],
    reminderMap: captureCancellation.reminderMap,
    actionHistory: [
      ...input.snapshot.actionHistory,
      captureClassificationEvent(updatedCapture, input.now),
    ],
    savedAt: input.now,
  };
}

function getUnclassifiedCapture(snapshot: AppSnapshot, captureId: string): Capture {
  const capture = snapshot.captures.find((candidate) => candidate.id === captureId);
  if (!capture) throw new Error("Capture not found.");
  if (capture.classification !== "unclassified") throw new AlreadyClassifiedError(captureId);
  return capture;
}

function replaceCapture(snapshot: AppSnapshot, updated: Capture): Capture[] {
  return snapshot.captures.map((capture) => (capture.id === updated.id ? updated : capture));
}

function captureClassificationEvent(capture: Capture, now: string) {
  return {
    id: `${capture.id}:capture_classified`,
    entityType: "capture" as const,
    entityId: capture.id,
    action: "capture_classified" as const,
    after: { classification: capture.classification, linkedTaskId: capture.linkedTaskId },
    occurredAt: now,
  };
}
