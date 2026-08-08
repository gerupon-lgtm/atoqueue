import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackup, createEmptySnapshot, type AppRepository } from "../../../../../packages/domain/src";
import { SettingsPage } from "./SettingsPage";

afterEach(cleanup);

describe("SettingsPage", () => {
  it("F-017/F-018 combines backup controls, notification settings, and local-only app information", () => {
    render(<SettingsPage repository={memory()} />);
    expect(screen.getByRole("button", { name: "JSONバックアップを書き出す" })).not.toBeNull();
    expect(screen.getByLabelText("JSONバックアップを復元")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "通知" })).not.toBeNull();
    expect(screen.getByText("あとキュー")).not.toBeNull();
    expect(screen.getByText(/バージョン/)).not.toBeNull();
    expect(screen.getByText("この端末にのみデータを保存します。")).not.toBeNull();
    expect(screen.getByText(/同期しません/)).not.toBeNull();
  });

  it("F-017/F-018 delegates post-restore notification sync to the injected application service", async () => {
    const flushNotifications = vi.fn(async () => undefined);
    const repository = memory();
    render(<SettingsPage flushNotifications={flushNotifications} repository={repository} />);

    const incoming = createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "88888888-8888-4888-8888-888888888888", timeZone: "Asia/Tokyo", now: "2026-08-04T09:00:00.000Z" });
    const input = screen.getByLabelText("JSONバックアップを復元");
    await userEvent.setup().upload(input, new File([await createBackup(incoming)], "backup.json", { type: "application/json" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "この内容で置き換える" }));

    await waitFor(() => expect(flushNotifications).toHaveBeenCalledTimes(1));
  });
});

function memory(): AppRepository {
  const value = createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "local", timeZone: "Asia/Tokyo", now: "2026-08-04T09:00:00.000Z" });
  return { load: async () => value, save: async () => undefined, loadDraft: async () => "", saveDraft: async () => undefined, clearDraft: async () => undefined };
}
