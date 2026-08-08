import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
      screen.getByText("タスク本文は通知サーバーへ送信しません。"),
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
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now: "2026-08-04T08:00:00.000Z" });
    const repository: AppRepository = {
      load: async () => snapshot,
      save: vi.fn().mockResolvedValue(undefined),
      loadDraft: async () => "",
      saveDraft: async () => undefined,
      clearDraft: async () => undefined,
    };
    const user = userEvent.setup();
    render(<NotificationSettings repository={repository} />);

    const initial = await screen.findByLabelText("初回通知まで（分）");
    const deadline = screen.getByLabelText("期限前通知（分）");
    await user.clear(initial);
    await user.type(initial, "90");
    await user.clear(deadline);
    await user.type(deadline, "45");
    await user.click(screen.getByRole("button", { name: "通知タイミングを保存" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ initialReminderDelayMinutes: 90, deadlineReminderLeadMinutes: 45 }),
    })));
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
