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
  markAsNote,
  markAsUnneeded,
  type AppRepository,
} from "../../../../../packages/domain/src";
import { InboxPage } from "./InboxPage";

const now = "2026-08-03T09:00:00.000Z";

function repositoryWithCaptures(): AppRepository {
  let snapshot = createEmptySnapshot({
    appVersion: "0.1.0",
    localDeviceId: "device-1",
    timeZone: "Asia/Tokyo",
    now,
  });
  snapshot = createCapture(
    snapshot,
    "古い記録",
    "2026-08-01T09:00:00.000Z",
    "capture-old",
  );
  snapshot = createCapture(
    snapshot,
    "新しい記録",
    "2026-08-02T09:00:00.000Z",
    "capture-new",
  );

  return {
    load: vi.fn().mockImplementation(async () => snapshot),
    save: vi.fn().mockImplementation(async (next) => {
      snapshot = next;
    }),
    loadDraft: vi.fn().mockResolvedValue(""),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn().mockResolvedValue(undefined),
  };
}

function repositoryWithNotes(): AppRepository {
  let snapshot = createEmptySnapshot({
    appVersion: "0.1.0",
    localDeviceId: "device-1",
    timeZone: "Asia/Tokyo",
    now,
  });
  snapshot = createCapture(
    snapshot,
    "新しいメモ",
    "2026-08-02T09:00:00.000Z",
    "note-new",
  );
  snapshot = createCapture(
    snapshot,
    "最も古いメモ",
    "2026-08-01T09:00:00.000Z",
    "note-old",
  );
  snapshot = markAsNote({ snapshot, captureId: "note-new", now });
  snapshot = markAsNote({ snapshot, captureId: "note-old", now });
  return {
    load: vi.fn().mockImplementation(async () => snapshot),
    save: vi.fn().mockImplementation(async (next) => {
      snapshot = next;
    }),
    loadDraft: vi.fn().mockResolvedValue(""),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn().mockResolvedValue(undefined),
  };
}

function repositoryWithAllClassifications(): AppRepository {
  let snapshot = createEmptySnapshot({
    appVersion: "0.1.0",
    localDeviceId: "device-1",
    timeZone: "Asia/Tokyo",
    now,
  });
  snapshot = createCapture(
    snapshot,
    "未整理の記録",
    "2026-08-01T09:00:00.000Z",
    "capture-unclassified",
  );
  snapshot = createCapture(
    snapshot,
    "メモの記録",
    "2026-08-02T09:00:00.000Z",
    "capture-note",
  );
  snapshot = markAsNote({ snapshot, captureId: "capture-note", now });
  snapshot = createCapture(
    snapshot,
    "不要な記録",
    "2026-08-03T09:00:00.000Z",
    "capture-unneeded",
  );
  snapshot = markAsUnneeded({ snapshot, captureId: "capture-unneeded", now });
  snapshot = createCapture(
    snapshot,
    "タスクの記録",
    "2026-08-04T09:00:00.000Z",
    "capture-task",
  );
  snapshot.captures = snapshot.captures.map((capture) =>
    capture.id === "capture-task"
      ? {
          ...capture,
          classification: "task",
          linkedTaskId: "task-1",
          classifiedAt: now,
        }
      : capture,
  );

  return {
    load: vi.fn().mockImplementation(async () => snapshot),
    save: vi.fn().mockImplementation(async (next) => {
      snapshot = next;
    }),
    loadDraft: vi.fn().mockResolvedValue(""),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn().mockResolvedValue(undefined),
  };
}

