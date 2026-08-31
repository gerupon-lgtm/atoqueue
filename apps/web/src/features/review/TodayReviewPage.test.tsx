// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  answerReview,
  createEmptySnapshot,
  modifyTask,
  startReviewSession,
  type AppRepository,
  type AppSnapshot,
  type ReviewCalendar,
  type Task,
} from "../../../../../packages/domain/src";
import { TodayReviewPage } from "./TodayReviewPage";

const now = "2026-08-03T09:00:00.000Z";
const calendar: ReviewCalendar = {
  addDays: (date, days) =>
    new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
      .toISOString()
      .slice(0, 10),
  addHours: (instant, hours) =>
    new Date(Date.parse(instant) + hours * 3_600_000).toISOString(),
  atTime: (date, hour, minute) =>
    `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  compareInstants: (left, right) => left.localeCompare(right),
  elapsedDays: (from, to) =>
    Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000),
  endOfDay: (date) => `${date}T23:59:00.000Z`,
  isAtOrAfter: (instant, date, hour, minute) =>
    instant >=
    `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
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
  let snapshot: AppSnapshot = createEmptySnapshot({
    appVersion: "0.1.0",
    localDeviceId: "device-1",
    timeZone: "UTC",
    now,
  });
  snapshot = {
    ...snapshot,
    tasks,
    reviewSessions: [
      startReviewSession({ sessionId: "session-1", now, calendar, tasks }),
    ],
  };
  return {
    load: async () => snapshot,
    save: async (next) => {
      snapshot = next;
    },
    loadDraft: async () => "",
    saveDraft: async () => undefined,
    clearDraft: async () => undefined,
  };
}

function repositoryWithSnapshot(initial: AppSnapshot): AppRepository {
  let snapshot = initial;
  return {
    load: async () => snapshot,
    save: async (next) => {
      snapshot = next;
    },
    loadDraft: async () => "",
    saveDraft: async () => undefined,
    clearDraft: async () => undefined,
  };
}

