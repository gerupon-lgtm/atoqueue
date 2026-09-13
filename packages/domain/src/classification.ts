import { AlreadyClassifiedError } from "./errors";
import type { AppSnapshot, Capture, Task } from "./model";
import type { DueResolution } from "./due-date";
import { queueTaskNotifications, rebuildGlobalNotificationSchedules, type NotificationIdFactory } from "./notification-queue";

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
  return confirmCaptureAsTask(input, "unclassified");
}

export interface ClassifyCapturesInput {
  snapshot: AppSnapshot;
  captureIds: readonly string[];
  now: string;
}

export type UnneededCaptureSource = "unclassified" | "note";

/** Converts a memo only after the user confirms the normal task-candidate form. */
export function promoteNoteToTask(input: ConfirmTaskInput): AppSnapshot {
  return confirmCaptureAsTask(input, "note");
}

function confirmCaptureAsTask(
  input: ConfirmTaskInput,
  allowedClassification: "unclassified" | "note",
): AppSnapshot {
  const capture = getClassifiableCapture(
    input.snapshot,
    input.captureId,
    allowedClassification,
  );
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
  const global = rebuildGlobalNotificationSchedules({
    snapshot: { ...input.snapshot, captures: replaceCapture(input.snapshot, updatedCapture) },
    now: input.now,
    createId: input.idFactory,
  });
  const notification = queueTaskNotifications({
    snapshot: { ...input.snapshot, ...global },
    task,
    now: input.now,
    createId: input.idFactory,
  });

  return {
    ...input.snapshot,
    captures: replaceCapture(input.snapshot, updatedCapture),
    tasks: [...input.snapshot.tasks, task],
    notificationOutbox: [
      ...global.notificationOutbox,
      ...notification.notificationOutbox,
    ],
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

/** Keeps disposal of a reviewed memo inside the domain notification rebuild path. */
export function markNoteAsUnneeded(input: ClassifyCaptureInput): AppSnapshot {
  return classifyWithoutTask(input, "unneeded", "note");
}

export function restoreUnneededCapture(input: ClassifyCaptureInput): AppSnapshot {
  return restoreUnneededCaptures({
    snapshot: input.snapshot,
    captureIds: [input.captureId],
    now: input.now,
  });
}

export function restoreUnneededCaptures(
  input: ClassifyCapturesInput,
): AppSnapshot {
  const captures = selectedUnneededCaptures(input);
  const selectedIds = new Set(input.captureIds);
  const restoredById = new Map(
    captures.map((capture) => [
      capture.id,
      {
        id: capture.id,
        body: capture.body,
        classification: "unclassified" as const,
        createdAt: capture.createdAt,
        updatedAt: input.now,
      },
    ]),
  );
  const updatedCaptures = input.snapshot.captures.map((capture) =>
    selectedIds.has(capture.id) ? restoredById.get(capture.id)! : capture,
  );
  const global = rebuildGlobalNotificationSchedules({
    snapshot: {
      ...input.snapshot,
      captures: updatedCaptures,
    },
    now: input.now,
  });

  return {
    ...input.snapshot,
    captures: updatedCaptures,
    notificationOutbox: global.notificationOutbox,
    reminderMap: global.reminderMap,
    actionHistory: [
      ...input.snapshot.actionHistory,
      ...captures.map((capture) =>
        captureClassificationEvent(restoredById.get(capture.id)!, input.now),
      ),
    ],
    savedAt: input.now,
  };
}

export function deleteUnneededCapture(input: ClassifyCaptureInput): AppSnapshot {
  return deleteUnneededCaptures({
    snapshot: input.snapshot,
    captureIds: [input.captureId],
    now: input.now,
  });
}

export function deleteUnneededCaptures(
  input: ClassifyCapturesInput,
): AppSnapshot {
  selectedUnneededCaptures(input);
  const selectedIds = new Set(input.captureIds);
  const captures = input.snapshot.captures.filter(
    (capture) => !selectedIds.has(capture.id),
  );
  const global = rebuildGlobalNotificationSchedules({
    snapshot: { ...input.snapshot, captures },
    now: input.now,
  });

  return {
    ...input.snapshot,
    captures,
    notificationOutbox: global.notificationOutbox,
    reminderMap: global.reminderMap,
    actionHistory: input.snapshot.actionHistory.filter(
      (event) =>
        !(event.entityType === "capture" && selectedIds.has(event.entityId)),
    ),
    savedAt: input.now,
  };
}

export function getUnneededCaptureSource(
  snapshot: AppSnapshot,
  captureId: string,
): UnneededCaptureSource {
  getClassifiableCapture(snapshot, captureId, "unneeded");
  let foundCurrentUnneeded = false;

  for (const event of [...snapshot.actionHistory].reverse()) {
    if (
      event.entityType !== "capture" ||
      event.entityId !== captureId ||
      event.action !== "capture_classified"
    ) {
      continue;
    }
    const classification = eventClassification(event.after);
    if (!foundCurrentUnneeded) {
      if (classification === "unneeded") foundCurrentUnneeded = true;
      continue;
    }
    return classification === "note" ? "note" : "unclassified";
  }

  return "unclassified";
}

function classifyWithoutTask(
  input: ClassifyCaptureInput,
  classification: "note" | "unneeded",
  allowedClassification: "unclassified" | "note" = "unclassified",
): AppSnapshot {
  const capture = getClassifiableCapture(
    input.snapshot,
    input.captureId,
    allowedClassification,
  );
  const updatedCapture: Capture = {
    ...capture,
    classification,
    classifiedAt: input.now,
    updatedAt: input.now,
  };

  const global = rebuildGlobalNotificationSchedules({
    snapshot: { ...input.snapshot, captures: replaceCapture(input.snapshot, updatedCapture) },
    now: input.now,
  });
  return {
    ...input.snapshot,
    captures: replaceCapture(input.snapshot, updatedCapture),
    notificationOutbox: global.notificationOutbox,
    reminderMap: global.reminderMap,
    actionHistory: [
      ...input.snapshot.actionHistory,
      captureClassificationEvent(updatedCapture, input.now),
    ],
    savedAt: input.now,
  };
}

function getClassifiableCapture(
  snapshot: AppSnapshot,
  captureId: string,
  classification: Capture["classification"],
): Capture {
  const capture = snapshot.captures.find((candidate) => candidate.id === captureId);
  if (!capture) throw new Error("Capture not found.");
  if (capture.classification !== classification) throw new AlreadyClassifiedError(captureId);
  return capture;
}

function selectedUnneededCaptures(
  input: ClassifyCapturesInput,
): Capture[] {
  if (input.captureIds.length === 0) {
    throw new Error("At least one capture is required.");
  }
  if (new Set(input.captureIds).size !== input.captureIds.length) {
    throw new Error("Capture IDs must be unique.");
  }
  return input.captureIds.map((captureId) =>
    getClassifiableCapture(input.snapshot, captureId, "unneeded"),
  );
}

function eventClassification(
  after: ActionEventAfter,
): Capture["classification"] | undefined {
  if (!after || typeof after !== "object" || !("classification" in after)) {
    return undefined;
  }
  const classification = after.classification;
  return classification === "unclassified" ||
    classification === "task" ||
    classification === "note" ||
    classification === "unneeded"
    ? classification
    : undefined;
}

type ActionEventAfter = AppSnapshot["actionHistory"][number]["after"];

function replaceCapture(snapshot: AppSnapshot, updated: Capture): Capture[] {
  return snapshot.captures.map((capture) => (capture.id === updated.id ? updated : capture));
}

function captureClassificationEvent(capture: Capture, now: string) {
  return {
    id: `${capture.id}:capture_classified:${now}`,
    entityType: "capture" as const,
    entityId: capture.id,
    action: "capture_classified" as const,
    after: { classification: capture.classification, linkedTaskId: capture.linkedTaskId },
    occurredAt: now,
  };
}
