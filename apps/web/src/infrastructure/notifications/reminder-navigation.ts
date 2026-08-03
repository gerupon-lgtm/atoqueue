import type { AppSnapshot } from "../../../../../packages/domain/src";

/** Looks up a push reminder locally; anonymous IDs never need a server request. */
export function resolveReminderTaskId(snapshot: AppSnapshot, reminderId: string | null): string | undefined {
  if (!reminderId) return undefined;
  const mapping = snapshot.reminderMap.find((entry) => entry.reminderId === reminderId);
  const task = mapping && snapshot.tasks.find((candidate) => candidate.id === mapping.taskId);
  return task?.status === "active" ? task.id : undefined;
}
