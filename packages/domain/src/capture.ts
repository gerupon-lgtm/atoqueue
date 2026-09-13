import type { AppSnapshot } from "./model";
import {
  rebuildInboxReminderNotifications,
  rebuildMemoReviewNotifications,
  type NotificationIdFactory,
} from "./notification-queue";

const MAX_CAPTURE_LENGTH = 280;

export function createCapture(
  snapshot: AppSnapshot,
  rawBody: string,
  now: string,
  id: string,
  idFactory?: NotificationIdFactory,
): AppSnapshot {
  const body = rawBody.trim();

  if (body.length === 0 || body.length > MAX_CAPTURE_LENGTH) {
    throw new Error("A capture must contain between 1 and 280 characters.");
  }

  const capture = {
    id,
    body,
    classification: "unclassified" as const,
    createdAt: now,
    updatedAt: now,
  };
  const snapshotWithCapture = {
    ...snapshot,
    captures: [...snapshot.captures, capture],
  };
  const hasMemoCapture = snapshot.captures.some(
    (candidate) => candidate.classification === "note",
  );
  const hasExistingMemoSeries = snapshot.reminderMap.some(
    (entry) => entry.scope === "memo",
  );
  let scheduledSnapshot = snapshotWithCapture;

  const inbox = rebuildInboxReminderNotifications({
    snapshot: scheduledSnapshot,
    now,
    createId: idFactory,
  });
  scheduledSnapshot = { ...scheduledSnapshot, ...inbox };

  if (hasMemoCapture && !hasExistingMemoSeries) {
    const memo = rebuildMemoReviewNotifications({
      snapshot: scheduledSnapshot,
      now,
      createId: idFactory,
    });
    scheduledSnapshot = { ...scheduledSnapshot, ...memo };
  }

  return {
    ...snapshot,
    captures: [...snapshot.captures, capture],
    notificationOutbox: scheduledSnapshot.notificationOutbox,
    reminderMap: scheduledSnapshot.reminderMap,
    actionHistory: [
      ...snapshot.actionHistory,
      {
        id: `${id}:capture_created`,
        entityType: "capture",
        entityId: id,
        action: "capture_created",
        after: { body, classification: "unclassified" },
        occurredAt: now,
      },
    ],
    savedAt: now,
  };
}

export function updateCaptureBody(
  snapshot: AppSnapshot,
  captureId: string,
  rawBody: string,
  now: string,
): AppSnapshot {
  const body = rawBody.trim();
  if (body.length === 0 || body.length > MAX_CAPTURE_LENGTH) {
    throw new Error("A capture must contain between 1 and 280 characters.");
  }
  const capture = snapshot.captures.find((candidate) => candidate.id === captureId);
  if (!capture) throw new Error("Capture not found.");

  return {
    ...snapshot,
    captures: snapshot.captures.map((candidate) =>
      candidate.id === captureId ? { ...candidate, body, updatedAt: now } : candidate,
    ),
    savedAt: now,
  };
}
