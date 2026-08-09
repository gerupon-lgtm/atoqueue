// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySnapshot,
  type AppRepository,
  type AppSnapshot,
} from "../../../../../packages/domain/src";
import { TaskDetailPage } from "./TaskDetailPage";

const now = "2026-08-03T09:00:00.000Z";

function repositoryWithTask(
  taskChanges: Partial<AppSnapshot["tasks"][number]> = {},
): { repository: AppRepository; snapshot: () => AppSnapshot } {
  let current: AppSnapshot = {
    ...createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "UTC",
      now,
    }),
    captures: [
      {
        id: "capture-1",
        body: "元のメモ",
        classification: "task",
        createdAt: now,
        updatedAt: now,
        linkedTaskId: "task-1",
      },
    ],
    tasks: [
      {
        id: "task-1",
        sourceCaptureId: "capture-1",
        title: "牛乳を買う",
        category: "shopping",
        status: "active",
        dueMode: "scheduled",
        dueAt: "2026-08-02T23:59:00.000Z",
        nextReviewAt: "2026-08-02T23:59:00.000Z",
        undecidedCount: 1,
        dismissCount: 1,
        postponeCount: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: now,
        revision: 1,
        ...taskChanges,
      },
    ],
    actionHistory: [
      {
        id: "event-1",
        entityType: "task",
        entityId: "task-1",
        action: "task_dismissed",
        occurredAt: "2026-08-02T09:00:00.000Z",
      },
    ],
  };
  return {
    repository: {
      load: async () => current,
      save: async (next) => {
        current = next;
      },
      loadDraft: async () => "",
      saveDraft: async () => undefined,
      clearDraft: async () => undefined,
    },
    snapshot: () => current,
  };
}

