// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  createEmptySnapshot,
  type AppRepository,
  type AppSnapshot,
  type Task,
} from "../../../../../packages/domain/src";
import { TaskListPage } from "./TaskListPage";

const now = "2026-08-03T09:00:00.000Z";

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
    createdAt: now,
    updatedAt: now,
    revision: 1,
    ...changes,
  };
}

function repository(): AppRepository {
  const snapshot: AppSnapshot = {
    ...createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "UTC",
      now,
    }),
    tasks: [
      task("期限切れ", {
        dueMode: "scheduled",
        dueAt: "2026-08-02T23:59:00.000Z",
      }),
      task("今日", { dueMode: "scheduled", dueAt: "2026-08-03T23:59:00.000Z" }),
      task("未設定", { dueMode: "unset" }),
      task("なし"),
      task("明日", { dueMode: "scheduled", dueAt: "2026-08-04T23:59:00.000Z" }),
      task("完了済み", {
        status: "completed",
        completedAt: now,
        dueMode: "scheduled",
        dueAt: "2026-08-02T23:59:00.000Z",
      }),
      task("保管済み", { status: "archived", archivedAt: now, category: "旧分類" }),
    ],
  };
  snapshot.settings.customTaskCategories = ["冷蔵庫"];
  return {
    load: async () => snapshot,
    save: async () => undefined,
    loadDraft: async () => "",
    saveDraft: async () => undefined,
    clearDraft: async () => undefined,
  };
}

describe("TaskListPage", () => {
  afterEach(cleanup);

  it("F-014 renders a text due-state badge and links each matching active task to its detail", async () => {
    render(
      <MemoryRouter>
        <TaskListPage now={() => now} repository={repository()} />
      </MemoryRouter>,
    );

    expect(await screen.findByText("期限切れ")).toBeTruthy();
    expect(screen.getByLabelText("期限切れの期限状態").textContent).toBe(
      "期限超過",
    );
    expect(screen.getByLabelText("今日の期限状態").textContent).toBe(
      "今日が期限",
    );
    expect(screen.getByLabelText("未設定の期限状態").textContent).toBe(
      "期限未設定",
    );
    expect(screen.getByLabelText("なしの期限状態").textContent).toBe(
      "期限なし",
    );
    expect(screen.getByLabelText("明日の期限状態").textContent).toBe(
      "期限あり",
    );
    expect(
      screen.getByRole("link", { name: "期限切れ" }).getAttribute("href"),
    ).toBe("/tasks/期限切れ");
    expect(screen.getByLabelText("期限切れの登録日時").textContent).toBe(
      "登録: 2026/8/3 09:00",
    );
  });

  it("NF-006 gives every primary list control a 44px minimum touch target", async () => {
    render(
      <MemoryRouter>
        <TaskListPage now={() => now} repository={repository()} />
      </MemoryRouter>,
    );

    await screen.findByRole("link", { name: "期限切れ" });
    for (const control of document.querySelectorAll<HTMLElement>(
      "select, input, a",
    )) {
      expect(getComputedStyle(control).minHeight).toBe("44px");
    }
  });

  it("F-014 reveals an overdue CTA without changing the default list, then filters active overdue tasks", async () => {
    render(
      <MemoryRouter>
        <TaskListPage now={() => now} repository={repository()} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "今日" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "期限超過のタスクを見る" }),
    );

    expect(screen.getByDisplayValue("対応中")).toBeTruthy();
    expect(screen.getByDisplayValue("期限超過")).toBeTruthy();
    expect(screen.getByText("期限切れ")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "今日" })).toBeNull();
  });

  it("F-014 lets the user select every state and open active, completed, or archived tasks", async () => {
    render(
      <MemoryRouter>
        <TaskListPage now={() => now} repository={repository()} />
      </MemoryRouter>,
    );

    const state = await screen.findByLabelText("状態");
    expect(
      within(state.closest("label")!).getByRole("option", { name: "すべて" }),
    ).toBeTruthy();
    fireEvent.change(state, { target: { value: "all" } });

    expect(screen.getByRole("link", { name: "期限切れ" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "完了済み" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "保管済み" })).toBeTruthy();
  });

  it("F-016 does not label a completed task as overdue", async () => {
    render(
      <MemoryRouter>
        <TaskListPage now={() => now} repository={repository()} />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("状態"), {
      target: { value: "completed" },
    });

    expect(screen.getByRole("link", { name: "完了済み" })).toBeTruthy();
    expect(screen.getByLabelText("完了済みの期限状態").textContent).toBe(
      "期限あり",
    );
  });

  it("keeps the overdue action and second filter row aligned for a compact mobile layout", async () => {
    render(
      <MemoryRouter>
        <TaskListPage now={() => now} repository={repository()} />
      </MemoryRouter>,
    );

    const overdue = await screen.findByRole("button", {
      name: "期限超過のタスクを見る",
    });
    expect(overdue.classList).toContain("task-list__overdue-link");
    expect(
      screen.getByLabelText("カテゴリ").closest("label")?.classList,
    ).toContain("task-list__category");
    expect(screen.getByLabelText("検索").closest("label")?.classList).toContain(
      "task-list__search",
    );
  });

  it("offers active custom and historical task categories as filters", async () => {
    render(
      <MemoryRouter>
        <TaskListPage now={() => now} repository={repository()} />
      </MemoryRouter>,
    );

    await screen.findByLabelText("カテゴリ");
    expect(screen.getByRole("option", { name: "冷蔵庫" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "旧分類（過去）" })).toBeTruthy();
  });

  it("F-014 uses one captured clock value for the list, overdue CTA, and due badges", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "UTC",
      now,
    });
    snapshot.tasks = [
      task("境界のタスク", {
        dueMode: "scheduled",
        dueAt: "2026-08-03T09:00:00.000Z",
      }),
    ];
    const repositoryAtBoundary: AppRepository = {
      load: async () => snapshot,
      save: async () => undefined,
      loadDraft: async () => "",
      saveDraft: async () => undefined,
      clearDraft: async () => undefined,
    };
    let calls = 0;
    const boundaryClock = () =>
      calls++ === 0 ? "2026-08-03T08:59:59.999Z" : "2026-08-03T09:00:00.001Z";

    render(
      <MemoryRouter>
        <TaskListPage now={boundaryClock} repository={repositoryAtBoundary} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("link", { name: "境界のタスク" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "期限超過のタスクを見る" }),
    ).toBeNull();
    expect(screen.getByLabelText("境界のタスクの期限状態").textContent).toBe(
      "今日が期限",
    );
  });
});
