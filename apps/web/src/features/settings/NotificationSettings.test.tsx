import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySnapshot,
  type AppRepository,
} from "../../../../../packages/domain/src";
import { NotificationSettings } from "./NotificationSettings";

afterEach(cleanup);

describe("NotificationSettings", () => {
  it("does not request permission on initial load and requests only after explicit action", async () => {
    const setup = vi.fn().mockResolvedValue({ state: "granted" });
    render(<NotificationSettings repository={memory()} setup={setup} />);

    expect(setup).not.toHaveBeenCalled();
    expect(
      screen.getByText(/タスク本文は通知サーバーへ送信しません/),
    ).not.toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "通知を設定する" }));
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["denied", "ブラウザの設定から通知を許可してください。"],
    [
      "unavailable",
      "このブラウザでは通知を利用できません。アプリを開いて今日の確認を使えます。",
    ],
  ] as const)(
    "shows fallback guidance when notification state is %s",
    async (state, message) => {
      render(
        <NotificationSettings
          repository={memory()}
          setup={async () => ({ state })}
        />,
      );
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "通知を設定する" }));
      expect(await screen.findByText(message)).not.toBeNull();
    },
  );

  it("does not make another browser permission request after it was denied", async () => {
    const setup = vi.fn().mockResolvedValue({ state: "denied" });
    render(<NotificationSettings repository={memory()} setup={setup} />);
    const button = screen.getByRole("button", { name: "通知を設定する" });
    await userEvent.setup().click(button);
    await screen.findByRole("alert");
    expect(button).toHaveProperty("disabled", true);
    await userEvent.setup().click(button);
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it("shows a persistent re-registration action when the saved device credentials are stale", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "test",
      localDeviceId: "local",
      timeZone: "Asia/Tokyo",
      now: "2026-08-04T08:00:00.000Z",
    });
    snapshot.device.pushSubscriptionStatus = "granted";
    snapshot.settings.notificationEnabled = false;
    render(
      <NotificationSettings
        repository={memory(snapshot)}
        setup={async () => ({ state: "granted" })}
      />,
    );
    expect(
      await screen.findByText("通知を再設定してください。"),
    ).not.toBeNull();
  });

  it("explains whether public-key loading, browser subscription, or API rate limiting blocked notification setup", async () => {
    const user = userEvent.setup();
    const setup = vi
      .fn()
      .mockResolvedValueOnce({ state: "error", reason: "public_key" })
      .mockResolvedValueOnce({ state: "error", reason: "subscription" })
      .mockResolvedValueOnce({ state: "error", reason: "rate_limited" });
    render(<NotificationSettings repository={memory()} setup={setup} />);

    await user.click(screen.getByRole("button", { name: "通知を設定する" }));
    expect(
      await screen.findByText(
        "通知サービスの公開鍵を取得できませんでした。通信状態を確認してから、もう一度お試しください。",
      ),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "通知を設定する" }));
    expect(
      await screen.findByText(
        "ブラウザで通知購読を作成できませんでした。ブラウザのサイト設定を確認してから、もう一度お試しください。",
      ),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "通知を設定する" }));
    expect(
      await screen.findByText(
        "短時間に通知設定を繰り返したため、しばらく待ってからもう一度お試しください。",
      ),
    ).not.toBeNull();
  });

  it("saves global initial and deadline-before reminder timing locally", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "test",
      localDeviceId: "local",
      timeZone: "Asia/Tokyo",
      now: "2026-08-04T08:00:00.000Z",
    });
    const repository: AppRepository = {
      load: async () => snapshot,
      save: vi.fn().mockResolvedValue(undefined),
      loadDraft: async () => "",
      saveDraft: async () => undefined,
      clearDraft: async () => undefined,
    };
    const user = userEvent.setup();
    render(<NotificationSettings repository={repository} />);

    const initial = await screen.findByLabelText("記録の初回通知まで（分）");
    const deadline = screen.getByLabelText("期限前通知（分）");
    await user.clear(initial);
    await user.type(initial, "90");
    await user.clear(deadline);
    await user.type(deadline, "45");
    const defaultDeadlineTime = screen.getByLabelText("期限の既定時刻");
    await user.clear(defaultDeadlineTime);
    await user.type(defaultDeadlineTime, "1830");
    await user.click(
      screen.getByRole("button", { name: "通知タイミングを保存" }),
    );

    await waitFor(() =>
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            initialReminderDelayMinutes: 90,
            deadlineReminderLeadMinutes: 45,
            defaultDeadlineTime: "18:30",
          }),
        }),
      ),
    );
    expect(
      screen.getByRole("status", { name: "通知タイミングの保存結果" })
        .textContent,
    ).toBe("通知タイミングを保存しました。");
  });

  it("formats the default deadline time and selects all text when the user taps it", async () => {
    render(<NotificationSettings repository={memory()} />);

    const time = (await screen.findByLabelText(
      "期限の既定時刻",
    )) as HTMLInputElement;
    expect(time.value).toBe("23:59");
    fireEvent.focus(time);
    await waitFor(() => {
      expect(time.selectionStart).toBe(0);
      expect(time.selectionEnd).toBe(5);
    });
    expect(
      screen.getByRole("button", {
        name: "時計で日付だけの期限に使う時刻を選ぶ",
      }),
    ).toBeTruthy();
  });

  it("selects touch-focused time and minute values after a short delay", async () => {
    render(<NotificationSettings repository={memory()} />);

    const time = (await screen.findByLabelText(
      "期限の既定時刻",
    )) as HTMLInputElement;
    fireEvent.pointerDown(time, { pointerType: "touch" });
    fireEvent.focus(time);
    await waitFor(() => {
      expect(time.selectionStart).toBe(0);
      expect(time.selectionEnd).toBe(5);
    });

    fireEvent.input(time, { inputType: "insertText", target: { value: "1" } });
    expect(time.value).toBe("1");

    const minutes = screen.getByLabelText(
      "記録の初回通知まで（分）",
    ) as HTMLInputElement;
    expect(minutes.type).toBe("text");
    expect(minutes.inputMode).toBe("numeric");
    fireEvent.pointerDown(minutes, { pointerType: "touch" });
    fireEvent.focus(minutes);
    await waitFor(() => {
      expect(minutes.selectionStart).toBe(0);
      expect(minutes.selectionEnd).toBe(2);
    });

    fireEvent.input(minutes, {
      inputType: "insertText",
      target: { value: "9a" },
    });
    expect(minutes.value).toBe("9");
  });

  it("groups each timing label, minute input, and unit into a compact setting row", async () => {
    render(<NotificationSettings repository={memory()} />);

    const initial = await screen.findByLabelText("記録の初回通知まで（分）");
    const deadline = screen.getByLabelText("期限前通知（分）");
    expect(
      initial.closest(".notification-settings__timing-row"),
    ).not.toBeNull();
    expect(
      deadline.closest(".notification-settings__timing-row"),
    ).not.toBeNull();
    expect(initial.parentElement?.textContent).toContain("分後");
    expect(deadline.parentElement?.textContent).toContain("分前");
  });

  it("de-emphasizes but keeps the reconfiguration action when the saved device and browser subscription are ready", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "test",
      localDeviceId: "local",
      timeZone: "Asia/Tokyo",
      now: "2026-08-04T08:00:00.000Z",
    });
    snapshot.device.pushDeviceId = "device-id";
    snapshot.device.pushDeviceSecret = "secret";
    snapshot.device.registeredAt = "2026-08-04T08:00:00.000Z";
    snapshot.device.pushSubscriptionStatus = "granted";
    snapshot.settings.notificationEnabled = true;
    render(
      <NotificationSettings
        inspectBrowserState={async () => "ready"}
        repository={memory(snapshot)}
      />,
    );

    expect(
      await screen.findByText("この端末は通知設定済みです。"),
    ).toBeTruthy();
    expect(screen.queryByText("通知を設定しました。")).toBeNull();
    const reconfigure = screen.getByRole("button", {
      name: "通知を再設定する",
    });
    expect(reconfigure).not.toHaveProperty("disabled", true);
    expect(reconfigure.classList).toContain("is-configured");
    expect(screen.getByLabelText("通知の端末登録日時").textContent).toBe(
      "通知の端末登録日時: 2026/8/4 17:00",
    );
  });

  it("shows the active time zone and a concise delivery-time limitation", async () => {
    render(<NotificationSettings repository={memory()} />);

    expect(
      (await screen.findByLabelText("利用中のタイムゾーン")).textContent,
    ).toContain("Asia/Tokyo");
    expect(screen.getByText(/通知は忘れ防止の補助機能です/)).toBeTruthy();
    expect(screen.getByText(/指定時刻の通知は保証されません/)).toBeTruthy();
    expect(screen.queryByText(/省電力設定、通信状態、集中モード/)).toBeNull();
  });

  it("uses accurate review-frequency labels and explains the compact default-deadline field", async () => {
    render(<NotificationSettings repository={memory()} />);

    expect(
      await screen.findByRole("option", { name: "再通知しない" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "ゆっくり確認する" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "こまめに確認する" }),
    ).toBeTruthy();
    expect(screen.getByRole("option", { name: "見直し通知なし" })).toBeTruthy();
    expect(screen.getByText("日付だけの期限に使います。")).toBeTruthy();
  });

  it("keeps timing changes separate from the browser notification setup action", async () => {
    render(<NotificationSettings repository={memory()} />);

    const saveTiming = await screen.findByRole("button", {
      name: "通知タイミングを保存",
    });
    const configure = screen.getByRole("button", { name: "通知を設定する" });

    expect(saveTiming.closest(".notification-settings__timing")).not.toBeNull();
    expect(
      configure.closest(".notification-settings__device-setup"),
    ).not.toBeNull();
    expect(
      saveTiming.closest(".notification-settings__device-setup"),
    ).toBeNull();
  });

  it("saves the inbox and memo review frequencies only after explicit confirmation", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "test",
      localDeviceId: "local",
      timeZone: "Asia/Tokyo",
      now: "2026-08-04T08:00:00.000Z",
    });
    snapshot.captures = [
      {
        id: "inbox-local-only",
        body: "unclassified private body",
        classification: "unclassified",
        createdAt: "2026-08-04T07:00:00.000Z",
        updatedAt: "2026-08-04T07:00:00.000Z",
      },
      {
        id: "memo-local-only",
        body: "memo private body",
        classification: "note",
        createdAt: "2026-08-04T07:00:00.000Z",
        updatedAt: "2026-08-04T07:00:00.000Z",
      },
    ];
    const repository = writableMemory(snapshot);
    const flushNotifications = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <NotificationSettings
        repository={repository}
        flushNotifications={flushNotifications}
      />,
    );

    const inbox = await screen.findByLabelText("未整理の受信箱の確認頻度");
    const memo = screen.getByLabelText("メモの見直し頻度");
    await user.selectOptions(inbox, "prompt");
    await user.selectOptions(memo, "monthly");
    expect(screen.getByText("変更を保存してください")).not.toBeNull();
    expect(
      inbox
        .closest(".notification-settings__review-frequency")
        ?.classList.contains("is-dirty"),
    ).toBe(true);
    expect((await repository.load()).settings.inboxReminderFrequency).toBe(
      "gentle",
    );

    await user.click(screen.getByRole("button", { name: "確認頻度を保存" }));

    await waitFor(async () =>
      expect((await repository.load()).settings).toMatchObject({
        inboxReminderFrequency: "prompt",
        memoReviewFrequency: "monthly",
      }),
    );
    expect((await repository.load()).notificationOutbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ notificationType: "inbox_review" }),
        expect.objectContaining({
          notificationType: "inbox_review",
          repeatCadence: "monthly",
        }),
      ]),
    );
    expect(flushNotifications).toHaveBeenCalledTimes(1);
  });

  it("keeps locally saved review frequencies and offers a retry when notification synchronization fails", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "test",
      localDeviceId: "local",
      timeZone: "Asia/Tokyo",
      now: "2026-08-04T08:00:00.000Z",
    });
    const repository = writableMemory(snapshot);
    const flushNotifications = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(
      <NotificationSettings
        repository={repository}
        flushNotifications={flushNotifications}
      />,
    );

    await user.selectOptions(
      await screen.findByLabelText("未整理の受信箱の確認頻度"),
      "none",
    );
    await user.click(screen.getByRole("button", { name: "確認頻度を保存" }));

    expect(
      await screen.findByText("通知の同期に失敗しました。再試行できます。"),
    ).not.toBeNull();
    expect((await repository.load()).settings.inboxReminderFrequency).toBe(
      "none",
    );

    await user.click(
      screen.getByRole("button", { name: "通知の同期を再試行" }),
    );
    expect(
      await screen.findByText("通知の同期が完了しました。"),
    ).not.toBeNull();
    expect(flushNotifications).toHaveBeenCalledTimes(2);
  });

  it("keeps smartphone troubleshooting available without adding scroll before it is needed", async () => {
    render(<NotificationSettings repository={memory()} />);

    const summary = await screen.findByText("スマホで通知が来ないとき");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it("explains that delivery time may move in either direction and exposes the mechanism as an expandable control", async () => {
    const user = userEvent.setup();
    render(<NotificationSettings repository={memory()} />);

    expect(
      await screen.findByText(/通知時刻が前後することがあり/),
    ).not.toBeNull();

    const summary = screen.getByText("通知の仕組みを見る");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);

    await user.click(summary);

    expect(details.open).toBe(true);
    expect(
      screen.getByText(/通知対象は最大5分ごとに確認します/),
    ).not.toBeNull();
  });
});

function memory(
  value = createEmptySnapshot({
    appVersion: "test",
    localDeviceId: "local",
    timeZone: "Asia/Tokyo",
    now: "2026-08-04T08:00:00.000Z",
  }),
): AppRepository {
  return {
    load: async () => value,
    save: async () => undefined,
    loadDraft: async () => "",
    saveDraft: async () => undefined,
    clearDraft: async () => undefined,
  };
}

function writableMemory(
  initial: ReturnType<typeof createEmptySnapshot>,
): AppRepository {
  let value = structuredClone(initial);
  return {
    load: async () => structuredClone(value),
    save: async (next) => {
      value = structuredClone(next);
    },
    loadDraft: async () => "",
    saveDraft: async () => undefined,
    clearDraft: async () => undefined,
  };
}
