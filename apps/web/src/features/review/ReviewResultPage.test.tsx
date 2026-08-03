// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { createEmptySnapshot, type AppRepository, type AppSnapshot } from "../../../../../packages/domain/src";
import { ReviewResultPage } from "./ReviewResultPage";

const now = "2026-08-03T09:00:00.000Z";

function repositoryWithResult(): AppRepository {
  let snapshot: AppSnapshot = {
    ...createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "device-1", timeZone: "UTC", now }),
    tasks: [
      { id: "one", sourceCaptureId: "capture-one", title: "タスク one", status: "completed", dueMode: "none", nextReviewAt: now, undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: now, updatedAt: now, completedAt: now, revision: 2 },
      { id: "two", sourceCaptureId: "capture-two", title: "タスク two", status: "active", dueMode: "none", nextReviewAt: now, undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: now, updatedAt: now, revision: 2 },
    ],
    reviewSessions: [{ id: "session-1", localDate: "2026-08-03", orderedTaskIds: ["one", "two"], currentIndex: 2, visitedTaskIds: ["one", "two"], answeredTaskIds: ["one", "two"], actionEventIds: ["event-1", "event-2"], startedAt: now, updatedAt: now, completedAt: now }],
    actionHistory: [
      { id: "event-1", entityType: "task", entityId: "one", action: "task_completed", occurredAt: now },
      { id: "event-2", entityType: "task", entityId: "two", action: "task_marked_no_due", occurredAt: now },
    ],
  };
  return { load: async () => snapshot, save: async (next) => { snapshot = next; }, loadDraft: async () => "", saveDraft: async () => undefined, clearDraft: async () => undefined };
}

describe("ReviewResultPage", () => {
  afterEach(cleanup);

  it("F-015 groups current session actions and links every processed task to its correction route", async () => {
    render(<MemoryRouter><ReviewResultPage repository={repositoryWithResult()} /></MemoryRouter>);

    expect(await screen.findByText("完了: 1件")).toBeTruthy();
    expect(screen.getByText("期限なし: 1件")).toBeTruthy();
    expect(screen.getByRole("link", { name: "タスク oneを修正" }).getAttribute("href")).toBe("/tasks/one");
    expect(screen.getByRole("link", { name: "タスク twoを修正" }).getAttribute("href")).toBe("/tasks/two");
    expect(screen.getByRole("link", { name: "タスク一覧を見る" }).getAttribute("href")).toBe("/tasks");
    expect(screen.getByRole("link", { name: "記録へ戻る" }).getAttribute("href")).toBe("/");
  });
});
