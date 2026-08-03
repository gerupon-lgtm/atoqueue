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
