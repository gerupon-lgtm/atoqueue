import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBackup,
  createEmptySnapshot,
  type AppRepository,
} from "../../../../../packages/domain/src";
import { SettingsPage } from "./SettingsPage";

afterEach(cleanup);

describe("SettingsPage", () => {
  it("F-017/F-018 keeps infrequent data and app information collapsed and places copyright outside them", async () => {
    render(<SettingsPage repository={memory()} />);

    const dataSummary = screen.getByText("データ", { selector: "summary" });
    const dataDetails = dataSummary.closest("details") as HTMLDetailsElement;
    expect(dataDetails).not.toBeNull();
    expect(dataDetails.open).toBe(false);
    await userEvent.setup().click(dataSummary);
    const categoryHeading = screen.getByRole("heading", { name: "カテゴリ" });
    const backupButton = screen.getByRole("button", {
      name: "JSONバックアップを書き出す",
    });
    expect(
      categoryHeading.compareDocumentPosition(backupButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(backupButton).not.toBeNull();
    expect(screen.getByLabelText("JSONバックアップを復元")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "通知" })).not.toBeNull();

    const appSummary = screen.getByText("アプリ情報", { selector: "summary" });
    const appDetails = appSummary.closest("details") as HTMLDetailsElement;
    expect(appDetails).not.toBeNull();
    expect(appDetails.open).toBe(false);
    await userEvent.setup().click(appSummary);
    expect(screen.getByText("あとキュー")).not.toBeNull();
    expect(screen.getByText(/バージョン/)).not.toBeNull();
    expect(screen.getByText("mvp-1.23.0")).not.toBeNull();
    expect(screen.getByText("© 2026 SIKUMI LAB").closest("details")).toBeNull();
  });

  it("F-017/F-018 delegates post-restore notification sync to the injected application service", async () => {
    const flushNotifications = vi.fn(async () => undefined);
    const repository = memory();
    render(
      <SettingsPage
        flushNotifications={flushNotifications}
        repository={repository}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByText("データ", { selector: "summary" }));

    const incoming = createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "88888888-8888-4888-8888-888888888888",
      timeZone: "Asia/Tokyo",
      now: "2026-08-04T09:00:00.000Z",
    });
    const input = screen.getByLabelText("JSONバックアップを復元");
    await userEvent.setup().upload(
      input,
      new File([await createBackup(incoming)], "backup.json", {
        type: "application/json",
      }),
    );
    await userEvent
      .setup()
      .click(
        await screen.findByRole("button", { name: "この内容で置き換える" }),
      );

    await waitFor(() => expect(flushNotifications).toHaveBeenCalledTimes(1));
  });

  it("offers a separate, explicit confirmation before delegating device-data deletion", async () => {
    const deleteDeviceData = vi.fn(async () => undefined);
    render(
      <SettingsPage
        deleteDeviceData={deleteDeviceData}
        repository={memory()}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByText("データ", { selector: "summary" }));

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "端末データを削除" }));
    expect(deleteDeviceData).not.toHaveBeenCalled();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "削除を確定する" }));
    await waitFor(() => expect(deleteDeviceData).toHaveBeenCalledOnce());
    expect(screen.getByRole("status").textContent).toContain(
      "端末データを削除しました",
    );
  });
});

function memory(): AppRepository {
  const value = createEmptySnapshot({
    appVersion: "0.1.0",
    localDeviceId: "local",
    timeZone: "Asia/Tokyo",
    now: "2026-08-04T09:00:00.000Z",
  });
  return {
    load: async () => value,
    save: async () => undefined,
    loadDraft: async () => "",
    saveDraft: async () => undefined,
    clearDraft: async () => undefined,
  };
}
