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
  createCapture,
  createEmptySnapshot,
  type AppRepository,
} from "../../../../../packages/domain/src";
import { TaskCandidatePage } from "./TaskCandidatePage";

const now = "2026-08-03T09:00:00.000Z";

function repositoryWithCapture(): AppRepository {
  const snapshot = createCapture(
    createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "Asia/Tokyo",
      now,
    }),
    "牛乳を買う",
    now,
    "capture-1",
  );
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    save: vi.fn().mockResolvedValue(undefined),
    loadDraft: vi.fn().mockResolvedValue(""),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn().mockResolvedValue(undefined),
  };
}

describe("TaskCandidatePage", () => {
  afterEach(cleanup);

  it("F-005 creates no task until the user presses タスクにする", async () => {
    const repository = repositoryWithCapture();
    render(
      <TaskCandidatePage
        captureId="capture-1"
        createId={() => "task-1"}
        now={() => now}
        repository={repository}
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    expect(repository.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "タスクにする" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].tasks,
    ).toEqual([
      expect.objectContaining({ id: "task-1", sourceCaptureId: "capture-1" }),
    ]);
  });

  it("S-003 shows the original capture separately and preselects editable rule-based suggestions", async () => {
    const snapshot = createCapture(
      createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now,
      }),
      "明日 牛乳を買う",
      now,
      "capture-1",
    );
    const repository: AppRepository = {
      load: vi.fn().mockResolvedValue(snapshot),
      save: vi.fn().mockResolvedValue(undefined),
      loadDraft: vi.fn().mockResolvedValue(""),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      clearDraft: vi.fn().mockResolvedValue(undefined),
    };
    render(<TaskCandidatePage captureId="capture-1" repository={repository} />);

    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent === "元の記録: 明日 牛乳を買う",
      ),
    ).toBeTruthy();
    expect(screen.getByText("登録: 2026/8/3 18:00")).toBeTruthy();
    expect((screen.getByLabelText("タスク名") as HTMLInputElement).value).toBe(
      "牛乳を買う",
    );
    expect((screen.getByLabelText("期限") as HTMLSelectElement).value).toBe(
      "tomorrow",
    );
    expect((screen.getByLabelText("カテゴリ") as HTMLSelectElement).value).toBe(
      "shopping",
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("F-005 offers an optional category and persists the user-selected candidate", async () => {
    const repository = repositoryWithCapture();
    render(
      <TaskCandidatePage
        captureId="capture-1"
        createId={() => "task-1"}
        now={() => now}
        repository={repository}
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.change(screen.getByLabelText("カテゴリ"), {
      target: { value: "shopping" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスクにする" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].tasks[0],
    ).toMatchObject({
      category: "shopping",
    });
  });

  it("suggests and offers a device-local exact-match category", async () => {
    const snapshot = createCapture(
      createEmptySnapshot({
        appVersion: "mvp-1.5.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now,
      }),
      "冷蔵庫の豆腐",
      now,
      "capture-1",
    );
    snapshot.settings.customTaskCategories = ["冷蔵庫"];
    const repository: AppRepository = {
      load: vi.fn().mockResolvedValue(snapshot),
      save: vi.fn().mockResolvedValue(undefined),
      loadDraft: vi.fn().mockResolvedValue(""),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      clearDraft: vi.fn().mockResolvedValue(undefined),
    };

    render(<TaskCandidatePage captureId="capture-1" repository={repository} />);

    expect(await screen.findByText("カテゴリ候補: 冷蔵庫")).toBeTruthy();
    expect((screen.getByLabelText("カテゴリ") as HTMLSelectElement).value).toBe(
      "冷蔵庫",
    );
  });

  it("F-006 changes the capture to a memo only after メモにする and returns", async () => {
    const repository = repositoryWithCapture();
    const onReturn = vi.fn();
    render(
      <TaskCandidatePage
        captureId="capture-1"
        now={() => now}
        onReturn={onReturn}
        repository={repository}
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.click(screen.getByRole("button", { name: "メモにする" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0]
        .captures[0],
    ).toMatchObject({
      classification: "note",
    });
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it("F-004 returns to the inbox without classifying when 受信箱へ戻る is pressed", async () => {
    const repository = repositoryWithCapture();
    const onReturn = vi.fn();
    render(
      <TaskCandidatePage
        captureId="capture-1"
        onReturn={onReturn}
        repository={repository}
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.click(screen.getByRole("button", { name: "受信箱へ戻る" }));

    expect(repository.save).not.toHaveBeenCalled();
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it("F-007 asks before saving a past custom date and leaves the form unchanged when cancelled", async () => {
    const repository = repositoryWithCapture();
    const confirmPastDate = vi.fn().mockReturnValue(false);
    render(
      <TaskCandidatePage
        captureId="capture-1"
        confirmPastDate={confirmPastDate}
        now={() => now}
        repository={repository}
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.change(screen.getByLabelText("期限"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("期限日（8桁）"), {
      target: { value: "20260802" },
    });
    fireEvent.change(screen.getByLabelText("タスク名"), {
      target: { value: "牛乳を買い足す" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスクにする" }));

    await waitFor(() => expect(confirmPastDate).toHaveBeenCalledOnce());
    expect(repository.save).not.toHaveBeenCalled();
    expect((screen.getByLabelText("タスク名") as HTMLInputElement).value).toBe(
      "牛乳を買い足す",
    );
    expect(
      (screen.getByLabelText("期限日（8桁）") as HTMLInputElement).value,
    ).toBe("2026/08/02");
  });

  it("F-007 explains that a deadline is chosen while turning an inbox item into a task", async () => {
    const repository = repositoryWithCapture();
    render(<TaskCandidatePage captureId="capture-1" repository={repository} />);

    await screen.findByDisplayValue("牛乳を買う");
    expect(
      screen.getByText(
        "期限はタスクにする時に選べます。日付と時刻を指定でき、時刻を指定しない場合は設定の既定時刻を使います。",
      ),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("期限"), {
      target: { value: "custom" },
    });
    expect(screen.getByLabelText("期限日（8桁）")).toHaveProperty(
      "type",
      "text",
    );
  });

  it("F-007 lets the user choose a deadline time while turning a capture into a task", async () => {
    const repository = repositoryWithCapture();
    render(
      <TaskCandidatePage
        captureId="capture-1"
        createId={() => "task-1"}
        now={() => now}
        repository={repository}
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.change(screen.getByLabelText("期限"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("期限日（8桁）"), {
      target: { value: "20260805" },
    });
    fireEvent.click(screen.getByLabelText("期限時刻を指定する"));
    fireEvent.change(screen.getByLabelText("期限時刻（4桁）"), {
      target: { value: "0930" },
    });
    fireEvent.click(screen.getByRole("button", { name: "タスクにする" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].tasks[0],
    ).toMatchObject({ dueAt: "2026-08-05T00:30:00.000Z" });
  });

  it("keeps the primary task action distinct from the two equally arranged alternatives", async () => {
    render(
      <TaskCandidatePage
        captureId="capture-1"
        repository={repositoryWithCapture()}
      />,
    );

    const taskAction = await screen.findByRole("button", {
      name: "タスクにする",
    });
    expect(taskAction.classList).toContain("task-candidate__save");
    expect(
      screen
        .getByRole("button", { name: "メモにする" })
        .closest(".task-candidate__secondary-actions"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "受信箱へ戻る" })
        .closest(".task-candidate__secondary-actions"),
    ).not.toBeNull();
  });
});
