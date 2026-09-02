import { describe, expect, it } from "vitest";
import { isTaskOverdue, listTasks, type Capture, type Task } from "./index";

const now = "2026-08-03T09:00:00.000Z";
const calendar = { today: (instant: string) => instant.slice(0, 10) };

function task(id: string, changes: Partial<Task> = {}): Task {
  return {
    id,
    sourceCaptureId: `capture-${id}`,
    title: id,
    status: "active",
    dueMode: "none",
    nextReviewAt: "2026-08-10T18:00:00.000Z",
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: now,
    revision: 1,
    ...changes,
  };
}

describe("listTasks", () => {
  it.each([
    ["past active deadline", { dueMode: "scheduled", dueAt: "2026-08-03T08:59:59.999Z" }, true],
    ["exact deadline", { dueMode: "scheduled", dueAt: now }, false],
    ["future deadline", { dueMode: "scheduled", dueAt: "2026-08-03T09:00:00.001Z" }, false],
    ["completed", { dueMode: "scheduled", dueAt: "2026-08-02T09:00:00.000Z", status: "completed" }, false],
    ["archived", { dueMode: "scheduled", dueAt: "2026-08-02T09:00:00.000Z", status: "archived" }, false],
    ["unset", { dueMode: "unset" }, false],
    ["none", { dueMode: "none" }, false],
    ["dismissed but overdue", { dueMode: "scheduled", dueAt: "2026-08-02T09:00:00.000Z", dismissCount: 1, nextReviewAt: "2026-09-01T09:00:00.000Z" }, true],
  ] as const)("F-012 derives overdue emphasis for %s", (_name, changes, expected) => {
    expect(isTaskOverdue(task("test", changes), now)).toBe(expected);
  });

  it("keeps the selected active, completed, or archived tab separate", () => {
    const tasks = [
      task("active"),
      task("completed", { status: "completed", completedAt: now }),
      task("archived", { status: "archived", archivedAt: now }),
    ];

    expect(listTasks(tasks, { tab: "active", now, calendar }).map(({ id }) => id)).toEqual(["active"]);
    expect(listTasks(tasks, { tab: "completed", now, calendar }).map(({ id }) => id)).toEqual(["completed"]);
    expect(listTasks(tasks, { tab: "archived", now, calendar }).map(({ id }) => id)).toEqual(["archived"]);
  });

  it("shows active, completed, and archived tasks together when every state is selected", () => {
    const tasks = [
      task("active"),
      task("completed", { status: "completed", completedAt: now }),
      task("archived", { status: "archived", archivedAt: now }),
    ];

    expect(listTasks(tasks, { tab: "all", now, calendar }).map(({ id }) => id)).toEqual(["active", "completed", "archived"]);
  });

  it("filters active tasks by overdue, today, unset, none, and category", () => {
    const tasks = [
      task("overdue", { dueMode: "scheduled", dueAt: "2026-08-02T23:59:00.000Z" }),
      task("today", { dueMode: "scheduled", dueAt: "2026-08-03T23:59:00.000Z" }),
      task("unset", { dueMode: "unset" }),
      task("none", { dueMode: "none", category: "home" }),
    ];
    const input = { tab: "active" as const, now, calendar };

    expect(listTasks(tasks, { ...input, due: "overdue" }).map(({ id }) => id)).toEqual(["overdue"]);
    expect(listTasks(tasks, { ...input, due: "today" }).map(({ id }) => id)).toEqual(["today"]);
    expect(listTasks(tasks, { ...input, due: "unset" }).map(({ id }) => id)).toEqual(["unset"]);
    expect(listTasks(tasks, { ...input, due: "none" }).map(({ id }) => id)).toEqual(["none"]);
    expect(listTasks(tasks, { ...input, category: "home" }).map(({ id }) => id)).toEqual(["none"]);
  });

  it("derives the overdue filter only for active tasks", () => {
    const overdue = {
      dueMode: "scheduled" as const,
      dueAt: "2026-08-02T23:59:00.000Z",
    };
    const tasks = [
      task("active", overdue),
      task("completed", { ...overdue, status: "completed", completedAt: now }),
      task("archived", { ...overdue, status: "archived", archivedAt: now }),
    ];

    expect(
      listTasks(tasks, { tab: "all", due: "overdue", now, calendar }).map(
        ({ id }) => id,
      ),
    ).toEqual(["active"]);
    expect(
      listTasks(tasks, { tab: "completed", due: "overdue", now, calendar }),
    ).toEqual([]);
  });

  it("finds a Unicode substring without changing the selected task state", () => {
    const tasks = [task("match", { title: "買い物：牛乳" }), task("other", { title: "会議資料" })];

    expect(listTasks(tasks, { tab: "active", now, calendar, search: "牛乳" }).map(({ id }) => id)).toEqual(["match"]);
    expect(listTasks([...tasks, task("old", { title: "牛乳", status: "completed", completedAt: now })], { tab: "active", now, calendar, search: "牛乳" }).map(({ id }) => id)).toEqual(["match"]);
  });

  it("finds a Unicode substring in the source capture body", () => {
    const tasks = [task("source-match", { title: "確認する" }), task("other", { title: "会議資料" })];
    const captures: Capture[] = [
      { id: "capture-source-match", body: "牛乳を忘れずに買う", classification: "task", createdAt: now, updatedAt: now, linkedTaskId: "source-match" },
      { id: "capture-other", body: "議事録", classification: "task", createdAt: now, updatedAt: now, linkedTaskId: "other" },
    ];

    expect(listTasks(tasks, { tab: "active", now, calendar, search: "牛乳" }, captures).map(({ id }) => id)).toEqual(["source-match"]);
  });

  it("uses the injected local calendar instead of the UTC ISO date for the today filter", () => {
    const localDay = { today: () => "2026-08-03" };
    const tasks = [task("local-today", { dueMode: "scheduled", dueAt: "2026-08-02T15:30:00.000Z" })];

    expect(listTasks(tasks, { tab: "active", now, calendar: localDay, due: "today" }).map(({ id }) => id)).toEqual(["local-today"]);
  });

  it("sorts stably by next review, then due time, then creation time", () => {
    const tasks = [
      task("created-later", { nextReviewAt: "2026-08-04T18:00:00.000Z", dueMode: "scheduled", dueAt: "2026-08-05T23:59:00.000Z", createdAt: "2026-08-02T00:00:00.000Z" }),
      task("due-earlier", { nextReviewAt: "2026-08-04T18:00:00.000Z", dueMode: "scheduled", dueAt: "2026-08-04T23:59:00.000Z", createdAt: "2026-08-03T00:00:00.000Z" }),
      task("review-earlier", { nextReviewAt: "2026-08-03T18:00:00.000Z" }),
      task("created-earlier", { nextReviewAt: "2026-08-04T18:00:00.000Z", dueMode: "scheduled", dueAt: "2026-08-05T23:59:00.000Z", createdAt: "2026-08-01T00:00:00.000Z" }),
    ];

    expect(listTasks(tasks, { tab: "active", now, calendar }).map(({ id }) => id)).toEqual([
      "review-earlier", "due-earlier", "created-earlier", "created-later",
    ]);
  });
});
