import type { AppSnapshot } from "./model";

const MAX_CAPTURE_LENGTH = 280;

export function createCapture(
  snapshot: AppSnapshot,
  rawBody: string,
  now: string,
  id: string,
): AppSnapshot {
  const body = rawBody.trim();

  if (body.length === 0 || body.length > MAX_CAPTURE_LENGTH) {
    throw new Error("A capture must contain between 1 and 280 characters.");
  }

  return {
    ...snapshot,
    captures: [
      ...snapshot.captures,
      {
        id,
        body,
        classification: "unclassified",
        createdAt: now,
        updatedAt: now,
      },
    ],
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
