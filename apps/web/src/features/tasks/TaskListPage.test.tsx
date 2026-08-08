// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { createEmptySnapshot, type AppRepository, type AppSnapshot, type Task } from "../../../../../packages/domain/src";
import { TaskListPage } from "./TaskListPage";

const now = "2026-08-03T09:00:00.000Z";

function task(id: string, changes: Partial<Task> = {}): Task {
  return { id, sourceCaptureId: `capture-${id}`, title: id, status: "active", dueMode: "none", nextReviewAt: "2026-08-10T18:00:00.000Z", undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: now, updatedAt: now, revision: 1, ...changes };
}

function repository(): AppRepository {
  const snapshot: AppSnapshot = { ...createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "device-1", timeZone: "UTC", now }), tasks: [
    task("期限切れ", { dueMode: "scheduled", dueAt: "2026-08-02T23:59:00.000Z" }),
    task("今日", { dueMode: "scheduled", dueAt: "2026-08-03T23:59:00.000Z" }),
    task("未設定", { dueMode: "unset" }),
    task("なし"),
    task("明日", { dueMode: "scheduled", dueAt: "2026-08-04T23:59:00.000Z" }),
  ] };
  return { load: async () => snapshot, save: async () => undefined, loadDraft: async () => "", saveDraft: async () => undefined, clearDraft: async () => undefined };
}

describe("TaskListPage", () => {
  afterEach(cleanup);

  it("F-014 renders a text due-state badge and links each matching active task to its detail", async () => {
    render(<MemoryRouter><TaskListPage now={() => now} repository={repository()} /></MemoryRouter>);

    expect(await screen.findByText("期限切れ")).toBeTruthy();
    expect(screen.getByLabelText("期限切れの期限状態").textContent).toBe("期限超過");
    expect(screen.getByLabelText("今日の期限状態").textContent).toBe("今日が期限");
    expect(screen.getByLabelText("未設定の期限状態").textContent).toBe("期限未設定");
    expect(screen.getByLabelText("なしの期限状態").textContent).toBe("期限なし");
    expect(screen.getByLabelText("明日の期限状態").textContent).toBe("期限あり");
    expect(screen.getByRole("link", { name: "期限切れ" }).getAttribute("href")).toBe("/tasks/期限切れ");
    expect(screen.getByLabelText("期限切れの登録日時").textContent).toBe("登録: 2026/8/3 09:00");
  });

  it("NF-006 gives every primary list control a 44px minimum touch target", async () => {
    render(<MemoryRouter><TaskListPage now={() => now} repository={repository()} /></MemoryRouter>);

    await screen.findByRole("link", { name: "期限切れ" });
    for (const control of document.querySelectorAll<HTMLElement>("select, input, a")) {
      expect(getComputedStyle(control).minHeight).toBe("44px");
    }
  });
});