describe("TodayReviewPage", () => {
  afterEach(cleanup);

  it.each(["complete", "archive"] as const)("F-010 shows the current active state after a reviewed %s is reopened elsewhere", async (answer) => {
    const repository = repositoryWithSession([task("one"), task("two")]);
    const answered = answerReview({ snapshot: await repository.load(), sessionId: "session-1", answer, now, calendar });
    const reopened = modifyTask({ snapshot: answered, taskId: "one", change: { type: "reopen" }, now, calendar });
    await repository.save({ ...reopened, reviewSessions: [{ ...reopened.reviewSessions[0]!, currentIndex: 0 }] });
    render(<TodayReviewPage calendar={calendar} now={() => now} repository={repository} />);
    await screen.findByText("タスク one");
    expect(screen.getByText("対応中", { selector: "strong" })).toBeTruthy();
    expect(screen.queryByText("このタスクは完了マーク済みです。")).toBeNull();
    expect(screen.queryByText("このタスクはアーカイブマーク済みです。")).toBeNull();
  });

  it("F-009 keeps four history cards and their progress aligned after three direct status changes", async () => {
    const repository = repositoryWithSession([task("one"), task("two"), task("three"), task("four")]);
    let snapshot = await repository.load();
    for (const [taskId, type] of [["one", "complete"], ["three", "archive"], ["four", "complete"]] as const) {
      snapshot = modifyTask({ snapshot, taskId, change: { type }, now, calendar, idFactory: (kind) => `${taskId}-${kind}` });
    }
    await repository.save(snapshot);
    const clock = () => now;
    const renderPage = () => render(<TodayReviewPage calendar={calendar} now={clock} repository={repository} />);
    let view = renderPage();
    await screen.findByText("タスク two");
    expect(screen.getByTestId("review-progress").textContent).toBe("2 / 4");
    fireEvent.click(screen.getByRole("button", { name: "前のタスク" }));
    await screen.findByText("タスク one");
    expect(screen.getByTestId("review-progress").textContent).toBe("1 / 4");
    expect(screen.getByText("このタスクは完了マーク済みです。")).toBeTruthy();
    expect(screen.getByText("完了", { selector: "strong" }).className).toContain("--completed");
    for (const [id, progress] of [["two", "2 / 4"], ["three", "3 / 4"], ["four", "4 / 4"], ["one", "1 / 4"]]) {
      fireEvent.click(screen.getByRole("button", { name: "次のタスク" }));
      await screen.findByText(`タスク ${id}`);
      expect(screen.getByTestId("review-progress").textContent).toBe(progress);
      if (id === "three") {
        expect(screen.getByText("このタスクはアーカイブマーク済みです。")).toBeTruthy();
        expect(screen.getByText("アーカイブ", { selector: "strong" }).className).toContain("--archived");
      }
    }
    const browsed = await repository.load();
    expect(browsed.actionHistory).toEqual(snapshot.actionHistory);
    expect(browsed.tasks).toEqual(snapshot.tasks);
    expect(browsed.notificationOutbox).toEqual(snapshot.notificationOutbox);
    expect(browsed.reminderMap).toEqual(snapshot.reminderMap);
    expect(browsed.reviewSessions[0]!.answeredTaskIds).toEqual(snapshot.reviewSessions[0]!.answeredTaskIds);
    expect(browsed.reviewSessions[0]!.actionEventIds).toEqual(snapshot.reviewSessions[0]!.actionEventIds);
    view.unmount();
    view = renderPage();
    await screen.findByText("タスク two");
    expect(screen.getByTestId("review-progress").textContent).toBe("2 / 4");
    fireEvent.click(screen.getByRole("button", { name: "前のタスク" }));
    await screen.findByText("タスク one");
    fireEvent.click(screen.getByRole("button", { name: "期限なし" }));
    await screen.findByText("タスク two");
    expect((await repository.load()).tasks[0]).toMatchObject({ id: "one", status: "active", dueMode: "none" });
    expect((await repository.load()).tasks[1]).toEqual(snapshot.tasks[1]);
    view.unmount();
  });

  it("F-012 omits the previous action until there is a task to return to and keeps progress inside the card", async () => {
    render(
      <TodayReviewPage
        calendar={calendar}
        now={() => now}
        repository={repositoryWithSession([task("one"), task("two")])}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "今日の確認" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "前のタスク" })).toBeNull();
    expect(
      screen.getByTestId("review-header").classList.contains("reviewHeader"),
    ).toBe(true);
    expect(
      screen.getByTestId("review-progress").closest(".reviewTaskCard"),
    ).not.toBeNull();
    expect(screen.getByText("タスク one")).toBeTruthy();
    expect(screen.getByRole("button", { name: "アーカイブ" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "不要" })).toBeNull();
  });

  it("F-009 shows the current task category inside the review card", async () => {
    render(
      <TodayReviewPage
        calendar={calendar}
        now={() => now}
        repository={repositoryWithSession([
          task("shopping", { category: "shopping" }),
        ])}
      />,
    );

    expect(
      (await screen.findByLabelText("現在のカテゴリ")).textContent,
    ).toBe("カテゴリ: 買い物");
    expect(
      screen.getByLabelText("現在のカテゴリ").closest(".reviewTaskCard"),
    ).not.toBeNull();
  });

  it("F-012 advances immediately after an answer, then lets the previous task be answered again", async () => {
    const repository = repositoryWithSession([task("one"), task("two")]);
    render(
      <TodayReviewPage
        calendar={calendar}
        now={() => now}
        repository={repository}
      />,
    );

    await screen.findByText("タスク one");
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    expect(await screen.findByText("タスク two")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "前のタスク" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "前のタスク" }));
    expect(await screen.findByText("タスク one")).toBeTruthy();
    expect(screen.getByText("このタスクは完了マーク済みです。")).toBeTruthy();
    expect(
      screen.queryByText(
        "少し時間が経っています。今日やるか、日付を変えましょう",
      ),
    ).toBeNull();
    expect(screen.getByText("現在：")).toBeTruthy();
    expect(screen.getByText("完了", { selector: "strong" }).className).toContain(
      "reviewCurrentStatus__value--completed",
    );
    fireEvent.click(screen.getByRole("button", { name: "期限なし" }));

    await waitFor(async () => {
      const snapshot = await repository.load();
      expect(
        snapshot.tasks.find((candidate) => candidate.id === "one"),
      ).toMatchObject({ dueMode: "none", status: "active" });
      expect(snapshot.actionHistory.map((event) => event.action)).toEqual([
        "task_completed",
        "task_marked_no_due",
      ]);
    });
  });

  it("F-010 gives an archived previous task its own message and status color", async () => {
    const repository = repositoryWithSession([task("one"), task("two")]);
    render(
      <TodayReviewPage
        calendar={calendar}
        now={() => now}
        repository={repository}
      />,
    );

    await screen.findByText("タスク one");
    fireEvent.click(screen.getByRole("button", { name: "アーカイブ" }));
    await screen.findByText("タスク two");
    fireEvent.click(screen.getByRole("button", { name: "前のタスク" }));

    expect(
      await screen.findByText("このタスクはアーカイブマーク済みです。"),
    ).toBeTruthy();
    expect(screen.getByText("現在：")).toBeTruthy();
    expect(
      screen.getByText("アーカイブ", { selector: "strong" }).className,
    ).toContain(
      "reviewCurrentStatus__value--archived",
    );
  });

  it("F-012 resumes an unfinished session at the next unanswered task", async () => {
    const first = task("one", { status: "completed", completedAt: now });
    const second = task("two");
    const initial = createEmptySnapshot({
      appVersion: "mvp-1.9.0",
      localDeviceId: "device-1",
      timeZone: "UTC",
      now,
    });
    const started = startReviewSession({
      sessionId: "session-1",
      now,
      calendar,
      tasks: [task("one"), second],
    });
    const repository = repositoryWithSnapshot({
      ...initial,
      tasks: [first, second],
      reviewSessions: [
        {
          ...started,
          currentIndex: 0,
          visitedTaskIds: ["one"],
          answeredTaskIds: ["one"],
        },
      ],
    });

    render(
      <TodayReviewPage
        calendar={calendar}
        now={() => now}
        repository={repository}
      />,
    );

    expect(await screen.findByText("タスク two")).toBeTruthy();
    expect(screen.queryByText("タスク one")).toBeNull();
    await waitFor(async () => {
      expect((await repository.load()).reviewSessions[0]?.currentIndex).toBe(1);
    });
  });

  it("F-012 starts a new local-day review without previous-day completed cards", async () => {
    const previousDay = "2026-08-03T09:00:00.000Z";
    const nextDay = "2026-08-04T09:00:00.000Z";
    const first = task("one", {
      status: "completed",
      completedAt: previousDay,
    });
    const second = task("two");
    const initial = createEmptySnapshot({
      appVersion: "mvp-1.10.0",
      localDeviceId: "device-1",
      timeZone: "UTC",
      now: previousDay,
    });
    const started = startReviewSession({
      sessionId: "previous-day-session",
      now: previousDay,
      calendar,
      tasks: [task("one"), second],
    });
    const repository = repositoryWithSnapshot({
      ...initial,
      tasks: [first, second],
      reviewSessions: [
        {
          ...started,
          currentIndex: 1,
          visitedTaskIds: ["one"],
          answeredTaskIds: ["one"],
        },
      ],
    });

    render(
      <TodayReviewPage
        calendar={calendar}
        createId={() => "next-day-session"}
        now={() => nextDay}
        repository={repository}
      />,
    );

    expect(await screen.findByText("タスク two")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "前のタスク" })).toBeNull();
    expect(screen.queryByText("タスク one")).toBeNull();
    await waitFor(async () => {
      expect((await repository.load()).reviewSessions.at(-1)).toMatchObject({
        id: "next-day-session",
        localDate: "2026-08-04",
        orderedTaskIds: ["two"],
      });
    });
  });

  it("refreshes an unfinished one-task session and exposes next navigation for a newly taskified item", async () => {
    const first = task("one");
    const second = task("new-today");
    const initial = createEmptySnapshot({
      appVersion: "mvp-1.5.0",
      localDeviceId: "device-1",
      timeZone: "UTC",
      now,
    });
    const repository = repositoryWithSnapshot({
      ...initial,
      tasks: [first, second],
      reviewSessions: [
        startReviewSession({
          sessionId: "session-1",
          now,
          calendar,
          tasks: [first],
        }),
      ],
    });

    render(
      <TodayReviewPage
        calendar={calendar}
        now={() => now}
        repository={repository}
      />,
    );

    expect(await screen.findByText("タスク one")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "次のタスク" }));
    expect(await screen.findByText("タスク new-today")).toBeTruthy();
    await waitFor(async () => {
      expect(
        (await repository.load()).reviewSessions[0]?.orderedTaskIds,
      ).toEqual(["one", "new-today"]);
    });
  });

  it("F-012 resets a date-change sheet after task navigation so a returned task can be answered", async () => {
    const repository = repositoryWithSession([
      task("one"),
      task("two"),
      task("three"),
    ]);
    render(
      <TodayReviewPage
        calendar={calendar}
        now={() => now}
        repository={repository}
      />,
    );

    await screen.findByText("タスク one");
    fireEvent.click(screen.getByRole("button", { name: "完了" }));
    await screen.findByText("タスク two");
    fireEvent.click(screen.getByRole("button", { name: "日付を変える" }));
    fireEvent.change(screen.getByLabelText("新しい期限"), {
      target: { value: "2026-08-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "この日付にする" }));
    await screen.findByText("タスク three");

    fireEvent.click(screen.getByRole("button", { name: "前のタスク" }));
    await screen.findByText("タスク two");
    fireEvent.click(screen.getByRole("button", { name: "前のタスク" }));
    await screen.findByText("タスク one");
    expect(screen.getByRole("button", { name: "期限なし" })).toBeTruthy();
  });

  it("F-012 displays the exact empty-state copy when no task is reviewable", async () => {
    render(
      <TodayReviewPage
        calendar={calendar}
        now={() => now}
        repository={repositoryWithSession([])}
      />,
    );

    expect(
      await screen.findByText(
        "今日確認するものはありません。記録したことは受信箱やタスク一覧からいつでも見直せます",
      ),
    ).toBeTruthy();
  });

  it("F-012 completes an empty stale session and computes fresh candidates that appeared later", async () => {
    const initial = createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "UTC",
      now,
    });
    const repository = repositoryWithSnapshot({
      ...initial,
      tasks: [task("later")],
      reviewSessions: [
        {
          id: "empty-session",
          localDate: "2026-08-03",
          orderedTaskIds: [],
          currentIndex: 0,
          visitedTaskIds: [],
          answeredTaskIds: [],
          actionEventIds: [],
          startedAt: "2026-08-03T08:00:00.000Z",
          updatedAt: "2026-08-03T08:00:00.000Z",
        },
      ],
    });

    render(
      <TodayReviewPage
        calendar={calendar}
        createId={() => "fresh-session"}
        now={() => now}
        repository={repository}
      />,
    );

    expect(await screen.findByText("タスク later")).toBeTruthy();
    await waitFor(async () => {
      const persisted = await repository.load();
      expect(persisted.reviewSessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "empty-session", completedAt: now }),
          expect.objectContaining({
            id: "fresh-session",
            orderedTaskIds: ["later"],
          }),
        ]),
      );
    });
  });

  it.each([
    [
      "task_rescheduled",
      { dueMode: "scheduled", dueAt: "2026-08-03T23:59:00.000Z" },
      "今日やる",
    ],
    [
      "task_rescheduled",
      { dueMode: "scheduled", dueAt: "2026-08-10T23:59:00.000Z" },
      "日付を変えた",
    ],
    ["task_marked_no_due", { dueMode: "none" }, "期限なし"],
    [
      "task_dismissed",
      { dueMode: "scheduled", dueAt: "2026-08-02T23:59:00.000Z" },
      "今回は閉じる",
    ],
  ] as const)(
    "F-015 shows the latest session-owned %s answer rather than a generic task status",
    async (action, changes, label) => {
      const initial = createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "UTC",
        now,
      });
      const current = task("one", changes);
      const repository = repositoryWithSnapshot({
        ...initial,
        tasks: [current],
        reviewSessions: [
          {
            id: "session-1",
            localDate: "2026-08-03",
            orderedTaskIds: ["one"],
            currentIndex: 0,
            visitedTaskIds: ["one"],
            answeredTaskIds: ["one"],
            actionEventIds: ["event-1"],
            startedAt: now,
            updatedAt: now,
          },
        ],
        actionHistory: [
          {
            id: "event-1",
            entityType: "task",
            entityId: "one",
            action,
            after: { dueAt: current.dueAt, dueMode: current.dueMode },
            occurredAt: now,
          },
        ],
      });

      render(
        <TodayReviewPage
          calendar={calendar}
          now={() => now}
          repository={repository}
        />,
      );

      expect(await screen.findByText("現在：")).toBeTruthy();
      expect(screen.getByText(label, { selector: "strong" })).toBeTruthy();
    },
  );
});
