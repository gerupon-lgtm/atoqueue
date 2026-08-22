import { calculateNeglectLevel, type ReminderCalendar } from "./reminder-policy";
import type { ActionEvent, ReviewSession, Task } from "./model";
import type { LocalCalendar } from "./due-date";

/** The complete, caller-provided time boundary for daily review decisions. */
export interface ReviewCalendar extends ReminderCalendar, LocalCalendar {}

export interface StartReviewInput {
  sessionId: string;
  now: string;
  calendar: ReviewCalendar;
  tasks: Task[];
}

export interface CurrentReviewTaskInput {
  session: ReviewSession;
  tasks: Task[];
}

export interface RefreshReviewInput extends Omit<StartReviewInput, "sessionId"> {
  session: ReviewSession;
}

export interface ReviewSummary {
  processedTaskIds: string[];
  actionCounts: Partial<Record<ActionEvent["action"], number>>;
}

/**
 * Creates a stable, locally ordered session. Time-derived priorities are used
 * only here; the priority values themselves are never persisted.
 */
export function startReviewSession(input: StartReviewInput): ReviewSession {
  return {
    id: input.sessionId,
    localDate: input.calendar.today(input.now),
    orderedTaskIds: input.tasks
      .filter((task) => task.status === "active" && reviewGroup(task, input.now, input.calendar) !== null)
      .sort((left, right) => compareReviewTasks(left, right, input.now, input.calendar))
      .map((task) => task.id),
    currentIndex: 0,
    visitedTaskIds: [],
    answeredTaskIds: [],
    actionEventIds: [],
    startedAt: input.now,
    updatedAt: input.now,
  };
}

/** Adds candidates that became eligible after an unfinished session started. */
export function refreshReviewSession(input: RefreshReviewInput): ReviewSession {
  const current = new Set(input.session.orderedTaskIds);
  const additions = startReviewSession({
    ...input,
    sessionId: input.session.id,
  }).orderedTaskIds.filter(
    (taskId) => !current.has(taskId),
  );
  if (additions.length === 0) return input.session;
  return {
    ...input.session,
    orderedTaskIds: [...input.session.orderedTaskIds, ...additions],
    updatedAt: input.now,
  };
}

/**
 * Finds the current item without reviving stale, unvisited tasks. Answered
 * tasks remain visible when the user explicitly goes back to correct a choice.
 */
export function currentReviewTask(input: CurrentReviewTaskInput): Task | null {
  for (let index = input.session.currentIndex; index < input.session.orderedTaskIds.length; index += 1) {
    const task = input.tasks.find((candidate) => candidate.id === input.session.orderedTaskIds[index]);
    if (task && (task.status === "active" || input.session.answeredTaskIds.includes(task.id))) return task;
  }
  return null;
}

export function goToPreviousTask(session: ReviewSession, now: string): ReviewSession {
  return {
    ...session,
    currentIndex: Math.max(0, session.currentIndex - 1),
    updatedAt: now,
  };
}

export function goToNextTask(
  session: ReviewSession,
  tasks: Task[],
  now: string,
): ReviewSession {
  const length = session.orderedTaskIds.length;
  if (length < 2) return session;
  for (let offset = 1; offset <= length; offset += 1) {
    const index = (session.currentIndex + offset) % length;
    const task = tasks.find(
      (candidate) => candidate.id === session.orderedTaskIds[index],
    );
    if (
      task &&
      task.status === "active" &&
      !session.answeredTaskIds.includes(task.id)
    ) {
      return { ...session, currentIndex: index, updatedAt: now };
    }
  }
  return session;
}

export function summarizeReview(session: ReviewSession, events: ActionEvent[]): ReviewSummary {
  const processedTaskIds = [...session.answeredTaskIds];
  const processed = new Set(processedTaskIds);
  const ownedEventIds = new Set(session.actionEventIds);
  const actionCounts: ReviewSummary["actionCounts"] = {};

  for (const event of events) {
    if (ownedEventIds.has(event.id) && event.entityType === "task" && processed.has(event.entityId)) {
      actionCounts[event.action] = (actionCounts[event.action] ?? 0) + 1;
    }
  }

  return { processedTaskIds, actionCounts };
}

export function findNextReviewIndex(session: ReviewSession, tasks: Task[], from: number): number {
  for (let index = from; index < session.orderedTaskIds.length; index += 1) {
    const task = tasks.find((candidate) => candidate.id === session.orderedTaskIds[index]);
    if (task?.status === "active" || (task && session.answeredTaskIds.includes(task.id))) return index;
  }
  return session.orderedTaskIds.length;
}

export function findNextUnansweredReviewIndex(
  session: ReviewSession,
  tasks: Task[],
  from: number,
): number {
  const length = session.orderedTaskIds.length;
  for (let offset = 0; offset < length; offset += 1) {
    const index = (from + offset) % length;
    const task = tasks.find(
      (candidate) => candidate.id === session.orderedTaskIds[index],
    );
    if (
      task?.status === "active" &&
      !session.answeredTaskIds.includes(task.id)
    ) {
      return index;
    }
  }
  return length;
}

function compareReviewTasks(left: Task, right: Task, now: string, calendar: ReviewCalendar): number {
  const group = reviewGroup(left, now, calendar)! - reviewGroup(right, now, calendar)!;
  if (group !== 0) return group;

  if (reviewGroup(left, now, calendar) === 0) {
    const due = calendar.compareInstants(left.dueAt!, right.dueAt!);
    if (due !== 0) return due;
  }

  if (reviewGroup(left, now, calendar) === 1) {
    const neglect = neglectLevel(right, now, calendar) - neglectLevel(left, now, calendar);
    if (neglect !== 0) return neglect;
  }

  return calendar.compareInstants(left.createdAt, right.createdAt);
}

function reviewGroup(task: Task, now: string, calendar: ReviewCalendar): number | null {
  const dueToday = task.dueMode === "scheduled"
    && task.dueAt
    && task.dismissCount === 0
    && calendar.today(task.dueAt) === calendar.today(now);
  if (!dueToday && calendar.compareInstants(task.nextReviewAt, now) > 0) return null;
  if (task.dueMode === "scheduled" && task.dueAt && calendar.compareInstants(task.dueAt, now) < 0) return 0;
  if (neglectLevel(task, now, calendar) >= 2) return 1;
  if (dueToday) return 2;
  if (task.dueMode === "unset" && calendar.compareInstants(task.nextReviewAt, now) <= 0) return 3;
  if (task.dueMode === "none" && calendar.compareInstants(task.nextReviewAt, now) <= 0) return 4;
  return null;
}

function neglectLevel(task: Task, now: string, calendar: ReviewCalendar): number {
  return calculateNeglectLevel({ ...task, now, calendar });
}
