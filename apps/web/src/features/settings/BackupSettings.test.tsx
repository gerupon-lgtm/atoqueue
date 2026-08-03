import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackup, createEmptySnapshot, type AppRepository, type AppSnapshot } from "../../../../../packages/domain/src";
import { BackupSettings } from "./BackupSettings";

const now = "2026-08-04T09:00:00.000Z";

afterEach(cleanup);

describe("BackupSettings", () => {
  it("F-017 offers a dated JSON download without serializing notification credentials", async () => {
    const snapshot = example();
    const createObjectURL = vi.fn(() => "blob:backup");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    render(<BackupSettings repository={memory(snapshot)} now={() => "2026-08-04T20:00:00.000Z"} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "JSONバックアップを書き出す" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "バックアップをダウンロード" }).getAttribute("download")).toBe("atoqueue-backup-2026-08-04.json");
  });

  it("F-018 previews incoming and current counts, then replaces only after explicit confirmation", async () => {
    const current = createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "local", timeZone: "Asia/Tokyo", now });
    const incoming = example();
    const repository = memory(current);
    const flush = vi.fn();
    render(<BackupSettings repository={repository} flushOutbox={flush} now={() => now} />);

    await selectFile(await createBackup(incoming));
    expect(await screen.findByText(/取り込みデータ: タスク 1件/)) .not.toBeNull();
    expect(screen.getByText(/現在のデータ: タスク 0件/)).not.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "この内容で置き換える" }));
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(flush).toHaveBeenCalledTimes(1);
    expect((repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].device.localDeviceId).toBe("local");
  });

  it("F-018 gives a reason for invalid files and never replaces local data", async () => {
    const repository = memory(example());
    render(<BackupSettings repository={repository} now={() => now} />);

    await selectFile("not JSON");
    expect((await screen.findByRole("alert")).textContent).toContain("JSON");
    expect(repository.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "この内容で置き換える" })).toBeNull();
  });
});

async function selectFile(contents: string): Promise<void> {
  const input = screen.getByLabelText("JSONバックアップを復元") as HTMLInputElement;
  await userEvent.setup().upload(input, new File([contents], "backup.json", { type: "application/json" }));
}

function example(): AppSnapshot {
  const value = createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "99999999-9999-4999-8999-999999999999", timeZone: "Asia/Tokyo", now });
  value.captures = [{ id: "11111111-1111-4111-8111-111111111111", body: "買い物", classification: "task", createdAt: now, updatedAt: now, classifiedAt: now, linkedTaskId: "22222222-2222-4222-8222-222222222222" }];
  value.tasks = [{ id: "22222222-2222-4222-8222-222222222222", sourceCaptureId: "11111111-1111-4111-8111-111111111111", title: "牛乳", status: "active", dueMode: "none", nextReviewAt: now, undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: now, updatedAt: now, revision: 1 }];
  return value;
}

function memory(value: AppSnapshot): AppRepository & { save: ReturnType<typeof vi.fn> } {
  const save = vi.fn(async (next: AppSnapshot) => { Object.assign(value, next); });
  return { load: async () => value, save, loadDraft: async () => "", saveDraft: async () => undefined, clearDraft: async () => undefined };
}
