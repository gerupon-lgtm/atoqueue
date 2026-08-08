// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../../../../../packages/domain/src";
import {
  createCapture,
  createEmptySnapshot,
} from "../../../../../packages/domain/src";
import { QuickCapturePage } from "./QuickCapturePage";

const now = "2026-08-03T00:00:00.000Z";

function createRepository(
  overrides: Partial<AppRepository> = {},
): AppRepository {
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("QuickCapturePage", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders one text field, omits task metadata controls, and focuses it", async () => {
    const repository = createRepository();
    render(<QuickCapturePage repository={repository} />);

    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "あとで思い出したいことは？" })
        .textContent,
    ).toBe("あとで思い出したいことは？");
    expect(screen.queryByLabelText(/期限|カテゴリ/)).toBeNull();
    expect(input).toBe(document.activeElement);
    expect(
      screen
        .getByRole("button", { name: "保存して戻る" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows a first-use guide and stores its dismissal locally", async () => {
    const repository = createRepository();
    render(<QuickCapturePage now={() => now} repository={repository} />);

    expect(
      await screen.findByRole("heading", { name: "はじめに" }),
    ).toBeTruthy();
    expect(
      screen.getByText("通知のタイミングは設定で変えられます。"),
    ).toBeTruthy();
    expect(screen.getByText("記録は受信箱でタスクにできます。")).toBeTruthy();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "はじめる" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toMatchObject({ settings: { onboardingCompletedAt: now } });
  });

  it("offers notification setup from capture only until the user has acted on it", async () => {
    const repository = createRepository();
    const setupNotifications = vi.fn().mockResolvedValue({ state: "granted" });
    render(
      <QuickCapturePage
        repository={repository}
        setupNotifications={setupNotifications}
      />,
    );

    const button = await screen.findByRole("button", {
      name: "通知を設定する",
    });
    await userEvent.setup().click(button);
    await waitFor(() => expect(setupNotifications).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "通知を設定する" })).toBeNull();
  });

  it("does not show notification setup from capture after a browser has already been registered", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "Asia/Tokyo",
      now,
    });
    snapshot.device.pushSubscriptionStatus = "granted";
    render(
      <QuickCapturePage
        repository={createRepository({
          load: vi.fn().mockResolvedValue(snapshot),
        })}
      />,
    );

    await screen.findByRole("textbox", { name: "思いついたこと" });
    expect(screen.queryByRole("button", { name: "通知を設定する" })).toBeNull();
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
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

    fireEvent.change(input, { target: { value: "あ".repeat(281) } });

    expect(
      screen
        .getByRole("button", { name: "保存して戻る" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe(
      "280文字以内で入力してください",
    );
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
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

    await user.type(input, "  牛乳を買う  ");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(repository.clearDraft).toHaveBeenCalledOnce();
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("status").textContent).toBe(
      "保存しました。いまの作業に戻って大丈夫です",
    );
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toMatchObject({
      captures: [expect.objectContaining({ body: "牛乳を買う" })],
    });
  });

  it("F-014 asks the application notification synchronizer to deliver the new inbox reminder", async () => {
    const repository = createRepository();
    const onNotificationChanged = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <QuickCapturePage
        createId={() => "capture-1"}
        now={() => now}
        onNotificationChanged={onNotificationChanged}
        repository={repository}
      />,
    );
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

    await user.type(input, "牛乳を買う");
    await user.click(screen.getByRole("button", { name: "保存して戻る" }));

    await waitFor(() => expect(onNotificationChanged).toHaveBeenCalledOnce());
  });

  it("saves with Enter while Shift+Enter keeps a line break", async () => {
    const repository = createRepository();
    const user = userEvent.setup();
    render(<QuickCapturePage repository={repository} />);
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

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
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

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
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

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
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

    await user.type(input, "牛乳を買う");
    await user.click(screen.getByRole("button", { name: "保存して戻る" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "保存して戻る" }));

    await waitFor(() => expect(repository.clearDraft).toHaveBeenCalledTimes(2));
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it("does not create a duplicate after reload when draft clearing failed", async () => {
    let storedSnapshot = createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "Asia/Tokyo",
      now,
    });
    let storedDraft = "牛乳を買う";
    let clearAllowed = false;
    const repository: AppRepository = {
      load: vi.fn().mockImplementation(async () => storedSnapshot),
      save: vi.fn().mockImplementation(async (next) => {
        storedSnapshot = next;
      }),
      loadDraft: vi.fn().mockImplementation(async () => storedDraft),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      clearDraft: vi.fn().mockImplementation(async () => {
        if (!clearAllowed) throw new Error("quota exceeded");
        storedDraft = "";
      }),
    };
    const user = userEvent.setup();
    const first = render(
      <QuickCapturePage
        createId={() => "capture-1"}
        now={() => now}
        repository={repository}
      />,
    );
    const firstInput = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

    await user.click(screen.getByRole("button", { name: "保存して戻る" }));
    await screen.findByRole("alert");
    expect(storedSnapshot.captures).toHaveLength(1);
    first.unmount();

    render(
      <QuickCapturePage
        createId={() => "capture-2"}
        now={() => now}
        repository={repository}
      />,
    );
    const reloadedInput = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });
    expect((reloadedInput as HTMLTextAreaElement).value).toBe("牛乳を買う");
    clearAllowed = true;
    await user.click(screen.getByRole("button", { name: "保存して戻る" }));

    await waitFor(() => expect(storedDraft).toBe(""));
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(storedSnapshot.captures).toHaveLength(1);
    expect(firstInput).not.toBe(reloadedInput);
  });

  it("saves an edited recovered draft as a new capture", async () => {
    let storedSnapshot = createCapture(
      createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now,
      }),
      "古い下書き",
      now,
      "capture-old",
    );
    let storedDraft = "古い下書き";
    let clearAllowed = false;
    const repository: AppRepository = {
      load: vi.fn().mockImplementation(async () => storedSnapshot),
      save: vi.fn().mockImplementation(async (next) => {
        storedSnapshot = next;
      }),
      loadDraft: vi.fn().mockImplementation(async () => storedDraft),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      clearDraft: vi.fn().mockImplementation(async () => {
        if (!clearAllowed) throw new Error("quota exceeded");
        storedDraft = "";
      }),
    };
    const user = userEvent.setup();
    render(
      <QuickCapturePage
        createId={() => "capture-new"}
        now={() => now}
        repository={repository}
      />,
    );
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });
    await screen.findByRole("alert");

    await user.clear(input);
    await user.type(input, "新しい下書き");
    clearAllowed = true;
    await user.click(screen.getByRole("button", { name: "保存して戻る" }));

    await waitFor(() => expect(storedDraft).toBe(""));
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(storedSnapshot.captures.map((capture) => capture.body)).toEqual([
      "古い下書き",
      "新しい下書き",
    ]);
  });

  it("keeps the newest draft when asynchronous draft writes complete out of order", async () => {
    vi.useFakeTimers();
    const oldWrite = createDeferred<void>();
    const newWrite = createDeferred<void>();
    let storedDraft = "";
    const repository = createRepository({
      saveDraft: vi.fn((value: string) => {
        const write = value === "古い下書き" ? oldWrite : newWrite;
        return write.promise.then(() => {
          storedDraft = value;
        });
      }),
    });
    render(<QuickCapturePage repository={repository} />);
    await act(async () => {
      await Promise.resolve();
    });
    const input = screen.getByRole("textbox", { name: "思いついたこと" });

    fireEvent.change(input, { target: { value: "古い下書き" } });
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.change(input, { target: { value: "新しい下書き" } });
    await vi.advanceTimersByTimeAsync(300);
    newWrite.resolve();
    oldWrite.resolve();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(repository.clearDraft).not.toHaveBeenCalled();
    expect(storedDraft).toBe("新しい下書き");
  });
});
