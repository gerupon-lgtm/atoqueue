// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRepository, AppSnapshot } from "../../../../../packages/domain/src";
import { createEmptySnapshot } from "../../../../../packages/domain/src";
import { QuickCapturePage } from "./QuickCapturePage";

const now = "2026-08-03T00:00:00.000Z";

function createRepository(overrides: Partial<AppRepository> = {}): AppRepository {
  return {
    load: vi.fn().mockResolvedValue(
      createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now,
      }),
    ),
    save: vi.fn().mockResolvedValue(undefined),
    loadDraft: vi.fn().mockResolvedValue(""),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("QuickCapturePage", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders one text field, omits task metadata controls, and focuses it", async () => {
    const repository = createRepository();
    render(<QuickCapturePage repository={repository} />);

    const input = await screen.findByRole("textbox", { name: "思いついたこと" });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("heading").textContent).toBe("あとで思い出したいことは？");
    expect(screen.queryByLabelText(/期限|カテゴリ/)).toBeNull();
    expect(input).toBe(document.activeElement);
    expect(
      screen.getByRole("button", { name: "保存して戻る" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("saves a draft after 300ms through the repository", async () => {
    vi.useFakeTimers();
    const repository = createRepository();
    render(<QuickCapturePage repository={repository} />);
    await act(async () => {
      await Promise.resolve();
    });
    const input = screen.getByRole("textbox", { name: "思いついたこと" });

    fireEvent.change(input, { target: { value: "牛乳を買う" } });
    await vi.advanceTimersByTimeAsync(299);
    expect(repository.saveDraft).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(repository.saveDraft).toHaveBeenCalledWith("牛乳を買う");
  });

  it("prevents more than 280 characters before attempting persistence", async () => {
    const repository = createRepository();
    render(<QuickCapturePage repository={repository} />);
    const input = await screen.findByRole("textbox", { name: "思いついたこと" });

    fireEvent.change(input, { target: { value: "あ".repeat(281) } });

    expect(
      screen.getByRole("button", { name: "保存して戻る" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("280文字以内で入力してください");
  });

  it("saves with Ctrl+Enter, clears the draft, and announces completion", async () => {
    const repository = createRepository();
    const user = userEvent.setup();
    render(
      <QuickCapturePage
        createId={() => "capture-1"}
        now={() => now}
        repository={repository}
      />,
    );
    const input = await screen.findByRole("textbox", { name: "思いついたこと" });

    await user.type(input, "  牛乳を買う  ");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(repository.clearDraft).toHaveBeenCalledOnce();
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("status").textContent).toBe(
      "保存しました。いまの作業に戻って大丈夫です",
    );
    expect((repository.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      captures: [expect.objectContaining({ body: "牛乳を買う" })],
    });
  });

  it("saves with Enter while Shift+Enter keeps a line break", async () => {
    const repository = createRepository();
    const user = userEvent.setup();
    render(<QuickCapturePage repository={repository} />);
    const input = await screen.findByRole("textbox", { name: "思いついたこと" });

    await user.type(input, "買い物");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect((input as HTMLTextAreaElement).value).toBe("買い物\n");
    await user.type(input, "牛乳");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
  });

  it("saves with Meta+Enter", async () => {
    const repository = createRepository();
    const user = userEvent.setup();
    render(<QuickCapturePage repository={repository} />);
    const input = await screen.findByRole("textbox", { name: "思いついたこと" });

    await user.type(input, "牛乳を買う");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
  });

  it("retains the text and gives recovery guidance when repository work fails", async () => {
    const repository = createRepository({
      save: vi.fn().mockRejectedValue(new Error("quota exceeded")),
    });
    const user = userEvent.setup();
    render(<QuickCapturePage repository={repository} />);
    const input = await screen.findByRole("textbox", { name: "思いついたこと" });

    await user.type(input, "牛乳を買う");
    await user.click(screen.getByRole("button", { name: "保存して戻る" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "端末に保存できませんでした。空き容量を確認して再試行してください",
      ),
    );
    expect((input as HTMLTextAreaElement).value).toBe("牛乳を買う");
  });

  it("does not create a duplicate capture when clearing the draft fails after save", async () => {
    const repository = createRepository({
      clearDraft: vi
        .fn()
        .mockRejectedValueOnce(new Error("quota exceeded"))
        .mockResolvedValue(undefined),
    });
    const user = userEvent.setup();
    render(<QuickCapturePage repository={repository} />);
    const input = await screen.findByRole("textbox", { name: "思いついたこと" });

    await user.type(input, "牛乳を買う");
    await user.click(screen.getByRole("button", { name: "保存して戻る" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "保存して戻る" }));

    await waitFor(() => expect(repository.clearDraft).toHaveBeenCalledTimes(2));
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});
