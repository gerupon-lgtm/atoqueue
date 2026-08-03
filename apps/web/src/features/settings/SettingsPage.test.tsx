import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptySnapshot, type AppRepository } from "../../../../../packages/domain/src";
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
});

function memory(): AppRepository {
  const value = createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "local", timeZone: "Asia/Tokyo", now: "2026-08-04T09:00:00.000Z" });
  return { load: async () => value, save: async () => undefined, loadDraft: async () => "", saveDraft: async () => undefined, clearDraft: async () => undefined };
}