describe("InboxPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("F-004 offers all four capture-history tabs and starts with unclassified", async () => {
    render(<InboxPage repository={repositoryWithCaptures()} />);

    expect(await screen.findByRole("tab", { name: "すべて" })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "未整理" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "メモ" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "不要" })).toBeTruthy();
  });

  it("F-004 shows every capture classification once in the all tab", async () => {
    render(<InboxPage repository={repositoryWithAllClassifications()} />);

    fireEvent.click(await screen.findByRole("tab", { name: "すべて" }));

    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/タスクの記録.*タスク化済み/),
      expect.stringMatching(/不要な記録.*不要/),
      expect.stringMatching(/メモの記録.*メモ/),
      expect.stringMatching(/未整理の記録.*未整理/),
    ]);
  });

  it("F-006 opens a task-classified capture through its linked task", async () => {
    const onTaskOpen = vi.fn();
    render(
      <InboxPage
        onTaskOpen={onTaskOpen}
        repository={repositoryWithAllClassifications()}
      />,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "すべて" }));
    fireEvent.click(screen.getByRole("button", { name: "タスクを開く" }));

    expect(onTaskOpen).toHaveBeenCalledWith("task-1");
  });

  it("F-006 restores an unneeded capture and synchronizes its rebuilt reminders", async () => {
    const repository = repositoryWithAllClassifications();
    const sync = vi.fn().mockResolvedValue(undefined);
    render(<InboxPage now={() => now} repository={repository} sync={sync} />);

    fireEvent.click(await screen.findByRole("tab", { name: "不要" }));
    fireEvent.click(screen.getByRole("button", { name: "未整理に戻す" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("不要な記録")).toBeNull();
  });

  it("F-006 permanently deletes an unneeded capture only after confirmation", async () => {
    const repository = repositoryWithAllClassifications();
    const confirm = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const sync = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("confirm", confirm);
    render(<InboxPage now={() => now} repository={repository} sync={sync} />);

    fireEvent.click(await screen.findByRole("tab", { name: "不要" }));
    fireEvent.click(screen.getByRole("button", { name: "完全削除" }));
    expect(repository.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "完全削除" }));
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("不要な記録")).toBeNull();
  });

  it("does not leave an empty list card below the inbox empty state", async () => {
    const empty = createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "Asia/Tokyo",
      now,
    });
    const repository: AppRepository = {
      load: async () => empty,
      save: async () => undefined,
      loadDraft: async () => "",
      saveDraft: async () => undefined,
      clearDraft: async () => undefined,
    };

    render(<InboxPage repository={repository} />);

    expect(await screen.findByText("未整理の記録はありません。")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("F-004 shows unclassified captures newest first with exactly three actions", async () => {
    render(<InboxPage repository={repositoryWithCaptures()} />);

    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("新しい記録"),
      expect.stringContaining("古い記録"),
    ]);
    expect(screen.getAllByRole("button", { name: "タスクかも" })).toHaveLength(
      2,
    );
    expect(screen.getAllByRole("button", { name: "メモ" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "不要" })).toHaveLength(2);
  });

  it("keeps each capture classification choice in one evenly arranged action group", async () => {
    render(<InboxPage repository={repositoryWithCaptures()} />);

    const actions = (
      await screen.findAllByRole("button", { name: "タスクかも" })
    )[0]!;
    const group = actions.closest(".inbox-item__classification-actions");
    expect(group).not.toBeNull();
  });

  it("F-004 shows each inbox capture's local registration date and time", async () => {
    render(<InboxPage repository={repositoryWithCaptures()} />);

    expect(await screen.findByText("登録: 2026/8/2 18:00")).toBeTruthy();
  });

  it("F-006 saves a memo classification locally", async () => {
    const repository = repositoryWithCaptures();
    render(<InboxPage now={() => now} repository={repository} />);

    const memoButtons = await screen.findAllByRole("button", { name: "メモ" });
    fireEvent.click(memoButtons[0]!);

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("新しい記録")).toBeNull();
  });

  it("F-014 saves an unneeded classification before immediately synchronizing its cancellation", async () => {
    const repository = repositoryWithCaptures();
    const sync = vi.fn().mockResolvedValue(undefined);
    render(<InboxPage now={() => now} repository={repository} sync={sync} />);

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "不要" }))[0]!,
    );

    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ).toBeLessThan(sync.mock.invocationCallOrder[0]!);
  });

  it("F-014 keeps the unneeded classification and reports a queued cancellation when sync fails", async () => {
    const repository = repositoryWithCaptures();
    const sync = vi.fn().mockRejectedValue(new Error("offline"));
    render(<InboxPage now={() => now} repository={repository} sync={sync} />);

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "不要" }))[0]!,
    );

    expect((await screen.findByRole("status")).textContent).toBe(
      "不要にしました。通知の取消は送信待ちです。",
    );
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].captures,
    ).toContainEqual(
      expect.objectContaining({
        id: "capture-new",
        classification: "unneeded",
      }),
    );
  });

  it("F-004 persists an inline edit through the repository without changing classification", async () => {
    const repository = repositoryWithCaptures();
    render(<InboxPage now={() => now} repository={repository} />);

    const body = await screen.findByDisplayValue("新しい記録");
    fireEvent.change(body, { target: { value: "編集した記録" } });
    fireEvent.click(
      screen.getByRole("button", { name: "新しい記録の本文を保存" }),
    );

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("status", { name: "編集した記録の保存結果" })
        .textContent,
    ).toBe("本文を保存しました。");
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].captures,
    ).toContainEqual(
      expect.objectContaining({
        body: "編集した記録",
        classification: "unclassified",
      }),
    );
  });

  it("keeps a failed body edit beside its capture so the user can retry", async () => {
    const repository = repositoryWithCaptures();
    repository.save = vi.fn().mockRejectedValue(new Error("quota"));
    render(<InboxPage now={() => now} repository={repository} />);

    const body = await screen.findByDisplayValue("新しい記録");
    fireEvent.change(body, { target: { value: "保存できなかった記録" } });
    fireEvent.click(
      screen.getByRole("button", { name: "新しい記録の本文を保存" }),
    );

    expect(
      (
        await screen.findByRole("alert", {
          name: "保存できなかった記録の保存結果",
        })
      ).textContent,
    ).toBe("本文を保存できませんでした。もう一度お試しください。");
    expect(screen.getByDisplayValue("保存できなかった記録")).not.toBeNull();
  });

  it("F-004 disables the whole list during a classification to prevent a concurrent lost update", async () => {
    const repository = repositoryWithCaptures();
    render(<InboxPage now={() => now} repository={repository} />);

    const memoButtons = await screen.findAllByRole("button", { name: "メモ" });
    fireEvent.click(memoButtons[0]!);

    expect(memoButtons[1]!.hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    const finalSnapshot = (repository.save as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(
      finalSnapshot.captures.map(
        (capture: { classification: string }) => capture.classification,
      ),
    ).toEqual(["unclassified", "note"]);
  });

  it("F-006 shows notes newest first and routes a chosen note to the task candidate", async () => {
    const onTaskCandidate = vi.fn();
    render(
      <InboxPage
        onTaskCandidate={onTaskCandidate}
        repository={repositoryWithNotes()}
      />,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "メモ" }));

    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("新しいメモ"),
      expect.stringContaining("最も古いメモ"),
    ]);
    fireEvent.click(
      screen.getAllByRole("button", { name: "タスクにする" })[0]!,
    );
    expect(onTaskCandidate).toHaveBeenCalledWith("note-new");
  });
});
