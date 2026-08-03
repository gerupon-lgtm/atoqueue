import { resolveDueChoice, type DueResolution } from "./due-date";
import { calculateNextReview } from "./reminder-policy";
import { findNextReviewIndex, type ReviewCalendar } from "./review-session";
import type { ActionEvent, AppSnapshot, NotificationOutboxItem, ReviewSession, Task } from "./model";

export type ReviewAnswer = "complete" | "do_today" | "reschedule" | "no_due" | "dismiss" | "archive";

export interface AnswerReviewInput {
  snapshot: AppSnapshot;
  sessionId: string;
  answer: ReviewAnswer;
  now: string;
  calendar: ReviewCalendar;
  /** Required only for the explicit new-date choice. */
  due?: DueResolution;
  /** Makes local IDs deterministic in tests without exposing them to an API. */
  idFactory?: (kind: "action" | "outbox" | "reminder") => string;
}

/**
 * Applies a review answer completely in local state. Network delivery is
 * intentionally absent: a later outbox synchronizer may fail without rolling
 * back this result.
 */
export function answerReview(input: AnswerReviewInput): AppSnapshot {
  const session = input.snapshot.reviewSessions.find((candidate) => candidate.id === input.sessionId);
  if (!session) throw new Error("Review session not found.");
  if (session.completedAt) throw new Error("Review session is already complete.");

  const currentIndex = findNextReviewIndex(session, input.snapshot.tasks, session.currentIndex);
  const taskId = session.orderedTaskIds[currentIndex];
  const task = input.snapshot.tasks.find((candidate) => candidate.id === taskId);
  if (!task || (task.status !== "active" && !session.answeredTaskIds.includes(task.id))) {
    return completeStaleSession(input.snapshot, session, currentIndex, input.now);
  }

  const updatedTask = applyAnswer(task, input);
  const action = actionFor(input.answer);
  const event: ActionEvent = {
    id: createId(input, "action"),
    entityType: "task",
    entityId: task.id,
    action,
    before: taskMetadata(task),
    after: taskMetadata(updatedTask),
    occurredAt: input.now,
  };
  const tasks = input.snapshot.tasks.map((candidate) => candidate.id === task.id ? updatedTask : candidate);
  const notification = queueNotification(input.snapshot, updatedTask, input);
  const answeredTaskIds = unique([...session.answeredTaskIds, task.id]);
  const visitedTaskIds = unique([...session.visitedTaskIds, task.id]);
  const nextIndex = findNextReviewIndex({ ...session, answeredTaskIds }, tasks, currentIndex + 1);
  const updatedSession: ReviewSession = {
    ...session,
    currentIndex: nextIndex,
    visitedTaskIds,
    answeredTaskIds,
    updatedAt: input.now,
    ...(nextIndex >= session.orderedTaskIds.length ? { completedAt: input.now } : {}),
  };

  return {
    ...input.snapshot,
    tasks,
    reviewSessions: input.snapshot.reviewSessions.map((candidate) => candidate.id === session.id ? updatedSession : candidate),
    actionHistory: [...input.snapshot.actionHistory, event],
    notificationOutbox: [...input.snapshot.notificationOutbox, notification.outbox],
    reminderMap: notification.reminderMap,
    savedAt: input.now,
  };
}

function applyAnswer(task: Task, input: AnswerReviewInput): Task {
  const revision = task.revision + 1;
  const active = (changes: Partial<Task>): Task => {
    const withoutTerminalState = { ...task };
    delete withoutTerminalState.completedAt;
    delete withoutTerminalState.archivedAt;
    return { ...withoutTerminalState, status: "active", revision, updatedAt: input.now, ...changes };
  };

  switch (input.answer) {
    case "complete": {
      const completed = { ...task };
      delete completed.archivedAt;
      return { ...completed, status: "completed", completedAt: input.now, revision, updatedAt: input.now };
    }
    case "do_today": {
      const dueAt = input.calendar.endOfDay(input.calendar.today(input.now));
      return active({ dueMode: "scheduled", dueAt, nextReviewAt: dueAt, dismissCount: 0 });
    }
    case "reschedule":
      if (!input.due || input.due.dueMode !== "scheduled" || !input.due.dueAt) {
        throw new Error("Rescheduling requires a scheduled due date.");
      }
      return active({ ...input.due, dismissCount: 0 });
    case "no_due": {
      const due = resolveDueChoice({ choice: { type: "none" }, now: input.now, calendar: input.calendar });
      return active(due);
    }
    case "dismiss": {
      const nextReviewAt = calculateNextReview({
        now: input.now,
        dueMode: task.dueMode,
        undecidedCount: task.undecidedCount,
        dismissCount: task.dismissCount,
        calendar: input.calendar,
      });
      return active({ dismissCount: task.dismissCount + 1, nextReviewAt, lastPromptedAt: input.now });
    }
    case "archive": {
      const archived = { ...task };
      delete archived.completedAt;
      return { ...archived, status: "archived", archivedAt: input.now, revision, updatedAt: input.now };
    }
  }
}

function queueNotification(snapshot: AppSnapshot, task: Task, input: AnswerReviewInput): {
  outbox: NotificationOutboxItem;
  reminderMap: AppSnapshot["reminderMap"];
} {
  const existing = snapshot.reminderMap.find((entry) => entry.taskId === task.id);
  const reminderId = existing?.reminderId ?? createId(input, "reminder");
  const cancel = task.status === "completed" || task.status === "archived";
  const outbox: NotificationOutboxItem = {
    id: createId(input, "outbox"),
    operation: cancel ? "cancel" : "upsert",
    reminderId,
    ...(!cancel ? { scheduledAt: task.nextReviewAt, notificationType: notificationType(task) } : {}),
    taskRevision: task.revision,
    attemptCount: 0,
    nextAttemptAt: input.now,
    createdAt: input.now,
  };
  const entry = { reminderId, taskId: task.id, taskRevision: task.revision, createdAt: existing?.createdAt ?? input.now };
  return {
    outbox,
    reminderMap: existing
      ? snapshot.reminderMap.map((candidate) => candidate.reminderId === reminderId ? entry : candidate)
      : [...snapshot.reminderMap, entry],
  };
}

function notificationType(task: Task): NotificationOutboxItem["notificationType"] {
  if (task.dueMode === "unset") return "unset_due_review";
  if (task.dueMode === "scheduled") return "deadline_review";
  return "task_review";
}

function actionFor(answer: ReviewAnswer): ActionEvent["action"] {
  switch (answer) {
    case "complete": return "task_completed";
    case "do_today":
    case "reschedule": return "task_rescheduled";
    case "no_due": return "task_marked_no_due";
    case "dismiss": return "task_dismissed";
    case "archive": return "task_archived";
  }
}

function completeStaleSession(snapshot: AppSnapshot, session: ReviewSession, currentIndex: number, now: string): AppSnapshot {
  const completed = { ...session, currentIndex: currentIndex, updatedAt: now, completedAt: now };
  return { ...snapshot, reviewSessions: snapshot.reviewSessions.map((candidate) => candidate.id === session.id ? completed : candidate), savedAt: now };
}

function taskMetadata(task: Task): Record<string, unknown> {
  return {
    status: task.status,
    dueMode: task.dueMode,
    dueAt: task.dueAt,
    nextReviewAt: task.nextReviewAt,
    revision: task.revision,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function createId(input: AnswerReviewInput, kind: "action" | "outbox" | "reminder"): string {
  return input.idFactory?.(kind) ?? crypto.randomUUID();
}
