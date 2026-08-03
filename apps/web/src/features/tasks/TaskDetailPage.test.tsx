// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptySnapshot, type AppRepository, type AppSnapshot } from "../../../../../packages/domain/src";
import { TaskDetailPage } from "./TaskDetailPage";

const now = "2026-08-03T09:00:00.000Z";

function repositoryWithTask(): { repository: AppRepository; snapshot: () => AppSnapshot } {
  let current: AppSnapshot = {
    ...createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "device-1", timeZone: "UTC", now }),
    captures: [{ id: "capture-1", body: "元のメモ", classification: "task", createdAt: now, updatedAt: now, linkedTaskId: "task-1" }],
    tasks: [{ id: "task-1", sourceCaptureId: "capture-1", title: "牛乳を買う", category: "shopping", status: "active", dueMode: "scheduled", dueAt: "2026-08-02T23:59:00.000Z", nextReviewAt: "2026-08-02T23:59:00.000Z", undecidedCount: 1, dismissCount: 1, postponeCount: 0, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: now, revision: 1 }],
    actionHistory: [{ id: "event-1", entityType: "task", entityId: "task-1", action: "task_dismissed", occurredAt: "2026-08-02T09:00:00.000Z" }],
  };
  return {
    repository: { load: async () => current, save: async (next) => { current = next; }, loadDraft: async () => "", saveDraft: async () => undefined, clearDraft: async () => undefined },
    snapshot: () => current,
  };
}

describe("TaskDetailPage", () => {
  afterEach(cleanup);

  it("F-015 shows source, current/due/review state, derived neglect reason, and chronological history", async () => {
    const { repository } = repositoryWithTask();
    render(<TaskDetailPage now={() => now} repository={repository} taskId="task-1" />);

    expect((await screen.findByLabelText("元の記録")).textContent).toBe("元の記録: 元のメモ");
    expect(screen.getByLabelText("現在の状態").textContent).toBe("状態: 対応中");
    expect(screen.getByLabelText("期限の状態").textContent).toBe("期限: 期限超過");
    expect(screen.getByLabelText("次の確認").textContent).toContain("次の確認");
    expect(screen.getByLabelText("放置理由").textContent).toContain("放置理由");
    expect(screen.getByText("後回し")).toBeTruthy();
  });

  it("F-015 persists a local completion before a later sync failure and shows the pending message", async () => {
    const { repository, snapshot } = repositoryWithTask();
    const sync = vi.fn().mockRejectedValue(new Error("offline"));
    render(<TaskDetailPage now={() => now} repository={repository} sync={sync} taskId="task-1" />);

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.click(screen.getByRole("button", { name: "完了" }));

    await waitFor(() => expect(snapshot().tasks[0]).toMatchObject({ status: "completed", revision: 2 }));
    expect(screen.getByRole("alert").textContent).toBe("通知の更新を後で同期します。");
    expect(snapshot().notificationOutbox[0]).toMatchObject({ operation: "cancel" });
    expect(JSON.stringify(snapshot().notificationOutbox)).not.toContain("牛乳を買う");
  });
});
