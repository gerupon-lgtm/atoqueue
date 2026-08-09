import { describe, expect, it } from "vitest";
import {
  currentReviewTask,
  goToNextTask,
  goToPreviousTask,
  refreshReviewSession,
  startReviewSession,
  summarizeReview,
  type ReviewCalendar,
  type Task,
} from "./index";

const now = "2026-08-03T09:00:00.000Z";

const calendar: ReviewCalendar = {
  addDays: (date, days) => {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  },
  addHours: (instant, hours) => new Date(Date.parse(instant) + hours * 3_600_000).toISOString(),
  atTime: (date, hour, minute) => `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  compareInstants: (left, right) => left.localeCompare(right),
  elapsedDays: (from, to) => Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000),
  endOfDay: (date) => `${date}T23:59:00.000Z`,
  isAtOrAfter: (instant, date, hour, minute) => instant >= `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  nextSunday: (date) => {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + ((7 - value.getUTCDay()) % 7));
    return value.toISOString().slice(0, 10);
  },
  nextWeekday: (date, weekday) => {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + ((weekday - value.getUTCDay() + 7) % 7));
    return value.toISOString().slice(0, 10);
  },
  today: (instant) => instant.slice(0, 10),
};

function task(id: string, changes: Partial<Task> = {}): Task {
  return {
    id,
    sourceCaptureId: `capture-${id}`,
    title: `private title ${id}`,
    status: "active",
    dueMode: "none",
    nextReviewAt: "2026-08-03T08:00:00.000Z",
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: now,
    revision: 1,
    ...changes,
  };
}

