import { expect, test } from "@playwright/test";

const now = "2026-08-03T09:00:00.000Z";

test("lists a task, opens its history, and persists a completion locally", async ({ page }) => {
  await page.addInitScript((snapshot) => window.localStorage.setItem("atoqueue:data:v1", JSON.stringify(snapshot)), {
    schemaVersion: 2,
    appVersion: "0.1.0",
    device: { localDeviceId: "device-1", pushSubscriptionStatus: "not_requested" },
    settings: { locale: "ja-JP", timeZone: "Asia/Tokyo", notificationEnabled: false, weeklyReviewDay: 0 },
    captures: [{ id: "capture-1", body: "元の記録", classification: "task", createdAt: now, updatedAt: now, linkedTaskId: "task-1" }],
    tasks: [{ id: "task-1", sourceCaptureId: "capture-1", title: "牛乳を買う", category: "shopping", status: "active", dueMode: "scheduled", dueAt: "2026-08-02T23:59:00.000Z", nextReviewAt: "2026-08-02T23:59:00.000Z", undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: now, revision: 1 }],
    reviewSessions: [], actionHistory: [], notificationOutbox: [], reminderMap: [], savedAt: now,
  });

  await page.goto("/tasks");
  await expect(page.getByRole("link", { name: "牛乳を買う" })).toBeVisible();
  await expect(page.getByLabel("牛乳を買うの期限状態")).toHaveText("期限超過");
  await page.getByRole("link", { name: "牛乳を買う" }).click();
  await expect(page.getByLabel("元の記録")).toHaveText("元の記録: 元の記録");
  await page.getByRole("button", { name: "完了" }).click();
  await expect(page.getByLabel("現在の状態")).toHaveText("状態: 完了");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("atoqueue:data:v1") ?? "{}").tasks[0]?.status)).toBe("completed");
});
