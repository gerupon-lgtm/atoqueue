import { expect, test } from "@playwright/test";

test("notification settings explains privacy without requesting browser permission on load", async ({ page }) => {
  await page.addInitScript(() => {
    let requestCount = 0;
    Object.defineProperty(Notification, "requestPermission", {
      configurable: true,
      value: async () => { requestCount += 1; return "denied"; },
    });
    Object.defineProperty(window, "__notificationRequestCount", { configurable: true, value: () => requestCount });
  });

  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "通知" })).toBeVisible();
  await expect(page.getByText("タスク本文は通知サーバーへ送信しません。")) .toBeVisible();
  await expect(page.getByRole("button", { name: "通知を設定する" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __notificationRequestCount: () => number }).__notificationRequestCount())).toBe(0);
});

test("a user-triggered denied permission shows browser-settings guidance", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "requestPermission", { configurable: true, value: async () => "denied" });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
  });

  await page.goto("/settings");
  await page.locator("button[type=button]").click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("button[type=button]")).toBeDisabled();
});

test("a persisted unavailable notification state keeps the Today Review fallback visible", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("atoqueue:data:v1", JSON.stringify({
    schemaVersion: 2,
    appVersion: "0.1.0",
    device: { localDeviceId: "device", pushSubscriptionStatus: "unavailable" },
    settings: { locale: "ja-JP", timeZone: "Asia/Tokyo", notificationEnabled: false, weeklyReviewDay: 0 },
    captures: [], tasks: [], reviewSessions: [], actionHistory: [], notificationOutbox: [], reminderMap: [], savedAt: "2026-08-04T09:00:00.000Z",
  })));
  await page.goto("/settings");

  await expect(page.getByRole("alert")).toBeVisible();
});