describe("review session", () => {
  it("F-012 orders due review candidates by overdue duration, neglect, due today, unset and normal review, then creation", () => {
    const value = startReviewSession({
      sessionId: "session-1",
      now,
      calendar,
      tasks: [
        task("normal-later", { createdAt: "2026-07-03T00:00:00.000Z" }),
        task("unset", { dueMode: "unset", nextReviewAt: "2026-08-03T08:00:00.000Z" }),
        task("today", { dueMode: "scheduled", dueAt: "2026-08-03T23:59:00.000Z", nextReviewAt: "2026-08-03T23:59:00.000Z" }),
        task("neglect", { dismissCount: 2, createdAt: "2026-08-02T12:00:00.000Z" }),
        task("overdue-short", { dueMode: "scheduled", dueAt: "2026-08-02T09:00:00.000Z", nextReviewAt: "2026-08-02T09:00:00.000Z" }),
        task("overdue-long", { dueMode: "scheduled", dueAt: "2026-07-25T09:00:00.000Z", nextReviewAt: "2026-07-25T09:00:00.000Z" }),
        task("normal-earlier", { createdAt: "2026-07-02T00:00:00.000Z" }),
      ],
    });

    expect(value.orderedTaskIds).toEqual(["overdue-long", "overdue-short", "neglect", "today", "unset", "normal-earlier", "normal-later"]);
  });

  it("F-009 fixes the ordered IDs and resumes at the persisted index", () => {
    const session = startReviewSession({ sessionId: "session-1", now, calendar, tasks: [task("first"), task("second")] });
    const edited = [task("second", { createdAt: "2000-01-01T00:00:00.000Z" }), task("first")];
    const resumed = { ...session, currentIndex: 1, visitedTaskIds: ["first"], answeredTaskIds: ["first"] };

    expect(session.orderedTaskIds).toEqual(["first", "second"]);
    expect(currentReviewTask({ session: resumed, tasks: edited })).toMatchObject({ id: "second" });
  });

  it("F-010 moves back one item without going below zero", () => {
    const session = startReviewSession({ sessionId: "session-1", now, calendar, tasks: [task("first"), task("second")] });

    expect(goToPreviousTask({ ...session, currentIndex: 1 }, now)).toMatchObject({ currentIndex: 0, updatedAt: now });
    expect(goToPreviousTask(session, now)).toMatchObject({ currentIndex: 0 });
  });

  it("refreshes an unfinished session with newly eligible tasks without losing progress", () => {
    const original = {
      ...startReviewSession({
        sessionId: "session-1",
        now,
        calendar,
        tasks: [task("first")],
      }),
      visitedTaskIds: ["first"],
    };

    const refreshed = refreshReviewSession({
      session: original,
      now,
      calendar,
      tasks: [task("first"), task("new-today")],
    });

    expect(refreshed).toMatchObject({
      orderedTaskIds: ["first", "new-today"],
      visitedTaskIds: ["first"],
      updatedAt: now,
    });
  });

  it("moves to the next available task and wraps so skipped items remain reachable", () => {
    const tasks = [task("first"), task("second")];
    const session = startReviewSession({ sessionId: "session-1", now, calendar, tasks });

    expect(goToNextTask(session, tasks, now)).toMatchObject({ currentIndex: 1 });
    expect(goToNextTask({ ...session, currentIndex: 1 }, tasks, now)).toMatchObject({
      currentIndex: 0,
    });
  });

  it("F-009 skips stale unvisited completed and archived IDs when resuming", () => {
    const session = {
      ...startReviewSession({ sessionId: "session-1", now, calendar, tasks: [task("done"), task("archived"), task("active")] }),
      currentIndex: 0,
    };

    expect(currentReviewTask({
      session,
      tasks: [task("done", { status: "completed", completedAt: now }), task("archived", { status: "archived", archivedAt: now }), task("active")],
    })).toMatchObject({ id: "active" });
  });

  it("F-012 suppresses a dismissed overdue task until its next review time", () => {
    const dismissedOverdue = task("dismissed-overdue", {
      dueMode: "scheduled",
      dueAt: "2026-08-02T23:59:00.000Z",
      nextReviewAt: "2026-08-04T18:00:00.000Z",
      dismissCount: 1,
    });

    expect(startReviewSession({ sessionId: "before", now, calendar, tasks: [dismissedOverdue] }).orderedTaskIds).toEqual([]);
    expect(startReviewSession({
      sessionId: "at",
      now: "2026-08-04T18:00:00.000Z",
      calendar,
      tasks: [dismissedOverdue],
    }).orderedTaskIds).toEqual(["dismissed-overdue"]);
  });

  it("F-008 suppresses a third unset-due prompt until its weekly review and keeps due-today tasks eligible", () => {
    const weeklyUnset = task("weekly-unset", {
      dueMode: "unset",
      undecidedCount: 2,
      nextReviewAt: "2026-08-09T18:00:00.000Z",
    });
    const dueToday = task("due-today", {
      dueMode: "scheduled",
      dueAt: "2026-08-03T23:59:00.000Z",
      nextReviewAt: "2026-08-03T23:59:00.000Z",
    });

    expect(startReviewSession({ sessionId: "before", now, calendar, tasks: [weeklyUnset, dueToday] }).orderedTaskIds).toEqual(["due-today"]);
    expect(startReviewSession({
      sessionId: "at",
      now: "2026-08-09T18:00:00.000Z",
      calendar,
      tasks: [weeklyUnset],
    }).orderedTaskIds).toEqual(["weekly-unset"]);
  });

  it("F-012 suppresses a dismissed due-today task until its future next review", () => {
    const dismissedToday = task("dismissed-today", {
      dueMode: "scheduled",
      dueAt: "2026-08-03T23:59:00.000Z",
      nextReviewAt: "2026-08-04T18:00:00.000Z",
      dismissCount: 1,
    });

    expect(startReviewSession({ sessionId: "before", now, calendar, tasks: [dismissedToday] }).orderedTaskIds).toEqual([]);
    expect(startReviewSession({
      sessionId: "at",
      now: "2026-08-04T18:00:00.000Z",
      calendar,
      tasks: [dismissedToday],
    }).orderedTaskIds).toEqual(["dismissed-today"]);
  });

  it("F-012 orders equally eligible neglected tasks by their derived neglect level", () => {
    const value = startReviewSession({
      sessionId: "session-1",
      now,
      calendar,
      tasks: [
        task("less-neglected", { dismissCount: 1 }),
        task("more-neglected", { dismissCount: 2 }),
      ],
    });

    expect(value.orderedTaskIds).toEqual(["more-neglected", "less-neglected"]);
  });

  it("F-012 excludes active tasks which are not eligible for any review group", () => {
    const futureTask = task("future", {
      dueMode: "scheduled",
      dueAt: "2026-08-04T23:59:00.000Z",
      nextReviewAt: "2026-08-03T08:00:00.000Z",
    });

    expect(startReviewSession({ sessionId: "session-1", now, calendar, tasks: [futureTask] }).orderedTaskIds).toEqual([]);
  });

  it("F-016 retains every processed task in the completed result", () => {
    const session = {
      ...startReviewSession({ sessionId: "session-1", now, calendar, tasks: [task("first"), task("second")] }),
      answeredTaskIds: ["first", "second"],
      actionEventIds: ["event-1", "event-2"],
      completedAt: now,
    };
    const summary = summarizeReview(session, [
      { id: "event-1", entityType: "task", entityId: "first", action: "task_completed", occurredAt: now },
      { id: "event-2", entityType: "task", entityId: "second", action: "task_rescheduled", occurredAt: now },
    ]);

    expect(summary).toMatchObject({ processedTaskIds: ["first", "second"], actionCounts: { task_completed: 1, task_rescheduled: 1 } });
  });

  it("F-016 summarizes only this session's actions, including every in-session re-answer", () => {
    const session = {
      ...startReviewSession({ sessionId: "session-1", now, calendar, tasks: [task("first")] }),
      answeredTaskIds: ["first"],
      actionEventIds: ["answer", "re-answer"],
    };
    const summary = summarizeReview(session, [
      { id: "historical", entityType: "task", entityId: "first", action: "task_archived", occurredAt: "2026-08-03T09:00:30.000Z" },
      { id: "answer", entityType: "task", entityId: "first", action: "task_completed", occurredAt: now },
      { id: "re-answer", entityType: "task", entityId: "first", action: "task_rescheduled", occurredAt: "2026-08-03T09:01:00.000Z" },
      { id: "unprocessed", entityType: "task", entityId: "other", action: "task_completed", occurredAt: "2026-08-03T09:02:00.000Z" },
    ]);

    expect(summary.actionCounts).toEqual({ task_completed: 1, task_rescheduled: 1 });
  });
});
