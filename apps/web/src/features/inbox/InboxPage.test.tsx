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
  markNoteAsUnneeded,
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
    "不要になったメモ",
    "2026-08-02T12:00:00.000Z",
    "capture-note-unneeded",
  );
  snapshot = markAsNote({
    snapshot,
    captureId: "capture-note-unneeded",
    now,
  });
  snapshot = markNoteAsUnneeded({
    snapshot,
    captureId: "capture-note-unneeded",
    now: "2026-08-03T10:00:00.000Z",
  });
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

  it("F-004 offers three counted capture-history tabs and starts with unclassified", async () => {
    render(<InboxPage repository={repositoryWithAllClassifications()} />);

    expect(screen.queryByRole("tab", { name: "すべて" })).toBeNull();
    expect(
      (await screen.findByRole("tab", { name: /未整理.*1件/ })).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: /メモ.*1件/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /不要.*2件/ })).toBeTruthy();
  });

  it("F-004 never shows task-classified captures in the inbox", async () => {
    render(<InboxPage repository={repositoryWithAllClassifications()} />);

    expect(await screen.findAllByText("未整理の記録")).toHaveLength(2);
    expect(screen.queryByText("タスクの記録")).toBeNull();
    expect(screen.queryByRole("button", { name: "タスクを開く" })).toBeNull();
  });

  it("F-006 labels whether an unneeded capture came from unclassified or memo", async () => {
    render(<InboxPage repository={repositoryWithAllClassifications()} />);

    fireEvent.click(await screen.findByRole("tab", { name: /不要.*2件/ }));

    expect(screen.getByText("未整理から")).toBeTruthy();
    expect(screen.getByText("メモから")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("F-006 restores an unneeded capture and synchronizes its rebuilt reminders", async () => {
    const repository = repositoryWithAllClassifications();
    const sync = vi.fn().mockResolvedValue(undefined);
    render(<InboxPage now={() => now} repository={repository} sync={sync} />);

    fireEvent.click(await screen.findByRole("tab", { name: /不要.*2件/ }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "未整理に戻す" })[0]!,
    );

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

    fireEvent.click(await screen.findByRole("tab", { name: /不要.*2件/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "完全削除" })[0]!);
    expect(repository.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "完全削除" })[0]!);
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("不要な記録")).toBeNull();
  });

  it("F-006 selects every unneeded capture and restores the batch after confirmation", async () => {
    const repository = repositoryWithAllClassifications();
    const sync = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirm);
    render(<InboxPage now={() => now} repository={repository} sync={sync} />);

    fireEvent.click(await screen.findByRole("tab", { name: /不要.*2件/ }));
    fireEvent.click(screen.getByRole("button", { name: "選択" }));

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "未整理に戻す" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "すべて選択" }));
    expect(screen.getByText("2件選択中")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "選択した記録を未整理に戻す" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(
      "選択した2件を未整理に戻しますか？",
    );
    expect(sync).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toBe(
      "2件を未整理に戻しました。",
    );
  });

  it("F-006 cancels or confirms a batch permanent deletion without partial updates", async () => {
    const repository = repositoryWithAllClassifications();
    const sync = vi.fn().mockResolvedValue(undefined);
    const confirm = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    render(<InboxPage now={() => now} repository={repository} sync={sync} />);

    fireEvent.click(await screen.findByRole("tab", { name: /不要.*2件/ }));
    fireEvent.click(screen.getByRole("button", { name: "選択" }));
    fireEvent.click(screen.getByRole("button", { name: "すべて選択" }));
    const remove = screen.getByRole("button", {
      name: "選択した記録を完全削除",
    });
    fireEvent.click(remove);
    expect(repository.save).not.toHaveBeenCalled();

    fireEvent.click(remove);
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenLastCalledWith(
      "選択した2件を完全に削除しますか？この操作は元に戻せません。",
    );
    expect(sync).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toBe(
      "2件を完全に削除しました。",
    );
  });

  it("F-006 keeps the batch selection when local persistence fails", async () => {
    const repository = repositoryWithAllClassifications();
    repository.save = vi.fn().mockRejectedValue(new Error("quota"));
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<InboxPage now={() => now} repository={repository} />);

    fireEvent.click(await screen.findByRole("tab", { name: /不要.*2件/ }));
    fireEvent.click(screen.getByRole("button", { name: "選択" }));
    fireEvent.click(screen.getByRole("button", { name: "すべて選択" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "選択した記録を未整理に戻す",
      }),
    );

    await screen.findByRole("alert");
    expect(screen.getByText("2件選択中")).toBeTruthy();
    expect(
      screen
        .getAllByRole("checkbox")
        .every((checkbox) => (checkbox as HTMLInputElement).checked),
    ).toBe(true);
  });

  it("F-014 keeps a successful batch restore and reports queued synchronization", async () => {
    const repository = repositoryWithAllClassifications();
    const sync = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<InboxPage now={() => now} repository={repository} sync={sync} />);

    fireEvent.click(await screen.findByRole("tab", { name: /不要.*2件/ }));
    fireEvent.click(screen.getByRole("button", { name: "選択" }));
    fireEvent.click(screen.getByRole("button", { name: "すべて選択" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "選択した記録を未整理に戻す",
      }),
    );

    expect((await screen.findByRole("status")).textContent).toBe(
      "2件を未整理に戻しました。通知の更新は送信待ちです。",
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: /未整理.*3件/ })).toBeTruthy();
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

  it("F-004 re-enables the remaining inbox actions after the local unneeded save while notification sync is pending", async () => {
    const repository = repositoryWithCaptures();
    const sync = vi.fn(() => new Promise<never>(() => undefined));
    render(<InboxPage now={() => now} repository={repository} sync={sync} />);

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "不要" }))[0]!,
    );

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "不要" }).hasAttribute("disabled"),
      ).toBe(false),
    );
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

    fireEvent.click(await screen.findByRole("tab", { name: /メモ.*2件/ }));

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
