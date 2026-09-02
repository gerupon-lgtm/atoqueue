// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRepository, AppSnapshot } from "../../../../../packages/domain/src";
import {
  createCapture,
  createEmptySnapshot,
} from "../../../../../packages/domain/src";
import { APP_VERSION } from "../../app-version";
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
    Reflect.deleteProperty(window.navigator, "virtualKeyboard");
    vi.useRealTimers();
  });

  it("renders one text field and omits task metadata controls", async () => {
    const repository = createRepository();
    render(<QuickCapturePage repository={repository} />);

    await screen.findByRole("textbox", {
      name: "思いついたこと",
    });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "あとで思い出したいことは？" })
        .textContent,
    ).toBe("あとで思い出したいことは？");
    expect(screen.queryByLabelText(/期限|カテゴリ/)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "保存して戻る" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("updates the unclassified count immediately after saving a new capture", async () => {
    const repository = createRepository();
    const user = userEvent.setup();
    render(
      <QuickCapturePage
        createId={() => "capture-1"}
        now={() => now}
        repository={repository}
      />,
    );

    expect(await screen.findByText("受信箱の未整理: 0件")).toBeTruthy();
    await user.type(
      screen.getByRole("textbox", { name: "思いついたこと" }),
      "牛乳を買う",
    );
    await user.click(screen.getByRole("button", { name: "保存して戻る" }));

    expect(await screen.findByText("受信箱の未整理: 1件")).toBeTruthy();
  });

  it("does not autofocus the capture textarea while notification setup is not requested", async () => {
    const showVirtualKeyboard = vi.fn();
    Object.defineProperty(window.navigator, "virtualKeyboard", {
      configurable: true,
      value: { show: showVirtualKeyboard },
    });
    const setupNotifications = vi.fn().mockResolvedValue({ state: "granted" });
    render(
      <QuickCapturePage
        repository={createRepository()}
        setupNotifications={setupNotifications}
      />,
    );

    await screen.findByRole("button", { name: "通知を設定する" });
    expect(screen.getByLabelText("思いついたこと")).not.toBe(
      document.activeElement,
    );
    expect(showVirtualKeyboard).not.toHaveBeenCalled();
  });

  it("does not focus immediately when the startup notification check is false", () => {
    const showVirtualKeyboard = vi.fn();
    Object.defineProperty(window.navigator, "virtualKeyboard", {
      configurable: true,
      value: { show: showVirtualKeyboard },
    });
    const repository = createRepository({
      load: vi.fn().mockReturnValue(createDeferred<AppSnapshot>().promise),
      loadDraft: vi.fn().mockReturnValue(createDeferred<string>().promise),
    });

    render(
      <QuickCapturePage
        repository={repository}
        shouldAutofocusCapture={() => false}
      />,
    );

    expect(screen.getByRole("textbox", { name: "思いついたこと" })).not.toBe(
      document.activeElement,
    );
    expect(showVirtualKeyboard).not.toHaveBeenCalled();
  });

  it("autofocuses the capture textarea after notification setup has already been handled", async () => {
    const showVirtualKeyboard = vi.fn();
    Object.defineProperty(window.navigator, "virtualKeyboard", {
      configurable: true,
      value: { show: showVirtualKeyboard },
    });
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

    expect(await screen.findByRole("textbox", { name: "思いついたこと" })).toBe(
      document.activeElement,
    );
    expect(showVirtualKeyboard).toHaveBeenCalledTimes(1);
  });

  it("requests the virtual keyboard once after deferred loading and StrictMode effect replay", async () => {
    const showVirtualKeyboard = vi.fn();
    Object.defineProperty(window.navigator, "virtualKeyboard", {
      configurable: true,
      value: { show: showVirtualKeyboard },
    });
    const snapshot = createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "Asia/Tokyo",
      now,
    });
    snapshot.device.pushSubscriptionStatus = "granted";
    const load = createDeferred<AppSnapshot>();
    const loadDraft = createDeferred<string>();
    const repository = createRepository({
      load: vi.fn().mockReturnValue(load.promise),
      loadDraft: vi.fn().mockReturnValue(loadDraft.promise),
    });

    render(
      <StrictMode>
        <QuickCapturePage
          repository={repository}
          shouldAutofocusCapture={() => true}
        />
      </StrictMode>,
    );

    expect(screen.getByRole("textbox", { name: "思いついたこと" })).toBe(
      document.activeElement,
    );
    expect(showVirtualKeyboard).toHaveBeenCalledTimes(1);

    await act(async () => {
      load.resolve(snapshot);
      loadDraft.resolve("");
      await Promise.resolve();
    });

    expect(showVirtualKeyboard).toHaveBeenCalledTimes(1);
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

  it("keeps Ctrl+Enter as a save shortcut when Enter registration is on", async () => {
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

  it("adds a newline with Enter when Enter save is turned off, while the save button still creates one capture", async () => {
    const repository = createRepository();
    const user = userEvent.setup();
    render(<QuickCapturePage repository={repository} />);
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

    await user.click(screen.getByRole("checkbox", { name: "改行で登録" }));
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toMatchObject({ settings: { enterSavesCapture: false } });

    await user.type(input, "改行する");
    await user.keyboard("{Enter}");
    expect((input as HTMLTextAreaElement).value).toBe("改行する\n");
    expect(repository.save).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "保存して戻る" }));
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(2));
  });

  it("keeps Ctrl+Enter as an explicit save shortcut when Enter registration is off", async () => {
    const repository = createRepository();
    const user = userEvent.setup();
    render(<QuickCapturePage repository={repository} />);
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

    await user.click(screen.getByRole("checkbox", { name: "改行で登録" }));
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    await user.type(input, "明示的に保存する");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(2));
  });

  it("persists only the Enter setting without discarding the typed draft", async () => {
    const repository = createRepository();
    const user = userEvent.setup();
    render(<QuickCapturePage repository={repository} />);
    const input = await screen.findByRole("textbox", {
      name: "思いついたこと",
    });

    await user.type(input, "保存前の下書き");
    await user.click(screen.getByRole("checkbox", { name: "改行で登録" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect((input as HTMLTextAreaElement).value).toBe("保存前の下書き");
    expect(
      (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toMatchObject({
      captures: [],
      settings: { enterSavesCapture: false },
    });
  });

  it("prevents capture persistence while the Enter setting save is still in flight", async () => {
    const preferenceSave = createDeferred<void>();
    let storedSnapshot = createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "Asia/Tokyo",
      now,
    });
    const repository: AppRepository = {
      load: vi.fn().mockImplementation(async () => storedSnapshot),
      save: vi.fn().mockImplementation(async (next) => {
        if (next.settings.enterSavesCapture === false) {
          await preferenceSave.promise;
        }
        storedSnapshot = next;
      }),
      loadDraft: vi.fn().mockResolvedValue(""),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      clearDraft: vi.fn().mockResolvedValue(undefined),
    };
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
    await user.type(input, "設定保存中の記録");

    await user.click(screen.getByRole("checkbox", { name: "改行で登録" }));
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    const form = input.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(repository.load).toHaveBeenCalledTimes(2);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "保存して戻る" })).toHaveProperty(
      "disabled",
      true,
    );

    preferenceSave.resolve();
    await waitFor(() =>
      expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
    await user.click(screen.getByRole("button", { name: "保存して戻る" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(2));
    expect(storedSnapshot.captures).toEqual([
      expect.objectContaining({ body: "設定保存中の記録" }),
    ]);
  });

  it("keeps the Enter registration label on one line in the compact action row", async () => {
    render(<QuickCapturePage repository={createRepository()} />);

    const label = await screen.findByText("改行で登録");
    expect(label.closest(".quick-capture__actions")).not.toBeNull();
    expect(
      label.closest("label")?.classList.contains("quick-capture__enter-save"),
    ).toBe(true);
  });

  it("shows the current app version quietly below the Enter registration option", async () => {
    render(<QuickCapturePage repository={createRepository()} />);

    const label = await screen.findByText("改行で登録");
    const version = screen.getByText(`バージョン ${APP_VERSION}`);
    const stack = label.closest(".quick-capture__option-stack");

    expect(stack).not.toBeNull();
    expect(stack?.contains(version)).toBe(true);
    expect(version.classList.contains("quick-capture__version")).toBe(true);
  });

  it("keeps Meta+Enter as a save shortcut when Enter registration is on", async () => {
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
