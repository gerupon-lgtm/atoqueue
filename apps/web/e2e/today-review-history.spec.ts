import { expect, test } from "@playwright/test";
import { createEmptySnapshot } from "../../../packages/domain/src";

test("F-009 browses and corrects all four daily cards after status changes outside Today", async ({ page }) => {
  const now = "2026-08-31T08:39:00.000Z";
  await page.clock.setFixedTime(new Date(now));
  await page.setViewportSize({ width: 412, height: 760 });
  const snapshot = createEmptySnapshot({ appVersion: "mvp-1.20.1", localDeviceId: "history-test", timeZone: "Asia/Tokyo", now });
  snapshot.settings.onboardingCompletedAt = now;
  snapshot.tasks = ["病院", "豆腐", "整髪ポマード", "ペットボトルを捨てにいく"].map((title, index) => ({
    id: `task-${index}`, sourceCaptureId: `capture-${index}`, title, status: "active", dueMode: "scheduled",
    dueAt: "2026-08-31T02:00:00.000Z", nextReviewAt: "2026-08-31T02:00:00.000Z",
    undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: now, updatedAt: now, revision: 1,
  }));
  snapshot.reviewSessions = [{ id: "daily-review", localDate: "2026-08-31", orderedTaskIds: ["task-0", "task-1", "task-2", "task-3"], currentIndex: 1, visitedTaskIds: [], answeredTaskIds: [], actionEventIds: [], startedAt: now, updatedAt: now }];
  await page.addInitScript(value => {
    if (!localStorage.getItem("atoqueue:data:v1")) localStorage.setItem("atoqueue:data:v1", JSON.stringify(value));
    localStorage.setItem("atoqueue:install-prompt-seen:v1", "seen");
  }, snapshot);
  for (const [id, action, status] of [["task-0", "完了", "完了"], ["task-2", "アーカイブ", "アーカイブ"], ["task-3", "完了", "完了"]]) {
    await page.goto(`/tasks/${id}`);
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page.getByLabel("現在の状態")).toHaveText(`状態: ${status}`);
  }
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "豆腐", exact: true })).toBeVisible();
  await expect(page.getByTestId("review-progress")).toHaveText("2 / 4");
  await page.getByRole("button", { name: "前のタスク" }).click();
  for (const [title, progress, status] of [["病院", "1 / 4", "完了"], ["豆腐", "2 / 4", ""], ["整髪ポマード", "3 / 4", "アーカイブ"], ["ペットボトルを捨てにいく", "4 / 4", "完了"]]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByTestId("review-progress")).toHaveText(progress);
    if (status) {
      await expect(page.getByText(`このタスクは${status}マーク済みです。`)).toBeVisible();
      await expect(page.locator(".reviewCurrentStatus strong")).toHaveText(status);
    }
    await page.getByRole("button", { name: "次のタスク" }).click();
  }
  await expect(page.getByRole("heading", { name: "病院", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "豆腐", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "前のタスク" }).click();
  await page.getByRole("button", { name: "期限なし", exact: true }).click();
  await expect(page.getByRole("heading", { name: "豆腐", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await expect(page).toHaveURL(/\/today\/result$/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("atoqueue:data:v1")!));
  expect(saved.tasks.map((task: { status: string }) => task.status)).toEqual(["active", "completed", "archived", "completed"]);
  expect(saved.tasks[0].dueMode).toBe("none");
  expect(saved.reviewSessions[0].answeredTaskIds).toEqual(["task-0", "task-1"]);
  expect(saved.actionHistory.map((event: { entityId: string }) => event.entityId)).toEqual(["task-0", "task-2", "task-3", "task-0", "task-1"]);
});
