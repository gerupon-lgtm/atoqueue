import { describe, expect, it } from "vitest";
import {
  currentReviewTask,
  goToPreviousTask,
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

  it("F-016 retains every processed task in the completed result", () => {
    const session = {
      ...startReviewSession({ sessionId: "session-1", now, calendar, tasks: [task("first"), task("second")] }),
      answeredTaskIds: ["first", "second"],
      completedAt: now,
    };
    const summary = summarizeReview(session, [
      { id: "event-1", entityType: "task", entityId: "first", action: "task_completed", occurredAt: now },
      { id: "event-2", entityType: "task", entityId: "second", action: "task_rescheduled", occurredAt: now },
    ]);

    expect(summary).toMatchObject({ processedTaskIds: ["first", "second"], actionCounts: { task_completed: 1, task_rescheduled: 1 } });
  });
});
