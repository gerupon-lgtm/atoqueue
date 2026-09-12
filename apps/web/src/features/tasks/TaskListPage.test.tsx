// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  act,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  createEmptySnapshot,
  type AppRepository,
  type AppSnapshot,
  type Task,
} from "../../../../../packages/domain/src";
import { TaskListPage } from "./TaskListPage";
import { makeTempalistFixture } from "../../../../../packages/domain/src/tempalist-test-fixture";
import { prepareTempalistRequest } from "../../../../../packages/domain/src";

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
        category: "shopping",
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
      task("保管済み", {
        status: "archived",
        archivedAt: now,
        category: "旧分類",
      }),
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

  it("F-020 keeps guidance out of the list until requested and closes it without changing tasks", async () => {
    render(
      <MemoryRouter>
        <TaskListPage
          repository={repository()}
          environment={() => "ios-browser"}
          tempalist={{
            prepare: vi.fn(),
            open: vi.fn(),
            lastRequest: async () => null,
          }}
        />
      </MemoryRouter>,
    );
    const help = await screen.findByRole("button", {
      name: "テンパリストとの連携について",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(help);
    const dialog = screen.getByRole("dialog", { name: "テンパリストとの連携" });
    expect(
      within(dialog).getByText(/ホーム画面版とはデータが別/),
    ).toBeVisible();
    const close = within(dialog).getByRole("button", { name: "説明を閉じる" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(help).toHaveFocus();
    fireEvent.click(help);
    fireEvent.click(screen.getByRole("button", { name: "説明を閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(help);
    fireEvent.pointerDown(screen.getByRole("heading", { name: "タスク" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "テンパリストへ" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "期限切れを選択" }),
    ).not.toBeChecked();
  });

  it("F-020 keeps the explanation usable beside the blocked iOS entry", async () => {
    render(
      <MemoryRouter>
        <TaskListPage
          repository={repository()}
          environment={() => "ios-standalone"}
          tempalist={{
            prepare: vi.fn(),
            open: vi.fn(),
            lastRequest: async () => null,
          }}
        />
      </MemoryRouter>,
    );
    const help = await screen.findByRole("button", {
      name: "テンパリストとの連携について",
    });
    expect(
      screen.getByRole("button", { name: "テンパリストへ" }),
    ).toBeDisabled();
    expect(help).toBeEnabled();
    expect(screen.getByText("ブラウザから利用できます")).toBeVisible();
    expect(screen.queryByText(/ホーム画面版とはデータが別/)).toBeNull();
    fireEvent.click(help);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "あとキューとテンパリストを同じブラウザで開いてください。",
    );
  });

  it("F-020 disables new handoffs and stored retries in iOS standalone without hiding tasks", async () => {
    const fixture = makeTempalistFixture();
    const service = {
      prepare: vi.fn(),
      open: vi.fn(),
      lastRequest: async () => prepareTempalistRequest(fixture),
    };
    render(
      <MemoryRouter>
        <TaskListPage
          repository={{ ...repository(), load: async () => fixture.snapshot }}
          tempalist={service}
          environment={() => "ios-standalone"}
        />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("button", { name: "テンパリストへ" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "直前の連携を確認" }),
    ).toBeNull();
    expect(screen.getByText("ブラウザから利用できます")).toBeVisible();
    expect(screen.getByRole("link", { name: "牛乳を買う" })).toBeTruthy();
    expect(service.prepare).not.toHaveBeenCalled();
    expect(service.open).not.toHaveBeenCalled();
  });

  it("F-020 collapses selection filters while retaining search, chosen tasks and the grouped actions", async () => {
    render(
      <MemoryRouter>
        <TaskListPage
          repository={repository()}
          tempalist={{
            prepare: vi.fn(),
            open: vi.fn(),
            lastRequest: async () => null,
          }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "テンパリストへ" }),
    );
    expect(screen.queryByRole("combobox", { name: "カテゴリ" })).toBeNull();
    const search = screen.getByRole("textbox", { name: "検索" });
    fireEvent.click(screen.getByRole("checkbox", { name: "期限切れを選択" }));
    fireEvent.click(screen.getByRole("button", { name: "絞り込み" }));
    fireEvent.change(screen.getByRole("combobox", { name: "カテゴリ" }), {
      target: { value: "shopping" },
    });
    fireEvent.click(screen.getByRole("button", { name: "絞り込み" }));
    expect(search).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "期限切れを選択" }),
    ).toBeChecked();
    const actions = screen.getByRole("region", {
      name: "チェックリスト選択の操作",
    });
    expect(
      within(actions).getByRole("button", { name: "内容を確認" }),
    ).toBeEnabled();
    fireEvent.click(
      within(actions).getByRole("button", { name: "選択をやめる" }),
    );
    expect(
      screen.queryByRole("region", { name: "チェックリスト選択の操作" }),
    ).toBeNull();
    expect(screen.getByRole("combobox", { name: "カテゴリ" })).toHaveValue(
      "shopping",
    );
  });

  it("F-020 clears last-request read errors after recovery and hides stale retry data after failure", async () => {
    const fixture = makeTempalistFixture();
    const request = prepareTempalistRequest(fixture);
    const lastRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce(request)
      .mockRejectedValueOnce(new Error("read failed again"))
      .mockResolvedValueOnce(request);
    render(
      <MemoryRouter>
        <TaskListPage
          repository={{ ...repository(), load: async () => fixture.snapshot }}
          tempalist={{ lastRequest, prepare: vi.fn(), open: vi.fn() }}
        />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/直前の連携を読み込めませんでした/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "テンパリストへ" }));
    await waitFor(() => expect(lastRequest).toHaveBeenCalledTimes(2));
    // Returning to the list triggers a failed read after a successful read in selection mode.
    fireEvent.click(screen.getByRole("button", { name: "選択をやめる" }));
    expect(
      await screen.findByText(/直前の連携を読み込めませんでした/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "直前の連携を確認" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "テンパリストへ" }));
    await waitFor(() => expect(lastRequest).toHaveBeenCalledTimes(4));
    lastRequest.mockResolvedValue(request);
    fireEvent.click(screen.getByRole("button", { name: "選択をやめる" }));
    expect(
      await screen.findByRole("button", { name: "直前の連携を確認" }),
    ).toBeTruthy();
    expect(screen.queryByText(/直前の連携を読み込めませんでした/)).toBeNull();
  });

  it("F-020 preserves a confirmation draft across metadata refresh and reselects at the end", async () => {
    const fixture = makeTempalistFixture();
    let refresh = () => {};
    const repo = {
      ...repository(),
      load: async () => fixture.snapshot,
      subscribe: (listener: () => void) => {
        refresh = listener;
        return () => {};
      },
    };
    render(
      <MemoryRouter>
        <TaskListPage
          repository={repo}
          tempalist={{
            prepare: async () => prepareTempalistRequest(fixture),
            open: async () => undefined,
            lastRequest: async () => null,
          }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "テンパリストへ" }),
    );
    for (const name of ["牛乳を買う", "電池を買う", "牛乳を買う", "牛乳を買う"])
      fireEvent.click(screen.getByRole("checkbox", { name: `${name}を選択` }));
    fireEvent.click(screen.getByRole("button", { name: "内容を確認" }));
    fireEvent.change(screen.getByRole("textbox", { name: "リスト名" }), {
      target: { value: "入力を維持" },
    });
    await act(async () => {
      refresh();
    });
    expect(screen.getByRole("textbox", { name: "リスト名" })).toHaveValue(
      "入力を維持",
    );
    expect(screen.getAllByTestId("transfer-item")[0]).toHaveTextContent(
      "電池を買う",
    );
  });

  it("F-020 reopens only persisted confirmation after reload and never launches automatically", async () => {
    const fixture = makeTempalistFixture();
    const request = prepareTempalistRequest(fixture);
    fixture.snapshot.tasks = [];
    const service = {
      prepare: vi.fn(),
      lastRequest: vi.fn(async () => request),
      open: vi.fn(async () => undefined),
    };
    render(
      <MemoryRouter>
        <TaskListPage
          repository={{ ...repository(), load: async () => fixture.snapshot }}
          tempalist={service}
        />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "直前の連携を確認" }),
    );
    expect(service.open).not.toHaveBeenCalled();
    expect(screen.getByText("牛乳を買う")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "直前の連携をもう一度開く" }),
    );
    await waitFor(() => expect(service.open).toHaveBeenCalledWith(request));
    expect(service.prepare).not.toHaveBeenCalled();
  });

  it("F-020 retains selection across search and reviews every selected task", async () => {
    const fixture = makeTempalistFixture();
    render(
      <MemoryRouter>
        <TaskListPage
          repository={{ ...repository(), load: async () => fixture.snapshot }}
          tempalist={{
            prepare: async () => prepareTempalistRequest(fixture),
            open: async () => undefined,
            lastRequest: async () => null,
          }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "テンパリストへ" }),
    );
    expect(screen.getByRole("button", { name: "内容を確認" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "牛乳を買うを選択" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "電池を買うを選択" }));
    fireEvent.change(screen.getByRole("textbox", { name: "検索" }), {
      target: { value: "牛乳" },
    });
    expect(screen.getByText("2件選択中（表示外も含む）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "内容を確認" }));
    expect(screen.getByRole("textbox", { name: "リスト名" })).toHaveValue(
      "あとキューのチェックリスト",
    );
    expect(screen.getAllByRole("button", { name: /除外/ })).toHaveLength(2);
  });

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
    expect(screen.getByLabelText("期限切れのカテゴリ").textContent).toBe(
      "カテゴリ: 買い物",
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
    expect(screen.getByLabelText("保管済みのカテゴリ").textContent).toBe(
      "カテゴリ: 旧分類（過去）",
    );
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
