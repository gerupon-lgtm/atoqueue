// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySnapshot,
  type AppRepository,
  type AppSnapshot,
  type Task,
} from "../../../../../packages/domain/src";
import { CategorySettings } from "./CategorySettings";

afterEach(cleanup);

describe("CategorySettings", () => {
  it("adds a device-local category and persists the draft only after explicit save", async () => {
    const { repository, save } = memory();
    render(<CategorySettings repository={repository} />);

    expect(
      await screen.findByText(/この端末だけに追加できます/),
    ).toBeTruthy();
    expect(screen.getByText("プリセット（変更不可）")).toBeTruthy();
    expect(screen.getByText("仕事")).toBeTruthy();
    expect(screen.getByText("0 / 10件")).toBeTruthy();

    await userEvent.setup().type(screen.getByLabelText("カテゴリ名"), "冷蔵庫");
    await userEvent.setup().click(screen.getByRole("button", { name: "追加" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("冷蔵庫")).toBeTruthy();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "カテゴリを保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0].settings.customTaskCategories).toEqual([
      "冷蔵庫",
    ]);
    expect(screen.getByRole("status").textContent).toBe(
      "カテゴリを保存しました。",
    );
  });

  it("shows the full limit before input and re-enables addition for a pending removal", async () => {
    const customTaskCategories = Array.from(
      { length: 10 },
      (_, index) => `分類${index}`,
    );
    const { repository } = memory({
      customTaskCategories,
      tasks: [
        task("active-one", "active", "分類0"),
        task("active-two", "active", "分類0"),
        task("done", "completed", "分類0"),
      ],
    });
    render(<CategorySettings repository={repository} />);

    expect(await screen.findByText("10 / 10件")).toBeTruthy();
    expect((screen.getByLabelText("カテゴリ名") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/追加カテゴリは10件までです/)).toBeTruthy();

    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "分類0を削除予定にする" }),
      );
    expect(screen.getByText("9 / 10件")).toBeTruthy();
    expect((screen.getByLabelText("カテゴリ名") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect(
      screen.getByText(
        "「分類0」が付いたタスク: 3件（対応中2件、完了・アーカイブ1件）",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/これらのタスクには残ります/)).toBeTruthy();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "分類0の削除を元に戻す" }));
    expect(screen.getByText("10 / 10件")).toBeTruthy();
  });

  it("keeps the edited categories visible when persistence fails", async () => {
    const { repository } = memory({ saveError: true });
    render(<CategorySettings repository={repository} />);
    await screen.findByText("0 / 10件");

    await userEvent.setup().type(screen.getByLabelText("カテゴリ名"), "経費");
    await userEvent.setup().click(screen.getByRole("button", { name: "追加" }));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "カテゴリを保存" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "カテゴリを保存できませんでした",
    );
    expect(screen.getByText("経費")).toBeTruthy();
  });
});

function memory(options: {
  customTaskCategories?: string[];
  tasks?: Task[];
  saveError?: boolean;
} = {}): { repository: AppRepository; save: ReturnType<typeof vi.fn> } {
  let snapshot: AppSnapshot = createEmptySnapshot({
    appVersion: "mvp-1.5.0",
    localDeviceId: "device-1",
    timeZone: "Asia/Tokyo",
    now: "2026-08-10T00:00:00.000Z",
  });
  snapshot = {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      customTaskCategories: options.customTaskCategories ?? [],
    },
    tasks: options.tasks ?? [],
  };
  const save = vi.fn(async (next: AppSnapshot) => {
    if (options.saveError) throw new Error("quota");
    snapshot = next;
  });
  return {
    repository: {
      load: async () => snapshot,
      save,
      loadDraft: async () => "",
      saveDraft: async () => undefined,
      clearDraft: async () => undefined,
    },
    save,
  };
}

function task(id: string, status: Task["status"], category: string): Task {
  return {
    id,
    sourceCaptureId: `capture-${id}`,
    title: id,
    category,
    status,
    dueMode: "unset",
    nextReviewAt: "2026-08-11T00:00:00.000Z",
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    revision: 1,
  };
}
