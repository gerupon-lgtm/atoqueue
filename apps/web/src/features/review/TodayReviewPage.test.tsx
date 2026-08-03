// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptySnapshot, startReviewSession, type AppRepository, type AppSnapshot, type ReviewCalendar, type Task } from "../../../../../packages/domain/src";
import { TodayReviewPage } from "./TodayReviewPage";

const now = "2026-08-03T09:00:00.000Z";
const calendar: ReviewCalendar = {
  addDays: (date, days) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10),
  addHours: (instant, hours) => new Date(Date.parse(instant) + hours * 3_600_000).toISOString(),
  atTime: (date, hour, minute) => `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  compareInstants: (left, right) => left.localeCompare(right),
  elapsedDays: (from, to) => Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000),
  endOfDay: (date) => `${date}T23:59:00.000Z`,
  isAtOrAfter: (instant, date, hour, minute) => instant >= `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  nextSunday: (date) => date,
  nextWeekday: (date) => date,
  today: (instant) => instant.slice(0, 10),
};

function task(id: string, changes: Partial<Task> = {}): Task {
  return {
    id,
    sourceCaptureId: `capture-${id}`,
    title: `タスク ${id}`,
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

function repositoryWithSession(tasks: Task[]): AppRepository {
  let snapshot: AppSnapshot = createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "device-1", timeZone: "UTC", now });
  snapshot = { ...snapshot, tasks, reviewSessions: [startReviewSession({ sessionId: "session-1", now, calendar, tasks })] };
  return {
    load: async () => snapshot,
    save: async (next) => { snapshot = next; },
    loadDraft: async () => "",
    saveDraft: async () => undefined,
    clearDraft: async () => undefined,
  };
}

function repositoryWithSnapshot(initial: AppSnapshot): AppRepository {
  let snapshot = initial;
  return {
    load: async () => snapshot,
    save: async (next) => { snapshot = next; },
    loadDraft: async () => "",
    saveDraft: async () => undefined,
    clearDraft: async () => undefined,
  };
}

describe("TodayReviewPage", () => {
  afterEach(cleanup);

  it("F-012 centers 今日の確認 in a three-column header and disables ← 前のタスク on the first item", async () => {
    render(<TodayReviewPage calendar={calendar} now={() => now} repository={repositoryWithSession([task("one"), task("two")])} />);

    expect(await screen.findByRole("heading", { name: "今日の確認" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "← 前のタスク" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("review-header").classList.contains("reviewHeader")).toBe(true);
    expect(screen.getByText("タスク one")).toBeTruthy();
  });

  it("F-012 advances immediately after an answer, then lets the previous task be answered again", async () => {
    const repository = repositoryWithSession([task("one"), task("two")]);
    render(<TodayReviewPage calendar={calendar} now={() => now} repository={repository} />);

    await screen.findByText("タスク one");
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    expect(await screen.findByText("タスク two")).toBeTruthy();
    expect((screen.getByRole("button", { name: "← 前のタスク" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "← 前のタスク" }));
    expect(await screen.findByText("タスク one")).toBeTruthy();
    expect(screen.getByText("現在: 完了")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "期限なし" }));

    await waitFor(async () => {
      const snapshot = await repository.load();
      expect(snapshot.tasks.find((candidate) => candidate.id === "one")).toMatchObject({ dueMode: "none", status: "active" });
      expect(snapshot.actionHistory.map((event) => event.action)).toEqual(["task_completed", "task_marked_no_due"]);
    });
  });

  it("F-012 resets a date-change sheet after task navigation so a returned task can be answered", async () => {
    const repository = repositoryWithSession([task("one"), task("two"), task("three")]);
    render(<TodayReviewPage calendar={calendar} now={() => now} repository={repository} />);

    await screen.findByText("タスク one");
    fireEvent.click(screen.getByRole("button", { name: "完了" }));
    await screen.findByText("タスク two");
    fireEvent.click(screen.getByRole("button", { name: "日付を変える" }));
    fireEvent.change(screen.getByLabelText("新しい期限"), { target: { value: "2026-08-10" } });
    fireEvent.click(screen.getByRole("button", { name: "この日付にする" }));
    await screen.findByText("タスク three");

    fireEvent.click(screen.getByRole("button", { name: "← 前のタスク" }));
    await screen.findByText("タスク two");
    fireEvent.click(screen.getByRole("button", { name: "← 前のタスク" }));
    await screen.findByText("タスク one");
    expect(screen.getByRole("button", { name: "期限なし" })).toBeTruthy();
  });

  it("F-012 displays the exact empty-state copy when no task is reviewable", async () => {
    render(<TodayReviewPage calendar={calendar} now={() => now} repository={repositoryWithSession([])} />);

    expect(await screen.findByText("今日確認するものはありません。記録したことは受信箱やタスク一覧からいつでも見直せます")).toBeTruthy();
  });

  it("F-012 completes an empty stale session and computes fresh candidates that appeared later", async () => {
    const initial = createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "device-1", timeZone: "UTC", now });
    const repository = repositoryWithSnapshot({
      ...initial,
      tasks: [task("later")],
      reviewSessions: [{ id: "empty-session", localDate: "2026-08-03", orderedTaskIds: [], currentIndex: 0, visitedTaskIds: [], answeredTaskIds: [], actionEventIds: [], startedAt: "2026-08-03T08:00:00.000Z", updatedAt: "2026-08-03T08:00:00.000Z" }],
    });

    render(<TodayReviewPage calendar={calendar} createId={() => "fresh-session"} now={() => now} repository={repository} />);

    expect(await screen.findByText("タスク later")).toBeTruthy();
    await waitFor(async () => {
      const persisted = await repository.load();
      expect(persisted.reviewSessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "empty-session", completedAt: now }),
        expect.objectContaining({ id: "fresh-session", orderedTaskIds: ["later"] }),
      ]));
    });
  });

  it.each([
    ["task_rescheduled", { dueMode: "scheduled", dueAt: "2026-08-03T23:59:00.000Z" }, "今日やる"],
    ["task_rescheduled", { dueMode: "scheduled", dueAt: "2026-08-10T23:59:00.000Z" }, "日付を変えた"],
    ["task_marked_no_due", { dueMode: "none" }, "期限なし"],
    ["task_dismissed", { dueMode: "scheduled", dueAt: "2026-08-02T23:59:00.000Z" }, "今回は閉じる"],
  ] as const)("F-015 shows the latest session-owned %s answer rather than a generic task status", async (action, changes, label) => {
    const initial = createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "device-1", timeZone: "UTC", now });
    const current = task("one", changes);
    const repository = repositoryWithSnapshot({
      ...initial,
      tasks: [current],
      reviewSessions: [{ id: "session-1", localDate: "2026-08-03", orderedTaskIds: ["one"], currentIndex: 0, visitedTaskIds: ["one"], answeredTaskIds: ["one"], actionEventIds: ["event-1"], startedAt: now, updatedAt: now }],
      actionHistory: [{ id: "event-1", entityType: "task", entityId: "one", action, after: { dueAt: current.dueAt, dueMode: current.dueMode }, occurredAt: now }],
    });

    render(<TodayReviewPage calendar={calendar} now={() => now} repository={repository} />);

    expect(await screen.findByText(`現在: ${label}`)).toBeTruthy();
  });
});
