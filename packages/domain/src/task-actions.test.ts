import { describe, expect, it } from "vitest";
import {
  answerReview,
  createEmptySnapshot,
  findNextReviewIndex,
  modifyTask,
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
  it.each([
    ["complete", {}, { status: "completed", completedAt: now }, "task_completed", "cancel"],
    ["reopen", {}, { status: "active" }, "task_reopened", "upsert"],
    ["reschedule", { due: { dueMode: "scheduled", dueAt: "2026-08-10T23:59:00.000Z", nextReviewAt: "2026-08-10T23:59:00.000Z" } }, { status: "active", dueAt: "2026-08-10T23:59:00.000Z" }, "task_rescheduled", "upsert"],
    ["no_due", {}, { dueMode: "none" }, "task_marked_no_due", "upsert"],
    ["dismiss", {}, { status: "active", dismissCount: 1 }, "task_dismissed", "upsert"],
    ["archive", {}, { status: "archived", archivedAt: now }, "task_archived", "cancel"],
    ["edit", { title: "new title", category: "home" }, { title: "new title", category: "home" }, "task_edited", "upsert"],
  ] as const)("F-015 changes a task directly with %s and keeps its anonymous sync record", (change, extra, expected, action, operation) => {
    const initial = {
      ...snapshotWithSession([task("task-1", { status: change === "reopen" ? "completed" : "active", completedAt: change === "reopen" ? now : undefined })]),
      reminderMap: [{ reminderId: "reminder-1", taskId: "task-1", taskRevision: 1, createdAt: now }],
    };

    const next = modifyTask({
      snapshot: initial,
      taskId: "task-1",
      change: { type: change, ...extra } as never,
      now,
      calendar,
      idFactory: (kind) => `${kind}-id`,
    });

    expect(next.tasks[0]).toMatchObject({ ...expected, revision: 2, updatedAt: now });
    expect(next.actionHistory.at(-1)).toMatchObject({ entityId: "task-1", action, occurredAt: now });
    expect(next.notificationOutbox.at(-1)).toMatchObject({ operation, reminderId: "reminder-1", taskRevision: 2 });
    expect(JSON.stringify(next.notificationOutbox.at(-1))).not.toContain("SECRET_TASK_TITLE");
    expect(JSON.stringify(next.notificationOutbox.at(-1))).not.toContain("task-1");
  });

  it("F-015 removes an existing category when the direct edit selects no category", () => {
    const initial = snapshotWithSession([task("task-1", { category: "work" })]);

    const next = modifyTask({
      snapshot: initial,
      taskId: "task-1",
      change: { type: "edit", category: null },
      now,
      calendar,
      idFactory: (kind) => `${kind}-id`,
    });

    expect("category" in next.tasks[0]!).toBe(false);
    expect(next.actionHistory.at(-1)?.after).toMatchObject({ category: undefined });
  });

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

  it("F-016 records every new action event ID on its owning review session", () => {
    let actionNumber = 0;
    const first = answerReview({
      snapshot: snapshotWithSession([task("first"), task("second")]),
      sessionId: "session-1",
      answer: "complete",
      now,
      calendar,
      idFactory: (kind) => kind === "action" ? `event-${++actionNumber}` : `${kind}-id`,
    });
    const revisiting = { ...first, reviewSessions: [{ ...first.reviewSessions[0]!, currentIndex: 0 }] };
    const reanswered = answerReview({
      snapshot: revisiting,
      sessionId: "session-1",
      answer: "reschedule",
      now,
      calendar,
      due: { dueMode: "scheduled", dueAt: "2026-08-10T23:59:00.000Z", nextReviewAt: "2026-08-10T23:59:00.000Z" },
      idFactory: (kind) => kind === "action" ? `event-${++actionNumber}` : `${kind}-id`,
    });

    expect(reanswered.reviewSessions[0]!.actionEventIds).toEqual(["event-1", "event-2"]);
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

  it("F-012 removes a scheduled dueAt entirely when no due is chosen", () => {
    const next = answer(snapshotWithSession([task("task-1")]), "no_due");

    expect(next.tasks[0]).toMatchObject({ dueMode: "none" });
    expect("dueAt" in next.tasks[0]!).toBe(false);
  });

  it("F-014 queues anonymous metadata only, never private task content or a task ID", () => {
    const next = answer(snapshotWithSession([task("task-1")]), "reschedule");
    const outbox = next.notificationOutbox[0]!;

    expect(Object.keys(outbox).sort()).toEqual(["attemptCount", "createdAt", "id", "nextAttemptAt", "notificationType", "operation", "reminderId", "scheduledAt", "taskRevision"]);
    expect(JSON.stringify(outbox)).not.toContain("SECRET_TASK_TITLE");
    expect(JSON.stringify(outbox)).not.toContain("task-1");
    expect(next.reminderMap).toEqual([expect.objectContaining({ reminderId: "reminder-id", taskId: "task-1", taskRevision: 2 })]);
  });

  it("F-009 completes a resumed session when every remaining task became stale", () => {
    const initial = snapshotWithSession([task("task-1")]);
    const stale = {
      ...initial,
      tasks: [task("task-1", { status: "completed", completedAt: now })],
      reviewSessions: [
        initial.reviewSessions[0]!,
        { ...initial.reviewSessions[0]!, id: "other-session" },
      ],
    };

    const next = answer(stale, "dismiss");

    expect(next.reviewSessions[0]).toMatchObject({ currentIndex: 1, completedAt: now });
    expect(next.actionHistory).toEqual([]);
    expect(next.notificationOutbox).toEqual([]);
  });

  it.each([
    ["is missing", (snapshot: AppSnapshot) => ({ ...snapshot, reviewSessions: [] })],
    ["is already complete", (snapshot: AppSnapshot) => ({
      ...snapshot,
      reviewSessions: [{ ...snapshot.reviewSessions[0]!, completedAt: now }],
    })],
  ] as const)("F-009 rejects an answer when the review session %s", (_reason, prepare) => {
    expect(() => answer(prepare(snapshotWithSession([task("task-1")])), "dismiss")).toThrow();
  });

  it("F-012 rejects an explicit reschedule without a scheduled date", () => {
    expect(() => answerReview({
      snapshot: snapshotWithSession([task("task-1")]),
      sessionId: "session-1",
      answer: "reschedule",
      now,
      calendar,
      idFactory: (kind) => `${kind}-id`,
    })).toThrow("Rescheduling requires a scheduled due date.");
  });

  it("F-009 returns the terminal index when no review tasks remain", () => {
    const session = startReviewSession({ sessionId: "session-1", now, calendar, tasks: [task("task-1")] });

    expect(findNextReviewIndex(session, [task("task-1", { status: "archived", archivedAt: now })], 0)).toBe(1);
  });

  it("F-012 uses a local random ID generator when no test ID factory is supplied", () => {
    const next = answerReview({
      snapshot: snapshotWithSession([task("task-1")]),
      sessionId: "session-1",
      answer: "dismiss",
      now,
      calendar,
    });

    expect(next.actionHistory[0]!.id).toEqual(expect.any(String));
    expect(next.notificationOutbox[0]!.id).toEqual(expect.any(String));
    expect(next.reminderMap[0]!.reminderId).toEqual(expect.any(String));
  });

  it("F-012 updates only the matching local session and reminder mapping", () => {
    const initial = snapshotWithSession([task("task-1")]);
    const snapshot: AppSnapshot = {
      ...initial,
      reviewSessions: [initial.reviewSessions[0]!, { ...initial.reviewSessions[0]!, id: "other-session" }],
      reminderMap: [
        { reminderId: "other-reminder", taskId: "other-task", taskRevision: 1, createdAt: now },
        { reminderId: "task-reminder", taskId: "task-1", taskRevision: 1, createdAt: "2026-08-01T00:00:00.000Z" },
      ],
    };

    const next = answer(snapshot, "dismiss");

    expect(next.reviewSessions[1]).toEqual({ ...initial.reviewSessions[0], id: "other-session" });
    expect(next.reminderMap).toEqual([
      { reminderId: "other-reminder", taskId: "other-task", taskRevision: 1, createdAt: now },
      expect.objectContaining({ reminderId: "task-reminder", taskId: "task-1", taskRevision: 2, createdAt: "2026-08-01T00:00:00.000Z" }),
    ]);
  });

  it("F-014 uses generic unset-due metadata for an unset task", () => {
    const unset = task("task-1", { dueMode: "unset" });
    delete unset.dueAt;

    const next = answer(snapshotWithSession([unset]), "dismiss");

    expect(next.notificationOutbox[0]).toMatchObject({ notificationType: "unset_due_review" });
  });

  it("keeps an earlier skipped task open when the last visible task is answered", () => {
    const initial = snapshotWithSession([task("first"), task("second")]);
    const skipped = {
      ...initial,
      reviewSessions: [{ ...initial.reviewSessions[0]!, currentIndex: 1 }],
    };

    const next = answerReview({
      snapshot: skipped,
      sessionId: "session-1",
      answer: "dismiss",
      now,
      calendar,
      idFactory: (kind) => `${kind}-id`,
    });

    expect(next.reviewSessions[0]).toMatchObject({
      currentIndex: 0,
      answeredTaskIds: ["second"],
    });
    expect(next.reviewSessions[0]?.completedAt).toBeUndefined();
  });

  it("F-014 cancels every anonymous reminder for a completed task without exposing task data", () => {
    const initial = snapshotWithSession([task("task-1", { dueAt: "2026-08-10T23:59:00.000Z", nextReviewAt: "2026-08-10T23:59:00.000Z" })]);
    initial.settings.notificationEnabled = true;
    initial.reminderMap = [
      { reminderId: "initial-reminder", taskId: "task-1", kind: "initial", taskRevision: 1, createdAt: now },
      { reminderId: "early-reminder", taskId: "task-1", kind: "deadline_before", taskRevision: 1, createdAt: now },
      { reminderId: "deadline-reminder", taskId: "task-1", kind: "review", taskRevision: 1, createdAt: now },
    ];

    const next = answer(initial, "complete");

    expect(next.reminderMap).toEqual([]);
    expect(next.notificationOutbox).toHaveLength(3);
    expect(next.notificationOutbox.every((item) => item.operation === "cancel")).toBe(true);
    expect(JSON.stringify(next.notificationOutbox)).not.toContain("SECRET_TASK_TITLE");
    expect(JSON.stringify(next.notificationOutbox)).not.toContain("task-1");
  });
});