describe("TaskDetailPage", () => {
  afterEach(cleanup);

  it("keeps one stable initial load when it uses the built-in clock", async () => {
    const { repository } = repositoryWithTask();
    const load = vi.spyOn(repository, "load");
    render(<TaskDetailPage repository={repository} taskId="task-1" />);

    await screen.findByRole("heading", { level: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("F-015 returns to the task list from the right-side correction header action", async () => {
    const { repository } = repositoryWithTask();
    const onReturn = vi.fn();
    render(
      <TaskDetailPage
        now={() => now}
        onReturn={onReturn}
        repository={repository}
        taskId="task-1"
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    const control = screen.getByRole("button", { name: "タスク一覧" });
    expect(control.textContent).not.toContain("←");
    fireEvent.click(control);

    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("gives the arrowless in-context task-list action the same 44px touch target as other actions", async () => {
    const { repository } = repositoryWithTask();
    render(
      <TaskDetailPage
        now={() => now}
        onReturn={() => undefined}
        repository={repository}
        taskId="task-1"
      />,
    );

    const control = await screen.findByRole("button", {
      name: "タスク一覧",
    });
    expect(getComputedStyle(control).minHeight).toBe("44px");
  });

  it("F-015 shows source, current/due/review state, derived neglect reason, and chronological history", async () => {
    const { repository } = repositoryWithTask();
    render(
      <TaskDetailPage
        now={() => now}
        repository={repository}
        taskId="task-1"
      />,
    );

    expect((await screen.findByLabelText("元の記録")).textContent).toBe(
      "元の記録: 元のメモ",
    );
    expect(screen.getByLabelText("現在の状態").textContent).toBe(
      "状態: 対応中",
    );
    expect(screen.getByLabelText("期限の状態").textContent).toBe(
      "期限: 2026/8/2 23:59（期限超過）",
    );
    expect(screen.queryByLabelText("次の確認")).toBeNull();
    expect(screen.getByLabelText("放置理由").textContent).toContain("放置理由");
    expect(screen.getByLabelText("登録日時").textContent).toBe(
      "登録日時: 2026/8/1 00:00",
    );
    expect(screen.getByLabelText("放置理由").textContent).toContain("後回し");
  });

  it("F-015 shows a local due-today state rather than a generic scheduled state", async () => {
    const { repository } = repositoryWithTask({
      dueAt: "2026-08-03T23:59:00.000Z",
    });
    render(
      <TaskDetailPage
        now={() => now}
        repository={repository}
        taskId="task-1"
      />,
    );

    expect((await screen.findByLabelText("期限の状態")).textContent).toBe(
      "期限: 2026/8/3 23:59（今日が期限）",
    );
  });

  it("F-015 persists a local completion before a later sync failure and shows the pending message", async () => {
    const { repository, snapshot } = repositoryWithTask();
    const sync = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <TaskDetailPage
        now={() => now}
        repository={repository}
        sync={sync}
        taskId="task-1"
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    await waitFor(() =>
      expect(snapshot().tasks[0]).toMatchObject({
        status: "completed",
        revision: 2,
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "通知の更新を送信待ちにしています",
    );
    expect(snapshot().notificationOutbox[0]).toMatchObject({
      operation: "cancel",
    });
    expect(JSON.stringify(snapshot().notificationOutbox)).not.toContain(
      "牛乳を買う",
    );
  });

  it("F-015 uses the date selected in the detail form for rescheduling", async () => {
    const { repository, snapshot } = repositoryWithTask();
    render(
      <TaskDetailPage
        now={() => now}
        repository={repository}
        taskId="task-1"
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.change(screen.getByLabelText("期限日（8桁）"), {
      target: { value: "20260810" },
    });
    fireEvent.click(screen.getByRole("button", { name: "期限を保存" }));

    await waitFor(() =>
      expect(snapshot().tasks[0]?.dueAt).toBe("2026-08-10T23:59:00.000Z"),
    );
  });

  it("F-015 uses the selected local time when rescheduling a task", async () => {
    const { repository, snapshot } = repositoryWithTask();
    render(
      <TaskDetailPage
        now={() => now}
        repository={repository}
        taskId="task-1"
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.change(screen.getByLabelText("期限日（8桁）"), {
      target: { value: "20260810" },
    });
    fireEvent.change(screen.getByLabelText("期限時刻（4桁）"), {
      target: { value: "0930" },
    });
    fireEvent.click(screen.getByRole("button", { name: "期限を保存" }));

    await waitFor(() =>
      expect(snapshot().tasks[0]?.dueAt).toBe("2026-08-10T09:30:00.000Z"),
    );
  });

  it("NF-012 handles a local save failure with a recoverable message", async () => {
    const { repository } = repositoryWithTask();
    repository.save = vi.fn().mockRejectedValue(new Error("quota"));
    render(
      <TaskDetailPage
        now={() => now}
        repository={repository}
        taskId="task-1"
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "変更を保存できませんでした。もう一度お試しください。",
    );
  });

  it("NF-006 gives every primary detail action a 44px minimum touch target", async () => {
    const { repository } = repositoryWithTask();
    render(
      <TaskDetailPage
        now={() => now}
        repository={repository}
        taskId="task-1"
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    for (const control of document.querySelectorAll<HTMLElement>(
      "select, input:not([aria-hidden=true]):not([type=checkbox]), button",
    )) {
      expect(getComputedStyle(control).minHeight).toBe("44px");
    }
    const timeToggle = screen.getByLabelText("期限時刻を指定する");
    expect(timeToggle.style.minHeight).toBe("");
    expect(timeToggle.closest("label")?.classList).toContain(
      "deadline-input-fields__toggle",
    );
  });

  it("keeps content, deadline, and status actions in deliberate button groups", async () => {
    const { repository } = repositoryWithTask();
    render(
      <TaskDetailPage
        now={() => now}
        repository={repository}
        taskId="task-1"
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    expect(
      screen
        .getByRole("button", { name: "内容を保存" })
        .closest(".task-detail__content-actions"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "期限を保存" })
        .closest(".task-detail__deadline-actions"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "完了" })
        .closest(".task-detail__status-actions"),
    ).not.toBeNull();
  });
});
