import { describe, expect, it } from "vitest";
import {
  answerReview,
  createEmptySnapshot,
  startReviewSession,
  type AppSnapshot,
  type ReviewCalendar,
  type Task,
} from "./index";

const now = "2026-08-03T09:00:00.000Z";
const calendar: ReviewCalendar = {
  addDays: (date, days) => ({ "2026-08-03:1": "2026-08-04", "2026-08-03:3": "2026-08-06", "2026-08-03:7": "2026-08-10" } as Record<string, string>)[`${date}:${days}`] ?? date,
  addHours: (instant, hours) => new Date(Date.parse(instant) + hours * 3_600_000).toISOString(),
  atTime: (date, hour, minute) => `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  compareInstants: (left, right) => left.localeCompare(right),
  elapsedDays: (from, to) => Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000),
  endOfDay: (date) => `${date}T23:59:00.000Z`,
  isAtOrAfter: () => false,
  nextSunday: () => "2026-08-09",
  nextWeekday: () => "2026-08-09",
  today: () => "2026-08-03",
};

function task(id: string, changes: Partial<Task> = {}): Task {
  return {
    id,
    sourceCaptureId: `capture-${id}`,
    title: "SECRET_TASK_TITLE",
    category: "work",
    status: "active",
    dueMode: "scheduled",
    dueAt: "2026-08-02T23:59:00.000Z",
    nextReviewAt: "2026-08-02T23:59:00.000Z",
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: now,
    revision: 1,
    ...changes,
  };
}

function snapshotWithSession(tasks: Task[]): AppSnapshot {
  const snapshot = { ...createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "device-1", timeZone: "UTC", now }), tasks };
  return {
    ...snapshot,
    reviewSessions: [startReviewSession({ sessionId: "session-1", now, calendar, tasks })],
  };
}

function answer(snapshot: AppSnapshot, action: "complete" | "do_today" | "reschedule" | "no_due" | "dismiss" | "archive") {
  return answerReview({
    snapshot,
    sessionId: "session-1",
    answer: action,
    now,
    calendar,
    due: action === "reschedule" ? { dueMode: "scheduled", dueAt: "2026-08-10T23:59:00.000Z", nextReviewAt: "2026-08-10T23:59:00.000Z" } : undefined,
    idFactory: (kind) => `${kind}-id`,
  });
}

describe("review task actions", () => {
  it("F-009 advances one item after an answer and final answer records completion", () => {
    const first = answer(snapshotWithSession([task("first"), task("second")]), "complete");
    expect(first.reviewSessions[0]).toMatchObject({ currentIndex: 1, visitedTaskIds: ["first"], answeredTaskIds: ["first"] });

    const complete = answer(first, "complete");
    expect(complete.reviewSessions[0]).toMatchObject({ currentIndex: 2, completedAt: now, answeredTaskIds: ["first", "second"] });
  });

  it("F-010 records a new event and current state when a visited task is answered again", () => {
    const afterComplete = answer(snapshotWithSession([task("first"), task("second")]), "complete");
    const revisiting = { ...afterComplete, reviewSessions: [{ ...afterComplete.reviewSessions[0]!, currentIndex: 0 }] };
    const rescheduled = answer(revisiting, "reschedule");

    expect(rescheduled.tasks[0]).toMatchObject({ status: "active", dueAt: "2026-08-10T23:59:00.000Z", revision: 3 });
    expect(rescheduled.actionHistory.map((event) => event.action)).toEqual(["task_completed", "task_rescheduled"]);
    expect(rescheduled.reviewSessions[0]!.answeredTaskIds).toEqual(["first"]);
  });

  it.each([
    ["complete", { status: "completed", completedAt: now }, "task_completed", "cancel"],
    ["do_today", { status: "active", dueAt: "2026-08-03T23:59:00.000Z" }, "task_rescheduled", "upsert"],
    ["reschedule", { status: "active", dueAt: "2026-08-10T23:59:00.000Z" }, "task_rescheduled", "upsert"],
    ["no_due", { status: "active", dueMode: "none" }, "task_marked_no_due", "upsert"],
    ["dismiss", { status: "active", dismissCount: 1 }, "task_dismissed", "upsert"],
    ["archive", { status: "archived", archivedAt: now }, "task_archived", "cancel"],
  ] as const)("F-012 applies %s locally, appends history, increments revision and queues %s", (action, expectedTask, eventAction, operation) => {
    const next = answer(snapshotWithSession([task("task-1")]), action);

    expect(next.tasks[0]).toMatchObject({ ...expectedTask, revision: 2, updatedAt: now });
    expect(next.actionHistory[0]).toMatchObject({ entityId: "task-1", action: eventAction, occurredAt: now });
    expect(next.notificationOutbox[0]).toMatchObject({ operation, reminderId: "reminder-id", taskRevision: 2, attemptCount: 0, nextAttemptAt: now });
  });

  it("F-014 queues anonymous metadata only, never private task content or a task ID", () => {
    const next = answer(snapshotWithSession([task("task-1")]), "reschedule");
    const outbox = next.notificationOutbox[0]!;

    expect(Object.keys(outbox).sort()).toEqual(["attemptCount", "createdAt", "id", "nextAttemptAt", "notificationType", "operation", "reminderId", "scheduledAt", "taskRevision"]);
    expect(JSON.stringify(outbox)).not.toContain("SECRET_TASK_TITLE");
    expect(JSON.stringify(outbox)).not.toContain("task-1");
    expect(next.reminderMap).toEqual([expect.objectContaining({ reminderId: "reminder-id", taskId: "task-1", taskRevision: 2 })]);
  });
});
