import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySnapshot,
  type Task,
} from "../../../../packages/domain/src";
import { LocalStorageRepository } from "../infrastructure/local-storage/local-storage-repository";
import { TaskListPage } from "../features/tasks/TaskListPage";
import { TaskDetailPage } from "../features/tasks/TaskDetailPage";
import { TodayReviewPage } from "../features/review/TodayReviewPage";
import { AppShell } from "./AppShell";

const instant = "2026-08-31T09:00:00.000Z";
const clock = () => instant;
const summaryName = "期限超過のタスク2件を確認する";

async function setup(path = "/", now = clock, reviewSecondTask = false) {
  const repository = new LocalStorageRepository(window.localStorage, {
    now,
    timeZone: "Asia/Tokyo",
  });
  const snapshot = createEmptySnapshot({
    appVersion: "test",
    localDeviceId: "device",
    timeZone: "Asia/Tokyo",
    now: instant,
  });
  const base: Task = {
    id: "overdue",
    sourceCaptureId: "capture-overdue",
    title: "期限を過ぎたタスク",
    status: "active",
    dueMode: "scheduled",
    dueAt: "2026-08-30T09:00:00.000Z",
    nextReviewAt: "2026-08-30T09:00:00.000Z",
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: instant,
    updatedAt: instant,
    revision: 1,
  };
  snapshot.tasks = [
    base,
    {
      ...base,
      id: "dismissed",
      title: "見送り中のタスク",
      sourceCaptureId: "capture-dismissed",
      dismissCount: 1,
      nextReviewAt: "2026-09-05T09:00:00.000Z",
    },
    {
      ...base,
      id: "completed",
      sourceCaptureId: "capture-completed",
      status: "completed",
      completedAt: instant,
    },
    {
      ...base,
      id: "archived",
      sourceCaptureId: "capture-archived",
      status: "archived",
      archivedAt: instant,
    },
    {
      ...base,
      id: "future",
      title: "明日のタスク",
      sourceCaptureId: "capture-future",
      dueAt: "2026-09-01T09:00:00.000Z",
    },
  ];
  if (reviewSecondTask) snapshot.tasks[1]!.nextReviewAt = base.nextReviewAt;
  snapshot.captures = snapshot.tasks.map((task) => ({
    id: task.sourceCaptureId,
    body: task.title,
    classification: "task",
    linkedTaskId: task.id,
    createdAt: instant,
    updatedAt: instant,
  }));
  await repository.save(snapshot);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell repository={repository} now={now} />}>
          <Route
            path="/tasks"
            element={<TaskListPage repository={repository} now={now} />}
          />
          <Route
            path="/tasks/overdue"
            element={
              <TaskDetailPage
                repository={repository}
                taskId="overdue"
                now={now}
              />
            }
          />
          <Route
            path="/today"
            element={<TodayReviewPage repository={repository} now={now} />}
          />
          <Route path="*" element={<p>画面の内容</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return repository;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("F-012 F-016 overdue awareness", () => {
  it.each(["/", "/inbox", "/settings", "/today/result"])(
    "offers the active overdue list from %s, including dismissed tasks",
    async (path) => {
      await setup(path);
      const link = await screen.findByRole("link", { name: summaryName });
      expect(link.getAttribute("href")).toBe("/tasks?due=overdue");
      expect(link.textContent).toContain("期限超過 2件");
      fireEvent.click(link);
      await screen.findByRole("link", { name: "見送り中のタスク" });
      expect(screen.queryByRole("link", { name: "明日のタスク" })).toBeNull();
      expect(
        screen
          .getByLabelText("見送り中のタスクの期限状態")
          .querySelector("svg"),
      ).not.toBeNull();
    },
  );

  it("reopens the full overdue list even when unrelated filters are selected on the same route", async () => {
    await setup("/tasks?due=overdue");
    await screen.findByRole("link", { name: "見送り中のタスク" });
    fireEvent.change(screen.getByLabelText("状態"), {
      target: { value: "completed" },
    });
    fireEvent.change(screen.getByLabelText("検索"), {
      target: { value: "見つからない文字" },
    });
    fireEvent.click(screen.getByRole("link", { name: summaryName }));
    await screen.findByRole("link", { name: "見送り中のタスク" });
    expect((screen.getByLabelText("状態") as HTMLSelectElement).value).toBe(
      "active",
    );
    expect((screen.getByLabelText("検索") as HTMLInputElement).value).toBe("");
  });

  it.each(["完了", "アーカイブ", "期限なしにする"])(
    "updates the global count after %s without leaving the detail screen",
    async (action) => {
      await setup("/tasks/overdue");
      await screen.findByRole("link", { name: summaryName });
      fireEvent.click(await screen.findByRole("button", { name: action }));
      await screen.findByRole("link", {
        name: "期限超過のタスク1件を確認する",
      });
      expect(screen.getByLabelText("現在の状態")).toBeTruthy();
      expect(
        screen.getByLabelText("期限の状態").querySelector(".overdue-indicator"),
      ).toBeNull();
    },
  );

  it("hides both indicators when the remaining overdue tasks are resolved or restored away", async () => {
    const repository = await setup();
    await screen.findByRole("link", { name: summaryName });
    const snapshot = await repository.load();
    snapshot.tasks = [];
    snapshot.captures = [];
    await act(() => repository.save(snapshot));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: summaryName })).toBeNull(),
    );
    expect(screen.queryByLabelText("期限超過のタスク: 2件")).toBeNull();
  });

  it("keeps the saved overdue count when a local write fails", async () => {
    const repository = await setup();
    await screen.findByRole("link", { name: summaryName });
    const snapshot = await repository.load();
    snapshot.tasks = [];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(repository.save(snapshot)).rejects.toThrow();
    expect(screen.getByRole("link", { name: summaryName })).toBeTruthy();
  });

  it("recalculates when the app returns to the foreground", async () => {
    let timestamp = "2026-08-29T09:00:00.000Z";
    await setup("/", () => timestamp);
    await act(async () => {});
    expect(screen.queryByRole("link", { name: summaryName })).toBeNull();
    timestamp = instant;
    fireEvent.focus(window);
    await screen.findByRole("link", { name: summaryName });
  });

  it("updates after another tab changes the stored snapshot", async () => {
    const repository = await setup();
    await screen.findByRole("link", { name: summaryName });
    const snapshot = await repository.load();
    snapshot.tasks = [];
    snapshot.captures = [];
    window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(snapshot));
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: "atoqueue:data:v1",
        storageArea: window.localStorage,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: summaryName })).toBeNull(),
    );
  });

  it("recalculates while open when the deadline passes, without resetting task filters", async () => {
    vi.useFakeTimers();
    let timestamp = "2026-08-30T08:59:59.000Z";
    await setup("/tasks", () => timestamp);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("検索"), {
      target: { value: "見送り" },
    });
    timestamp = instant;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.getByRole("link", { name: summaryName })).toBeTruthy();
    expect(
      screen.getByLabelText("見送り中のタスクの期限状態").textContent,
    ).toBe("期限超過");
    expect((screen.getByLabelText("検索") as HTMLInputElement).value).toBe(
      "見送り",
    );
  });

  it("does not retain overdue emphasis on a completed review card revisited for correction", async () => {
    await setup("/today", clock, true);
    await screen.findByRole("button", { name: "完了" });
    expect(
      screen
        .getByRole("article", { name: "確認するタスク" })
        .querySelector(".overdue-indicator"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "完了" }));
    fireEvent.click(await screen.findByRole("button", { name: "前のタスク" }));
    await screen.findByText("このタスクは完了マーク済みです。");
    expect(
      screen
        .getByRole("article", { name: "確認するタスク" })
        .querySelector(".overdue-indicator"),
    ).toBeNull();
  });
});
