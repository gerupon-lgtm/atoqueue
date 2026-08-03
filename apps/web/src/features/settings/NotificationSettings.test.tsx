import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptySnapshot, type AppRepository } from "../../../../../packages/domain/src";
import { NotificationSettings } from "./NotificationSettings";

afterEach(cleanup);

describe("NotificationSettings", () => {
  it("does not request permission on initial load and requests only after explicit action", async () => {
    const setup = vi.fn().mockResolvedValue({ state: "granted" });
    render(<NotificationSettings repository={memory()} setup={setup} />);

    expect(setup).not.toHaveBeenCalled();
    expect(screen.getByText("タスク本文は通知サーバーへ送信しません。" )).not.toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "通知を設定する" }));
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["denied", "ブラウザの設定から通知を許可してください。"],
    ["unavailable", "このブラウザでは通知を利用できません。アプリを開いて今日の確認を使えます。"],
  ] as const)("shows fallback guidance when notification state is %s", async (state, message) => {
    render(<NotificationSettings repository={memory()} setup={async () => ({ state })} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "通知を設定する" }));
    expect(await screen.findByText(message)).not.toBeNull();
  });
});

function memory(): AppRepository {
  const value = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now: "2026-08-04T08:00:00.000Z" });
  return { load: async () => value, save: async () => undefined, loadDraft: async () => "", saveDraft: async () => undefined, clearDraft: async () => undefined };
}
