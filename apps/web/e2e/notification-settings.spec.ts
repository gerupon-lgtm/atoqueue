import { expect, test } from "@playwright/test";

test("notification settings explains privacy without requesting browser permission on load", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let requestCount = 0;
    Object.defineProperty(Notification, "requestPermission", {
      configurable: true,
      value: async () => {
        requestCount += 1;
        return "denied";
      },
    });
    Object.defineProperty(window, "__notificationRequestCount", {
      configurable: true,
      value: () => requestCount,
    });
  });

  await page.goto("/settings");

  await expect(
    page.getByRole("heading", { name: "通知", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("タスク本文は通知サーバーへ送信しません。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "通知を設定する" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & { __notificationRequestCount: () => number }
        ).__notificationRequestCount(),
      ),
    )
    .toBe(0);
});

test("a user-triggered denied permission shows browser-settings guidance", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "requestPermission", {
      configurable: true,
      value: async () => "denied",
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class {},
    });
  });

  await page.goto("/settings");
  const setupButton = page.getByRole("button", { name: "通知を設定する" });
  await setupButton.click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(setupButton).toBeDisabled();
});

test("a persisted unavailable notification state keeps the Today Review fallback visible", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.localStorage.setItem(
      "atoqueue:data:v1",
      JSON.stringify({
        schemaVersion: 2,
        appVersion: "0.1.0",
        device: {
          localDeviceId: "device",
          pushSubscriptionStatus: "unavailable",
        },
        settings: {
          locale: "ja-JP",
          timeZone: "Asia/Tokyo",
          notificationEnabled: false,
          weeklyReviewDay: 0,
        },
        captures: [],
        tasks: [],
        reviewSessions: [],
        actionHistory: [],
        notificationOutbox: [],
        reminderMap: [],
        savedAt: "2026-08-04T09:00:00.000Z",
      }),
    ),
  );
  await page.goto("/settings");

  await expect(page.getByRole("alert")).toBeVisible();
});

test("mobile settings keeps notification help actionable and app information on compact rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");

  const mechanism = page.getByText("通知の仕組みを見る");
  await expect(mechanism).toHaveCSS("border-style", "solid");
  await expect(mechanism).toHaveCSS("background-color", "rgb(244, 248, 244)");

  await page.getByText("アプリ情報", { exact: true }).click();
  const information = page.getByLabel("アプリ情報");
  await expect(information.getByText("mvp-1.14.0")).toBeVisible();
  await expect(
    information.locator("dt").filter({ hasText: "バージョン" }),
  ).toHaveCSS("white-space", "nowrap");
  await expect(information.getByText("端末間では同期しません")).toHaveCSS(
    "white-space",
    "nowrap",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("numeric timing fields select their full value before accepting replacement input", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");

  const time = page.getByLabel("期限の既定時刻");
  await time.click();
  await expect
    .poll(() =>
      time.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
    )
    .toEqual([0, 5]);
  await page.keyboard.type("1830");
  await expect(time).toHaveValue("18:30");

  const minutes = page.getByLabel("記録の初回通知まで（分）");
  await expect(minutes).toHaveAttribute("inputmode", "numeric");
  await expect(minutes).toHaveAttribute("type", "text");
  await minutes.click();
  await expect
    .poll(() =>
      minutes.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
    )
    .toEqual([0, 2]);
  await page.keyboard.type("90");
  await expect(minutes).toHaveValue("90");
});
